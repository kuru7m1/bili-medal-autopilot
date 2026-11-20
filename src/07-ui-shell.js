  /* ==================================================================
   * 14. UI 外壳：样式 / 顶栏按钮 / 浮窗 / 拖拽 / 缩放
   * ================================================================== */
  const CSS = `
#bma-btn.bma-entry{-webkit-appearance:none;appearance:none;border:0;border-radius:6px;padding:5px 10px;margin-left:8px;background:#23ade5;color:#fff;font-size:12px;line-height:16px;cursor:pointer;font-family:inherit;vertical-align:middle}
#bma-btn.bma-entry:hover{background:#1097cc}
#bma-btn.bma-entry-fixed{position:fixed;right:16px;top:96px;z-index:2147483000;box-shadow:0 3px 12px rgba(0,0,0,.3)}
.bma-panel{position:fixed;z-index:2147483001;display:flex;flex-direction:column;background:rgba(22,24,31,.97);color:#e8ebf1;border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:12px/1.55 "Microsoft YaHei","PingFang SC",system-ui,sans-serif;overflow:hidden;user-select:none}
.bma-hd{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.08);cursor:grab;flex:none}
.bma-hd:active{cursor:grabbing}
.bma-title{font-weight:700;font-size:13px;color:#fff;white-space:nowrap}
.bma-sub{flex:1;color:#8b93a3;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bma-hdbtns{display:flex;gap:6px;flex:none}
.bma-tabs{display:flex;gap:2px;padding:6px 8px 0;border-bottom:1px solid rgba(255,255,255,.08);flex:none;flex-wrap:wrap}
.bma-tab{padding:5px 10px;border-radius:6px 6px 0 0;color:#9aa2b1;cursor:pointer;font-size:12px;white-space:nowrap}
.bma-tab:hover{color:#dfe4ee;background:rgba(255,255,255,.05)}
.bma-tab.on{color:#fff;background:rgba(35,173,229,.18);box-shadow:inset 0 -2px 0 #23ade5}
.bma-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:10px;user-select:text;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.42) rgba(255,255,255,.08);scrollbar-gutter:stable;overscroll-behavior:contain}
.bma-body::-webkit-scrollbar{width:11px}
.bma-body::-webkit-scrollbar-track{background:rgba(255,255,255,.07);border-radius:6px}
.bma-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.38);border-radius:6px;min-height:36px}
.bma-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.55)}
.bma-body::-webkit-scrollbar-thumb:active{background:rgba(255,255,255,.68)}
.bma-rs{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.28) 50%);border-bottom-right-radius:10px}
.bma-sec{margin-bottom:10px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:8px 10px}
.bma-sec-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.bma-sec-tt{font-weight:700;color:#fff;font-size:12px}
.bma-muted{color:#8b93a3;font-size:11px}
.bma-err{color:#ff9a9d;cursor:pointer}
.bma-err:hover{text-decoration:underline}
.bma-warn{color:#ff9a9d;font-weight:600}
.bma-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0}
.bma-kv{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
.bma-kv b{color:#fff;font-weight:600}
.bma-btn{-webkit-appearance:none;appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#dfe4ee;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;line-height:16px}
.bma-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.bma-btn.primary{background:#23ade5;border-color:#23ade5;color:#fff}
.bma-btn.primary:hover{background:#1097cc;border-color:#1097cc}
.bma-btn.danger{background:rgba(229,72,77,.18);border-color:rgba(229,72,77,.5);color:#ff9a9d}
.bma-btn.danger:hover{background:rgba(229,72,77,.32);color:#fff}
.bma-btn.mini{padding:2px 7px;font-size:11px;line-height:14px}
.bma-btn[disabled]{opacity:.45;cursor:not-allowed}
.bma-input,.bma-select{background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.16);color:#e8ebf1;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;min-width:0}
.bma-input:focus,.bma-select:focus{border-color:#23ade5}
.bma-input.grow{flex:1}
.bma-input.narrow{width:64px}
.bma-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:10px;font-size:11px;line-height:16px;background:rgba(255,255,255,.1);color:#c7cdd9;white-space:nowrap}
.bma-chip.done{background:rgba(26,176,89,.2);color:#7ee0a5}
.bma-chip.run{background:rgba(35,173,229,.22);color:#8ed7f7}
.bma-chip.fail{background:rgba(229,72,77,.2);color:#ff9a9d}
.bma-chip.off{background:rgba(255,255,255,.06);color:#6d7583}
.bma-room{position:relative;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:7px 9px;margin-bottom:6px;background:rgba(255,255,255,.03)}
.bma-room-task{position:absolute;right:9px;bottom:7px}
.bma-room-last{padding-right:72px}
.bma-room.drag{opacity:.45;border-style:dashed}
.bma-taskpop{position:fixed;z-index:2147483003;width:262px;padding:6px;background:rgba(26,28,36,.98);color:#e8ebf1;border:1px solid rgba(255,255,255,.14);border-radius:8px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:12px/1.5 "Microsoft YaHei","PingFang SC",system-ui,sans-serif}
.bma-taskpop-hd{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:2px 4px 6px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:4px}
.bma-taskpop-hd b{color:#fff;font-size:12px;font-weight:700}
.bma-taskpop-row{display:flex;align-items:center;gap:6px;padding:4px;border-radius:5px}
.bma-taskpop-row:hover{background:rgba(255,255,255,.07)}
.bma-taskpop-lbl{display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer}
.bma-taskpop-row input[type=checkbox]{accent-color:#23ade5;width:14px;height:14px;cursor:pointer}
.bma-taskpop-row input[type=range]{width:96px;height:14px;accent-color:#23ade5;cursor:pointer;flex:none}
.bma-limit-val{width:24px;text-align:right;color:#b8c0cf;font-variant-numeric:tabular-nums;flex:none}
.bma-taskpop-row.disabled{opacity:.55}
.bma-taskpop-row.disabled .bma-taskpop-lbl{cursor:default}
.bma-taskpop-row.disabled:hover{background:none}
.bma-taskpop-row.disabled input{cursor:not-allowed}
.bma-taskpop-row .bma-muted{margin-left:auto;font-size:10px}
.bma-room-hd{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.bma-room-name{font-weight:600;color:#fff;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;display:inline-block}a.bma-room-name:hover{color:#8ed7f7;text-decoration:underline}
.bma-room-id{color:#7c8494;font-size:11px}
/* 队列卡片上的粉丝牌等级 + 亲密度迷你条 */
.bma-room-medal{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:16px;color:#b8c0cf;font-variant-numeric:tabular-nums;white-space:nowrap}
.bma-room-medal>b{color:#fff;font-weight:600}
.bma-mbar{display:inline-block;width:42px;height:4px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden;vertical-align:middle}
.bma-mbar>em{display:block;height:100%;background:linear-gradient(90deg,#1ab059,#23ade5);border-radius:2px;transition:width .4s}
.bma-grip{cursor:grab;color:#5c6472;font-size:13px;padding:0 2px}
.bma-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin:4px 0}
.bma-bar>i{display:block;height:100%;background:linear-gradient(90deg,#1ab059,#23ade5);border-radius:3px;transition:width .4s}
.bma-log{font:11px/1.5 Consolas,Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:none}
.bma-log div{padding:1px 0;border-bottom:1px dashed rgba(255,255,255,.05)}
.bma-log .lv-warn{color:#f5c26b}
.bma-log .lv-error{color:#ff9a9d}
.bma-log .lv-ok{color:#7ee0a5}
.bma-log .lv-info{color:#b8c0cf}
.bma-switch{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:#b8c0cf}
.bma-switch input{accent-color:#23ade5;width:14px;height:14px;cursor:pointer}
.bma-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bma-empty{padding:18px 8px;text-align:center;color:#6d7583}
.bma-wb{margin:7px 0}
.bma-wb-hd{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#b8c0cf;margin-bottom:3px}
.bma-wb-name{max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bma-wb-val{color:#8b93a3;flex:none}
.bma-wb-track{position:relative;display:flex;height:9px;border-radius:5px;background:rgba(255,255,255,.1);overflow:hidden}
.bma-wb-track>i{display:block;flex:none;height:100%;background:linear-gradient(90deg,#1ab059,#7ee0a5);transition:width .4s}
.bma-wb-track>i.self{background:linear-gradient(90deg,#e5484d,#ff9a9d)}
.bma-wb-track>i.done{background:linear-gradient(90deg,#0f8a49,#5fd394)}
.bma-wb-track>i.run{background:linear-gradient(90deg,#1ab059,#9cebbe)}
.bma-wb-track>i.off{background:rgba(255,255,255,.2)}
    .bma-wb-track>i.srv{background:linear-gradient(90deg,#2f6ff5,#8fbcff)}
.bma-wb-track>em{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.45)}
.bma-toast{position:fixed;z-index:2147483002;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(20,22,28,.96);color:#fff;padding:7px 14px;border-radius:8px;font-size:12px;border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}
.bma-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}
.bma-toast.err{border-color:rgba(229,72,77,.6)}
html[data-bma-dark] .bma-panel{background:rgba(22,24,31,.97)}
`;

  function injectCss() {
    if (document.getElementById('bma-css')) return;
    const st = document.createElement('style');
    st.id = 'bma-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  const UI = {
    panel: null,
    body: null,
    sub: null,
    tab: 'room',
    openNow: false,
    watchOpen: true,
    watchSrv: false,
    geo: { left: null, top: null, w: 430, h: 580 },
    toastEl: null,
    toastTimer: null,
    renderTimer: null,
    lastVersion: -1,

    loadGeo() {
      const g = lsGet(LSKEY.ui, null);
      if (g && typeof g === 'object') {
        ['left', 'top', 'w', 'h'].forEach((k) => {
          if (typeof g[k] === 'number' && isFinite(g[k])) this.geo[k] = g[k];
        });
        if (g.tab) this.tab = String(g.tab);
        if (g.watchOpen === false) this.watchOpen = false;
        if (g.watchSrv === true) this.watchSrv = true;
      }
      return this;
    },

    saveGeo() {
      lsSet(LSKEY.ui, { left: this.geo.left, top: this.geo.top, w: this.geo.w, h: this.geo.h, tab: this.tab, watchOpen: this.watchOpen !== false, watchSrv: this.watchSrv === true });
    },

    init() {
      injectCss();
      this.loadGeo();
      this.injectEntryButton();
      Engine.on(() => this.scheduleRender());
      Log.on(() => { if (this.tab === 'log') this.scheduleRender(200); });
      return this;
    },

    /* ---------- 顶栏入口按钮 ---------- */
    injectEntryButton() {
      if (!document.body) return;
      if (document.getElementById('bma-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'bma-btn';
      btn.type = 'button';
      btn.className = 'bma-entry';
      btn.textContent = '任务';
      btn.title = 'bilibili粉丝团任务工具（Alt+T 打开/关闭）';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      });
      const anchor =
        document.querySelector('.header-info-ctnr .normal-row-ctnr') ||
        document.querySelector('#player-ctnr .normal-row-ctnr') ||
        document.querySelector('.normal-row-ctnr') ||
        document.querySelector('.follow-ctnr');
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      } else {
        btn.classList.add('bma-entry-fixed');
        document.body.appendChild(btn);
      }
    },

    ensureButtonLoop() {
      setInterval(() => {
        if (!document.body) return;
        if (!document.getElementById('bma-btn')) this.injectEntryButton();
      }, 2500);
    },

    /* ---------- 浮窗 ---------- */
    mount() {
      if (this.panel) return;
      injectCss();
      const p = document.createElement('div');
      p.className = 'bma-panel';
      p.innerHTML =
        '<div class="bma-hd" data-el="hd">' +
          '<span class="bma-title">直播任务助手</span>' +
          '<span class="bma-sub" data-el="sub"></span>' +
          '<span class="bma-hdbtns">' +
            '<button type="button" class="bma-btn mini" data-act="reloadPanel" title="重新加载配置、粉丝牌与任务数据（不用刷新页面）">刷新</button>' +
            '<button type="button" class="bma-btn primary mini" data-act="run">开始</button>' +
            '<button type="button" class="bma-btn mini" data-act="close">×</button>' +
          '</span>' +
        '</div>' +
        '<div class="bma-tabs">' +
          '<span class="bma-tab" data-tab="room">本房间</span>' +
          '<span class="bma-tab" data-tab="list">任务看板</span>' +
          '<span class="bma-tab" data-tab="log">日志</span>' +
          '<span class="bma-tab" data-tab="set">设置</span>' +
        '</div>' +
        '<div class="bma-body" data-el="body"></div>' +
        '<div class="bma-rs" data-el="rs"></div>';
      document.documentElement.appendChild(p);
      this.panel = p;
      this.body = p.querySelector('[data-el="body"]');
      this.sub = p.querySelector('[data-el="sub"]');
      this.applyGeo();
      this.bindPanel();
      this.render(true);
      this.openNow = true;
      Engine.touch();
    },

    unmount() {
      removeNode(this.panel);
      this.panel = null;
      this.body = null;
      this.openNow = false;
      if (typeof ListView !== 'undefined') ListView.taskPop = '';
      Engine.touch();
    },

    toggle() {
      if (this.panel) this.unmount();
      else this.mount();
    },

    applyGeo() {
      if (!this.panel) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = clamp(this.geo.w || 430, 340, Math.max(340, vw - 24));
      const h = clamp(this.geo.h || 580, 300, Math.max(300, vh - 24));
      let left = this.geo.left;
      let top = this.geo.top;
      if (left == null) left = vw - w - 24;
      if (top == null) top = 88;
      left = clamp(left, 8, Math.max(8, vw - w - 8));
      top = clamp(top, 8, Math.max(8, vh - h - 8));
      this.panel.style.left = left + 'px';
      this.panel.style.top = top + 'px';
      this.panel.style.width = w + 'px';
      this.panel.style.height = h + 'px';
      this.geo = { left: left, top: top, w: w, h: h };
    },

    bindPanel() {
      const p = this.panel;
      const hd = p.querySelector('[data-el="hd"]');
      const rs = p.querySelector('[data-el="rs"]');

      /* 页签 / 按钮 */
      p.addEventListener('click', (e) => {
        const tabEl = e.target.closest ? e.target.closest('[data-tab]') : null;
        if (tabEl && p.contains(tabEl)) {
          this.setTab(tabEl.getAttribute('data-tab'));
          return;
        }
        const actEl = e.target.closest ? e.target.closest('[data-act]') : null;
        if (actEl && p.contains(actEl)) {
          this.onAction(actEl.getAttribute('data-act'), actEl, e);
        }
      });

      p.addEventListener('change', (e) => {
        const el = e.target;
        if (!el || !el.getAttribute) return;
        const bind = el.getAttribute('data-bind');
        if (bind) {
          let val;
          if (el.type === 'checkbox') val = !!el.checked;
          else if (el.type === 'number') val = Number(el.value);
          else val = el.value;
          this.setBind(bind, val);
        }
      });

      /* 房间上限滑块：拖动时只更新右侧数字，松手（change）才落盘 */
      p.addEventListener('input', (e) => {
        const el = e.target;
        if (!el || !el.getAttribute || !el.getAttribute('data-room-limit')) return;
        const wrap = el.parentNode;
        const val = wrap && wrap.querySelector ? wrap.querySelector('.bma-limit-val') : null;
        if (val) val.textContent = el.value;
      });

      /* 拖拽移动 */
      let drag = null;
      hd.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest('button')) return;
        drag = {
          x: e.clientX,
          y: e.clientY,
          left: this.panel.offsetLeft,
          top: this.panel.offsetTop
        };
        e.preventDefault();
        const move = (ev) => {
          if (!drag) return;
          const left = clamp(drag.left + ev.clientX - drag.x, 4, window.innerWidth - 120);
          const top = clamp(drag.top + ev.clientY - drag.y, 4, window.innerHeight - 60);
          this.panel.style.left = left + 'px';
          this.panel.style.top = top + 'px';
          this.geo.left = left;
          this.geo.top = top;
        };
        const up = () => {
          drag = null;
          document.removeEventListener('mousemove', move, true);
          document.removeEventListener('mouseup', up, true);
          this.saveGeo();
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
      });

      /* 拖拽缩放 */
      let size = null;
      rs.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        size = {
          x: e.clientX,
          y: e.clientY,
          w: this.panel.offsetWidth,
          h: this.panel.offsetHeight
        };
        e.preventDefault();
        e.stopPropagation();
        const move = (ev) => {
          if (!size) return;
          const w = clamp(size.w + ev.clientX - size.x, 340, window.innerWidth - this.panel.offsetLeft - 8);
          const h = clamp(size.h + ev.clientY - size.y, 280, window.innerHeight - this.panel.offsetTop - 8);
          this.panel.style.width = w + 'px';
          this.panel.style.height = h + 'px';
          this.geo.w = w;
          this.geo.h = h;
        };
        const up = () => {
          size = null;
          document.removeEventListener('mousemove', move, true);
          document.removeEventListener('mouseup', up, true);
          this.saveGeo();
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
      });

      /* 滚动或缩放时浮层会与按钮错位：滚动直接关闭，缩放重新定位 */
      this.body.addEventListener('scroll', () => {
        if (typeof ListView === 'undefined' || !ListView.taskPop) return;
        ListView.taskPop = '';
        const pop = p.querySelector('.bma-taskpop');
        if (pop) removeNode(pop);
      }, { passive: true });

      window.addEventListener('resize', () => {
        this.applyGeo();
        if (typeof ListView !== 'undefined' && ListView.taskPop) this.placeTaskPop();
      });
    },

    setTab(tab) {
      this.tab = tab;
      if (tab !== 'list' && typeof ListView !== 'undefined') ListView.taskPop = '';
      this.saveGeo();
      const tabs = this.panel ? this.panel.querySelectorAll('.bma-tab') : [];
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === tab);
      }
      this.render(true);
    },

    onAction(act, el) {
      if (act === 'run') {
        Engine.toggle();
      } else if (act === 'close') {
        this.unmount();
      }
    },

    setBind(pathStr, val) {
      /* 只保证是正整数，不设上限；实际并发还会按房间数收敛 */
      if (pathStr === 'watch.multiRoomMax') {
        val = Math.max(1, Math.round(Number(val) || 1));
      }
      /* 任务上限：留空/0 = 跟随服务端；不设输入范围 */
      if (/^taskLimit\.(like|danmu|watch)$/.test(pathStr)) {
        val = Math.max(0, Math.round(Number(val) || 0));
      }
      Cfg.set(pathStr, val);
      if (pathStr === 'watch.multiRoomMax') this.scheduleRender(80);
      Engine.touch();
    },

    scheduleRender(delay) {
      clearTimeout(this.renderTimer);
      this.renderTimer = setTimeout(() => this.render(false), delay || 320);
    },

    render(force) {
      if (!this.panel || !this.body) return;
      const ae = document.activeElement;
      if (!force && ae && ae.tagName && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT') && this.panel.contains(ae)) {
        return;
      }
      if (!force && this.lastVersion === Engine.version) return;
      this.lastVersion = Engine.version;

      /* 表头状态 */
      const total = Engine.entries().length;
      const doneCount = Engine.entries().filter((e) => {
        const meta = Data.room(e.roomId);
        return meta && Engine.allDone(meta);
      }).length;
      let subText;
      if (Engine.syncing) {
        subText = '正在与服务端对账…';
      } else if (Engine.running) {
        const cur = Engine.current ? (TASK_NAME[Engine.current.name] + ' ' + Engine.current.roomId + ' ' + (Engine.current.text || '')) : '';
        const w = Engine.watches.length ? ('观时 ' + Engine.watches.length + ' 路') : '';
        subText = '运行中 ' + doneCount + '/' + total + (cur ? ' · ' + cur : '') + (w ? ' · ' + w : '');
      } else {
        subText = '已停止 · 完成 ' + doneCount + '/' + total;
      }
      if (this.sub) this.sub.textContent = subText;

      const btn = this.panel.querySelector('[data-act="run"]');
      if (btn) {
        btn.textContent = Engine.running ? '停止' : '开始';
        btn.classList.toggle('danger', !!Engine.running);
        btn.classList.toggle('primary', !Engine.running);
      }

      const tabs = this.panel.querySelectorAll('.bma-tab');
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === this.tab);
      }

      let html;
      try {
        html = Tabs[this.tab] ? Tabs[this.tab]() : '<div class="bma-empty">未知页签</div>';
      } catch (e) {
        html = '<div class="bma-empty">渲染出错：' + esc(e && e.message ? e.message : e) + '</div>';
        Log.error('界面', '渲染 ' + this.tab + ' 失败：' + (e && e.stack ? e.stack : e));
      }
      const scrollTop = this.body.scrollTop;
      this.body.innerHTML = html;
      if (this.tab !== 'log') this.body.scrollTop = scrollTop;
      else this.body.scrollTop = this.body.scrollHeight;
      if (typeof ListView !== 'undefined' && ListView.taskPop) this.placeTaskPop();
    },

    /* 把房间任务开关的浮层贴在对应按钮下方（空间不足时翻到上方） */
    placeTaskPop() {
      if (!this.panel) return;
      const pop = this.panel.querySelector('.bma-taskpop');
      if (!pop) return;
      const key = String(ListView.taskPop);
      const btns = this.panel.querySelectorAll('[data-act="roomTasks"]');
      let btn = null;
      for (let i = 0; i < btns.length; i++) {
        if (String(btns[i].getAttribute('data-key')) === key) { btn = btns[i]; break; }
      }
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const w = pop.offsetWidth || 262;
      const h = pop.offsetHeight || 176;
      let left = r.right - w;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = r.top - h - 6;
      left = clamp(left, 8, Math.max(8, window.innerWidth - w - 8));
      top = clamp(top, 8, Math.max(8, window.innerHeight - h - 8));
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    },

    toast(msg, ok) {
      if (!this.toastEl) {
        const el = document.createElement('div');
        el.className = 'bma-toast';
        document.documentElement.appendChild(el);
        this.toastEl = el;
      }
      this.toastEl.textContent = String(msg || '');
      this.toastEl.classList.toggle('err', ok === false);
      this.toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        if (this.toastEl) this.toastEl.classList.remove('show');
      }, 2600);
    }
  };
