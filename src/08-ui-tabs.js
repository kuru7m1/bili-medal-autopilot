  /* ==================================================================
   * 15. 页签内容
   * ================================================================== */
  const TASKMETA = {
    feedLight: '投喂粉丝灯牌',
    watchLive: '观看直播',
    sendGift: '投喂礼物',
    sendDanmu: '发弹幕',
    like: '点赞'
  };
  const TASKREWARD = {
    feedLight: '+6 亲密度',
    watchLive: '+1 亲密度',
    sendGift: '+1 亲密度/电池',
    sendDanmu: '+1 亲密度',
    like: '+1 亲密度'
  };

  function chip(state, text) {
    const cls = state === 'done' ? 'done' : state === 'run' ? 'run' : state === 'fail' ? 'fail' : state === 'off' ? 'off' : '';
    return '<span class="bma-chip ' + cls + '">' + esc(text) + '</span>';
  }

  /* 储蓄亲密度：达到设置阈值时只把数字标红，卡片上不加额外文字 */
  function freeIntimacyHtml(n) {
    const v = Number(n) || 0;
    const warn = Number(Cfg.v.freeWarnAt);
    if (warn > 0 && v >= warn) return '<span class="bma-warn">' + fmt(v) + '</span>';
    return fmt(v);
  }

  const TASK_STATE_LABEL = {
    off: '关',
    done: '✓',
    ready: '可做',
    run: '进行中',
    retry: '重试',
    waitLive: '待开播',
    waitOffline: '待下播',
    waitLight: '待点亮',
    defer: '待确认',
    na: '无任务',
    nomedal: '无牌',
    skip: '跳过'
  };

  function taskChip(name, state, info) {
    const label = TASK_NAME[name] || name;
    const text = TASK_STATE_LABEL[state] || '待做';
    const cls = state === 'done' ? 'done'
      : state === 'run' ? 'run'
        : state === 'retry' ? 'fail'
          : (state === 'waitLive' || state === 'waitOffline' || state === 'waitLight' || state === 'off' ||
            state === 'defer' || state === 'na' || state === 'nomedal' || state === 'skip') ? 'off'
            : state === 'blocked' ? 'fail'
            : '';
    let num = '';
    const showNum = state === 'ready' || state === 'run' || state === 'done' ||
      state === 'retry' || state === 'blocked';
    if (info && info.max > 0 && showNum) {
      const cur = Math.min(Math.max(0, Number(info.cur) || 0), info.max);
      num = ' ' + cur + '/' + info.max;
    }
    return chip(cls, label + num + ' ' + text);
  }

  /* ---------------- 本房间视图 ---------------- */
  const RoomView = {
    at: 0,
    data: null,
    loading: false,
    /* 已经提示过「没有 today_feed」的房间，避免每 15 秒刷一条日志 */
    noFeedLogged: {},

    async refresh(force) {
      const roomId = currentPageRoomId();
      if (!roomId) {
        this.data = null;
        return;
      }
      if (Net.blocked()) return;
      if (!force && this.data && this.data.roomId === roomId && nowMs() - this.at < 12000) return;
      if (this.loading) return;
      this.loading = true;
      try {
        await Auth.ensure();
        if (!Data.medalOf(roomId) && !Data.medals.size) await Data.refreshMedals(false);
        const medal = Data.medalOf(roomId) || null;
        const uid = medal ? Number(medal.medal.target_id) : 0;
        let tasks = { ok: false, tasks: [] };
        if (uid) tasks = await Data.tasks(uid);
        this.data = {
          roomId: roomId,
          uid: uid,
          medal: medal,
          tasks: tasks,
          at: nowMs()
        };
        this.at = nowMs();
      } catch (e) {
        Log.warn('本房间', '读取失败：' + (e.message || e));
      } finally {
        this.loading = false;
        Engine.touch();
      }
    },

    start() {
      setInterval(() => {
        if (UI.panel && UI.tab === 'room') this.refresh(false);
      }, 15000);
      this.refresh(true);
    },

    /* 按任务进度反推今日亲密度：每项 = 已完成轮次 × 每轮亲密度，大航海 ×1.5 */
    taskGain(tasks, guardLevel) {
      let sum = 0;
      (tasks || []).forEach((t) => {
        const mm = /(\d+)\s*\/\s*(\d+)/.exec(String(t.sub_title || ''));
        if (!mm || !Number(mm[1])) return;
        const unit = (/亲密度\s*\+\s*(\d+)/.exec(String(t.add_text || '')) || [0, 0])[1];
        sum += Number(mm[1]) * Number(unit);
      });
      return guardLevel > 0 && sum > 0 ? Math.floor(sum * 1.5) : sum;
    },

    /* 今日亲密度增长明细（与亲密度面板同算法：任务反推 + 大航海 1.5 倍 + 其他反推） */
    gainHtml(tasks, medal, guardLevel, shareGain) {
      if (!tasks || !tasks.length) return '';
      const share = Number(shareGain) || 0;
      const rows = [];
      tasks.forEach((t) => {
        const mm = /(\d+)\s*\/\s*(\d+)/.exec(String(t.sub_title || ''));
        if (!mm || !Number(mm[1])) return;
        const unit = (/亲密度\s*\+\s*(\d+)/.exec(String(t.add_text || '')) || [0, 0])[1];
        rows.push({
          name: TASKMETA[t.jump_type] || t.title || '任务',
          mid: mm[1] + '/' + mm[2],
          gained: Number(mm[1]) * Number(unit)
        });
      });
      const sum = rows.reduce((a, r) => a + r.gained, 0);
      let body = rows.length ? rows.map((r) =>
        '<div class="bma-kv"><span>' + esc(r.name) + ' <span class="bma-muted">' + esc(r.mid) + '</span></span><b>+' + r.gained + '</b></div>'
      ).join('') : '<div class="bma-muted">今日暂无亲密度增长</div>';
      /* 分享不在五项任务里，单独列一行，并从「其他」的差额里扣掉 */
      if (share > 0) {
        body += '<div class="bma-kv"><span>分享 <span class="bma-muted">脚本上报</span></span><b>+' + share + '</b></div>';
      }

      let total = sum;
      let foot = '<div class="bma-kv"><span>明细合计</span><b>+' + sum + '</b></div>';
      if (guardLevel > 0 && sum > 0) {
        const boosted = sum * 1.5;
        total = Math.floor(boosted);
        foot += '<div class="bma-kv"><span>大航海 ×1.5</span><b>+' + total + '</b></div>';
      }
      const todayFeed = medal && medal.today_feed != null ? Number(medal.today_feed) : null;
      if (todayFeed != null && todayFeed - total - share > 0) {
        const other = todayFeed - total - share;
        foot += '<div class="bma-kv"><span class="bma-muted">其他（充电/投币/礼物）</span><b>+' + other + '</b></div>';
      }
      return '<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">今日亲密度增长明细</span></div>' + body + foot + '</div>';
    },

    render() {
      const roomId = currentPageRoomId();
      if (!roomId) {
        return '<div class="bma-empty">当前页面不是直播间<br>' +
          '<span class="bma-muted">当前页面不是直播间，观时任务可正常执行；' +
          '若同时在其它标签页观看直播，该观看会计入账号总并发额度。批量执行与运行日志见上方页签。</span></div>';
      }
      const d = this.data;
      if (!d || d.roomId !== roomId) {
        return '<div class="bma-empty">正在读取房间 ' + esc(roomId) + ' …</div>';
      }
      const medal = d.medal;
      const tasks = (d.tasks && d.tasks.tasks) || [];
      const out = [];

      if (!medal) {
        out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">直播间 ' + esc(roomId) + '</span>' +
          chip('off', '未加入粉丝团') + '</div>' +
          '<div class="bma-muted">当前账号未持有该主播的粉丝牌，因此不存在粉丝团任务；即使加入白名单也不会有可执行任务。</div></div>');
      } else {
        const m = medal.medal || {};
        const shareRec = Daily.get({ roomId: Number(roomId), uid: Number(m.target_id) || 0 });
        const intimacy = Number(m.intimacy) || 0;
        const next = Number(m.next_intimacy) || 0;
        const todayFeed = Number(m.today_feed) || 0;
        const dayLimit = Number(m.day_limit) || 0;
        const pct = next > 0 ? Math.min(100, Math.round((intimacy / next) * 100)) : 0;
        const guardLevel = Number(m.guard_level) || 0;
        const guardName = guardLevel === 1 ? '总督' : guardLevel === 2 ? '提督' : guardLevel === 3 ? '舰长' : '';
        /* 服务端的 today_feed 有时给不出来（储蓄模式），此时按任务进度估算；
           分享收益不并入估算值——储蓄模式下它本身也验证不了，并进来会虚高 */
        const estToday = this.taskGain(tasks, guardLevel);
        const hasServerToday = m.today_feed != null && todayFeed > 0;
        if (!hasServerToday && estToday > 0 && !this.noFeedLogged[roomId]) {
          this.noFeedLogged[roomId] = true;
          Log.log('本房间', '房间 ' + roomId + ' 的粉丝牌数据没有可用的 today_feed，今日亲密度按任务进度估算');
        }
        const todayText = hasServerToday
          ? fmt(todayFeed) + (dayLimit > 0 ? ' / ' + fmt(dayLimit) : '')
          : (estToday > 0 ? fmt(estToday) + '（按任务估算）' : '0');
        out.push('<div class="bma-sec">' +
          '<div class="bma-sec-hd"><span class="bma-sec-tt">' + esc(m.medal_name || '粉丝牌') + '</span>' +
          chip('', 'Lv.' + (m.level == null ? '?' : m.level)) +
          (guardName ? chip('done', guardName) : '') +
          (Number(m.is_lighted) === 1 ? chip('done', '已点亮') : chip('fail', '未点亮')) + '</div>' +
          '<div class="bma-bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="bma-kv"><span>亲密度</span><b>' + fmt(intimacy) + ' / ' + fmt(next) + '</b></div>' +
          '<div class="bma-kv"><span>今日亲密度</span><b>' + todayText + '</b></div>' +
          (!hasServerToday && estToday > 0
            ? '<div class="bma-muted">储蓄模式下服务端不返回今日亲密度，此处由插件按每日任务进度估算，不含分享直播间的收益。</div>'
            : '') +
          '</div>');

        if (d.tasks && d.tasks.ok) {
          if (d.tasks.free > 0) {
            out.push('<div class="bma-sec"><div class="bma-kv"><span>已储蓄亲密度</span><b>' + fmt(d.tasks.free) + (d.tasks.reachLimit ? ' · 已达上限' : '') + '</b></div>' +
              '<div class="bma-muted">投喂一个粉丝灯牌即可领取储蓄的亲密度</div></div>');
          }
          const jn = d.tasks.journey;
          if (jn && jn.enable) {
            const total = Number(jn.total_days) || 0;
            const done = Math.min(Number(jn.completed_days) || 0, total);
            if (total > 0) {
              let seg = '';
              for (let i = 0; i < total; i++) seg += '<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:2px;background:' + (i < done ? '#1ab059' : 'rgba(255,255,255,.15)') + '"></i>';
              let extra = '';
              const left = (Number(jn.task_intimacy_journey_gift_expire_ts) || 0) * 1000 - nowMs();
              if (jn.has_task_intimacy_journey_gift && left > 0) extra = '<div class="bma-muted">旅程礼物已解锁，剩余 ' + Math.floor(left / 86400000) + ' 天领取时限</div>';
              out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">亲密之旅</span><span class="bma-muted">' + done + '/' + total + ' 天</span></div><div>' + seg + '</div>' + extra + '</div>');
            }
          }
          const shareRow = Cfg.v.tasks.share
            ? '<div class="bma-row" style="justify-content:space-between"><span>分享直播间 ' +
              '<span class="bma-muted">亲密度+2 · 每日 1 次</span></span>' +
              (shareRec.done && shareRec.done.share ? chip('done', '已完成')
                : (shareRec.shareTryAt ? chip('off', '待确认') : chip('', '未完成'))) + '</div>'
            : '';
          out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">每日任务</span><span class="bma-muted">' + (tasks.length ? (tasks.length + (Cfg.v.tasks.share ? 1 : 0)) + ' 项' : '接口未返回') + '</span></div>' +
            (tasks.length ? tasks.map((t) => {
              const mm = /(\d+)\s*\/\s*(\d+)/.exec(String(t.sub_title || ''));
              const done = t.is_done === 1 || t.is_done === true;
              const name = TASKMETA[t.jump_type] || t.title || '任务';
              const meta = [TASKREWARD[t.jump_type] || '', mm ? mm[1] + '/' + mm[2] : ''].filter(Boolean).join(' · ');
              return '<div class="bma-row" style="justify-content:space-between"><span>' + esc(name) +
                (meta ? ' <span class="bma-muted">' + esc(meta) + '</span>' : '') + '</span>' +
                (done ? chip('done', '已完成') : chip('', '未完成')) + '</div>';
            }).join('') + shareRow : '<div class="bma-muted">' + esc(d.tasks.reason || '暂无任务数据') + '</div>') +
            '</div>');
          out.push(this.gainHtml(tasks, m, Number(d.tasks.guard) || 0, shareRec.shareGain));
        } else {
          out.push('<div class="bma-sec"><div class="bma-muted">任务进度读取失败：' + esc((d.tasks && d.tasks.reason) || '未知') + '</div>' +
            '<div class="bma-row"><button type="button" class="bma-btn mini" data-act="refreshRoom">重新读取</button></div></div>');
        }
      }

      return out.join('');
    }
  };

  /* ---------------- 白名单 ---------------- */
  const ListView = {
    picking: false,
    sel: new Set(),
    taskPop: '',   /* 当前展开房间任务开关的房间号（空 = 未展开） */

    /* 可导入的粉丝牌（按等级降序） */
    items() {
      const out = [];
      Data.medals.forEach((it, key) => {
        if (!key || String(key).indexOf("u") === 0) return;
        if (!it || !it.medal || !it.room_info) return;
        out.push(it);
      });
      out.sort((a, b) => Number(b.medal.level) - Number(a.medal.level));
      return out;
    },

    /* 清掉已不在列表里的勾选（粉丝牌可能被取关、房间信息缺失） */
    pruneSel() {
      if (!this.sel.size) return;
      const ids = new Set();
      this.items().forEach((it) => ids.add(String(it.room_info.room_id)));
      Array.from(this.sel).forEach((rid) => { if (!ids.has(rid)) this.sel.delete(rid); });
    },

    /* 勾选后只更新按钮文字，不重建列表——否则连续勾选时会因为 DOM 被替换而漏点 */
    syncPickBtns() {
      const body = (typeof UI !== 'undefined' && UI && UI.body) ? UI.body : null;
      if (!body) return;
      const imp = body.querySelector('[data-act="pickImport"]');
      if (imp) imp.textContent = '导入所选（' + this.sel.size + '）';
      const all = body.querySelector('[data-act="pickAll"]');
      if (all) {
        const items = this.items();
        const allSel = items.length > 0 && items.every((it) => this.sel.has(String(it.room_info.room_id)));
        all.textContent = allSel ? '全不选' : '全选';
      }
    },

    render() {
      const v = Cfg.v;
      const out = [];
      const running = Engine.running;

      out.push('<div class="bma-sec">' +
        '<div class="bma-row"><input class="bma-input grow" data-el="roomInput" placeholder="房间号 / 直播间链接 / uid:12345" />' +
        '<button type="button" class="bma-btn primary" data-act="addRoom">添加</button></div>' +
        '<div class="bma-row">' +
        '<button type="button" class="bma-btn ' + (running ? 'danger' : 'primary') + '" data-act="run">' + (running ? '停止执行' : '开始执行') + '</button>' +
        '<button type="button" class="bma-btn" data-act="refreshRooms">刷新状态</button>' +
        '<button type="button" class="bma-btn" data-act="pickMedals">从粉丝牌导入</button>' +
        '</div>' +
        '<div class="bma-muted">白名单 ' + v.whitelist.length + ' 个 · 黑名单 ' + v.blacklist.length + ' 个 · 实际执行 ' + Engine.entries().length + ' 个（黑名单优先）</div>' +
        '</div>');

      if (Net.blocked()) {
        out.push('<div class="bma-sec" style="border-color:rgba(229,72,77,.5)">' +
          '<div class="bma-row">' + chip('fail', '风控冷却中 ' + Math.ceil(Net.blockedLeft() / 1000) + ' 秒') + '</div>' +
          '<div class="bma-muted">接口返回风控码后将暂停请求直至冷却结束；具体触发接口可在「日志」页签查看。</div></div>');
      }

      if (this.picking) {
        const items = this.items();
        const allSel = items.length > 0 && items.every((it) => this.sel.has(String(it.room_info.room_id)));
        const wlSet = new Set((v.whitelist || []).map((e) => String(e.roomId)));
        out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">从粉丝牌导入（' + items.length + '）</span></div>' +
          '<div class="bma-row"><button type="button" class="bma-btn mini" data-act="pickAll">' +
          (allSel ? '全不选' : '全选') + '</button>' +
          '<button type="button" class="bma-btn mini primary" data-act="pickImport">导入所选（' + this.sel.size + '）</button></div>' +
          (items.length ? items.slice(0, 200).map((it) => {
            const rid = String(it.room_info.room_id);
            const checked = this.sel.has(rid) ? ' checked' : '';
            const lit = Number(it.medal.is_lighted) === 1;
            const added = wlSet.has(rid);
            return '<label class="bma-switch" style="display:flex;justify-content:space-between;padding:2px 0">' +
              '<span><input type="checkbox" data-pick="' + rid + '"' + checked + ' /> ' +
              esc(it.medal.medal_name || '') + ' <span class="bma-muted">Lv.' + esc(it.medal.level) + ' · ' + rid + (lit ? '' : ' · 未点亮') + '</span>' +
              (added ? chip('done', '已添加') : '') + '</span>' +
              '</label>';
          }).join('') : '<div class="bma-muted">暂无粉丝牌数据，请先点击「刷新状态」</div>') +
          '</div>');
      }

      const list = v.whitelist.slice();
      if (!list.length) {
        out.push('<div class="bma-empty">还没有添加任何直播间<br><span class="bma-muted">可输入房间号手动添加，或通过「从粉丝牌导入」批量导入</span></div>');
      } else {
        const rows = Engine.summary();
        const doneRows = rows.filter((r) => ['light', 'like', 'danmu', 'watch'].every((k) => r.tasks[k] === 'done' || r.tasks[k] === 'off')).length;
        out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">执行队列（拖拽排序）</span>' +
          '<span class="bma-muted">今日完成 ' + doneRows + '/' + rows.length + '</span></div>');
        rows.forEach((r) => {
          const blocked = !!r.blocked;
          /* 任务标签上的 n/m：按任务受设置开关控制，max 为 0 时不显示 */
          const showTaskNum = (name) => {
            const sh = (v.taskLimit || {}).show;
            return typeof sh === 'boolean' ? sh : !(sh && sh[name] === false);
          };
          const limInfo = (name) => {
            if (!showTaskNum(name)) return null;
            const max = r.limits ? (Number(r.limits[name]) || 0) : 0;
            if (!max) return null;
            const p = (r.prog && r.prog[name]) || {};
            return { max: max, cur: Number(p.cur) || 0 };
          };
          /* 任务开关贴在右下角，与左侧最后一行对齐：最后一行可能是报错、储蓄亲密度或今日统计，
             只给这一行留出右侧空间，按钮不占额外高度 */
          const showFree = Cfg.v.showFreeIntimacy && r.free > 0;
          const lastCls = ' bma-room-last';
          const todayCls = (!r.err && !showFree) ? lastCls : '';
          const freeCls = (!r.err && showFree) ? lastCls : '';
          const errCls = r.err ? lastCls : '';
          /* live_status：0 未开播 / 1 直播中 / 2 轮播（房间在放往期录像，不能做点赞与观时） */
          const live = r.liveStatus === 1 ? chip('done', '直播中')
            : r.liveStatus === 0 ? chip('off', '未开播')
              : r.liveStatus === 2 ? chip('off', '轮播')
                : chip('', '状态未知');
          /* 粉丝牌等级 + 亲密度（当前 / 升级所需）。数据来自已加载的粉丝牌索引，
             取不到等级时整段不显示；设置里可关闭 */
          const mi = r.medalInfo;
          let medalChip = '';
          if (Cfg.v.showMedalBar !== false && mi && mi.level > 0) {
            const pct = mi.next > 0
              ? Math.max(0, Math.min(100, Math.round((mi.intimacy / mi.next) * 100)))
              : -1;
            const tip = '粉丝牌 Lv.' + mi.level +
              (mi.next > 0
                ? ' · 亲密度 ' + fmt(mi.intimacy) + ' / ' + fmt(mi.next) +
                  '（距离升级还差 ' + fmt(Math.max(0, mi.next - mi.intimacy)) + '）'
                : '') +
              (mi.lit ? '' : ' · 未点亮');
            medalChip = '<span class="bma-room-medal" title="' + esc(tip) + '">' +
              '<b>Lv.' + esc(mi.level) + '</b>' +
              (pct >= 0
                ? '<span class="bma-mbar"><em style="width:' + pct + '%"></em></span>' +
                  fmt(mi.intimacy) + ' / ' + fmt(mi.next)
                : '') +
              '</span>';
          }
          out.push('<div class="bma-room" draggable="true" data-key="' + esc(r.key) + '">' +
            '<div class="bma-room-hd">' +
            '<span class="bma-grip" title="拖拽排序">⋮⋮</span>' +
            '<a class="bma-room-name" href="https://live.bilibili.com/' + r.roomId +
            '" target="_blank" rel="noreferrer" draggable="false" title="新标签页打开直播间">' +
            esc(r.uname || ('房间 ' + r.roomId)) + '</a>' +
            '<span class="bma-room-id">' + esc(r.roomId) + '</span>' + live + medalChip +
            (blocked ? chip('fail', '黑名单') : '') +
            (r.medalState === 'unknown'
              ? (r.medalLoading ? ''
                : '<span class="bma-chip off" title="粉丝牌数据尚未加载成功，可能是网络或登录问题">牌未加载</span>')
              : (r.medal ? '' : chip('off', '无粉丝牌'))) +
            '<span style="flex:1"></span>' +
            '<button type="button" class="bma-btn mini" data-act="removeRoom" data-key="' + esc(r.key) + '">删除</button>' +
            '</div>' +
            '<div class="bma-row">' +
            taskChip('light', r.tasks.light) + taskChip('like', r.tasks.like, limInfo('like')) +
            taskChip('danmu', r.tasks.danmu, limInfo('danmu')) + taskChip('watch', r.tasks.watch, limInfo('watch')) +
            (v.tasks.share ? taskChip('share', r.tasks.share) : '') +
            '</div>' +
            '<div class="bma-muted">' +
            (r.activity ? '<span style="color:#8ed7f7">' + esc(r.activity) + '</span>'
              : (r.ready.length ? '当前可执行：' + esc(r.ready.join('、')) : '当前无可执行任务')) +
            (r.waiting.length ? ' ｜ 等待条件：' + esc(r.waiting.join('、')) : '') +
            '</div>' +
            '<div class="bma-muted' + todayCls + '">今日：点赞 ' + fmt(Math.max(r.counts.like, r.counts.likeSrv)) + ' 次 · 弹幕 ' +
            fmt(Math.max(r.counts.danmu, r.counts.danmuSrv)) + ' 条 · 观时 ' + hms(r.counts.watch) +
            (r.counts.self > 0 ? '（自己 ' + hms(r.counts.self) + '）' : '') + '</div>' +
            (showFree
              ? '<div class="bma-muted' + freeCls + '">储蓄亲密度 ' + freeIntimacyHtml(r.free) + ' / 100' +
                (r.freeReach ? '（已达上限）' : '') + ' · 投喂灯牌后可领取</div>'
              : '') +
            (r.err ? '<div class="bma-muted bma-err' + errCls + '" data-act="clearErr" data-key="' + esc(r.key) +
              '" title="点击清除这条提示">' + esc(r.err) + '</div>' : '') +
            '<button type="button" class="bma-btn mini bma-room-task" data-act="roomTasks" data-key="' + esc(r.key) + '">任务开关</button>' +
            '</div>');
        });
        out.push('<div class="bma-row"><button type="button" class="bma-btn danger mini" data-act="clearList">清空白名单</button>' +
          '<button type="button" class="bma-btn mini" data-act="blacklistAdd">加入黑名单</button></div></div>');
      }
      if (this.taskPop) out.push(this.taskPopHtml());
      return out.join('');
    },

    /* 房间任务开关浮层：总开关关闭的项固定为不可选；
       点赞/弹幕/观时附带 1~多少的每日上限滑块，上限不能超过设置里的总上限 */
    taskPopHtml() {
      const key = String(this.taskPop);
      const entry = (Cfg.v.whitelist || []).find((e) => String(e.roomId) === key);
      if (!entry) return '';
      const names = ['light', 'like', 'danmu', 'watch', 'share'];
      /* 滑块最大值 = 该房间的实际生效上限：设置留空时跟随服务端，
         关闭超上限时取 min(设置值, 服务端上限)，开启时取设置值 */
      const meta = Data.room(key) || { roomId: Number(key) || 0, uid: entry.uid || 0 };
      const rows = names.map((name) => {
        const on = !!Cfg.v.tasks[name];
        const checked = on && roomTaskOn(entry, name);
        const gMax = Engine.globalLimitOf(meta, name);
        const withLimit = gMax > 0 && (name === 'like' || name === 'danmu' || name === 'watch');
        let limitHtml = '';
        if (withLimit) {
          const own = entry.limits && entry.limits[name] != null ? Number(entry.limits[name]) : 0;
          const val = Math.min(Math.max(1, own || gMax), gMax);
          /* 设置值或房间原值高于当前允许上限时，在悬停提示里说清楚为什么被压低 */
          const gSet = Math.max(0, Math.round(Number((Cfg.v.taskLimit || {})[name]) || 0));
          const tips = [];
          if (gSet > gMax) tips.push('设置值 ' + gSet + (Engine.brkOf(name) ? '' : '，关闭超上限后按服务端上限压到 ' + gMax));
          if (own > gMax) tips.push('本房间原设 ' + own + '，当前只能做 ' + gMax);
          limitHtml = '<input type="range" class="bma-limit-range" min="1" max="' + gMax + '" step="1" value="' + val + '"' +
            (tips.length ? ' title="' + esc(tips.join('；')) + '"' : '') +
            ' data-room-limit="' + name + '" data-max="' + gMax + '" data-key="' + esc(key) + '"' + (on ? '' : ' disabled') + ' />' +
            '<span class="bma-limit-val">' + val + '</span>';
        }
        return '<div class="bma-taskpop-row' + (on ? '' : ' disabled') + '">' +
          '<label class="bma-taskpop-lbl">' +
          '<input type="checkbox" data-room-task="' + name + '" data-key="' + esc(key) + '"' +
          (checked ? ' checked' : '') + (on ? '' : ' disabled') + ' />' +
          '<span>' + esc(TASK_NAME[name] || name) + '</span>' +
          '</label>' + limitHtml +
          (on ? '' : '<span class="bma-muted">总开关已关闭</span>') +
          '</div>';
      }).join('');
      return '<div class="bma-taskpop" data-el="taskpop">' +
        '<div class="bma-taskpop-hd"><b>任务开关</b><span class="bma-muted">' + esc(entry.uname || ('房间 ' + key)) + '</span></div>' +
        rows +
        (rows.indexOf('data-room-limit') < 0
          ? '<div class="bma-muted" style="padding:2px 0">任务上限跟随服务端；读取到该房间的任务进度后可按房间调小</div>'
          : '') +
        '</div>';
    }
  };

  /* ---------------- 日志 ---------------- */
  const LogView = {
    render() {
      const lines = Log.lines.slice(-250);
      return '<div class="bma-sec"><div class="bma-row">' +
        '<button type="button" class="bma-btn mini" data-act="logCopy">复制全部</button>' +
        '<button type="button" class="bma-btn mini" data-act="logClear">清空</button>' +
        '<span class="bma-muted">共 ' + Log.lines.length + ' 条（控制台同时输出）</span></div></div>' +
        '<div class="bma-log">' + (lines.length ? lines.map((l) =>
          '<div class="lv-' + l.level + '">[' + l.t.toLocaleTimeString('zh-CN') + '][' + esc(l.tag) + '] ' + esc(l.msg) + '</div>'
        ).join('') : '<div class="bma-muted">暂无日志</div>') + '</div>';
    }
  };

  /* ---------------- 设置 ---------------- */
  function switchRow(label, bind, checked, hint, dis) {
    return '<label class="bma-switch" style="display:flex;justify-content:space-between;padding:3px 0' +
      (dis ? ';opacity:.45' : '') + '">' +
      '<span>' + esc(label) + (hint ? ' <span class="bma-muted">' + esc(hint) + '</span>' : '') + '</span>' +
      '<input type="checkbox" data-bind="' + bind + '"' + (checked ? ' checked' : '') +
      (dis ? ' disabled title="' + esc(hint || '当前不可用') + '"' : '') + ' /></label>';
  }

  /* 任务上限：留空或 0 = 跟随服务端；不设输入范围 */
  function limitRow(label, bind, val, hint) {
    const v = Math.max(0, Math.round(Number(val) || 0));
    return '<label class="bma-switch" style="display:flex;justify-content:space-between;padding:3px 0">' +
      '<span>' + esc(label) + (hint ? ' <span class="bma-muted">' + esc(hint) + '</span>' : '') + '</span>' +
      '<input class="bma-input narrow" type="number" min="0" step="1" data-bind="' + bind + '"' +
      ' value="' + (v > 0 ? v : '') + '" placeholder="跟随服务端" /></label>';
  }

  function sec(title, body) {
    return '<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">' + esc(title) + '</span></div>' +
      body + '</div>';
  }

  function numberRow(label, bind, val, min, max, step, dis) {
    return '<label class="bma-switch" style="display:flex;justify-content:space-between;padding:3px 0' + (dis ? ';opacity:.45' : '') + '">' +
      '<span>' + esc(label) + '</span>' +
      '<input class="bma-input narrow" type="number" data-bind="' + bind + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '"' + (dis ? ' disabled title="请先开启「并行执行多个直播间的观时」"' : '') + ' /></label>';
  }

  const SetView = {
    render() {
      const v = Cfg.v;
      const tl = v.taskLimit || {};
      const lim = (name) => Math.max(0, Math.round(Number(tl[name]) || 0));
      const brk = (name) => (typeof tl.brk === 'boolean' ? tl.brk : !!(tl.brk && tl.brk[name]));
      const showNum = (name) => (typeof tl.show === 'boolean' ? tl.show : !(tl.show && tl.show[name] === false));
      const limitHint = '留空或 0 = 跟随 B 站任务上限';
      const overNote = '关闭：设置值高于 B 站任务上限时，按 B 站上限执行；开启：按设置值执行。超出 B 站上限的部分不计亲密度，只增加请求与风控风险。';
      const bottomNote = '每个直播间可在「任务开关」里单独调小，不能超过实际生效上限；做到上限即视为当天完成。';
      const overRow = (name) => switchRow('允许超过服务端上限', 'taskLimit.brk.' + name, brk(name),
        lim(name) > 0 ? '' : '需要先填写上限', lim(name) <= 0) +
        '<div class="bma-muted">' + overNote + '</div>';
      const out = [];

      /* 执行：只保留全局行为，任务参数放到各自的卡片 */
      out.push(sec('执行',
        switchRow('进入直播站点后自动开始执行', 'autoStart', v.autoStart, '打开任意直播间页面或 live.bilibili.com 首页时自动开始') +
        switchRow('执行时避让本人正在观看的直播间', 'avoidWatching', v.avoidWatching) +
        switchRow('任务全部完成时发送浏览器通知', 'notify', v.notify)
      ));

      /* 总开关：单项参数见下方各任务卡片 */
      out.push(sec('任务开关',
        switchRow('点亮熄灭勋章', 'tasks.light', v.tasks.light) +
        switchRow('点赞', 'tasks.like', v.tasks.like) +
        switchRow('发弹幕', 'tasks.danmu', v.tasks.danmu) +
        switchRow('观看直播', 'tasks.watch', v.tasks.watch) +
        switchRow('分享直播间', 'tasks.share', v.tasks.share) +
        '<div class="bma-muted">这里是总开关；单个直播间还可以在看板卡片的「任务开关」里单独关闭。</div>'
      ));

      out.push(sec('点亮熄灭勋章',
        '<div class="bma-muted">开播中通过点赞点亮；未开播通过弹幕点亮。未关注主播无法点亮。</div>'
      ));

      out.push(sec('点赞',
        limitRow('每日点赞上限（轮）', 'taskLimit.like', lim('like'), limitHint) +
        overRow('like') +
        switchRow('看板显示「点赞 n/m」', 'taskLimit.show.like', showNum('like')) +
        '<div class="bma-sec-hd" style="margin-top:10px"><span class="bma-sec-tt">节奏</span></div>' +
        '<div class="bma-grid2">' +
        numberRow('每次最少(次)', 'like.batchMin', v.like.batchMin, 1, 30) +
        numberRow('每次最多(次)', 'like.batchMax', v.like.batchMax, 1, 30) +
        numberRow('间隔最小(秒)', 'like.gapMin', v.like.gapMin, 3, 120) +
        numberRow('间隔最大(秒)', 'like.gapMax', v.like.gapMax, 3, 180) +
        '</div>' +
        numberRow('每房间每日点赞次数保护上限(次)', 'like.capClicks', v.like.capClicks, 30, 5000) +
        '<div class="bma-muted">保护上限是硬限制：即使任务上限设得更高，到了这里也会停止。</div>' +
        '<div class="bma-muted">' + bottomNote + '</div>'
      ));

      out.push(sec('发弹幕',
        limitRow('每日弹幕上限（条）', 'taskLimit.danmu', lim('danmu'), limitHint) +
        overRow('danmu') +
        switchRow('看板显示「弹幕 n/m」', 'taskLimit.show.danmu', showNum('danmu')) +
        switchRow('仅在未开播的直播间发送弹幕', 'danmu.onlyWhenNotLive', v.danmu.onlyWhenNotLive, '开启时仅在未开播的直播间发送；关闭后开播中的直播间也会发送，弹幕会展示给主播和观众') +
        switchRow('优先发送直播间与粉丝团表情', 'danmu.useRoomEmoticons', v.danmu.useRoomEmoticons, '在账号当前可发的表情里随机挑选（房间专属、已解锁的粉丝团 / 大航海 / 充电表情）；取不到或发送失败时改用下方文字') +
        '<div class="bma-sec-hd" style="margin-top:10px"><span class="bma-sec-tt">弹幕内容（每行一条）</span></div>' +
        '<textarea class="bma-input" data-el="danmuText" rows="5" style="width:100%;resize:vertical;margin-top:4px">' + esc((v.danmu.list || []).join('\n')) + '</textarea>' +
        '<div class="bma-row"><button type="button" class="bma-btn mini primary" data-act="saveDanmu">保存</button>' +
        '<span class="bma-muted">下方文字为兜底内容；点亮任务在未开播房间也用它</span></div>' +
        '<div class="bma-sec-hd" style="margin-top:10px"><span class="bma-sec-tt">节奏</span></div>' +
        '<div class="bma-grid2">' +
        numberRow('间隔最小(秒)', 'danmu.gapMin', v.danmu.gapMin, 3, 120) +
        numberRow('间隔最大(秒)', 'danmu.gapMax', v.danmu.gapMax, 3, 180) +
        '</div>' +
        '<div class="bma-muted">接口返回「发送频率过快」时，将等待 20~45 秒后重试。</div>' +
        '<div class="bma-muted">' + bottomNote + '</div>'
      ));

      const watchCap = Engine.effectiveWatchParallel();
      out.push(sec('观看直播',
        limitRow('每日观时上限（轮）', 'taskLimit.watch', lim('watch'), limitHint) +
        overRow('watch') +
        switchRow('看板显示「观时 n/m」', 'taskLimit.show.watch', showNum('watch')) +
        switchRow('仅对开播中的直播间执行观时', 'watch.requireLive', v.watch.requireLive, '未开播的直播间同样可以记录观时；开启后只挂开播中的房间') +
        switchRow('记录观时心跳日志', 'watch.logHeartbeat', v.watch.logHeartbeat, '每次心跳成功后写入一条日志') +
        switchRow('切到后台时继续观时', 'watch.bgContinue', v.watch.bgContinue, '开启（默认）：后台继续发送，浏览器会降频，可能变慢；关闭：后台暂停心跳，回到前台自动续挂') +
        switchRow('并行执行多个直播间的观时', 'watch.multiRoom', v.watch.multiRoom, '实测同一账号同一时间只记录一个直播间的观时；开启后会向多个房间发送心跳，只会增加风控概率') +
        numberRow('最大并行直播间数' + (v.watch.multiRoom ? '' : '（未启用，固定为 1）'), 'watch.multiRoomMax', v.watch.multiRoom ? Math.max(1, Number(v.watch.multiRoomMax) || 2) : 1, 1, 999, 1, !v.watch.multiRoom) +
        '<div class="bma-muted">脚本当前并发：运行中 ' + Engine.watches.length + ' 路（上限 ' + watchCap + ' 路）。</div>' +
        '<div class="bma-muted">' + bottomNote + '</div>'
      ));

      out.push(sec('分享直播间',
        '<div class="bma-muted">每天 1 次、亲密度 +2。只有通过插件完成的才显示「已完成」；今天已在别处分享过或接口未生效时显示「待确认」。储蓄亲密度满 100 时自动跳过（可在「储蓄亲密度」里关闭该策略）。</div>'
      ));

      out.push(sec('储蓄亲密度',
        switchRow('在看板显示已储蓄亲密度', 'showFreeIntimacy', v.showFreeIntimacy, '显示为「已储蓄 / 上限（100）」，投喂灯牌后可领取') +
        switchRow('储蓄亲密度满 100 时只维持点亮', 'freeFullLite', v.freeFullLite, '满储的房间跳过观时与分享，只做点亮、点赞、弹幕；领取后自动恢复') +
        numberRow('储蓄亲密度标红阈值', 'freeWarnAt', v.freeWarnAt, 1, 100, 1) +
        '<div class="bma-muted">达到阈值时只把看板上的数字标红，用于提醒接近上限（100）。</div>'
      ));

      out.push(sec('看板显示',
        switchRow('执行队列显示粉丝牌等级与亲密度', 'showMedalBar', v.showMedalBar !== false,
          '显示为「Lv.8 23 / 28」，分数是当前亲密度 / 升级所需；鼠标悬停可看还差多少升级') +
        '<div class="bma-muted">只影响看板卡片，不影响任务执行；粉丝牌索引没取到等级时不显示。</div>'
      ));

      /* 今日累计观时图表：每行独立比例尺（满格 = 该房间任务总时长），竖线固定在轮次分界处 */
      const rows = Engine.summary();
      const srvMode = UI.watchSrv === true;
      const wRows = rows.map((r) => {
        const rounds = Math.max(1, Number(r.rounds) || 1);
        const roundMin = Number(r.roundMin) || 15;
        return {
          name: r.uname || ('房间 ' + r.roomId),
          sec: srvMode ? (Number(r.srvWatch) || 0) : (Number(r.counts.watch) || 0),
          self: srvMode ? 0 : (Number(r.counts.self) || 0),
          srvRounds: Number(r.srvRounds) || 0,
          srvSec: Number(r.srvWatch) || 0,
          roundSec: roundMin * 60,
          rounds: rounds,
          target: rounds * roundMin * 60,
          state: r.tasks.watch
        };
      }).sort((a, b) => (b.sec + b.self) - (a.sec + a.self));

      const totalSec = wRows.reduce((a, b) => a + b.sec, 0);
      const totalSelf = wRows.reduce((a, b) => a + b.self, 0);

      const chartOpen = UI.watchOpen !== false;
      out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">今日累计观时</span>' +
        '<span class="bma-muted">' + (srvMode ? '服务端认可' : ('脚本 ' + hms(totalSec) + (totalSelf > 0 ? ' + 自己 ' + hms(totalSelf) : ''))) +
        ' <button type="button" class="bma-btn mini" data-act="toggleWatchSrv">' + (srvMode ? '显示脚本记录' : '显示服务端认可') + '</button>' +
        ' <button type="button" class="bma-btn mini" data-act="toggleWatchChart">' + (chartOpen ? '收起' : '展开') + '</button></span></div>' +
        (chartOpen ? (
        (wRows.length ? wRows.map((r) => {
          const total = r.sec + r.self;
          /* 满格 = 任务总时长；超出部分只改变红绿比例，不改变竖线位置 */
          const filled = Math.min(100, (total / r.target) * 100);
          const ratio = total > 0 ? r.sec / total : 0;
          const scriptPct = filled * ratio;
          const selfPct = filled - scriptPct;
          const cls = r.state === 'done' ? 'done' : (r.state === 'run' ? 'run' : (r.state === 'waitLive' || r.state === 'waitLight' ? 'off' : ''));

          /* 固定分界线：2 轮在 50%，10 轮在 10%/20%…90% */
          let marks = '';
          for (let i = 1; i < r.rounds; i++) {
            marks += '<em style="left:' + ((i * 100) / r.rounds).toFixed(4) + '%"></em>';
          }

          const val = (total > 0 ? hms(total) : '—') +
            ' / ' + hms(r.target) +
            (r.self > 0 ? '（自己 ' + hms(r.self) + '）' : '') +
            (srvMode ? '（服务端 ' + r.srvRounds + '/' + r.rounds + ' 轮）' : '');
          return '<div class="bma-wb">' +
            '<div class="bma-wb-hd"><span class="bma-wb-name">' + esc(r.name) +
            ' <span class="bma-muted">' + r.rounds + ' 轮 × ' + Math.round(r.roundSec / 60) + ' 分</span></span>' +
            '<span class="bma-wb-val">' + esc(val) + '</span></div>' +
            '<div class="bma-wb-track">' +
            (scriptPct > 0 ? '<i class="' + cls + '" style="width:' + scriptPct.toFixed(2) + '%"></i>' : '') +
            (selfPct > 0 ? '<i class="self" style="width:' + selfPct.toFixed(2) + '%"></i>' : '') +
            marks + '</div>' +
            '</div>';
        }).join('') : '<div class="bma-muted">还没有观时记录</div>') +
        '<div class="bma-muted">' + (srvMode
          ? '蓝色=服务端认可的有效观时（按已完成轮次 × 每轮分钟换算，精度为一整轮，非精确秒数）。'
          : '绿色=脚本累计，红色=本人观看；进度条满格=当日任务总时长，竖线为轮次分界（每轮一条）。') + '</div>') : '') +
        '</div>');

      out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">体验优化</span></div>' +
        switchRow('暂停首页自动播放的直播', 'enhance.pauseHome', v.enhance.pauseHome !== false,
          '首页轮播自动暂停；手动点播放不受影响') +
        '</div>');

      out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">黑名单</span></div>' +
        '<div class="bma-row">' +
        (v.blacklist.length ? v.blacklist.map((id) =>
          '<button type="button" class="bma-btn mini" data-act="blacklistDel" data-id="' + esc(id) + '">' + esc(id) + ' ×</button>'
        ).join('') : '<span class="bma-muted">空（黑名单优先于白名单）</span>') +
        '</div>' +
        '<div class="bma-row"><input class="bma-input grow" data-el="blackInput" placeholder="输入房间号加入黑名单" />' +
        '<button type="button" class="bma-btn mini" data-act="blacklistAdd2">加入</button></div></div>');

      const epRisk = Net.riskSummary();
      out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">风控</span>' +
        '<span>' + (Net.blocked() ? chip('fail', '账号级冷却 ' + Math.ceil(Net.blockedLeft() / 1000) + 's') : chip('done', '正常')) + '</span></div>' +
        switchRow('保守模式（限制请求频率）', 'risk.conservative', v.risk.conservative) +
        '<div class="bma-grid2">' +
        numberRow('请求最小间隔（毫秒）', 'risk.gapMs', v.risk.gapMs, 0, 10000, 100) +
        numberRow('单接口冷却时长（分钟）', 'risk.cooldownMin', v.risk.cooldownMin, 1, 30) +
        numberRow('触发熔断的连续次数', 'risk.epStrikes', v.risk.epStrikes, 2, 10) +
        numberRow('熔断时长（分钟）', 'risk.epDisableMin', v.risk.epDisableMin, 1, 60) +
        '</div>' +
        '<div class="bma-muted">默认仅冷却触发风控的接口，其余任务继续执行；仅当 5 分钟内有两个及以上接口触发风控时，才升级为账号级暂停。</div>' +
        (epRisk.length ? '<div class="bma-muted">处于冷却或熔断状态的接口：' + epRisk.map((x) =>
          esc(x.ep) + (x.disabled ? '（熔断）' : '（' + Math.ceil((x.until - nowMs()) / 1000) + 's）')
        ).join('、') + '</div>' : '') +
        '<div class="bma-row"><button type="button" class="bma-btn mini" data-act="riskReset">解除冷却与熔断</button></div>' +
        '</div>');

      out.push('<div class="bma-sec"><div class="bma-sec-hd"><span class="bma-sec-tt">关于</span></div>' +
        '<div class="bma-kv"><span>版本</span><b>' + VERSION + '</b></div>' +
        '<div class="bma-kv"><span>登录状态</span><b>' + (Auth.isLogin ? esc(Auth.uname || '已登录') : '未登录/未获取') + '</b></div>' +
        '<div class="bma-kv"><span>UID</span><b>' + fmt(Auth.uid || 0) + '</b></div>' +
        '<div class="bma-row"><button type="button" class="bma-btn mini" data-act="checkAuth">检查登录</button>' +
        '<button type="button" class="bma-btn mini" data-act="resetDaily">重置今日记录</button></div>' +
        '</div>');
      return out.join('');
    }
  };

  const Tabs = {
    room: () => RoomView.render(),
    list: () => ListView.render(),
    log: () => LogView.render(),
    set: () => SetView.render()
  };
