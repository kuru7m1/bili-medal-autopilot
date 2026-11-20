  /* ==================================================================
   * 5. 网络层：并发闸门 + 保守模式限速 + 风控冷却 + 接口熔断 + WBI 签名
   * ================================================================== */
  const RISK_CODES = { '-352': 1, '-412': 1, '-403': 1 };
  const EP_DISABLE_MS = 30 * 60 * 1000;

  function riskError(code, msg, ep) {
    const e = new Error(msg || ('风控 code ' + code));
    e.code = Number(code);
    e.risk = true;
    e.endpoint = ep || '';
    return e;
  }

  const Net = {
    inflight: 0,
    max: 3,
    waiters: [],
    riskUntil: 0,
    lastAt: 0,
    paceChain: null,     /* 保守模式下的串行预约链 */
    stats: { ok: 0, fail: 0, risk: 0 },
    eps: new Map(),      /* endpoint -> {risk, lastLogAt, cooldownUntil, disabledUntil, lastCode} */
    epRiskAt: new Map(), /* endpoint -> 最近一次风控时间，用于判定账号级风控 */

    acquire() {
      if (this.inflight < this.max) {
        this.inflight++;
        return Promise.resolve();
      }
      return new Promise((resolve) => this.waiters.push(resolve));
    },

    release() {
      this.inflight = Math.max(0, this.inflight - 1);
      const next = this.waiters.shift();
      if (next) {
        this.inflight++;
        next();
      }
    },

    /* 把 URL 归一成短接口名，用于日志与熔断 */
    endpointOf(url) {
      try {
        const s = String(url || '');
        const q = s.indexOf('?');
        const path = q >= 0 ? s.slice(0, q) : s;
        const m = path.match(/^https?:\/\/[^/]+(\/.*)$/);
        return m ? m[1] : path;
      } catch (e) {
        return String(url || '');
      }
    },

    blocked() {
      return nowMs() < this.riskUntil;
    },

    blockedLeft() {
      return Math.max(0, this.riskUntil - nowMs());
    },

    epOf(url) {
      const ep = this.endpointOf(url);
      let st = this.eps.get(ep);
      if (!st) {
        st = { risk: 0, lastLogAt: 0, cooldownUntil: 0, disabledUntil: 0, lastCode: 0 };
        this.eps.set(ep, st);
      }
      return { ep: ep, st: st };
    },

    /* 保守模式：所有请求之间至少留 gapMs。
       用串行预约链推进时间戳：并发请求依次排队，后一个在前一个写下的时间之后
       重新计算等待。旧实现三个并发会读到同一个 lastAt、等同一段时间、再一起发出去 */
    pace(url) {
      const gap = (Cfg.v && Cfg.v.risk && Cfg.v.risk.conservative) ? (Number(Cfg.v.risk.gapMs) || 1500) : 0;
      if (!gap) return Promise.resolve();
      const run = async () => {
        const wait = gap - (nowMs() - this.lastAt);
        if (wait > 0) await sleep(wait);
        this.lastAt = nowMs();
      };
      this.paceChain = (this.paceChain || Promise.resolve()).then(run, run);
      return this.paceChain;
    },

    /* 记录一次风控：默认只冷却「出事的那一个接口」，多接口同时出事才升级为账号级全局暂停 */
    riskCooldown(url, code, msg) {
      const now = nowMs();
      const st = this.epOf(url);
      const R = (Cfg.v && Cfg.v.risk) || {};
      st.st.risk++;
      st.st.lastCode = code;

      const baseMin = Number(R.cooldownMin) || 2;
      const cdMs = baseMin * 60000 * Math.min(4, Math.pow(2, Math.min(st.st.risk - 1, 2)));
      st.st.cooldownUntil = Math.max(st.st.cooldownUntil || 0, now + cdMs);
      this.stats.risk++;

      if (st.st.risk >= (Number(R.epStrikes) || 3)) {
        st.st.disabledUntil = now + (Number(R.epDisableMin) || 5) * 60000;
        Log.error('风控', '接口 ' + st.ep + ' 连续 ' + st.st.risk + ' 次触发风控，熔断 ' +
          (Number(R.epDisableMin) || 5) + ' 分钟（只影响这个接口）');
      } else {
        Log.warn('风控', '接口 ' + st.ep + ' 返回 code ' + code + (msg ? '（' + msg + '）' : '') +
          '，该接口冷却 ' + Math.round(cdMs / 60000) + ' 分钟，其他任务照常');
      }

      /* 最近 5 分钟内有 2 个以上不同接口被风控 → 认为是账号级风控 */
      this.epRiskAt.set(st.ep, now);
      let recent = 0;
      this.epRiskAt.forEach((t) => { if (now - t < 5 * 60000) recent++; });
      if (recent >= 2) {
        const gMin = Number(R.globalCooldownMin) || 3;
        this.riskUntil = Math.max(this.riskUntil, now + gMin * 60000);
        Log.error('风控', '最近 5 分钟有 ' + recent + ' 个接口被风控，判定为账号级风控，全局暂停 ' + gMin + ' 分钟');
      }

      Bus.post('risk', { until: this.riskUntil, ep: st.ep, code: code });
      if (typeof Engine !== 'undefined' && Engine && Engine.touch) Engine.touch();
    },
    /* 手动解除冷却（面板上的「解除风控」按钮） */
    resetRisk() {
      this.riskUntil = 0;
      this.lastAt = 0;
      this.epRiskAt.clear();
      this.eps.clear();
      Log.log('风控', '已手动清空风控冷却与熔断记录');
      Engine && Engine.touch && Engine.touch();
    },

    riskSummary() {
      const now = nowMs();
      const out = [];
      this.eps.forEach((st, ep) => {
        const until = Math.max(st.disabledUntil || 0, st.cooldownUntil || 0);
        if (until > now) out.push({ ep: ep, until: until, code: st.lastCode, disabled: st.disabledUntil > now });
      });
      return out;
    },

    async fetchJson(url, init, opt) {
      const o = opt || {};
      const tries = o.tries == null ? 2 : o.tries;
      const timeout = o.timeout || 12000;
      /* 手动触发的请求：用户点了就发，不受本地冷却拦截，
         即使被风控也只是一次失败，不把整条接口链路拖进冷却 */
      const soft = !!o.softRisk;
      const epInfo = this.epOf(url);
      let lastErr = null;

      /* 冷却 / 熔断期间直接失败，绝不发请求——这是之前风控风暴的根源 */
      const guard = () => {
        if (o.ignoreGuard || soft) return;
        const now = nowMs();
        if (epInfo.st.disabledUntil > now) {
          throw riskError(epInfo.st.lastCode, '接口已熔断（剩余 ' + Math.ceil((epInfo.st.disabledUntil - now) / 1000) + ' 秒）', epInfo.ep);
        }
        if (epInfo.st.cooldownUntil > now) {
          throw riskError(epInfo.st.lastCode, '该接口冷却中（剩余 ' + Math.ceil((epInfo.st.cooldownUntil - now) / 1000) + ' 秒）', epInfo.ep);
        }
        if (now < this.riskUntil) {
          throw riskError(epInfo.st.lastCode, '账号级风控冷却中，剩余 ' + Math.ceil((this.riskUntil - now) / 1000) + ' 秒', epInfo.ep);
        }
      };

      for (let i = 0; i < tries; i++) {
        guard();
        await this.acquire();
        let ctrl = null;
        let timer = null;
        let released = false;
        const done = () => {
          if (!released) { released = true; this.release(); }
          if (timer) { clearTimeout(timer); timer = null; }
        };
        try {
          await this.pace(url);
          guard();
          if (typeof AbortController === 'function') {
            ctrl = new AbortController();
            timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { /* ignore */ } }, timeout);
          }
          const finalInit = Object.assign({ credentials: 'include', cache: 'no-store' }, init || {});
          if (ctrl) finalInit.signal = ctrl.signal;
          const res = await fetch(url, finalInit);
          const text = await res.text();
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const json = safeParse(text, null);
          if (!json) throw new Error('响应不是 JSON');
          done();
          this.stats.ok++;
          const code = Number(json.code);
          if (RISK_CODES[String(code)]) {
            if (!soft) this.riskCooldown(url, code, json.message || '');
            throw riskError(code, json.message || '', epInfo.ep);
          }
          return json;
        } catch (e) {
          done();
          this.stats.fail++;
          lastErr = e;
          if (e && e.risk) throw e;
          if (o.noRetry) break;
          if (i < tries - 1) await sleep(600 + rand(0, 900));
        }
      }
      throw lastErr || new Error('请求失败');
    }
  };

  /* ---------------- WBI 签名 ---------------- */
  const Wbi = {
    keys: null,
    at: 0,
    mixin: '',
    /* B 站固定的乱序表，用于从 img_key+sub_key 派生 mixin key */
    TABLE: [
      46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
      27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
      37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
      22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
    ],

    async ensure(force) {
      if (!force && this.keys && nowMs() - this.at < 50 * 60 * 1000) return true;
      try {
        const j = await Net.fetchJson(HOST.main + '/x/web-interface/nav', null, { tries: 2 });
        const d = (j && j.data) || {};
        const img = d.wbi_img || {};
        const imgKey = String(img.img_url || '').split('/').pop().split('.')[0];
        const subKey = String(img.sub_url || '').split('/').pop().split('.')[0];
        if (!imgKey || !subKey) return false;
        const raw = imgKey + subKey;
        this.mixin = this.TABLE.map((i) => raw[i] || '').join('').slice(0, 32);
        this.keys = { imgKey: imgKey, subKey: subKey };
        this.at = nowMs();
        if (d.mid) Auth.uid = Number(d.mid);
        if (d.uname) Auth.uname = String(d.uname);
        Auth.isLogin = !!d.isLogin;
        return !!this.mixin;
      } catch (e) {
        return false;
      }
    },

    sign(params) {
      const all = Object.assign({}, params || {}, { wts: nowSec() });
      const keys = Object.keys(all).sort();
      const parts = [];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = all[k];
        if (v === undefined || v === null) continue;
        const sv = String(v).replace(/[!'()*]/g, '');
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(sv));
      }
      const query = parts.join('&');
      if (!this.mixin) return query;
      return query + '&w_rid=' + Crypto.md5(query + this.mixin);
    }
  };

  /* ---------------- 账号信息 ---------------- */
  const Auth = {
    uid: 0,
    uname: '',
    isLogin: false,

    get csrf() { return cookie('bili_jct'); },

    get buvid() {
      const live = cookie('LIVE_BUVID');
      if (live) return live;
      const b3 = cookie('buvid3');
      if (b3) return b3;
      return 'XY' + Math.random().toString(36).slice(2, 10).toUpperCase() + Math.random().toString(36).slice(2, 10).toUpperCase();
    },

    uidFromCookie() {
      const m = /^(\d+)$/.exec(cookie('DedeUserID') || '');
      return m ? Number(m[1]) : 0;
    },

    /* 强制重新拉一次 nav，用来做「检查登录」 */
    async verify() {
      this.uid = this.uid || this.uidFromCookie();
      try { await Wbi.ensure(true); } catch (e) { /* ignore */ }
      if (!this.uid) this.uid = this.uidFromCookie();
      return this.isLogin || !!this.uid;
    },

    async ensure() {
      if (this.isLogin && this.uid) return true;
      this.uid = this.uid || this.uidFromCookie();
      await Wbi.ensure(false);
      if (!this.uid) this.uid = this.uidFromCookie();
      return this.isLogin;
    }
  };

  /* ==================================================================
   * 6. B 站接口封装
   * ================================================================== */
  function postForm(url, data) {
    const body = Object.keys(data)
      .filter((k) => data[k] !== undefined && data[k] !== null)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(data[k])))
      .join('&');
    return Net.fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
  }

  /* GetActivatedMedalInfo 有时把粉丝牌字段平铺在 data 上（medal_name / level / is_lighted…），
     没有 medal_info 嵌套对象。只看 level 与 is_lighted 判断是否真的持有这枚牌子：
     没有牌子时这两个值是 0，不能仅凭字段存在就当成有。 */
  function medalFromFlat(d, targetId) {
    if (!d || typeof d !== 'object') return null;
    const level = Number(d.level) || 0;
    const lit = d.is_lighted === 1 || d.is_lighted === true;
    if (level <= 0 && !lit) return null;
    return {
      target_id: Number(targetId) || 0,
      medal_name: String(d.medal_name || ''),
      level: level,
      is_lighted: d.is_lighted,
      intimacy: Number(d.intimacy) || 0,
      next_intimacy: Number(d.next_intimacy) || 0,
      guard_level: Number(d.guard_level) || 0,
      light_source: Number(d.light_source) || 0
    };
  }

  /* 弹幕与表情弹幕共用的表单字段（两者只有 msg 与表情相关字段不同） */
  function danmuForm(roomId) {
    const csrf = Auth.csrf;
    return {
      bubble: 0,
      color: 16777215,
      mode: 1,
      room_type: 0,
      jumpfrom: 0,
      reply_mid: 0,
      reply_attr: 0,
      replay_dmid: '',
      statistics: JSON.stringify({ appId: 100, platform: 5 }),
      reply_type: 0,
      reply_uname: '',
      data_extend: JSON.stringify({ trackid: '-99998' }),
      fontsize: 25,
      rnd: nowSec(),
      roomid: roomId,
      csrf: csrf,
      csrf_token: csrf
    };
  }

  const API = {
    /* 房间基础：短号 -> 真实房间号 / 主播 uid / 直播状态 */
    async roomInit(id) {
      const j = await Net.fetchJson(HOST.live + '/room/v1/Room/room_init?id=' + encodeURIComponent(id));
      if (Number(j.code) !== 0 || !j.data) throw new Error('房间解析失败：' + (j.message || j.code));
      return {
        roomId: Number(j.data.room_id),
        shortId: Number(j.data.short_id) || 0,
        uid: Number(j.data.uid),
        liveStatus: Number(j.data.live_status)
      };
    },

    async roomInfo(roomId) {
      await Wbi.ensure(false);
      const q = Wbi.sign({ room_id: roomId, web_location: WEB_LOCATION });
      const j = await Net.fetchJson(HOST.live + '/xlive/web-room/v1/index/getInfoByRoom?' + q);
      if (Number(j.code) !== 0 || !j.data) return null;
      const ri = j.data.room_info || {};
      const ai = (j.data.anchor_info || {}).base_info || {};
      return {
        roomId: Number(ri.room_id) || Number(roomId),
        uid: Number(ri.uid) || 0,
        liveStatus: Number(ri.live_status),
        areaId: Number(ri.area_id) || 0,
        parentAreaId: Number(ri.parent_area_id) || 0,
        title: String(ri.title || ''),
        uname: String(ai.uname || ''),
        cover: String(ri.cover || '')
      };
    },

    /* 我持有的全部粉丝牌（含 is_lighted / room_id / 亲密度）。
       返回 { list, complete, reason }：
         complete=true  已拿到完整列表（以「取到空页」为准）
         complete=false 这次没拿全（某页出错 / 触达硬上限），调用方必须保留旧索引，
                        否则缺项会被判成「没有粉丝牌」，持牌房间整天被跳过 */
    async allMedals(maxPage) {
      const pages = maxPage || 12;
      const out = [];
      for (let page = 1; page <= pages; page++) {
        /* page_size 给大一点：分享验证每房间要重读好几次，43 个牌子从 3 页降到 1 页，
           单次刷新少 ~2 个请求和一个分页间隔。服务端若按 20 截断，下面的空页终止照样生效。 */
        let j = null;
        try {
          j = await Net.fetchJson(HOST.live + '/xlive/app-ucenter/v1/fansMedal/panel?page=' + page + '&page_size=50');
        } catch (e) {
          return { list: out, complete: false, reason: '第 ' + page + ' 页请求失败：' + (e.message || e) };
        }
        if (Number(j && j.code) !== 0 || !j.data) {
          return { list: out, complete: false, reason: '第 ' + page + ' 页返回 code ' + (j && j.code) };
        }
        const d = j.data;
        if (page === 1 && Array.isArray(d.special_list)) out.push.apply(out, d.special_list);
        if (Array.isArray(d.list)) out.push.apply(out, d.list);
        if (!Array.isArray(d.list) || d.list.length === 0) return { list: out, complete: true };
        /* 不按 total_page 提前结束：个别账号该字段偏小，会把后面的牌子截断 */
        if (page === pages) return { list: out, complete: false, reason: '达到分页上限 ' + pages };
        await sleep(rand(250, 420));
      }
      return { list: out, complete: false, reason: '分页未结束' };
    },

    /* 单个主播的粉丝团任务进度（task_info / 储蓄亲密度 / 亲密之旅） */
    async medalTasks(targetId) {
      const csrf = Auth.csrf;
      const base = 'target_id=' + encodeURIComponent(targetId) + '&web_location=444.260';
      const tail = csrf ? '&csrf=' + csrf : '';
      const urls = [
        HOST.live + '/xlive/app-ucenter/v1/fansMedal/GetActivatedMedalInfo?' + base + '&platform=pc&scene=club' + tail,
        HOST.live + '/xlive/app-ucenter/v1/fansMedal/GetActivatedMedalInfo?' + base + tail
      ];
      let last = null;
      for (let i = 0; i < urls.length; i++) {
        try {
          const j = await Net.fetchJson(urls[i]);
          if (Number(j.code) === 0 && j.data) {
            const d = j.data;
            return {
              ok: true,
              tasks: Array.isArray(d.task_info) ? d.task_info : [],
              free: Number(d.free_intimacy) || 0,
              reachLimit: !!d.reach_free_intimacy_limit,
              journey: d.intimacy_journey_info || null,
              guard: Number(d.guard_level) || 0,
              keys: Object.keys(d || {}),
              /* 诊断用：接口把粉丝牌字段平铺在 data 上，这里记录原始取值，
                 便于判断「明明有牌子却识别不到」时到底缺的是哪一项 */
              flag: {
                level: Number(d.level) || 0,
                medalName: String(d.medal_name || ''),
                isLighted: d.is_lighted
              },
              medal: d.medal_info || d.medal || d.my_medal || medalFromFlat(d, targetId)
            };
          }
          last = (j.message || '') + '(' + j.code + ')';
        } catch (e) {
          last = e.message || '网络错误';
        }
      }
      return { ok: false, reason: last || '未知错误', tasks: [] };
    },

    /* 分享直播间（粉丝团第 6 项任务）：App 口径的纯 GET，不带 App 签名，
       浏览器带 cookie 直接调即生效。服务端只按调用给 today_feed +2，
       没有查询接口，成败要由调用方对比亲密度差值判断。 */
    async shareConf(roomId) {
      const q = [
        'room_id=' + encodeURIComponent(roomId),
        'scene=fans_medal_share',
        'platform=android',
        'mobi_app=android',
        'build=9140400',
        Auth.uid ? 'mid=' + Auth.uid : '',
        Auth.csrf ? 'csrf=' + Auth.csrf : ''
      ].filter(Boolean).join('&');
      return Net.fetchJson(HOST.live + '/xlive/app-room/v1/index/shareConf?' + q, null, { tries: 1, noRetry: true });
    },

    /* 点赞上报：click_time = 本次上报的点击次数 */
    async likeReport(roomId, anchorId, clickTime) {
      await Wbi.ensure(false);
      const q = Wbi.sign({
        click_time: clickTime,
        room_id: roomId,
        uid: Auth.uid,
        anchor_id: anchorId,
        web_location: WEB_LOCATION,
        csrf: Auth.csrf
      });
      return Net.fetchJson(HOST.live + '/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3?' + q, { method: 'POST' });
    },

    /* 直播间可用表情包（含房间专属与粉丝团表情）。需要 cookie；属于可选能力，
       失败时由调用方兜底改发文字，不在这一层重试 */
    async emoticons(roomId) {
      const j = await Net.fetchJson(
        HOST.live + '/xlive/web-ucenter/v2/emoticon/GetEmoticons?platform=pc&room_id=' + encodeURIComponent(roomId),
        null,
        { tries: 1, noRetry: true }
      );
      if (Number(j.code) !== 0) throw new Error(j.message || ('code ' + j.code));
      const list = (j.data && j.data.data) || [];
      return Array.isArray(list) ? list : [];
    },

    /* 发送弹幕 */
    async sendDanmu(roomId, msg) {
      await Wbi.ensure(false);
      const q = Wbi.sign({ web_location: WEB_LOCATION });
      return postForm(HOST.live + '/msg/send?' + q, Object.assign(danmuForm(roomId), { msg: msg }));
    },

    /* 发送表情弹幕：dm_type=1、msg 传 emoji 的唯一标识、附带 emoticonOptions。
       官方小表情以外的房间/粉丝团表情不能用文字里的 [表情名] 触发，必须走这条通路 */
    async sendEmoticon(roomId, e) {
      await Wbi.ensure(false);
      const q = Wbi.sign({ web_location: WEB_LOCATION });
      const opts = {
        bulge_display: Number(e.bulge_display) || 0,
        emoticon_unique: e.emoticon_unique,
        height: Number(e.height) || 40,
        width: Number(e.width) || 40,
        in_player_area: 1,
        url: e.url || ''
      };
      return postForm(HOST.live + '/msg/send?' + q, Object.assign(danmuForm(roomId), {
        msg: e.emoticon_unique,
        dm_type: 1,
        emoticonOptions: JSON.stringify(opts)
      }));
    },

    /* 观看直播心跳：E（开始）/ X（续期） */
    async traceE(idArr, deviceArr, ruid) {
      await Wbi.ensure(false);
      const q = Wbi.sign({
        id: JSON.stringify(idArr),
        device: JSON.stringify(deviceArr),
        ruid: ruid,
        ts: nowMs(),
        is_patch: 0,
        heart_beat: JSON.stringify([]),
        ua: UA,
        web_location: WEB_LOCATION,
        csrf: Auth.csrf
      });
      return Net.fetchJson(HOST.trace + '/xlive/data-interface/v1/x25Kn/E?' + q, { method: 'POST' });
    },

    async traceX(p) {
      await Wbi.ensure(false);
      const q = Wbi.sign({
        s: p.s,
        id: JSON.stringify(p.id),
        device: JSON.stringify(p.device),
        ruid: p.ruid,
        ets: p.ets,
        benchmark: p.benchmark,
        time: p.time,
        ts: p.ts,
        ua: UA,
        trackid: '-99998',
        web_location: WEB_LOCATION,
        csrf: Auth.csrf
      });
      return Net.fetchJson(HOST.trace + '/xlive/data-interface/v1/x25Kn/X?' + q, { method: 'POST' });
    },

    /* 批量查询主播直播状态 */
    async roomStatusByUids(uids) {
      const map = {};
      for (let i = 0; i < uids.length; i += 50) {
        const part = uids.slice(i, i + 50);
        const q = part.map((u) => 'uids[]=' + encodeURIComponent(u)).join('&');
        try {
          const j = await Net.fetchJson(HOST.live + '/room/v1/Room/get_status_info_by_uids?' + q);
          if (Number(j.code) === 0 && j.data) Object.assign(map, j.data);
        } catch (e) { /* ignore */ }
      }
      return map;
    },

    /* 房间在线人数（在线榜） */
    async onlineNum(roomId, uid) {
      try {
        const j = await Net.fetchJson(HOST.live + '/xlive/general-interface/v1/rank/getOnlineGoldRank?ruid=' + encodeURIComponent(uid) + '&roomId=' + encodeURIComponent(roomId) + '&page=1&pageSize=1');
        if (Number(j.code) === 0 && j.data && typeof j.data.onlineNum === 'number') return j.data.onlineNum;
      } catch (e) { /* ignore */ }
      return null;
    },

    /* 我与你（uid）的关注关系，返回 attribute（2 已关注 / 6 互关 / 0 未关注） */
    async relation(uid) {
      try {
        const j = await Net.fetchJson(HOST.main + '/x/relation?fid=' + encodeURIComponent(uid));
        if (Number(j.code) === 0 && j.data) return Number(j.data.attribute);
      } catch (e) { /* ignore */ }
      return null;
    }
  };
