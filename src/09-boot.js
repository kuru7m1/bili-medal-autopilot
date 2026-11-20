  /* ==================================================================
   * 16. 交互动作
   * ================================================================== */
  function addEntry(entry) {
    if (!entry || !entry.roomId) return false;
    const exists = Cfg.v.whitelist.some((e) => String(e.roomId) === String(entry.roomId));
    if (exists) return false;
    Cfg.v.whitelist.push({
      roomId: Number(entry.roomId),
      uid: Number(entry.uid) || 0,
      uname: String(entry.uname || ''),
      at: nowMs()
    });
    Cfg.save();
    Engine.touch();
    return true;
  }

  const Actions = {
    async run() {
      if (Engine.running) { Engine.stop('手动停止'); return; }
      /* 非主控标签页点「开始」：请求当前主控让出执行权；
         Web Locks 是异步授予的，拿到锁后会自动开始，这里不阻塞等待 */
      if (!Leader.isLeader) {
        Leader.takeover();
        if (!Leader.isLeader) {
          UI.toast('已请求接管，等待原标签页让出执行权…');
          return;
        }
      }
      Engine.start();
    },

    refreshRoom() { RoomView.refresh(true); },

    async addRoom(el) {
      const panel = UI.panel;
      const input = panel ? panel.querySelector('[data-el="roomInput"]') : null;
      const text = input ? input.value : '';
      const p = parseRoomInput(text);
      if (!p) {
        UI.toast('请输入房间号、直播间链接或 uid:12345', false);
        return;
      }
      UI.toast('正在解析…');
      try {
        let roomId = 0;
        let uid = 0;
        let uname = '';
        if (p.type === 'uid') {
          const map = await API.roomStatusByUids([p.value]);
          const d = map[p.value] || map[String(p.value)];
          if (!d || !d.room_id) throw new Error('该 UID 没有直播间');
          roomId = Number(d.room_id);
          uid = p.value;
          uname = String(d.uname || '');
        } else {
          const init = await API.roomInit(p.value);
          roomId = init.roomId;
          uid = init.uid;
          const info = await API.roomInfo(roomId);
          uname = (info && info.uname) || '';
          Data.putRoom({
            key: String(p.value),
            roomId: roomId,
            uid: uid,
            uname: uname,
            liveStatus: info ? info.liveStatus : init.liveStatus,
            areaId: info ? info.areaId : 0,
            parentAreaId: info ? info.parentAreaId : 0,
            title: info ? info.title : '',
            at: nowMs()
          });
        }
        if (addEntry({ roomId: roomId, uid: uid, uname: uname })) {
          if (input) input.value = '';
          UI.toast('已添加 ' + (uname || roomId));
          UI.render(true);
        } else {
          UI.toast('该直播间已在列表中', false);
        }
      } catch (e) {
        UI.toast('解析失败：' + (e.message || e), false);
      }
    },

    removeRoom(el) {
      const key = el.getAttribute('data-key');
      Cfg.v.whitelist = Cfg.v.whitelist.filter((e) => String(e.roomId) !== String(key));
      Cfg.save();
      Engine.touch();
      UI.render(true);
    },

    /* 展开 / 收起某个房间的任务开关浮层 */
    roomTasks(el) {
      const key = String(el.getAttribute('data-key') || '');
      if (!key) return;
      ListView.taskPop = ListView.taskPop === key ? '' : key;
      UI.render(true);
    },

    /* 房间级任务开关：只能收紧，总开关关闭的项直接忽略 */
    setRoomTask(key, name, on) {
      if (!Cfg.v.tasks[name]) return;
      const entry = (Cfg.v.whitelist || []).find((e) => String(e.roomId) === String(key));
      if (!entry) return;
      if (!entry.tasks) entry.tasks = {};
      entry.tasks[name] = !!on;
      Cfg.save();
      if (!on) Engine.stopRoomTask(entry.roomId, name);
      Engine.touch();
      UI.render(true);
    },

    /* 房间级每日上限：不能超过该房间的实际生效上限；等于上限时删掉覆盖值。
       maxHint 来自滑块渲染时的 max，避免服务端缓存过期后算不出上限 */
    setRoomLimit(key, name, val, maxHint) {
      const entry = (Cfg.v.whitelist || []).find((e) => String(e.roomId) === String(key));
      if (!entry) return;
      const meta = Data.room(key) || { roomId: Number(key) || 0, uid: entry.uid || 0 };
      const gMax = Math.max(0, Math.round(Number(maxHint) || 0)) || Engine.globalLimitOf(meta, name);
      if (!gMax) return;
      const v = Math.max(1, Math.min(Math.round(Number(val) || gMax), gMax));
      if (!entry.limits) entry.limits = {};
      if (v >= gMax) delete entry.limits[name];
      else entry.limits[name] = v;
      if (!Object.keys(entry.limits).length) delete entry.limits;
      Cfg.save();
      Engine.touch();
      UI.render(true);
    },

    clearList() {
      Cfg.v.whitelist = [];
      Cfg.save();
      Engine.stop('直播间列表已清空');
      Engine.touch();
      UI.render(true);
      UI.toast('直播间列表已清空');
    },

    async refreshRooms() {
      UI.toast('正在刷新房间与粉丝牌…');
      await Auth.ensure();
      await Data.refreshMedals(true);
      Engine.resetMedalCache();
      const list = Cfg.v.whitelist.slice();
      for (let i = 0; i < list.length; i++) {
        await Engine.ensureRoom(list[i], true);
        await sleep(rand(150, 300));
      }
      Engine.touch();
      UI.render(true);
      UI.toast('已刷新 ' + list.length + ' 个直播间');
    },

    pickMedals() {
      ListView.picking = !ListView.picking;
      if (ListView.picking) {
        ListView.pruneSel();
        if (!Data.medals.size) Data.refreshMedals(true);
      }
      UI.render(true);
    },

    pickAll() {
      const items = ListView.items();
      const allSel = items.length > 0 && items.every((it) => ListView.sel.has(String(it.room_info.room_id)));
      ListView.sel.clear();
      if (!allSel) items.forEach((it) => ListView.sel.add(String(it.room_info.room_id)));
      UI.render(true);
    },

    pickImport() {
      /* 以页面上的勾选为准同步一次：即使某次 change 事件没被接住，
         也不会出现「勾了但导入 0 个」的情况 */
      const body = (typeof UI !== 'undefined' && UI && UI.body) ? UI.body : null;
      if (body && typeof body.querySelectorAll === 'function') {
        const els = body.querySelectorAll('[data-pick]');
        if (els && els.length) {
          const ids = new Set();
          for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el && el.checked) ids.add(String(el.getAttribute('data-pick')));
          }
          ListView.sel = ids;
        }
      }
      let n = 0;
      Data.medals.forEach((it, key) => {
        if (String(key).indexOf('u') === 0) return;
        const rid = String(it.room_info.room_id);
        if (!ListView.sel.has(rid)) return;
        if (addEntry({ roomId: it.room_info.room_id, uid: it.medal.target_id, uname: (it.anchor_info && it.anchor_info.nick_name) || '' })) n++;
      });
      ListView.sel.clear();
      ListView.picking = false;
      UI.render(true);
      UI.toast('已导入 ' + n + ' 个直播间');
    },

    async logCopy() {
      const text = Log.dump();
      try {
        await navigator.clipboard.writeText(text);
        UI.toast('日志已复制');
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); UI.toast('日志已复制'); } catch (e2) { UI.toast('复制失败', false); }
        removeNode(ta);
      }
    },

    logClear() {
      Log.lines = [];
      Log.seq = 0;
      UI.render(true);
    },

    saveDanmu() {
      const panel = UI.panel;
      const ta = panel ? panel.querySelector('[data-el="danmuText"]') : null;
      if (!ta) return;
      const list = String(ta.value || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 60);
      if (!list.length) {
        UI.toast('至少保留一条弹幕', false);
        return;
      }
      const long = list.filter((s) => s.length > 30);
      Cfg.v.danmu.list = list;
      Cfg.save();
      UI.toast(long.length ? ('已保存，其中 ' + long.length + ' 条超过 30 字可能被拒') : '弹幕已保存');
      UI.render(true);
    },

    blacklistAdd() {
      const v = window.prompt('要把哪个房间加入黑名单？（输入房间号）');
      if (!v) return;
      const p = parseRoomInput(v);
      if (!p) { UI.toast('房间号无效', false); return; }
      const id = Number(p.value);
      if (Cfg.v.blacklist.map(String).indexOf(String(id)) < 0) Cfg.v.blacklist.push(id);
      Cfg.save();
      UI.render(true);
    },

    blacklistAdd2() {
      const panel = UI.panel;
      const input = panel ? panel.querySelector('[data-el="blackInput"]') : null;
      const text = input ? input.value : '';
      const p = parseRoomInput(text);
      if (!p) { UI.toast('房间号无效', false); return; }
      const id = Number(p.value);
      if (Cfg.v.blacklist.map(String).indexOf(String(id)) < 0) Cfg.v.blacklist.push(id);
      Cfg.save();
      Engine.touch();
      UI.render(true);
    },

    blacklistDel(el) {
      const id = String(el.getAttribute('data-id'));
      Cfg.v.blacklist = Cfg.v.blacklist.filter((x) => String(x) !== id);
      Cfg.save();
      Engine.touch();
      UI.render(true);
    },

    async checkAuth() {
      UI.toast('正在检查登录状态…');
      const ok = await Auth.verify();
      UI.render(true);
      UI.toast(ok ? ('已登录：' + (Auth.uname || Auth.uid)) : '未检测到登录状态', ok);
    },

    resetDaily() {
      Daily.date = '';
      Daily.rooms = {};
      /* 递增代号，让正在跑的观时会话失效：否则它每 60 秒会把重置前的累计值写回来 */
      Daily.gen++;
      Daily.save();
      /* 顺便停掉正在进行的观时会话，避免它继续空跑 */
      Engine.watches.forEach((s) => { if (s && s.heart && s.heart.stop) s.heart.stop(); });
      Engine.failState.clear();
      Engine.touch();
      UI.render(true);
      UI.toast('今日记录已重置（仅本地，服务端进度不受影响）');
    },

    /* 软刷新：重新读配置/粉丝牌/任务状态，不用刷新整个页面 */
    async reloadPanel() {
      const wasRunning = Engine.running;
      try { Engine.stop('刷新插件'); } catch (e) { /* ignore */ }
      try {
        Data.rooms.clear();
        Data.medals.clear();
        Data.taskCache.clear();
        Data.medalsAt = 0;
        Data.loadRooms();
        Cfg.load();
        Daily.reload();
        Net.resetRisk();
        Engine.failState.clear();
        Engine.parked.clear();
        Engine.resetMedalCache();
        Engine.statusAt = 0;
        RoomView.at = 0;
        RoomView.data = null;
        UI.render(true);
        RoomView.refresh(true);
        Data.refreshMedals(true);
        if (wasRunning) Engine.start();
        Engine.syncTasks(true);
        UI.toast('插件已刷新');
        Log.log('界面', '已软刷新（配置 / 粉丝牌 / 任务状态重新加载）');
      } catch (e) {
        UI.toast('刷新失败：' + (e.message || e), false);
      }
    },
    /* 切换观时图表口径：脚本记录 / 服务端认可 */
    /* 点一下卡片上的红字：手动清除这条提示 */
    clearErr(el) {
      const key = el && el.getAttribute ? el.getAttribute('data-key') : '';
      if (!key) return;
      const meta = Data.room(key) || { roomId: key };
      if (Daily.clearErr(meta)) {
        Engine.touch();
        UI.render(true);
      }
    },

    toggleWatchSrv() {
      UI.watchSrv = !(UI.watchSrv === true);
      UI.saveGeo();
      UI.render(true);
      UI.toast(UI.watchSrv ? '已切换为服务端认可的轮次换算' : '已切换为脚本记录的时长');
    },

    toggleWatchChart() {
      UI.watchOpen = !(UI.watchOpen !== false);
      UI.saveGeo();
      UI.render(true);
    },

    riskReset() {
      Net.resetRisk();
      UI.render(true);
      UI.toast('已解除风控冷却与熔断');
    }
  };

  UI.onAction = function (act, el, e) {
    if (act === 'close') { this.unmount(); return; }
    const fn = Actions[act];
    if (!fn) return;
    try {
      fn.call(Actions, el, e);
    } catch (err) {
      Log.error('界面', '操作 ' + act + ' 出错：' + (err.message || err));
      UI.toast('操作失败：' + (err.message || err), false);
    }
  };

  /* ---------------- 全局事件：勾选、拖拽排序 ---------------- */
  let dragKey = null;

  function wireGlobalEvents() {
    /* 点击浮层与按钮以外的地方：直接收起房间任务开关（不重绘，避免吞掉这次点击） */
    document.addEventListener('mousedown', (e) => {
      if (!ListView.taskPop) return;
      const t = e.target;
      if (t && t.closest && (t.closest('.bma-taskpop') || t.closest('[data-act="roomTasks"]'))) return;
      ListView.taskPop = '';
      const pop = document.querySelector('.bma-taskpop');
      if (pop) removeNode(pop);
    }, true);

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el || el.tagName !== 'INPUT') return;
      const roomTask = el.getAttribute && el.getAttribute('data-room-task');
      if (roomTask) {
        Actions.setRoomTask(el.getAttribute('data-key'), roomTask, el.checked);
        return;
      }
      const lim = el.getAttribute && el.getAttribute('data-room-limit');
      if (lim) {
        Actions.setRoomLimit(el.getAttribute('data-key'), lim, el.value, el.getAttribute('data-max'));
        return;
      }
      const pick = el.getAttribute && el.getAttribute('data-pick');
      if (pick) {
        if (el.checked) ListView.sel.add(pick);
        else ListView.sel.delete(pick);
        ListView.syncPickBtns();
      }
    });

    document.addEventListener('dragstart', (e) => {
      const row = e.target && e.target.closest ? e.target.closest('.bma-room') : null;
      if (!row) return;
      dragKey = row.getAttribute('data-key');
      row.classList.add('drag');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragKey || '');
      } catch (err) { /* ignore */ }
    });

    document.addEventListener('dragover', (e) => {
      if (!dragKey) return;
      const row = e.target && e.target.closest ? e.target.closest('.bma-room') : null;
      if (!row) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ }
    });

    document.addEventListener('drop', (e) => {
      if (!dragKey) return;
      const row = e.target && e.target.closest ? e.target.closest('.bma-room') : null;
      if (!row) return;
      e.preventDefault();
      const targetKey = row.getAttribute('data-key');
      if (targetKey && targetKey !== dragKey) {
        const list = Cfg.v.whitelist.slice();
        const from = list.findIndex((x) => String(x.roomId) === String(dragKey));
        const to = list.findIndex((x) => String(x.roomId) === String(targetKey));
        if (from >= 0 && to >= 0) {
          const item = list.splice(from, 1)[0];
          list.splice(to, 0, item);
          Cfg.v.whitelist = list;
          Cfg.save();
          Log.log('白名单', '已调整执行顺序');
        }
      }
      dragKey = null;
      UI.render(true);
    });

    document.addEventListener('dragend', () => {
      dragKey = null;
      const rows = document.querySelectorAll('.bma-room.drag');
      for (let i = 0; i < rows.length; i++) rows[i].classList.remove('drag');
    });
  }

  /* ==================================================================
   * 17. 体验优化模块
   * ================================================================== */
  const Enhance = {
    installed: false,
    lastUserAt: 0,
    logged: false,
    hooked: null,
    /* 用户自己点过播放（或暂停后重新播放）的视频：之后不再自动暂停它。
       只要元素还在播放，就不该被 3.5s/8s 的补扫再次打断 */
    userPlayed: null,

    install() {
      if (this.installed) return;
      this.installed = true;
      try { this.pauseHomeAutoplay(); } catch (e) { /* ignore */ }
    },

    /* 只处理 live.bilibili.com 首页；具体直播间由用户自己控制 */
    isHome() {
      try {
        if (location.hostname !== 'live.bilibili.com') return false;
        const p = location.pathname || '/';
        return p === '/' || p === '';
      } catch (e) { return false; }
    },

    /* 标记/查询「用户已接管播放」的视频 */
    authorize(v) {
      if (!v) return;
      if (!this.userPlayed) this.userPlayed = new WeakSet();
      try { this.userPlayed.add(v); } catch (e) { /* ignore */ }
    },

    isAuthorized(v) {
      return !!(v && this.userPlayed && this.userPlayed.has(v));
    },

    forget(v) {
      if (v && this.userPlayed) {
        try { this.userPlayed.delete(v); } catch (e) { /* ignore */ }
      }
    },

    /* 首页左侧轮播会自动播放推荐直播：加载后直接暂停；
       用户自己点过播放的，永远不再打断，避免和播放器抢控制权 */
    pauseHomeAutoplay() {
      const conf = (Cfg.v && Cfg.v.enhance) || {};
      if (conf.pauseHome === false) return;
      if (!this.isHome()) return;
      const markUser = () => { this.lastUserAt = nowMs(); };
      ['pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach((t) => {
        document.addEventListener(t, markUser, true);
      });
      const quiet = () => nowMs() - this.lastUserAt > 3000;
      /* 只暂停「像播放器」的元素：首页卡片悬停预览通常很小，不打扰 */
      const bigEnough = (v) => {
        try {
          const r = v.getBoundingClientRect ? v.getBoundingClientRect() : null;
          if (!r || !r.width) return (v.clientWidth || 0) >= 320;
          return r.width >= 320 && r.height >= 180;
        } catch (e) { return true; }
      };
      const stop = (v) => {
        if (!v || v.tagName !== 'VIDEO' || v.paused) return;
        if (this.isAuthorized(v)) return;
        if (!quiet() || !bigEnough(v)) return;
        try { v.pause(); } catch (e) { /* ignore */ }
        if (!this.logged) {
          this.logged = true;
          Log.log('优化', '已暂停首页自动播放的直播（可在设置里关闭）');
        }
      };
      const docs = () => {
        const list = [document];
        try {
          const frames = document.querySelectorAll('iframe');
          for (let i = 0; i < frames.length; i++) {
            const d = frames[i].contentDocument;
            if (d && list.indexOf(d) < 0) list.push(d);
          }
        } catch (e) { /* 跨域 iframe 忽略 */ }
        return list;
      };
      const hook = (doc) => {
        if (!doc || !doc.addEventListener) return;
        if (!this.hooked) this.hooked = new Set();
        if (this.hooked.has(doc)) return;
        this.hooked.add(doc);
        doc.addEventListener('play', (e) => {
          const v = e.target;
          if (!v || v.tagName !== 'VIDEO') return;
          /* 3 秒内有过点击/按键：认定是用户自己播的，记下来永不再暂停 */
          if (!quiet()) {
            this.authorize(v);
            return;
          }
          stop(v);
          /* 播放器偶尔会立刻重试，再补一次 */
          setTimeout(() => stop(v), 500);
        }, true);
        /* 播放结束（轮播换台）后撤销授权，下一段自动播放仍会被暂停 */
        doc.addEventListener('ended', (e) => {
          if (e.target && e.target.tagName === 'VIDEO') this.forget(e.target);
        }, true);
      };
      const scan = () => {
        docs().forEach((doc) => {
          hook(doc);
          let list = [];
          try { list = doc.querySelectorAll('video'); } catch (e) { list = []; }
          for (let i = 0; i < list.length; i++) stop(list[i]);
        });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
      else scan();
      setTimeout(scan, 1200);
      setTimeout(scan, 3500);
      setTimeout(scan, 8000);
    }
  };

  /* document-start 阶段先装监听：首页轮播的自动播放往往早于脚本初始化 */
  try {
    Cfg.load();
    Enhance.install();
  } catch (e) { /* ignore */ }

  /* ==================================================================
   * 18. 单主控选举（多标签页只让一个标签执行任务）
   * ================================================================== */
  const Leader = {
    id: Bus.id,
    isLeader: false,
    at: 0,
    mode: '',            /* 'locks' | 'lease' */
    _was: false,
    _release: null,      /* Web Locks 的释放函数 */
    _queued: false,      /* 已申请锁、正在排队或持有 */
    _timer: null,
    _onChange: null,
    _autoStart: true,    /* 拿到执行权时是否允许自动开始；后开的标签页为 false */
    _wantStart: false,   /* 用户在本页点了「开始」，拿到锁后必须启动 */
    _manualStart: false, /* 手动启动：不受「自动开始」设置限制 */
    _wired: false,

    /* 执行权变化回调：拿到执行权时调用一次，用于自动开始 */
    onChange(fn) {
      this._onChange = fn;
      if (this.isLeader && fn) {
        try { fn(true); } catch (e) { /* ignore */ }
      }
    },

    autoStartAllowed() {
      return this._autoStart !== false;
    },

    manualStartRequested() {
      return !!this._manualStart;
    },

    clearManualStart() {
      this._manualStart = false;
    },

    notify(isLeader) {
      if (this._was === isLeader) return;
      this._was = isLeader;
      if (isLeader) Log.log('主控', '本标签页成为执行主控（' + this.describe() + '）');
      else Log.log('主控', '执行权已交给其他标签页');
      if (this._onChange) {
        try { this._onChange(isLeader); } catch (e) { /* ignore */ }
      }
    },

    describe() {
      return this.mode === 'locks' ? 'Web Locks' : '租约';
    },

    check() {
      const now = nowMs();
      const cur = lsGet('bma.leader.v1', null);
      if (!cur || !cur.id || now - Number(cur.at || 0) > 15000) {
        lsSet('bma.leader.v1', { id: this.id, at: now });
        this.isLeader = true;
      } else if (cur.id === this.id) {
        lsSet('bma.leader.v1', { id: this.id, at: now });
        this.isLeader = true;
      } else {
        this.isLeader = false;
      }
      this.at = now;
      this.notify(this.isLeader);
      return this.isLeader;
    },

    /* 监听其他标签页的接管请求：停止并让出执行权 */
    wire() {
      if (this._wired) return;
      this._wired = true;
      Bus.on((msg) => {
        if (!msg || msg.type !== 'leader' || !msg.data || msg.data.cmd !== 'yield') return;
        if (!this.isLeader) return;
        Log.log('主控', '收到其他标签页的接管请求，停止并让出执行权');
        if (Engine.running) Engine.stop('执行权已转移');
        this.release();
      });
    },

    /* 申请执行锁；若已有标签持有则排队，拿到后也不自动开始（后开的标签页保持停止） */
    acquire() {
      if (this.mode !== 'locks' || this.isLeader || this._queued) return;
      const t0 = nowMs();
      this._queued = true;
      try {
        navigator.locks.request('bma-leader-v1', { mode: 'exclusive' }, () => {
          this._queued = false;
          this.isLeader = true;
          const want = !!this._wantStart;
          this._wantStart = false;
          /* 排队超过 1.5 秒且不是用户主动接管：说明是后开的标签页，拿到锁也保持停止 */
          if (!want && nowMs() - t0 > 1500) this._autoStart = false;
          this.notify(true);
          /* 一直持有，直到页面关闭或调用 release() */
          const hold = new Promise((resolve) => { this._release = resolve; });
          /* 待命标签页不挡路：如果还有别的标签在排队（通常是点了「开始」的那个），
             立即让出，让请求接管的标签页拿到执行权 */
          if (!want && !this._autoStart) {
            this.probePending().then((n) => {
              if (n > 0 && this.isLeader) {
                Log.log('主控', '本页待命中，让出执行权给等待的标签页');
                this.release();
              }
            });
          }
          return hold;
        }).then(() => {
          this._queued = false;
        }).catch((e) => {
          this._queued = false;
          Log.warn('主控', '执行锁申请失败，回退到租约：' + (e.message || e));
          this.mode = 'lease';
          this.startLease();
        });
      } catch (e) {
        this._queued = false;
        Log.warn('主控', '执行锁申请异常，回退到租约：' + (e.message || e));
        this.mode = 'lease';
        this.startLease();
      }
    },

    /* 查询是否已有其他标签页持锁（用于判断本页是不是后开的） */
    probeHeld() {
      if (!navigator.locks || typeof navigator.locks.query !== 'function') return Promise.resolve(false);
      return navigator.locks.query().then((st) => {
        const held = (st && st.held) || [];
        return held.some((l) => l && l.name === 'bma-leader-v1');
      }).catch(() => false);
    },

    /* 还有多少标签页在排队等这把锁 */
    probePending() {
      if (!navigator.locks || typeof navigator.locks.query !== 'function') return Promise.resolve(0);
      return navigator.locks.query().then((st) => {
        const pending = (st && st.pending) || [];
        return pending.filter((l) => l && l.name === 'bma-leader-v1').length;
      }).catch(() => 0);
    },

    start() {
      /* 优先 Web Locks：浏览器保证同一时刻只有一个标签持有，
         不依赖定时器，页面关闭或崩溃时自动释放；
         不可用时回退到 localStorage 租约（后台节流时可能误判） */
      this.wire();
      /* 刷新前这一页正在执行：恢复执行并抢回执行权；新开的标签页没有这个标记 */
      let wasLeader = false;
      try { wasLeader = sessionStorage.getItem('bma.leaderTab') === '1'; } catch (e) { /* ignore */ }
      if (wasLeader) {
        this._autoStart = true;
        this._wantStart = true;
      }
      try {
        if (navigator.locks && typeof navigator.locks.request === 'function') {
          this.mode = 'locks';
          this.probeHeld().then((held) => {
            if (held && !this._wantStart && !this.isLeader) this._autoStart = false;
            this.acquire();
            /* 刷新前是本页在执行：请当前持锁的待命标签页让出 */
            if (wasLeader) Bus.post('leader', { cmd: 'yield' });
          });
          return;
        }
      } catch (e) {
        Log.warn('主控', '当前环境不支持 Web Locks，改用租约：' + (e.message || e));
      }
      this.mode = 'lease';
      this.startLease();
    },

    startLease() {
      if (this._timer) return;
      /* 已有其他标签页的有效租约：本页是后开的，接管后不自动开始 */
      const cur = lsGet('bma.leader.v1', null);
      if (cur && cur.id && cur.id !== this.id && nowMs() - Number(cur.at || 0) <= 15000) {
        if (!this._wantStart) this._autoStart = false;
      }
      /* 刷新后恢复：直接占用租约 */
      if (this._wantStart) lsSet('bma.leader.v1', { id: this.id, at: nowMs() });
      this.check();
      this._timer = setInterval(() => {
        const was = this.isLeader;
        this.check();
        if (was && !this.isLeader && Engine.running) Engine.stop('执行权已转移');
      }, 5000);
    },

    /* 手动接管：请求当前主控停止并让出执行权。
       Web Locks 的授予是异步的，这里只负责发出请求并排队，
       拿到锁后会由 onChange 自动开始；不设短超时，避免后台标签页
       处理消息稍慢就被误判为「无响应」 */
    takeover() {
      if (this.isLeader) return true;
      this._wantStart = true;
      this._manualStart = true;
      this._autoStart = true;
      if (this.mode === 'locks') {
        this.acquire();
      } else {
        lsSet('bma.leader.v1', { id: this.id, at: nowMs() });
        this.check();
      }
      Bus.post('leader', { cmd: 'yield' });
      return this.isLeader;
    },

    /* 主动让出执行权（正常情况下不需要：关闭页面时浏览器会自动释放） */
    release() {
      if (!this._release) return false;
      const done = this._release;
      this._release = null;
      this.isLeader = false;
      this.notify(false);
      done();
      return true;
    }
  };

  /* ==================================================================
   * 19. 启动
   * ================================================================== */
  const Boot = {
    started: false,

    async run() {
      if (this.started) return;
      this.started = true;

      Cfg.load();
      Daily.load();
      Data.loadRooms();
      PageState.init();
      Engine.init();
      Enhance.install();
      UI.init();
      wireGlobalEvents();

      /* 粉丝牌尽早拉一次：看板和三态判定都依赖它。
         以前只有点「开始」才会拉，载入到成为主控的十几秒里整个看板都显示「无粉丝牌」。 */
      Data.refreshMedals(false).then(() => {
        Engine.touch();
        UI.render(true);
      });

      window.addEventListener('keydown', (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 't' || e.key === 'T')) {
          e.preventDefault();
          UI.toggle();
        }
      });

      Log.ok('启动', 'bilibili粉丝团任务工具 v' + VERSION + ' 已载入（Alt+T 打开面板）');

      /* 页面结构可能稍后才出现，按钮注入用轮询兜底 */
      UI.ensureButtonLoop();

      /* 房间视图轮询 */
      RoomView.start();

      /* 登录信息 */
      Auth.ensure().then(() => {
        if (!Auth.isLogin) Log.warn('启动', '未检测到登录状态，任务可能全部失败，请先登录 B 站');
        Engine.touch();
      });

      /* 单主控 + 自动开始：Web Locks 是异步授予的，
         放在 onChange 里才能同时覆盖「启动即持有」与「接管」两种情况 */
      Leader.onChange((isLeader) => {
        if (!isLeader || Engine.running) return;
        const manual = Leader.manualStartRequested();
        if (!manual && (!Cfg.v.autoStart || !Leader.autoStartAllowed())) return;
        setTimeout(() => {
          if (!Leader.isLeader || Engine.running) return;
          if (!manual && (!Cfg.v.autoStart || !Leader.autoStartAllowed())) return;
          Leader.clearManualStart();
          if (Engine.entries().length) {
            Log.log('主控', '接管执行，开始执行任务');
            Engine.start();
          } else {
            Log.log('启动', '任务列表为空，等待添加直播间');
          }
        }, manual ? 600 : 3500);
      });
      Leader.start();

      /* 每分钟检查一次登录与跨天 */
      setInterval(() => {
        Auth.ensure();
        if (Daily.rollover()) {
          Engine.failState.clear();
          Data.clearTaskCache();
          Engine.touch();
        }
      }, 60000);

      Engine.touch();
    }
  };

  /* DOM 就绪后启动，避免 document-start 阶段拿不到 body */
  if (document.body) {
    Boot.run();
  } else {
    window.addEventListener('DOMContentLoaded', () => Boot.run(), { once: true });
    setTimeout(() => { if (!Boot.started) Boot.run(); }, 3000);
  }
})();
