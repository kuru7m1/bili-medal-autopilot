  /* ==================================================================
   * 7. 配置 / 每日记录 / 数据层
   * ================================================================== */
  const DEFAULT_DANMU = [
    '(⌒▽⌒)', '（￣▽￣）', '(°∀°)ﾉ', '(｀・ω・´)', '(･∀･)',
    '╮(￣▽￣)╭', '_(:3」∠)_', '(●￣(ｴ)￣●)', '(ノ≧∇≦)ノ', '←◡←'
  ];
  const DEFAULT_LIGHT_DANMU = ['[dog]', '[花]', '[妙]', '[哇]', '[爱]', '[惊喜]', '[OK]', '[牛]'];

  const DEFAULT_CONFIG = {
    version: 1,
    autoStart: true,
    avoidWatching: true,
    notify: true,
    showFreeIntimacy: true,
    /* 执行队列卡片上显示粉丝牌等级与亲密度（当前 / 升级所需） */
    showMedalBar: true,
    /* 储蓄亲密度达到该值时，看板卡片上的数字标红（上限 100，0 表示不标红） */
    freeWarnAt: 80,
    whitelist: [],
    blacklist: [],
    tasks: { light: true, like: true, danmu: true, watch: true, share: true },
    /* 储蓄亲密度满 100 时只维持点亮：跳过观时与分享，保留点亮/点赞/弹幕。
       实测满储时点赞/弹幕仍算「今日互动」，可以保持灯牌点亮 */
    freeFullLite: true,
    /* 每项任务每天做多少：0 或留空 = 跟随服务端任务上限（默认）。
       填写数字则按该值执行：关闭 brk 时取 min(设置值, 服务端上限)，开启 brk 时按设置值。
       like 按轮、danmu 按条、watch 按轮；房间可在「任务开关」里单独调小。
       show 控制看板是否显示 n/m，关闭只隐藏显示，上限仍然生效。 */
    taskLimit: {
      like: 0,
      danmu: 0,
      watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    },
    like: {
      batchMin: 10,
      batchMax: 20,
      gapMin: 8,
      gapMax: 18,
      capClicks: 310
    },
    danmu: {
      list: DEFAULT_DANMU.slice(),
      lightList: DEFAULT_LIGHT_DANMU.slice(),
      /* true = 优先发送主播直播间/粉丝团的免费表情，取不到或发送失败时改用下面的文字列表 */
      useRoomEmoticons: true,
      /* true = 只在未开播的直播间发弹幕（默认）；false = 开播中也发 */
      onlyWhenNotLive: true,
      gapMin: 8,
      gapMax: 16
    },
    watch: {
      roundMinutes: 15,
      /* 每次心跳成功后是否写一条日志 */
      logHeartbeat: true,
      /* 观时是否只在主播开播时才做。实测未开播的直播间同样能记录观时，故默认关闭 */
      requireLive: false,
      /* 是否允许同时挂多个直播间（实测同一账号同一时间只记录一个） */
      multiRoom: false,
      multiRoomMax: 2,
      /* 切到后台时是否继续发心跳。默认开启：后台继续，但浏览器会降频，
         进度可能变慢；关闭后后台暂停，回到前台重新对齐后续挂 */
      bgContinue: true
    },
    risk: {
      /* 保守模式：全局请求最小间隔 */
      conservative: true,
      gapMs: 1500,
      /* 单个接口撞风控后的冷却基数（分钟，连续触发会翻倍） */
      cooldownMin: 2,
      /* 同一接口连续撞几次就熔断 */
      epStrikes: 3,
      /* 熔断时长（分钟） */
      epDisableMin: 5,
      /* 多接口同时出事时的账号级全局暂停（分钟） */
      globalCooldownMin: 3,
      v2: true
    },
    enhance: {
      /* 首页自动播放的直播自动暂停 */
      pauseHome: true
    }
  };

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  /* 深拷贝合并：必须把 base 里的嵌套对象也复制出来，
     否则 Cfg.v 会直接引用 DEFAULT_CONFIG 的子对象，运行时改一处配置就把默认值改掉了。 */
  function cloneDeep(v) {
    if (Array.isArray(v)) return v.slice();
    if (isPlainObject(v)) {
      const out = {};
      Object.keys(v).forEach((k) => { out[k] = cloneDeep(v[k]); });
      return out;
    }
    return v;
  }

  function mergeDeep(base, patch) {
    const out = cloneDeep(base);
    if (!isPlainObject(patch)) return out;
    Object.keys(patch).forEach((k) => {
      const bv = out[k];
      const pv = patch[k];
      if (isPlainObject(bv) && isPlainObject(pv)) out[k] = mergeDeep(bv, pv);
      else if (pv !== undefined) out[k] = pv;
    });
    return out;
  }

  const Cfg = {
    v: null,
    saveTimer: null,

    load() {
      this.v = mergeDeep(DEFAULT_CONFIG, lsGet(LSKEY.config, {}));
      if (!Array.isArray(this.v.whitelist)) this.v.whitelist = [];
      if (!Array.isArray(this.v.blacklist)) this.v.blacklist = [];
      /* 并行路数只保证是正整数（不设上限，实际并发按房间数收敛） */
      if (this.v.watch && Number(this.v.watch.multiRoomMax) < 1) this.v.watch.multiRoomMax = 1;
      /* 1.18.0：实测未开播的直播间同样能记录观时，取消「仅对开播中的直播间执行观时」的默认开启；
         「本人观看直播时」三档策略对观时结果没有影响，已移除，这里一并清掉老配置的残留字段 */
      if (this.v.watch) {
        if (!this.v.watch.v2) {
          this.v.watch.requireLive = false;
          this.v.watch.v2 = true;
        }
        delete this.v.watch.whenWatching;
        delete this.v.watch.pauseWhenWatching;
      }
      /* 1.6.x 迁移：1.1.0 时代的风控参数（冷却 10 分钟）太粗暴，升级时重置一次 */
      if (this.v.risk && !this.v.risk.v2) {
        this.v.risk.cooldownMin = 2;
        this.v.risk.epStrikes = 3;
        this.v.risk.epDisableMin = 5;
        this.v.risk.globalCooldownMin = 3;
        this.v.risk.v2 = true;
      }
      /* 1.8.0：实测未开播直播间发出的弹幕计入任务，默认改回「仅在未开播时发送」 */
      if (this.v.danmu && !this.v.danmu.v3) {
        this.v.danmu.onlyWhenNotLive = true;
        this.v.danmu.v3 = true;
      }
      /* 1.35.0：任务上限改为按任务配置。旧的 show/brk 是布尔值，升级时三项继承；
         上限允许留空（0），表示跟随服务端任务上限 */
      if (!isPlainObject(this.v.taskLimit)) this.v.taskLimit = cloneDeep(DEFAULT_CONFIG.taskLimit);
      {
        const tl = this.v.taskLimit;
        const toObj = (val, def) => {
          const out = {};
          ['like', 'danmu', 'watch'].forEach((k) => {
            out[k] = isPlainObject(val) && val[k] != null ? !!val[k]
              : (typeof val === 'boolean' ? val : def);
          });
          return out;
        };
        tl.show = toObj(tl.show, true);
        tl.brk = toObj(tl.brk, false);
        ['like', 'danmu', 'watch'].forEach((k) => {
          const n = Math.round(Number(tl[k]));
          tl[k] = n > 0 ? n : 0;
        });
      }
      /* 1.20.0：分享任务重新上线（接口为 shareConf，1.17.1 删除是因为当时找错了接口）。
         老配置里可能残留着 1.17.1 之前的 tasks.share，语义相同，直接沿用默认值即可。 */
      return this.v;
    },

    save() {
      lsSet(LSKEY.config, this.v);
      Bus.post('config', { at: nowMs() });
      return this.v;
    },

    saveLater(ms) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), ms || 400);
    },

    set(pathStr, val) {
      const parts = pathStr.split('.');
      let cur = this.v;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = val;
      this.saveLater();
    },

    get(pathStr, def) {
      const parts = pathStr.split('.');
      let cur = this.v;
      for (let i = 0; i < parts.length; i++) {
        if (cur == null) return def;
        cur = cur[parts[i]];
      }
      return cur === undefined ? def : cur;
    }
  };

  /* 房间级任务开关：白名单条目上的 tasks 字段，缺省视为开启。
     实际生效 = 总开关 && 房间开关：总开关关闭时，卡片里不能再打开 */
  function roomTaskOn(entry, name) {
    if (!entry || !entry.tasks) return true;
    return entry.tasks[name] !== false;
  }

  /* ---------------- 每日记录 ---------------- */
  const Daily = {
    date: '',
    rooms: {},
    /* 「重置今日记录」的代号。正在进行的观时会话在开工时记下它，
       一旦发现代号变了就停止回写，避免把重置前的累计值又写回来。 */
    gen: 0,
    saveTimer: null,
    /* 写盘版本戳：loadedAt 是内存快照对应的磁盘版本，savedAt 是本标签最后一次写入的版本。
       其它标签写过更新的数据时，save() 会先合并再写，避免旧快照整体覆盖新进度 */
    savedAt: 0,
    loadedAt: 0,

    load() {
      const raw = lsGet(LSKEY.daily, null);
      const today = todayStr();
      if (raw && raw.date === today && isPlainObject(raw.rooms)) {
        this.date = raw.date;
        this.rooms = raw.rooms;
        this.savedAt = Number(raw.savedAt) || 0;
        this.loadedAt = this.savedAt;
      } else {
        this.date = today;
        this.rooms = {};
        this.save();
      }
      return this;
    },

    /* 重新读盘：接管执行权、或收到其它标签的写盘通知时用。
       未落盘的防抖计时器要先取消，否则它会把旧快照再写回去 */
    reload() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      return this.load();
    },

    /* 把磁盘上更新的内容并进内存。
       计数当天只增不减，取大；done 取并集；错误信息取 errAt 较新的那一条；
       超上限基线/保护上限标记保留已有的，缺了才补 */
    mergeFrom(stored) {
      const rooms = stored && isPlainObject(stored.rooms) ? stored.rooms : {};
      Object.keys(rooms).forEach((k) => {
        const old = rooms[k];
        if (!isPlainObject(old)) return;
        const cur = this.rooms[k];
        if (!cur) {
          this.rooms[k] = old;
          return;
        }
        ['like', 'danmu', 'watch', 'self', 'light', 'likeSrv', 'danmuSrv', 'shareGain'].forEach((f) => {
          cur[f] = Math.max(Number(cur[f]) || 0, Number(old[f]) || 0);
        });
        if (isPlainObject(old.done)) cur.done = Object.assign({}, old.done, isPlainObject(cur.done) ? cur.done : {});
        if (isPlainObject(old.overBase)) {
          if (!isPlainObject(cur.overBase)) cur.overBase = {};
          Object.keys(old.overBase).forEach((name) => {
            if (!cur.overBase[name]) cur.overBase[name] = old.overBase[name];
          });
        }
        if (isPlainObject(old.capOut)) {
          if (!isPlainObject(cur.capOut)) cur.capOut = {};
          Object.keys(old.capOut).forEach((name) => {
            if (!cur.capOut[name]) cur.capOut[name] = old.capOut[name];
          });
        }
        if ((Number(old.errAt) || 0) > (Number(cur.errAt) || 0)) {
          cur.err = old.err || '';
          cur.errAt = Number(old.errAt) || 0;
          cur.errTask = old.errTask || '';
        }
      });
      this.loadedAt = Math.max(this.loadedAt, Number(stored.savedAt) || 0);
    },

    /* 跨天检查：日期变了就清空 */
    rollover() {
      const today = todayStr();
      if (this.date === today) return false;
      this.date = today;
      this.rooms = {};
      this.save();
      Log.log('每日', '已切换到新的一天 ' + today + '，任务记录已清零');
      return true;
    },

    save() {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      /* 磁盘上已有更新版本时先合并：旧标签的延迟写盘不能覆盖新进度 */
      const stored = lsGet(LSKEY.daily, null);
      if (stored && stored.date === this.date && (Number(stored.savedAt) || 0) > this.loadedAt) {
        this.mergeFrom(stored);
      }
      this.savedAt = Math.max(nowMs(), this.loadedAt + 1);
      this.loadedAt = this.savedAt;
      lsSet(LSKEY.daily, { date: this.date, rooms: this.rooms, savedAt: this.savedAt });
      /* 让其它标签刷新显示；写入方自己不会收到（Bus 按 from 过滤） */
      Bus.post('daily', { at: this.savedAt });
    },

    /* 高频计数用防抖写盘，避免每点赞一批就写一次 localStorage */
    saveSoon() {
      if (this.saveTimer) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, 800);
    },

    /* 统一键：优先用主播 uid（永不变化），其次房间号 */
    keyOf(t) {
      if (t && typeof t === 'object') {
        if (t.uid) return 'u' + t.uid;
        if (t.roomId) return 'r' + t.roomId;
        return 'r0';
      }
      const s = String(t == null ? '' : t);
      if (/^u\d+$/.test(s)) return s;
      if (/^r\d+$/.test(s)) return this.keyOf(s.slice(1));
      const meta = (typeof Data !== 'undefined' && Data) ? Data.room(s) : null;
      if (meta && meta.uid) return 'u' + meta.uid;
      return 'r' + s;
    },

    get(t) {
      const key = this.keyOf(t);
      let r = this.rooms[key];
      if (!r) {
        /* 兼容历史键：按 roomId / uid 回查一次，命中就搬过来 */
        const rid = (t && typeof t === 'object') ? t.roomId : String(t);
        const uid = (t && typeof t === 'object') ? t.uid : 0;
        const keys = Object.keys(this.rooms);
        for (let i = 0; i < keys.length; i++) {
          const e = this.rooms[keys[i]];
          if (!e) continue;
          const hit = (rid && String(e.roomId) === String(rid)) || (uid && String(e.uid) === String(uid));
          if (hit) {
            r = e;
            this.rooms[key] = r;
            break;
          }
        }
      }
      if (!r) {
        r = { roomId: 0, uid: 0, like: 0, danmu: 0, watch: 0, self: 0, light: 0, likeSrv: 0, danmuSrv: 0, shareGain: 0, done: {}, overBase: {}, capOut: {}, err: '', errAt: 0, errTask: '' };
        this.rooms[key] = r;
      }
      if (t && typeof t === 'object') {
        if (t.roomId) r.roomId = Number(t.roomId) || r.roomId;
        if (t.uid) r.uid = Number(t.uid) || r.uid;
      }
      if (!isPlainObject(r.done)) r.done = {};
      if (!isPlainObject(r.overBase)) r.overBase = {};
      if (!isPlainObject(r.capOut)) r.capOut = {};
      return r;
    },

    /* 房间号解析出 uid 后，把历史 r* 键的记录并入 u* 键，避免重启后读不到 */
    adopt(meta) {
      if (!meta || !meta.uid) return;
      const target = 'u' + meta.uid;
      const aliases = ['r' + meta.roomId];
      if (meta.key) aliases.push('r' + meta.key);
      aliases.forEach((k) => {
        const old = this.rooms[k];
        if (!old || k === target) return;
        const cur = this.rooms[target];
        if (!cur) {
          this.rooms[target] = old;
        } else {
          ['like', 'danmu', 'watch', 'light'].forEach((f) => {
            cur[f] = Math.max(Number(cur[f]) || 0, Number(old[f]) || 0);
          });
          cur.done = Object.assign({}, old.done || {}, cur.done || {});
          if (!isPlainObject(cur.overBase)) cur.overBase = {};
          if (isPlainObject(old.overBase)) {
            Object.keys(old.overBase).forEach((k) => {
              if (!cur.overBase[k]) cur.overBase[k] = old.overBase[k];
            });
          }
          if (!isPlainObject(cur.capOut)) cur.capOut = {};
          if (isPlainObject(old.capOut)) {
            Object.keys(old.capOut).forEach((k) => {
              if (!cur.capOut[k]) cur.capOut[k] = old.capOut[k];
            });
          }
          if (!cur.err) cur.err = old.err || '';
        }
        delete this.rooms[k];
      });
      this.saveSoon();
    },

    add(t, field, n) {
      const r = this.get(t);
      r[field] = (Number(r[field]) || 0) + (Number(n) || 0);
      this.saveSoon();
      return r[field];
    },

    done(t, task, val) {
      const r = this.get(t);
      r.done[task] = val === undefined ? true : !!val;
      /* 只清除该任务自己留下的错误：以前任意任务成功都会把红字抹掉，
         导致「观时的报错被点亮成功清掉」这种对不上的情况 */
      if (r.done[task] && (!r.errTask || r.errTask === task)) {
        r.err = '';
        r.errTask = '';
        r.errAt = 0;
      }
      this.saveSoon();
    },

    /* 我自己真实观看的时长（由主控标签页按可见性累加） */
    addSelf(t, sec) {
      const n = Number(sec);
      if (!(n > 0)) return;
      const r = this.get(t);
      r.self = (Number(r.self) || 0) + n;
      this.saveSoon();
    },

    isDone(t, task) {
      return !!this.get(t).done[task];
    },

    allDone(t, isOn) {
      const r = this.get(t);
      const on = typeof isOn === 'function' ? isOn : (name) => !!Cfg.v.tasks[name];
      if (on('light') && !r.done.light) return false;
      if (on('like') && !r.done.like) return false;
      if (on('danmu') && !r.done.danmu) return false;
      if (on('watch') && !r.done.watch) return false;
      /* 分享不参与「全部完成」判定：它是附加收益，接口失效时不该把引擎永远拖着不停 */
      return true;
    },

    setErr(t, msg, task) {
      const r = this.get(t);
      r.err = String(msg || '');
      r.errAt = nowMs();
      r.errTask = task ? String(task) : (r.errTask || '');
      this.saveSoon();
    },

    /* 手动清除红字（卡片上点一下错误文字） */
    clearErr(t) {
      const r = this.get(t);
      if (!r.err && !r.errAt) return false;
      r.err = '';
      r.errAt = 0;
      r.errTask = '';
      this.saveSoon();
      return true;
    },
  };

  /* ---------------- 房间与粉丝牌数据 ---------------- */
  const Data = {
    rooms: new Map(),       /* roomId -> room meta（含短号别名） */
    medals: new Map(),      /* roomId -> medal item（fansMedalPanel 原始项） */
    count: 0,               /* 实际粉丝牌数量（medals 同时按 roomId 与 uid 建索引，size 是它的两倍） */
    medalsAt: 0,
    medalsLoading: null,
    taskCache: new Map(),   /* uid -> {at, data} */
    roomsTimer: null,

    room(roomId) {
      return this.rooms.get(String(roomId)) || null;
    },

    /* 房间元数据落盘：重启后不必再逐个请求 room_init / getInfoByRoom */
    loadRooms() {
      const raw = lsGet(LSKEY.rooms, null);
      if (!raw || !isPlainObject(raw.rooms)) return this;
      Object.keys(raw.rooms).forEach((k) => {
        const m = raw.rooms[k];
        if (!m || !m.roomId) return;
        this.rooms.set(String(m.roomId), m);
        if (m.key && String(m.key) !== String(m.roomId)) this.rooms.set(String(m.key), m);
      });
      return this;
    },

    saveRooms() {
      if (this.roomsTimer) return;
      this.roomsTimer = setTimeout(() => {
        this.roomsTimer = null;
        const out = {};
        this.rooms.forEach((m, k) => {
          if (!m || !m.roomId) return;
          if (String(k) !== String(m.roomId)) return;
          out[k] = {
            key: m.key || '',
            roomId: m.roomId,
            shortId: m.shortId || 0,
            uid: m.uid || 0,
            uname: m.uname || '',
            liveStatus: m.liveStatus,
            areaId: m.areaId || 0,
            parentAreaId: m.parentAreaId || 0,
            title: m.title || '',
            watchTarget: m.watchTarget || 0,
            freeIntimacy: m.freeIntimacy || 0,
            watchSrvRounds: m.watchSrvRounds || 0,
            watchSrvAt: m.watchSrvAt || 0,
            freeReach: !!m.freeReach,
            watchRounds: m.watchRounds || 0,
            watchRoundMin: m.watchRoundMin || 0,
            srvMax: m.srvMax || null,
            srvMaxDate: m.srvMaxDate || '',
            at: m.at || 0
          };
        });
        lsSet(LSKEY.rooms, { at: nowMs(), rooms: out });
      }, 600);
    },

    putRoom(meta) {
      if (!meta || !meta.roomId) return null;
      const old = this.rooms.get(String(meta.roomId)) || {};
      const merged = Object.assign({}, old, meta);
      this.rooms.set(String(meta.roomId), merged);
      if (merged.key && String(merged.key) !== String(merged.roomId)) this.rooms.set(String(merged.key), merged);
      if (typeof Daily !== 'undefined' && Daily) Daily.adopt(merged);
      this.saveRooms();
      return merged;
    },

    /* 观时任务目标（由 B 站返回的轮次 × 每轮分钟数算出），落盘到房间元数据 */
    setWatchTarget(meta, sec, rounds, roundMin) {
      if (!meta || !(sec > 0)) return;
      meta.watchTarget = Math.round(sec);
      if (rounds > 0) meta.watchRounds = Math.round(rounds);
      if (roundMin > 0) meta.watchRoundMin = Math.round(roundMin);
      this.saveRooms();
    },

    /* 服务端每日任务上限（按天记）。未开播、任务还没同步、接口失败时用这份兜底，
       否则「允许超过服务端上限」关闭时，看板滑块会显示出高于服务端的上限 */
    noteSrvMax(meta, name, max) {
      const n = Math.round(Number(max) || 0);
      if (!meta || !meta.roomId || n <= 0) return;
      if (name !== 'like' && name !== 'danmu' && name !== 'watch') return;
      const m = this.rooms.get(String(meta.roomId)) || meta;
      const today = todayStr();
      if (!isPlainObject(m.srvMax) || m.srvMaxDate !== today) {
        m.srvMax = {};
        m.srvMaxDate = today;
      }
      if (Math.round(Number(m.srvMax[name]) || 0) === n) return;
      m.srvMax[name] = n;
      this.saveRooms();
    },

    srvMaxOf(meta, name) {
      if (!meta || !meta.roomId) return 0;
      const m = this.rooms.get(String(meta.roomId)) || meta;
      if (!isPlainObject(m.srvMax) || m.srvMaxDate !== todayStr()) return 0;
      return Math.max(0, Math.round(Number(m.srvMax[name]) || 0));
    },

    watchTargetOf(meta) {
      if (!meta) return 0;
      return Number(meta.watchTarget) || 0;
    },

    medalOf(roomId) {
      return this.medals.get(String(roomId)) || null;
    },

    /* 服务端单独返回了粉丝牌信息、但粉丝牌面板里没有这一枚时，把它补进索引，
       避免每次刷新后又判定「没有牌子」。 */
    putMedal(uid, roomId, medal) {
      if (!uid || !medal) return null;
      const key = 'u' + uid;
      const item = this.medals.get(key) || { medal: {}, room_info: {} };
      item.medal = Object.assign({}, item.medal, medal, { target_id: Number(uid) });
      if (roomId) item.room_info = Object.assign({}, item.room_info, { room_id: Number(roomId) });
      this.medals.set(key, item);
      if (roomId) this.medals.set(String(roomId), item);
      return item;
    },

    /* 拉取全部粉丝牌，建立 roomId -> medal 索引 */
    async refreshMedals(force) {
      if (!force && nowMs() - this.medalsAt < 5 * 60 * 1000 && this.medals.size) return this.medals;
      if (this.medalsLoading) {
        /* 强制刷新不能直接复用进行中的请求：那可能是发弹幕/点赞之前的快照，
           会拿到旧的 is_lighted，把已经点亮的结果误判成失败 */
        if (!force) return this.medalsLoading;
        try { await this.medalsLoading; } catch (e) { /* ignore */ }
      }
      this.medalsLoading = (async () => {
        try {
          const res = await API.allMedals(12);
          /* 兼容旧返回结构；新结构带 complete 标记 */
          const raw = Array.isArray(res) ? res : ((res && Array.isArray(res.list)) ? res.list : []);
          const complete = Array.isArray(res) ? true : !!(res && res.complete);
          if (!complete) {
            Log.warn('数据', '粉丝牌列表不完整（' + ((res && res.reason) || '未知') + '），保留上次的 ' +
              this.count + ' 个，稍后重试');
            return this.medals;
          }
          /* 按 medal_id 去重（special_list 与 list 会重复） */
          const seen = new Set();
          const list = [];
          raw.forEach((it) => {
            if (!it || !it.medal) return;
            const id = String(it.medal.medal_id || (it.medal.target_id + ':' + (it.room_info && it.room_info.room_id)));
            if (seen.has(id)) return;
            seen.add(id);
            list.push(it);
          });
          const next = new Map();
          list.forEach((it) => {
            if (!it || !it.medal) return;
            /* 少数牌子的 room_info 是空的（主播没开播/房间信息缺失），
               这类条目以前会被整个丢掉，连 uid 索引都建不起来，
               导致「明明有牌子却查不到」。room_info 缺了就只建 uid 索引。 */
            if (it.room_info && it.room_info.room_id) {
              next.set(String(it.room_info.room_id), it);
            }
            const key = 'u' + it.medal.target_id;
            if (it.medal.target_id && !next.has(key)) next.set(key, it);
          });
          this.medals = next;
          this.count = list.length;
          this.medalsAt = nowMs();
          Log.log('数据', '粉丝牌已更新，共 ' + (list.length) + ' 个');
          Bus.post('medals', { count: list.length });
        } catch (e) {
          Log.error('数据', '拉取粉丝牌失败：' + (e.message || e));
        } finally {
          this.medalsLoading = null;
        }
        return this.medals;
      })();
      return this.medalsLoading;
    },

    medalByUid(uid) {
      return this.medals.get('u' + uid) || null;
    },

    /* 粉丝牌三态：
       has     —— 索引里能查到（uid 或房间号任一命中）
       none    —— 索引已经成功加载过，但确实没有这枚牌子
       unknown —— 索引从未成功加载（网络/登录问题），此时不能判定「没有」 */
    medalState(meta) {
      if (!meta) return 'unknown';
      if (this.medalByUid(meta.uid) || this.medalOf(meta.roomId)) return 'has';
      return this.medalsAt ? 'none' : 'unknown';
    },

    /* 启动/开始执行前等一次粉丝牌，最多等 waitMs；超时或失败都放行，
       由调用方按 unknown 处理（照常执行，不误杀房间） */
    async ensureMedals(waitMs) {
      if (this.medalsAt && nowMs() - this.medalsAt < 5 * 60 * 1000 && this.medals.size) return this.medals;
      const p = this.refreshMedals(false).catch(() => this.medals);
      if (!(waitMs > 0)) return this.medals;
      await Promise.race([p, sleep(waitMs)]);
      return this.medals;
    },

    /* 粉丝团任务进度（带 90 秒缓存，失败也缓存 20 秒避免打爆接口） */
    async tasks(uid, force) {
      const key = String(uid);
      const hit = this.taskCache.get(key);
      if (!force && hit && nowMs() - hit.at < (hit.data.ok ? 90 * 1000 : 20 * 1000)) return hit.data;
      const data = await API.medalTasks(uid);
      this.taskCache.set(key, { at: nowMs(), data: data });
      /* 顺手把储蓄亲密度写回房间元数据：对账每轮只覆盖前 N 个房间，
         剩下的房间靠各自的任务请求补全，看板才不会一片空白 */
      if (data && data.ok) this.noteFree(uid, data.free, data.reachLimit);
      return data;
    },

    /* 按主播 uid 把储蓄亲密度同步到对应房间（同一主播可能有多个房间条目） */
    noteFree(uid, free, reach) {
      const id = Number(uid);
      if (!id) return;
      let changed = false;
      this.rooms.forEach((m) => {
        if (!m || Number(m.uid) !== id) return;
        const f = Number(free) || 0;
        if (Number(m.freeIntimacy) !== f || !!m.freeReach !== !!reach) {
          m.freeIntimacy = f;
          m.freeReach = !!reach;
          changed = true;
        }
      });
      if (changed) this.saveRooms();
    },

    clearTaskCache(uid) {
      if (uid) this.taskCache.delete(String(uid));
      else this.taskCache.clear();
    },

    /* 同步读任务缓存（看板渲染用，不触发请求）。90 秒内的数据才有效 */
    cachedTasks(uid) {
      if (!uid) return null;
      const hit = this.taskCache.get(String(uid));
      return hit && hit.data && hit.data.ok ? hit.data : null;
    }
  };

  /* ---------------- 任务字段解析 ---------------- */
  function findTaskInfo(list, jumpType) {
    if (!Array.isArray(list)) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].jump_type === jumpType) return list[i];
    }
    return null;
  }

  /* sub_title 形如 "3/10"，返回 {current, limit} */
  function parseDailyLimit(subTitle) {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(String(subTitle || ''));
    if (!m) return null;
    return { current: Number(m[1]), limit: Number(m[2]) };
  }

  /* title 里的数字，例如 "每30次点赞" -> 30 */
  function parseTitleCount(title) {
    const m = /(\d+)/.exec(String(title || ''));
    if (!m) return null;
    const n = Number(m[1]);
    return n > 0 ? n : null;
  }

  function isTaskDone(item) {
    if (!item) return false;
    return item.is_done === 1 || item.is_done === true;
  }

  /* 白名单输入解析：房间号 / 直播间链接 / UID */
  function parseRoomInput(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const uidMark = /^(uid|UID)[:：\s]*(\d+)$/.exec(s);
    if (uidMark) return { type: 'uid', value: Number(uidMark[2]) };
    const m = /(?:live\.bilibili\.com)?\/(?:blanc\/)?(\d{2,})/.exec(s);
    if (m) return { type: 'room', value: Number(m[1]) };
    if (/^\d{2,}$/.test(s)) return { type: 'room', value: Number(s) };
    return null;
  }
