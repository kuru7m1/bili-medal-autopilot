  /* ==================================================================
   * 10. 页面状态（真实可见性，不受体验优化补丁影响）
   * ================================================================== */
  const nativeVisibility = (function () {
    try {
      const d = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
      if (d && d.get) return () => d.get.call(document);
    } catch (e) { /* ignore */ }
    return () => document.visibilityState;
  })();

  const PageState = {
    visible: true,
    focused: true,
    lastSeen: nowMs(),

    realVisible() {
      try { return nativeVisibility() === 'visible'; } catch (e) { return !document.hidden; }
    },

    init() {
      const sync = () => {
        this.visible = this.realVisible();
        this.lastSeen = nowMs();
        Engine.touch();
      };
      document.addEventListener('visibilitychange', sync);
      window.addEventListener('focus', () => { this.focused = true; this.lastSeen = nowMs(); Engine.touch(); });
      window.addEventListener('blur', () => { this.focused = false; Engine.touch(); });
      document.addEventListener('mousemove', () => { this.lastSeen = nowMs(); }, { passive: true });
      sync();
      return this;
    }
  };

  function currentPageRoomId() {
    const m = /^\/(?:blanc\/)?(\d{2,})/.exec(location.pathname);
    return m ? m[1] : '';
  }

  /* ==================================================================
   * 11. 任务引擎（双泳道调度：观时泳道 + 点赞弹幕泳道）
   * ================================================================== */
  const Engine = {
    running: false,
    paused: false,
    workers: [],
    busyTask: new Set(),
    busyWatch: new Set(),
    failState: new Map(),
    parked: new Map(),   /* 'roomId:task' -> {kind:'none'|'defer'} */
    noMedal: new Map(),  /* roomId -> 当天确认无粉丝牌的时刻 */
    _medalConfirmAt: 0,  /* 无牌确认（强制全量拉取）的全局限频 */
    _medalTryAt: 0,      /* 索引未知时的补拉限频 */
    syncing: false,
    _syncing: false,
    _syncAt: 0,
    watches: [],
    watchGuard: new Map(),
    runId: 0,
    starting: false,
    activeWatch: null,
    current: null,
    startedAt: 0,
    version: 0,
    emitTimer: null,
    listeners: new Set(),
    lastAllDoneAt: 0,
    _autoRestartAt: 0,
    statusAt: 0,
    tabs: new Map(),

    init() {
      Bus.on((msg) => {
        if (msg.type === 'tab') {
          this.tabs.set(msg.from, Object.assign({ at: nowMs() }, msg.data || {}));
        } else if (msg.type === 'config') {
          Cfg.load();
          this.touch();
        } else if (msg.type === 'daily') {
          /* 其它标签写盘后刷新显示；1 秒节流，避免高频计数时反复整块重绘 */
          if (nowMs() - (this._dailyLoadAt || 0) < 1000) return;
          this._dailyLoadAt = nowMs();
          Daily.load();
          this.touch();
        }
      });
      setInterval(() => {
        Bus.post('tab', { roomId: currentPageRoomId(), visible: PageState.visible, at: nowMs() });
        const now = nowMs();
        this.tabs.forEach((v, k) => {
          if (now - v.at > 20000) this.tabs.delete(k);
        });
      }, 6000);
      setInterval(() => this.tick(), 1500);
      return this;
    },

    on(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    },

    touch() {
      this.version++;
      if (this.emitTimer) return;
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        this.listeners.forEach((fn) => { try { fn(this.version); } catch (e) { /* ignore */ } });
      }, 400);
    },

    /* 用户是否正在看这个直播间（含其他标签页） */
    isBeingWatched(roomId) {
      if (!Cfg.v.avoidWatching) return false;
      const id = String(roomId);
      if (PageState.visible && String(currentPageRoomId()) === id) return true;
      let hit = false;
      this.tabs.forEach((v) => {
        if (hit) return;
        if (v && v.visible && String(v.roomId) === id) hit = true;
      });
      return hit;
    },

    /* 脚本侧观时并发上限：并行开关关闭时为 1，开启后取设定值，并按房间数收敛 */
    /* 用户设定的脚本并行路数（不做上限截断，只保证是正整数） */
    watchParallelWanted() {
      const w = Cfg.v.watch || {};
      if (!w.multiRoom) return 1;
      return Math.max(1, Math.round(Number(w.multiRoomMax) || 2));
    },

    /* 实际并发：不超过待处理房间数 */
    effectiveWatchParallel() {
      return Math.min(this.watchParallelWanted(), Math.max(1, this.entries().length));
    },

    /* 当前可见的直播间（本页优先，其次其它标签页上报的） */
    visibleRoomId() {
      const self = currentPageRoomId();
      if (self && PageState.visible) return String(self);
      let hit = '';
      this.tabs.forEach((v) => {
        if (hit) return;
        if (v && v.visible && v.roomId) hit = String(v.roomId);
      });
      return hit;
    },

    /* 记录「我自己看的观时」：只有主控写盘，避免多标签互相覆盖 */
    tickSelfWatch() {
      if (typeof Leader === 'undefined' || !Leader || !Leader.isLeader) return;
      const roomId = this.visibleRoomId();
      const now = nowMs();
      if (!roomId) { this._selfRoom = ''; this._selfAt = 0; return; }
      if (this._selfRoom !== roomId || !this._selfAt) {
        this._selfRoom = roomId;
        this._selfAt = now;
        return;
      }
      const meta = Data.room(roomId);
      /* 只有「直播中」的白名单房间才算作你自己在看；未开播/非白名单不计 */
      if (!meta || meta.liveStatus !== 1) { this._selfAt = 0; this._selfRoom = ''; return; }
      const delta = (now - this._selfAt) / 1000;
      if (delta < 3) return;
      this._selfAt = now;
      Daily.addSelf(meta, delta);
    },

    /* 这个房间此刻在干什么（给白名单卡片用） */
    roomActivity(id) {
      const rid = String(id);
      if (this.current && String(this.current.roomId) === rid) {
        return (TASK_NAME[this.current.name] || '任务') + ' 执行中';
      }
      for (let i = 0; i < this.watches.length; i++) {
        const w = this.watches[i];
        if (String(w.roomId) === rid) return '观时 ' + hms(w.done) + ' / ' + hms(w.total);
      }
      return '';
    },
    /* 以服务端 task_info 为准对账：修正本地的「已完成」标记，并补齐观时目标 */
    async syncTasks(force) {
      if (this._syncing) return;
      if (!force && nowMs() - this._syncAt < 10 * 60 * 1000) return;
      this._syncing = true;
      this._syncAt = nowMs();
      /* 顺带刷新粉丝牌（内部有 5 分钟缓存）：用户中途投喂得到新牌子时，
         不必等手动刷新就能被识别；无牌缓存按 has 优先，不会挡住新牌 */
      Data.refreshMedals(false);
      this.syncing = true;
      this.touch();
      const list = this.entries().slice(0, 50);
      let changed = 0;
      let ok = 0;
      try {
        for (let i = 0; i < list.length; i++) {
          const meta = await this.ensureRoom(list[i], false);
          if (!meta || !meta.uid) continue;
          const t = await Data.tasks(meta.uid, true);
          if (!t.ok) continue;
          ok++;
          const apply = (name, item) => {
            if (!item) return;
            const srvDone = isTaskDone(item);
            const local = Daily.isDone(meta, name);
            /* 开启超上限且设置值还没做满：服务端完成只代表做到了服务端上限，
               这里不能写「已完成」，否则任务会提前收工 */
            const keep = srvDone && this.keepOverflow(meta, name, item);
            if (srvDone && !keep) {
              if (!local) {
                Daily.done(meta, name, true);
                this.parked.delete(this.failKey(meta.roomId, name));
                changed++;
              }
            /* 服务端说没做完，或超上限还没做满：本地的完成标记作废，
               交给执行泳道按实际进度重排。已经做到自定义上限的保留，
               否则每次对账都会把「按设置值做满」的状态清掉 */
            } else if (local && !this.limitReached(meta, name)) {
              Daily.done(meta, name, false);
              changed++;
            }
          };
          apply('like', findTaskInfo(t.tasks, 'like'));
          apply('danmu', findTaskInfo(t.tasks, 'sendDanmu'));
          apply('watch', findTaskInfo(t.tasks, 'watchLive'));

          /* 储蓄亲密度（上限 100，投喂灯牌才能领取） */
          meta.freeIntimacy = Number(t.free) || 0;
          meta.freeReach = !!t.reachLimit;

          /* 点赞 / 弹幕次数以服务端 sub_title 为准（本地只记脚本自己发起的） */
          const li = findTaskInfo(t.tasks, 'like');
          if (li) {
            const lim = parseDailyLimit(li.sub_title);
            const per = parseTitleCount(li.title) || 30;
            if (lim) {
              Data.noteSrvMax(meta, 'like', lim.limit);
              const rr = Daily.get(meta);
              const srv = lim.current * per;
              if (srv > (Number(rr.likeSrv) || 0)) { rr.likeSrv = srv; Daily.saveSoon(); }
            }
          }
          const di = findTaskInfo(t.tasks, 'sendDanmu');
          if (di) {
            const lim = parseDailyLimit(di.sub_title);
            const per = parseTitleCount(di.title) || 1;
            if (lim) {
              Data.noteSrvMax(meta, 'danmu', lim.limit);
              const rr = Daily.get(meta);
              const srv = lim.current * per;
              if (srv > (Number(rr.danmuSrv) || 0)) { rr.danmuSrv = srv; Daily.saveSoon(); }
            }
          }

          /* 观时目标：轮次 × 每轮分钟（新加的房间也能立刻拿到） */
          const wi = findTaskInfo(t.tasks, 'watchLive');
          const lim = wi ? parseDailyLimit(wi.sub_title) : null;
          const mins = wi ? (parseTitleCount(wi.title) || 0) : 0;
          if (lim && mins) {
            Data.noteSrvMax(meta, 'watch', lim.limit);
            Data.setWatchTarget(meta, lim.limit * mins * 60, lim.limit, mins);
            /* 服务端认可的有效轮次（精度 = 每轮分钟数） */
            meta.watchSrvRounds = lim.current;
            meta.watchSrvAt = nowMs();
          }

          this.touch();
          await sleep(rand(200, 420));
        }
        if (changed) Log.log('同步', '与服务端对齐了 ' + changed + ' 个任务状态');
      } catch (e) {
        Log.warn('同步', '对账失败：' + (e.message || e));
      } finally {
        this._syncing = false;
        this.syncing = false;
        if (ok) this._syncAt = nowMs();
        this.touch();
      }
    },
    failKey(roomId, task) { return String(roomId) + ':' + task; },

    canTry(roomId, task) {
      if (this.parked.has(this.failKey(roomId, task))) return false;
      const f = this.failState.get(this.failKey(roomId, task));
      if (!f) return true;
      const wait = Math.min(30 * 60 * 1000, 90000 * Math.pow(2, Math.min(f.n, 5)));
      return nowMs() - f.at >= wait;
    },

    markFail(roomId, task) {
      const k = this.failKey(roomId, task);
      const f = this.failState.get(k) || { n: 0, at: 0 };
      f.n++;
      f.at = nowMs();
      this.failState.set(k, f);
    },

    markOk(roomId, task) {
      this.failState.delete(this.failKey(roomId, task));
    },

    retryInfo(roomId, task) {
      const f = this.failState.get(this.failKey(roomId, task));
      if (!f) return '';
      const wait = Math.min(30 * 60 * 1000, 90000 * Math.pow(2, Math.min(f.n, 5)));
      const left = Math.max(0, wait - (nowMs() - f.at));
      return '失败 ' + f.n + ' 次，' + Math.ceil(left / 1000) + 's 后重试';
    },

    entries() {
      const list = Array.isArray(Cfg.v.whitelist) ? Cfg.v.whitelist : [];
      const block = new Set((Cfg.v.blacklist || []).map(String));
      return list.filter((e) => e && e.roomId && !block.has(String(e.roomId)));
    },

    /* 元数据对应的白名单条目（短号房间用 meta.key 兜底匹配） */
    entryOf(meta) {
      if (!meta) return null;
      const list = Array.isArray(Cfg.v.whitelist) ? Cfg.v.whitelist : [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || !e.roomId) continue;
        if (String(e.roomId) === String(meta.roomId)) return e;
        if (meta.key && String(e.roomId) === String(meta.key)) return e;
      }
      return null;
    },

    /* 任务在该房间是否允许：总开关 && 房间开关 */
    taskOn(meta, name) {
      if (!Cfg.v.tasks[name]) return false;
      return roomTaskOn(this.entryOf(meta), name);
    },

    /* 某任务是否允许超过服务端上限。兼容旧配置里的布尔值 */
    brkOf(name) {
      const conf = Cfg.v.taskLimit || {};
      const b = conf.brk;
      if (typeof b === 'boolean') return b;
      return !!(b && b[name] === true);
    },

    /* 该任务的全局生效上限：
       设置值为空/0 —— 跟随服务端任务上限（服务端未知时返回 0，代表不设上限）；
       关闭 brk —— min(设置值, 服务端上限)；开启 brk —— 设置值。
       当前这次拉取没有服务端上限（未开播/未同步/接口失败）时，用该房间今天上次同步到的值兜底，
       避免看板滑块显示出高于服务端的上限 */
    globalLimitOf(meta, name) {
      if (name !== 'like' && name !== 'danmu' && name !== 'watch') return 0;
      const conf = Cfg.v.taskLimit || {};
      const g = Math.max(0, Math.round(Number(conf[name]) || 0));
      const live = this.progressOf(meta, name).srvMax;
      const srvMax = live > 0 ? live : Data.srvMaxOf(meta, name);
      if (g <= 0) return srvMax > 0 ? srvMax : 0;
      if (this.brkOf(name)) return g;
      return srvMax > 0 ? Math.min(g, srvMax) : g;
    },

    /* 该房间某项任务今天做多少：0 表示跟随服务端、不额外限制。
       房间设置只能调小，不能超过全局生效上限 */
    limitOf(meta, name) {
      if (name !== 'like' && name !== 'danmu' && name !== 'watch') return 0;
      const max = this.globalLimitOf(meta, name);
      const entry = this.entryOf(meta);
      const r = entry && entry.limits ? Math.max(0, Math.round(Number(entry.limits[name]) || 0)) : 0;
      if (r > 0) return max > 0 ? Math.min(r, max) : r;
      return max;
    },

    /* 启动时打印一行生效上限：设置值、是否允许超过服务端上限一眼可见，
       省得看日志时猜「我明明没开超上限，怎么还在做」 */
    limitSummary() {
      const one = (name, label, unit) => {
        const g = Math.max(0, Math.round(Number((Cfg.v.taskLimit || {})[name]) || 0));
        if (g <= 0) return label + ' 跟随服务端';
        return label + ' ' + g + unit + (this.brkOf(name) ? '（允许超上限）' : '（按服务端上限）');
      };
      return '任务上限：' + one('like', '点赞', ' 轮') + ' · ' + one('danmu', '弹幕', ' 条') +
        ' · ' + one('watch', '观时', ' 轮');
    },

    /* 开启超上限时的目标值（与 limitOf 分开，避免 progressOf 递归调用） */
    overTargetOf(meta, name) {
      if (!this.brkOf(name)) return 0;
      const g = Math.max(0, Math.round(Number((Cfg.v.taskLimit || {})[name]) || 0));
      if (g <= 0) return 0;
      const entry = this.entryOf(meta);
      const r = entry && entry.limits ? Math.max(0, Math.round(Number(entry.limits[name]) || 0)) : 0;
      return r > 0 ? Math.min(r, g) : g;
    },

    /* 开启超上限、且设置值还没做满时，服务端显示完成也不能算完成。
       是否继续以实际进度为准，不再看服务端 is_done */
    keepOverflow(meta, name) {
      if (!meta) return false;
      if (name !== 'like' && name !== 'danmu' && name !== 'watch') return false;
      if (!this.brkOf(name)) return false;
      if (Math.round(Number((Cfg.v.taskLimit || {})[name]) || 0) <= 0) return false;
      const target = this.limitOf(meta, name);
      if (!(target > 0)) return false;
      return this.progressOf(meta, name).cur < target;
    },

    /* 记下「服务端已经做到上限」这一刻的本地计数（点赞次数 / 弹幕条数 / 观时秒数）。
       之后多做的部分才能按轮次折算成进度；local 可由调用方指定，
       用于把「服务端还没计入、但已经发出去」的那一小批从基线里剔除 */
    markOverBase(meta, name, srvCur, local) {
      if (!meta) return null;
      const r = Daily.get(meta);
      const n = local === undefined
        ? (name === 'like' ? (Number(r.like) || 0)
          : name === 'danmu' ? (Number(r.danmu) || 0) : (Number(r.watch) || 0))
        : Math.max(0, Number(local) || 0);
      const base = { srv: Math.max(0, Math.round(Number(srvCur) || 0)), local: n };
      r.overBase[name] = base;
      Daily.saveSoon();
      return base;
    },

    /* 用户中途把上限调高、或从普通模式切到超上限时，清掉之前写下的「已完成」 */
    syncOverflowDone(meta) {
      if (!meta) return;
      ['like', 'danmu', 'watch'].forEach((name) => {
        if (this.keepOverflow(meta, name) && Daily.isDone(meta, name)) Daily.done(meta, name, false);
      });
    },

    /* 进度：srvCur/srvMax 是服务端原始值，cur 是用于判定与展示的实际进度。
       服务端到达上限后就不再计数；此时以「做到上限那一刻」的本地计数为基线，
       把之后实际发出的点赞/弹幕、实际心跳时长折算成轮次继续累加。
       这样进度能真正走到设置值，不会出现「5/10 ✓」这种假完成。 */
    progressOf(meta, name) {
      const t = Data.cachedTasks(meta && meta.uid);
      const jt = name === 'danmu' ? 'sendDanmu' : (name === 'watch' ? 'watchLive' : 'like');
      const item = t ? findTaskInfo(t.tasks, jt) : null;
      const lim = item ? parseDailyLimit(item.sub_title) : null;
      const srvCur = lim ? lim.current : 0;
      const srvMax = lim ? lim.limit : 0;
      if (srvMax > 0 && meta) Data.noteSrvMax(meta, name, srvMax);
      const srvDone = !!(item && (isTaskDone(item) || (srvMax > 0 && srvCur >= srvMax)));
      /* 每轮单位：点赞每轮多少次、弹幕 1 条、观时每轮多少秒 */
      const per = name === 'danmu' ? 1
        : (item ? (parseTitleCount(item.title) || 0) : 0) ||
          (name === 'watch' ? (Number(Cfg.v.watch.roundMinutes) || 15) : 30);
      const unit = name === 'watch' ? per * 60 : per;
      const r = meta ? Daily.get(meta) : null;
      const local = r ? (name === 'like' ? (Number(r.like) || 0)
        : name === 'danmu' ? (Number(r.danmu) || 0) : (Number(r.watch) || 0)) : 0;
      let cur = srvCur;
      const target = this.overTargetOf(meta, name);
      const atCap = !!lim && srvMax > 0 && srvCur >= srvMax;
      if (r && item && atCap && target > srvCur) {
        let base = r.overBase[name];
        if (unit > 0 && (!base || Number(base.srv) > srvCur || Number(base.local) > local)) {
          /* 兼容 1.35.0 的 overHit：按当时写下的目标反推基线，升级后不用重做。
             没有记录时，把服务端已计入的量折算成本地等价量：点赞/弹幕是逐次调用，
             脚本发出的前 srvCur×每轮单位 次就是服务端计入的那些，多出来的才是超上限部分。
             观时可能因心跳漂移本地偏多，保守取当前值 */
          const oldHit = Math.round(Number((r.overHit || {})[name]) || 0);
          const counted = (name === 'like' || name === 'danmu')
            ? Math.min(local, srvCur * unit)
            : local;
          const baseLocal = oldHit > srvCur
            ? Math.max(0, local - (oldHit - srvCur) * unit)
            : counted;
          base = this.markOverBase(meta, name, srvCur, baseLocal);
          if (oldHit) {
            delete r.overHit[name];
            Daily.saveSoon();
          }
        }
        if (base && unit > 0) {
          const extra = Math.max(0, local - (Number(base.local) || 0));
          /* 观时允许 1 秒误差（心跳 ok 的判定本身也留 1 秒） */
          cur = base.srv + Math.floor((extra + (name === 'watch' ? 1 : 0)) / unit);
        }
      }
      /* 服务端计数有延迟（弹幕尤其明显：一批发完才更新），截图里的 2/10 就是这么来的。
         分子同时参考本地实际完成量，取两者较大值：点赞按已点次数折轮、弹幕按已发条数、
         观时按已看时长折轮。分母仍由 limitOf 决定，不受这里影响 */
      if (r && unit > 0) {
        const localRounds = Math.floor((local + (name === 'watch' ? 1 : 0)) / unit);
        if (localRounds > cur) cur = localRounds;
      }
      return { cur: Math.max(cur, srvCur), srvCur: srvCur, srvMax: srvMax, srvDone: srvDone };
    },

    /* 是否已经做到自定义上限（做成即视为完成，不再占用调度） */
    limitReached(meta, name) {
      if (name !== 'like' && name !== 'danmu' && name !== 'watch') return false;
      const max = this.limitOf(meta, name);
      if (!max) return false;
      return this.progressOf(meta, name).cur >= max;
    },

    /* 储蓄亲密度已满：只维持点亮，其余任务都不再产生收益 */
    isFreeFull(meta) {
      if (!meta || !Cfg.v.freeFullLite) return false;
      if (meta.freeReach) return true;
      return Number(meta.freeIntimacy) >= 100;
    },

    /* 「全部完成」要按房间开关算：关掉的任务不参与未完成判定 */
    allDone(meta) {
      /* 确定没有粉丝牌的房间：五个任务都不可能产生收益，按「不适用」计入完成，
         否则引擎永远等不到「全部完成」 */
      if (meta && Data.medalState(meta) === 'none') return true;
      /* 开启超上限且还没做满时，之前落盘的「已完成」要清掉，否则会提前收工 */
      this.syncOverflowDone(meta);
      const full = this.isFreeFull(meta);
      const basic = Daily.allDone(meta, (name) =>
        this.taskOn(meta, name) && !(full && name !== 'light') &&
        !this.limitReached(meta, name));
      if (!basic) return false;
      /* 分享每天只有一次机会，且服务端没有可对账的进度：
         「还没尝试」不能算完成，否则四项主任务做完就自动停机，分享永远轮不到。
         已尝试（shareTried）、服务端没有该任务、被限制时都算终止状态 */
      if (!this.taskOn(meta, 'share') || full) return true;
      const r = Daily.get(meta);
      if (r.done && r.done.share) return true;
      if (r.shareTried) return true;
      const pk = this.parked.get(this.failKey(meta.roomId, 'share'));
      if (pk && (pk.kind === 'none' || pk.kind === 'blocked')) return true;
      return false;
    },

    /* 房间开关被关掉时立即停止正在执行的任务 */
    stopRoomTask(roomId, name) {
      const rid = String(roomId);
      if (name === 'watch') {
        this.watches.slice().forEach((s) => {
          if (s && String(s.roomId) === rid && s.heart) s.heart.stop();
        });
      }
      /* 点赞 / 弹幕的循环通过 taskSleep 感知开关变化，逐批退出 */
      this.touch();
    },

    /* 可中断的等待：任务被关掉或引擎停止时尽早返回 false */
    async taskSleep(ms, meta, name) {
      const end = nowMs() + Math.max(0, ms | 0);
      /* 进入等待时的轮次：刷新/停止会让它作废，等待提前结束 */
      const runId = this.runId;
      while (nowMs() < end) {
        if (!this.running || this.runId !== runId) return false;
        if (meta && name && !this.taskOn(meta, name)) return false;
        await sleep(Math.min(500, Math.max(1, end - nowMs())));
      }
      return this.running && this.runId === runId && (!meta || !name || this.taskOn(meta, name));
    },

    /* 房间元数据持久化后，只有「从没解析过」才发请求；开播状态改由批量接口刷新 */
    async ensureRoom(entry, force) {
      const id = String(entry.roomId);
      const cached = Data.room(id);
      if (!force && cached && cached.uid && cached.areaId) {
        if (!cached.key) cached.key = id;
        return cached;
      }
      try {
        const init = await API.roomInit(id);
        const info = await API.roomInfo(init.roomId);
        const meta = Data.putRoom({
          key: id,
          roomId: init.roomId,
          shortId: init.shortId,
          uid: init.uid,
          uname: (info && info.uname) || entry.uname || '',
          liveStatus: info ? info.liveStatus : init.liveStatus,
          areaId: info ? info.areaId : 0,
          parentAreaId: info ? info.parentAreaId : 0,
          title: info ? info.title : '',
          at: nowMs()
        });
        /* 短号与真实房间号都做别名，避免每次循环都重新请求 */
        if (meta && String(meta.roomId) !== id) Data.rooms.set(id, meta);
        return meta;
      } catch (e) {
        Log.warn('数据', '解析直播间 ' + id + ' 失败：' + (e.message || e));
        return null;
      }
    },

    /* 一次请求刷新白名单所有房间的开播状态（替代逐房间 getInfoByRoom） */
    async refreshStatuses(force) {
      if (!force && nowMs() - this.statusAt < 120000) return;
      const list = this.entries();
      const uids = [];
      list.forEach((e) => {
        const m = Data.room(String(e.roomId));
        if (m && m.uid) uids.push(m.uid);
      });
      if (!uids.length) return;
      this.statusAt = nowMs();
      try {
        const map = await API.roomStatusByUids(uids);
        let changed = 0;
        list.forEach((e) => {
          const m = Data.room(String(e.roomId));
          if (!m || !m.uid) return;
          const d = map[m.uid] || map[String(m.uid)];
          if (!d) return;
          if (d.live_status != null && Number(d.live_status) !== Number(m.liveStatus)) {
            m.liveStatus = Number(d.live_status);
            changed++;
          }
          if (d.title) m.title = String(d.title);
          if (d.uname) m.uname = String(d.uname);
          m.at = nowMs();
        });
        Data.saveRooms();
        if (changed) this.touch();
      } catch (e) {
        Log.warn('数据', '刷新开播状态失败：' + (e.message || e));
      }
    },

    /* 任务此刻是否可做：off / done / nomedal / ready / waitLive / waitOffline */
    taskState(meta, name) {
      if (!meta) return 'off';
      if (!this.taskOn(meta, name)) return 'off';
      /* 超上限未做满时，服务端/历史写下完成都不算完成 */
      if (this.keepOverflow(meta, name) && Daily.isDone(meta, name)) Daily.done(meta, name, false);
      if (Daily.isDone(meta, name)) return 'done';
      /* 做到自己设的上限就当作完成：不再进入调度，卡片显示 ✓ */
      if (this.limitReached(meta, name)) return 'done';
      /* 确定没有粉丝牌：五项都做不了，统一显示「无牌」，不再逐项执行
         （索引未加载成功属于未知，放行，交给任务自身判断） */
      if (Data.medalState(meta) === 'none') return 'nomedal';
      /* 满储：只做点亮，点赞/弹幕/观时/分享全部跳过 */
      if (this.isFreeFull(meta) && name !== 'light') return 'skip';
      /* 分享每天只有一次机会：接口调用过就固定显示「待确认」，
         刷新插件、清空内存 park 都不会让它重跑 */
      if (name === 'share' && Daily.get(meta).shareTried) return 'defer';
      const st = meta.liveStatus;
      const known = st === 0 || st === 1 || st === 2;
      const live = st === 1;
      if (name === 'like') {
        if (known && !live) return 'waitLive';
      } else if (name === 'watch') {
        /* pick('watch') 要求该房间点亮已完成，这里同步反映，
           避免看板显示「可做」却永远轮不到；点亮本身被关掉时不再等待 */
        if (this.taskOn(meta, 'light') && !Daily.isDone(meta, 'light')) return 'waitLight';
        if (Cfg.v.watch.requireLive && known && !live) return 'waitLive';
      } else if (name === 'danmu') {
        if (known && live && Cfg.v.danmu.onlyWhenNotLive) return 'waitOffline';
      }
      return 'ready';
    },

    /* 这个房间现在有没有「能立刻做」的任务 */
    hasWork(meta) {
      if (!meta) return false;
      const names = ['light', 'share', 'like', 'danmu'];
      for (let i = 0; i < names.length; i++) {
        if (this.taskState(meta, names[i]) !== 'ready') continue;
        if (!this.canTry(meta.roomId, names[i])) continue;
        return true;
      }
      return false;
    },

    /* 房间级资格判定：
       has     —— 直接放行
       unknown —— 索引还没加载成功（网络/登录问题），照常执行，后台限频补拉，绝不误杀
       none    —— 当天第一次遇到时强制拉一次确认；确认仍没有就记下来，之后直接跳过 */
    async medalOk(meta) {
      const st = Data.medalState(meta);
      if (st === 'has') return true;
      if (st === 'unknown') {
        if (nowMs() - this._medalTryAt > 60 * 1000) {
          this._medalTryAt = nowMs();
          Data.refreshMedals(false);
        }
        return true;
      }
      const rid = String(meta.roomId);
      if (this.noMedal.has(rid)) return false;
      if (nowMs() - this._medalConfirmAt > 10 * 60 * 1000) {
        this._medalConfirmAt = nowMs();
        await Data.refreshMedals(true);
        if (Data.medalState(meta) === 'has') {
          this.noMedal.delete(rid);
          return true;
        }
      }
      this.noMedal.set(rid, nowMs());
      Log.log('牌', '房间 ' + rid + (meta.uname ? '（' + meta.uname + '）' : '') +
        ' 不在粉丝牌列表，今日跳过');
      return false;
    },

    /* 手动「刷新状态」后清掉无牌缓存，下次遇到会重新确认 */
    resetMedalCache() {
      this.noMedal.clear();
      this._medalConfirmAt = 0;
      this._medalTryAt = 0;
    },

    /* 挑一个房间并「当场占位」，避免多个 worker 同时选中同一个房间 */
    async pick(kind) {
      const list = this.entries();
      for (let i = 0; i < list.length; i++) {
        const meta = await this.ensureRoom(list[i], false);
        if (!meta) continue;
        const id = meta.roomId;
        if (!(await this.medalOk(meta))) continue;

        if (kind === 'watch') {
          if (this.busyWatch.has(id)) continue;
        if (this.watchGuard && this.watchGuard.has(String(id))) continue;
          if (this.taskState(meta, 'watch') !== 'ready') continue;
          if (!this.canTry(id, 'watch')) continue;
          if (this.isBeingWatched(id)) continue;
          if (this.taskOn(meta, 'light') && !Daily.isDone(meta, 'light')) continue;
          if (this.allDone(meta)) continue;
          this.busyWatch.add(id);
          return meta;
        } else {
          if (this.busyTask.has(id)) continue;
          if (!this.hasWork(meta)) continue;
          this.busyTask.add(id);
          return meta;
        }
      }
      return null;
    },

    async doRoomTasks(meta) {
      const roomId = meta.roomId;
      const runId = this.runId;
      const order = ['light', 'share', 'like', 'danmu'];
      for (let i = 0; i < order.length; i++) {
        if (!this.running) return;
        const name = order[i];
        if (this.taskState(meta, name) !== 'ready') continue;
        if (!this.canTry(roomId, name)) continue;
        this.current = { roomId: roomId, name: name, text: '执行中' };
        this.touch();
        let res;
        try {
          const opt = {};
          if (name === 'danmu') opt.maxCount = this.limitOf(meta, name);
          else if (name === 'like' || name === 'watch') opt.maxRounds = this.limitOf(meta, name);
          res = await Tasks[name](meta, opt);
        } catch (e) {
          res = { status: 'fail', reason: e.message || '异常' };
        }
        /* 执行途中用户点了停止/刷新：不记失败、不写红字，直接收工。
           刷新会立刻起新一轮（runId 已变），旧任务不能把结果写到新一轮头上 */
        if (!this.running || this.runId !== runId) {
          if (this.runId === runId) this.current = null;
          this.touch();
          return;
        }
        if (res.status === 'done') {
          Daily.done(meta, name, true);
          this.markOk(roomId, name);
        } else if (res.status === 'skip') {
          Daily.done(meta, name, true);
          this.markOk(roomId, name);
          Log.log(TASK_NAME[name], '房间 ' + roomId + ' 跳过：' + (res.reason || ''));
        } else if (res.status === 'defer') {
          this.parked.set(this.failKey(roomId, name), { kind: 'defer' });
          Log.warn(TASK_NAME[name], '房间 ' + roomId + ' 已暂停该任务：' + (res.reason || ''));
        } else if (res.status === 'na') {
          this.parked.set(this.failKey(roomId, name), { kind: 'none' });
          Log.log(TASK_NAME[name], '房间 ' + roomId + ' 服务端没有这个任务：' + (res.reason || ''));
        } else if (res.status === 'blocked') {
          this.parked.set(this.failKey(roomId, name), { kind: 'blocked' });
          Log.warn(TASK_NAME[name], '房间 ' + roomId + ' 被限制：' + (res.reason || '无权限') + '，今天不再尝试该任务');
        } else if (res.status === 'halt') {
          /* 房间任务开关被关掉：不记失败、不写完成，等用户重新打开 */
          Log.log(TASK_NAME[name], '房间 ' + roomId + ' 的该任务已关闭，本次中断');
        } else {
          this.markFail(roomId, name);
          Daily.setErr(meta, (TASK_NAME[name] || name) + '：' + (res.reason || '失败'), name);
          Log.warn(TASK_NAME[name], '房间 ' + roomId + ' 未完成：' + (res.reason || '未知'));
        }
        this.touch();
        await sleep(rand(800, 1600));
      }
      if (this.allDone(meta)) {
        Log.ok('任务', '房间 ' + roomId + (meta.uname ? '（' + meta.uname + '）' : '') + ' 今日任务全部完成');
      }
      this.current = null;
      this.touch();
    },

    async riskWait() {
      if (!Net.blocked()) return false;
      const left = Net.blockedLeft();
      if (!this._riskLogAt || nowMs() - this._riskLogAt > 60000) {
        this._riskLogAt = nowMs();
        Log.warn('引擎', '风控冷却中，剩余 ' + Math.ceil(left / 1000) + ' 秒，任务暂停（可在设置页手动解除）');
      }
      await sleep(Math.min(left + 500, 60000));
      return true;
    },

    async taskWorker(runId) {
      Log.log('引擎', '点赞/弹幕泳道已启动');
      while (this.running && this.runId === runId) {
        if (await this.riskWait()) continue;
        let meta = null;
        try {
          meta = await this.pick('task');
        } catch (e) { /* ignore */ }
        if (!meta) {
          await sleep(4000);
          continue;
        }
        /* pick() 期间可能被停止/重启：旧泳道不能再进入任务，否则会多出一条泳道 */
        if (!this.running || this.runId !== runId) {
          this.busyTask.delete(meta.roomId);
          return;
        }
        try {
          await this.doRoomTasks(meta);
        } catch (e) {
          Log.error('引擎', '任务泳道异常：' + (e.message || e));
        } finally {
          this.busyTask.delete(meta.roomId);
        }
        await sleep(rand(600, 1200));
      }
      Log.log('引擎', '点赞/弹幕泳道已停止');
    },

    /* 并发上限可能因为「本人开始看直播」或用户改设置而变小；这里把超出的观时主动收掉 */
    guardWatchConcurrency() {
      const cap = this.effectiveWatchParallel();
      while (this.watches.length > cap) {
        const slot = this.watches.pop();
        if (slot && slot.heart) slot.heart.stop();
        if (slot) Log.log('观时', '超出并发上限，已停止房间 ' + slot.roomId + ' 的心跳');
      }
    },

    async watchWorker(runId) {
      Log.log('引擎', '观时泳道已启动');
      while (this.running && this.runId === runId) {
        if (await this.riskWait()) continue;
        const parallel = this.effectiveWatchParallel();
        if (this.watches.length >= parallel) {
          await sleep(2000);
          continue;
        }
        let meta = null;
        try {
          meta = await this.pick('watch');
        } catch (e) { /* ignore */ }
        if (!meta) {
          await sleep(5000);
          continue;
        }
        /* 同上：停止/重启后旧泳道不得再启动观时 */
        if (!this.running || this.runId !== runId) {
          this.busyWatch.delete(meta.roomId);
          return;
        }
        let res;
        try {
          /* 把生效上限传给观时：以前没传，单次会话会按服务端剩余轮次一直挂，
             用户设的 1 轮也会被做满 5 轮 */
          const opt = {};
          const maxRounds = this.limitOf(meta, 'watch');
          if (maxRounds > 0) opt.maxRounds = maxRounds;
          res = await Tasks.watch(meta, opt);
        } catch (e) {
          res = { status: 'fail', reason: e.message || '异常' };
        } finally {
          this.busyWatch.delete(meta.roomId);
        }
        /* 旧轮次的结果只能丢弃：不能给新一轮写完成或红字 */
        if (!this.running || this.runId !== runId) {
          this.touch();
          return;
        }
        if (res.status === 'done') {
          Daily.done(meta, 'watch', true);
          this.markOk(meta.roomId, 'watch');
        } else if (res.status === 'skip') {
          Daily.done(meta, 'watch', true);
          this.markOk(meta.roomId, 'watch');
        } else if (res.status === 'halt') {
          Log.log('观时', '房间 ' + meta.roomId + ' 本次中断（主动停止或开关关闭）');
        } else if (!this.running) {
          /* 用户停止/刷新：不算失败，也不写红字 */
        } else if (res.status === 'na') {
          /* 服务端没有观看任务（无粉丝牌的直播间就是这种）：当天不再重试，
             以前这里被当成失败，会每 30 分钟重试一次并反复刷红字 */
          this.parked.set(this.failKey(meta.roomId, 'watch'), { kind: 'none' });
          Log.log('观时', '房间 ' + meta.roomId + ' 服务端没有观看任务：' + (res.reason || ''));
        } else if (res.quiet) {
          /* 后台节流导致的心跳失效：记退避重试，但不写红字、不打扰用户 */
          this.markFail(meta.roomId, 'watch');
          Log.warn('观时', '房间 ' + meta.roomId + ' 本次会话中断：' + (res.reason || '心跳失效'));
        } else {
          this.markFail(meta.roomId, 'watch');
          Daily.setErr(meta, '观时：' + (res.reason || '失败'), 'watch');
        }
        this.touch();
        await sleep(rand(800, 1500));
      }
      Log.log('引擎', '观时泳道已停止');
    },

    async start() {
      if (this.running) return;
      this.starting = true;
      try {
        /* 接管执行权时以磁盘为准：待命标签的内存快照可能已经落后，
           直接跑会按旧的 done/计数执行，下一次写盘还会覆盖新进度 */
        Daily.reload();
        Daily.rollover();
        Cfg.load();
        if (!Array.isArray(Cfg.v.whitelist) || !Cfg.v.whitelist.length) {
          Log.warn('引擎', '任务列表为空，请先在「任务看板」中添加直播间');
          return;
        }
        this.running = true;
        this.paused = false;
        this.startedAt = nowMs();
        /* 记在本标签页的 sessionStorage 里：刷新后仍能认出「这一页原本在跑」，
           新开的标签页没有这个标记，保持待命 */
        try { sessionStorage.setItem('bma.leaderTab', '1'); } catch (e) { /* ignore */ }
        Log.ok('引擎', '开始执行，共 ' + this.entries().length + ' 个直播间');
        Log.log('引擎', this.limitSummary());
        Bus.post('engine', { running: true });
        this.touch();

        await Auth.ensure();
        if (!this.running) return;
        /* 必须等粉丝牌索引就绪再起泳道：以前这里发了不等，启动瞬间分享/点亮会
           读到空索引，把有牌的房间误判成「无粉丝牌」并 park 一整天 */
        await Data.ensureMedals(10000);
        if (!this.running) return;
        if (!Data.medalsAt) {
          Log.warn('数据', '粉丝牌尚未加载成功，本次按「未知」放行，执行中会继续重试');
        } else {
          Log.log('数据', '粉丝牌索引已就绪，共 ' + Data.count + ' 个');
        }
        this.syncTasks(false);

        const runId = ++this.runId;
        this.workers = [this.taskWorker(runId), this.watchWorker(runId)];
        /* 启动时按配置上限铺满 worker；每轮循环内再按「账号总并发」动态收敛 */
        /* 只为「不超过房间数」的 worker 起泳道，避免配置很大时白起一堆空转任务 */
        const parallel = Math.min(this.watchParallelWanted(), Math.max(1, this.entries().length));
        for (let i = 1; i < parallel; i++) this.workers.push(this.watchWorker(runId));
      } catch (e) {
        this.running = false;
        Log.error('引擎', '启动失败：' + (e.message || e));
        this.touch();
      } finally {
        this.starting = false;
      }
    },

    stop(reason) {
      if (!this.running) return;
      this.running = false;
      try { sessionStorage.removeItem('bma.leaderTab'); } catch (e) { /* ignore */ }
      this.runId++;   /* 让上一轮的 worker 立即退出，避免刷新时出现重复泳道 */
      this.paused = false;
      this.watches.forEach((s) => { if (s.heart) s.heart.stop(); });
      this.watches = [];
      /* watchGuard / busyWatch 故意不清：旧会话的请求可能还在路上，
         由 Tasks.watch 的 finally 与泳道的 finally 释放。清掉会让新一轮对同一房间
         再起一个观时会话，两个心跳互相干扰 seq */
      /* busyTask 故意不清：在途任务会在下一个检查点退出并自行释放锁。
         清掉的话，刷新后新泳道会立刻重选同一房间，和尚未退出的旧任务并发发送 */
      this.current = null;
      Log.log('引擎', '已停止' + (reason ? '（' + reason + '）' : ''));
      Bus.post('engine', { running: false });
      this.touch();
    },

    toggle() {
      if (this.running) this.stop('手动停止');
      else this.start();
    },

    tick() {
      if (Daily.rollover()) {
        /* 新的一天：昨天 park 的任务（无任务/待确认）必须重新尝试，
           否则挂机过夜后这些房间整天都不会再跑 */
        this.parked.clear();
        this.failState.clear();
        this.noMedal.clear();
        this._medalConfirmAt = 0;
        this._medalTryAt = 0;
      }
      this.tickSelfWatch();
      if (this.running || (typeof UI !== 'undefined' && UI && UI.openNow)) this.refreshStatuses(false);
      if (this.running) this.syncTasks(false);
      if (this.running) this.guardWatchConcurrency();
      if (!this.running) {
        /* 跨天停止后，等到 00:05 自动恢复 */
        if (Cfg.v.autoStart && Leader && Leader.isLeader && this.entries().length) {
          const d = new Date();
          const h = d.getHours();
          const m = d.getMinutes();
          if (h === 0 && m >= 5 && m < 30 && nowMs() - this._autoRestartAt > 5 * 60 * 1000) {
            this._autoRestartAt = nowMs();
            Log.log('引擎', '已跨天，自动恢复执行');
            this.start();
          }
        }
        return;
      }
      if (isCrossDayDanger()) {
        this.stop('即将跨天');
        return;
      }
      const entries = this.entries();
      if (!entries.length) return;
      /* 启动流程还没铺完泳道时不要判定收工：此时 done 可能来自昨天/上一个标签页，
         一旦判定成功就会把刚启动的引擎停掉 */
      if (this.starting) return;
      let unresolved = 0;
      const allDone = entries.every((e) => {
        const meta = Data.room(e.roomId);
        if (!meta) { unresolved++; return true; }
        return this.allDone(meta);
      });
      if (unresolved === entries.length) return;
      if (allDone && nowMs() - this.lastAllDoneAt > 60 * 1000) {
        this.lastAllDoneAt = nowMs();
        Log.ok('引擎', '任务看板内所有直播间今日任务已完成');
        Notify.push('bilibili粉丝团任务工具', entries.length + ' 个直播间的今日任务已全部完成');
        this.stop('全部完成');
      }
    },

    summary() {
      const out = [];
      const list = Array.isArray(Cfg.v.whitelist) ? Cfg.v.whitelist : [];
      const blockedSet = new Set((Cfg.v.blacklist || []).map(String));
      const cur = this.current;
      list.forEach((e) => {
        if (!e || !e.roomId) return;
        const key = String(e.roomId);
        const meta = Data.room(key);
        const id = meta ? meta.roomId : e.roomId;
        const d = Daily.get(meta || { roomId: id });
        const mm = meta || { roomId: id, uid: e.uid };
        /* 每项任务的自定义上限与服务端进度（卡片显示 n/m 用） */
        const limitsOf = {
          like: this.limitOf(mm, 'like'),
          danmu: this.limitOf(mm, 'danmu'),
          watch: this.limitOf(mm, 'watch')
        };
        const progOf = {
          like: this.progressOf(mm, 'like'),
          danmu: this.progressOf(mm, 'danmu'),
          watch: this.progressOf(mm, 'watch')
        };
        /* 三态：has / none / unknown（unknown 只在索引没加载成功时出现） */
        const medalState = Data.medalState(meta || { roomId: id, uid: e.uid });
        /* 看板展示用的粉丝牌等级与亲密度：只读已加载的索引，不额外请求。
           房间号索引缺失时按 uid 兜底（改名/换房间号的情况） */
        const medalItem = medalState === 'has'
          ? (Data.medalOf(id) || (e.uid ? Data.medalByUid(e.uid) : null))
          : null;
        const medalMeta = (medalItem && medalItem.medal) || {};
        const stateOf = (name) => {
          const pk = this.parked.get(this.failKey(id, name));
          const st = pk ? (pk.kind === 'none' ? 'na' : (pk.kind === 'blocked' ? 'blocked' : 'defer'))
            : (meta ? this.taskState(meta, name) : (Cfg.v.tasks[name] ? 'ready' : 'off'));
          if (st === 'off' || st === 'done') return st;
          if (cur && cur.roomId === id && cur.name === name) return 'run';
          if (name === 'watch' && this.watches.some((w) => String(w.roomId) === String(id))) return 'run';
          /* 满储跳过优先于旧的 park 记录：策略跳过不是失败 */
          if (meta && this.isFreeFull(meta) && name !== 'light') return 'skip';
          if (this.retryInfo(id, name)) return 'retry';
          return st;
        };
        const tasks = {
          light: stateOf('light'),
          like: stateOf('like'),
          danmu: stateOf('danmu'),
          watch: stateOf('watch'),
          share: stateOf('share')
        };
        const ready = [];
        const waiting = [];
        Object.keys(tasks).forEach((name) => {
          const st = tasks[name];
          if (st === 'ready' || st === 'run') ready.push(TASK_NAME[name]);
          else if (st === 'waitLive') waiting.push(TASK_NAME[name] + '（等开播）');
          else if (st === 'waitOffline') waiting.push(TASK_NAME[name] + '（等下播）');
          else if (st === 'waitLight') waiting.push(TASK_NAME[name] + '（待点亮）');
        });
        out.push({
          key: key,
          roomId: id,
          uname: (meta && meta.uname) || e.uname || '',
          liveStatus: meta ? meta.liveStatus : null,
          blocked: blockedSet.has(key),
          tasks: tasks,
          ready: ready,
          waiting: waiting,
          counts: {
            like: d.like,
            danmu: d.danmu,
            watch: d.watch,
            self: Number(d.self) || 0,
            likeSrv: Number(d.likeSrv) || 0,
            danmuSrv: Number(d.danmuSrv) || 0
          },
          limits: limitsOf,
          prog: progOf,
          target: Data.watchTargetOf(meta),
          srvRounds: Number(meta && meta.watchSrvRounds) || 0,
          srvWatch: (Number(meta && meta.watchSrvRounds) || 0) * (Number(meta && meta.watchRoundMin) || 0) * 60,
          free: Number(meta && meta.freeIntimacy) || 0,
          freeReach: !!(meta && meta.freeReach),
          rounds: Number(meta && meta.watchRounds) || 0,
          roundMin: Number(meta && meta.watchRoundMin) || 0,
          activity: this.roomActivity(id),
          err: (d.err && nowMs() - (Number(d.errAt) || 0) < 10 * 60 * 1000) ? d.err : '',
          medal: medalState === 'has',
          medalInfo: medalItem ? {
            level: Number(medalMeta.level) || 0,
            intimacy: Number(medalMeta.intimacy) || 0,
            next: Number(medalMeta.next_intimacy) || 0,
            lit: Number(medalMeta.is_lighted) === 1
          } : null,
          medalState: medalState,
          medalLoading: !!Data.medalsLoading
        });
      });
      return out;
    }
  };

  /* 简单的桌面通知 */
  const Notify = {
    push(title, body) {
      if (!Cfg.v.notify) return;
      try {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
          new Notification(title, { body: body, tag: 'bma', silent: false });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then((p) => {
            if (p === 'granted') new Notification(title, { body: body, tag: 'bma' });
          });
        }
      } catch (e) { /* ignore */ }
    }
  };
