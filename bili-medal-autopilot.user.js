// ==UserScript==
// @name         bilibili粉丝团任务工具
// @name:en      bili-medal-autopilot
// @namespace    https://github.com/kuru7m1
// @version      1.0.1
// @description  自动完成 B 站粉丝团五项每日任务（点亮 / 点赞 / 弹幕 / 观时 / 分享）
// @description:en  Automatically completes the five daily fan-medal tasks on Bilibili live rooms: light up, like, danmaku, watch, share.
// @author       kuru7m1
// @license      MIT
// @icon         https://raw.githubusercontent.com/kuru7m1/bili-medal-autopilot/main/assets/icon.png
// @homepageURL  https://github.com/kuru7m1/bili-medal-autopilot
// @supportURL   https://github.com/kuru7m1/bili-medal-autopilot/issues
// @updateURL    https://raw.githubusercontent.com/kuru7m1/bili-medal-autopilot/main/bili-medal-autopilot.user.js
// @downloadURL  https://raw.githubusercontent.com/kuru7m1/bili-medal-autopilot/main/bili-medal-autopilot.user.js
// @match        https://live.bilibili.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ==================================================================
   * 0. 全局守卫
   * ================================================================== */
  if (window.__BMA_ACTIVE__) return;
  window.__BMA_ACTIVE__ = true;

  const APP = 'BMA';
  const VERSION = '1.0.1';

  const LSKEY = {
    config: 'bma.config.v1',
    daily: 'bma.daily.v1',
    rooms: 'bma.rooms.v1',
    ui: 'bma.ui.v1',
    bus: 'bma.bus.v1'
  };

  const HOST = {
    live: 'https://api.live.bilibili.com',
    trace: 'https://live-trace.bilibili.com',
    main: 'https://api.bilibili.com'
  };

  const UA = navigator.userAgent;
  const WEB_LOCATION = '444.8';

  /* ==================================================================
   * 1. 基础工具
   * ================================================================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms | 0)));
  const rand = (min, max) => Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) + Math.min(min, max);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nowSec = () => Math.floor(Date.now() / 1000);
  const nowMs = () => Date.now();

  function todayStr(d) {
    const x = d || new Date();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return x.getFullYear() + '-' + m + '-' + day;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmt(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return v.toLocaleString('zh-CN');
  }

  function hms(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return h + '小时' + m + '分';
    if (m > 0) return m + '分' + ss + '秒';
    return ss + '秒';
  }

  function clock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return m + ':' + String(ss).padStart(2, '0');
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function safeParse(text, def) {
    if (text == null) return def;
    if (typeof text === 'object') return text;
    try { return JSON.parse(text); } catch (e) { return def; }
  }

  function lsGet(key, def) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? def : safeParse(raw, def);
    } catch (e) { return def; }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  function removeNode(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function waitFor(fn, opt) {
    const o = opt || {};
    const timeout = o.timeout == null ? 15000 : o.timeout;
    const interval = o.interval || 300;
    const started = nowMs();
    return new Promise((resolve) => {
      const tick = () => {
        let v = null;
        try { v = fn(); } catch (e) { v = null; }
        if (v) { resolve(v); return; }
        if (nowMs() - started >= timeout) { resolve(null); return; }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  /* 23:55 之后 / 00:05 之前视为跨天危险区 */
  function isCrossDayDanger() {
    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();
    return h === 23 && m >= 55;
  }

  function isFreshDay() {
    const d = new Date();
    return d.getHours() === 0 && d.getMinutes() < 5;
  }

  /* ==================================================================
   * 2. MD5 / HMAC（WBI 签名与直播心跳加密都要用）
   * ================================================================== */
  const Crypto = (function () {
    const S = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

    const enc = new TextEncoder();

    function bytesOf(v) {
      if (v instanceof Uint8Array) return v;
      return enc.encode(typeof v === 'string' ? v : String(v));
    }

    function md5Bytes(input) {
      const bytes = bytesOf(input);
      const n = bytes.length;
      const blocks = ((n + 8) >>> 6) + 1;
      const words = new Uint32Array(blocks * 16);
      for (let i = 0; i < n; i++) words[i >>> 2] |= bytes[i] << ((i % 4) * 8);
      words[n >>> 2] |= 0x80 << ((n % 4) * 8);
      const bits = n * 8;
      words[blocks * 16 - 2] = bits >>> 0;
      words[blocks * 16 - 1] = Math.floor(bits / 4294967296) >>> 0;

      let a0 = 0x67452301;
      let b0 = 0xefcdab89;
      let c0 = 0x98badcfe;
      let d0 = 0x10325476;

      for (let blk = 0; blk < blocks; blk++) {
        const off = blk * 16;
        let A = a0;
        let B = b0;
        let C = c0;
        let D = d0;
        for (let i = 0; i < 64; i++) {
          let F;
          let g;
          if (i < 16) { F = (B & C) | (~B & D); g = i; }
          else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
          else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
          else { F = C ^ (B | ~D); g = (7 * i) % 16; }
          F = (F + A + K[i] + words[off + g]) >>> 0;
          A = D;
          D = C;
          C = B;
          const rot = S[i];
          B = (B + (((F << rot) | (F >>> (32 - rot))) >>> 0)) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
      }

      const out = new Uint8Array(16);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, a0, true);
      dv.setUint32(4, b0, true);
      dv.setUint32(8, c0, true);
      dv.setUint32(12, d0, true);
      return out;
    }

    function hex(u8) {
      let s = '';
      for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
      return s;
    }

    function md5(v) { return hex(md5Bytes(v)); }

    function concat(a, b) {
      const out = new Uint8Array(a.length + b.length);
      out.set(a, 0);
      out.set(b, a.length);
      return out;
    }

    function hmacMd5Hex(keyStr, msgStr) {
      let key = bytesOf(keyStr);
      if (key.length > 64) key = md5Bytes(key);
      const ipad = new Uint8Array(64);
      const opad = new Uint8Array(64);
      ipad.fill(0x36);
      opad.fill(0x5c);
      for (let i = 0; i < key.length; i++) {
        ipad[i] ^= key[i];
        opad[i] ^= key[i];
      }
      const inner = md5Bytes(concat(ipad, bytesOf(msgStr)));
      return hex(md5Bytes(concat(opad, inner)));
    }

    const ALGO = { 1: 'SHA-1', 2: 'SHA-256', 3: 'SHA-224', 4: 'SHA-512', 5: 'SHA-384' };

    async function hmacHex(rule, keyStr, msgStr) {
      if (rule === 0) return hmacMd5Hex(keyStr, msgStr);
      const alg = ALGO[rule] || 'SHA-256';
      const subtle = (window.crypto && window.crypto.subtle) || null;
      if (!subtle) return null;
      try {
        const ck = await subtle.importKey('raw', bytesOf(keyStr), { name: 'HMAC', hash: alg }, false, ['sign']);
        const sig = await subtle.sign('HMAC', ck, bytesOf(msgStr));
        return hex(new Uint8Array(sig));
      } catch (e) {
        return null;
      }
    }

    return { md5, md5Bytes, hex, hmacHex, hmacMd5Hex, bytesOf };
  })();

  /* ==================================================================
   * 3. 日志（环形缓冲 + 订阅）
   * ================================================================== */
  const Log = {
    lines: [],
    max: 400,
    seq: 0,
    subs: new Set(),

    push(level, tag, msg) {
      const item = {
        id: ++this.seq,
        t: new Date(),
        level: level,
        tag: tag || '',
        msg: String(msg == null ? '' : msg)
      };
      this.lines.push(item);
      if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
      const text = '[' + item.t.toLocaleTimeString('zh-CN') + '][' + item.tag + '] ' + item.msg;
      try {
        if (level === 'error') console.error('%c' + APP + '%c' + text, 'color:#fff;background:#e5484d;padding:0 3px;border-radius:3px', '');
        else if (level === 'warn') console.warn('%c' + APP + '%c' + text, 'color:#fff;background:#f5a524;padding:0 3px;border-radius:3px', '');
        else console.log('%c' + APP + '%c' + text, 'color:#fff;background:#23ade5;padding:0 3px;border-radius:3px', '');
      } catch (e) { /* ignore */ }
      this.subs.forEach((fn) => { try { fn(item); } catch (e) { /* ignore */ } });
    },

    log(tag, msg) { this.push('info', tag, msg); },
    warn(tag, msg) { this.push('warn', tag, msg); },
    error(tag, msg) { this.push('error', tag, msg); },
    ok(tag, msg) { this.push('ok', tag, msg); },

    on(fn) {
      this.subs.add(fn);
      return () => this.subs.delete(fn);
    },

    dump() {
      return this.lines.map((l) => '[' + l.t.toLocaleString('zh-CN') + '][' + l.level + '][' + l.tag + '] ' + l.msg).join('\n');
    }
  };

  /* ==================================================================
   * 4. 跨标签总线（BroadcastChannel，降级用 storage 事件）
   * ================================================================== */
  const Bus = {
    id: 'tab-' + Math.random().toString(36).slice(2, 10),
    ch: null,
    handlers: new Set(),
    ready: false,

    init() {
      if (this.ready) return this;
      this.ready = true;
      try {
        this.ch = new BroadcastChannel('bma-bus');
        this.ch.onmessage = (e) => this._dispatch(e.data);
      } catch (e) {
        this.ch = null;
      }
      if (!this.ch) {
        window.addEventListener('storage', (e) => {
          if (e.key === LSKEY.bus) this._dispatch(safeParse(e.newValue, null));
        });
      }
      return this;
    },

    post(type, data) {
      const msg = { from: this.id, type: type, data: data, at: nowMs() };
      if (this.ch) {
        try { this.ch.postMessage(msg); return; } catch (e) { /* fallthrough */ }
      }
      try { localStorage.setItem(LSKEY.bus, JSON.stringify(msg)); } catch (e) { /* ignore */ }
    },

    on(fn) {
      this.handlers.add(fn);
      return () => this.handlers.delete(fn);
    },

    _dispatch(msg) {
      if (!msg || msg.from === this.id) return;
      this.handlers.forEach((fn) => { try { fn(msg); } catch (e) { /* ignore */ } });
    }
  };
  Bus.init();

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

  /* ==================================================================
   * 8. 观看直播心跳（live-trace E/X + spyder 签名）
   * ================================================================== */
  function uuid4() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) { /* ignore */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* 心跳迟到多少算过期。实测 interval=60 时迟到 20 秒仍被接受，
     迟到 90 秒返回 time check failed；取间隔的 40% 作为阈值，留出余量。
     超过阈值的拍不再硬发，先重发 E 对齐服务端时间戳。 */
  function watchDriftTooLarge(now, nextAt, intervalSec) {
    return now - nextAt > Math.max(8000, (Number(intervalSec) || 30) * 400);
  }

  const RoomHeart = class RoomHeart {
    constructor(meta, targetSec) {
      this.roomId = meta.roomId;
      this.areaId = meta.areaId || 0;
      this.parentAreaId = meta.parentAreaId || 0;
      this.ruid = meta.uid;
      this.targetSec = Math.max(60, targetSec | 0);
      this.seq = 0;
      this.stopped = false;
      this.watched = 0;
      this.uuid = uuid4();
      this.device = [Auth.buvid, this.uuid];
      this.interval = 30;
      this.secretKey = '';
      this.secretRule = [0, 1, 2, 5];
      this.ts = nowSec();
      this.ets = nowSec();
      this.nextAt = nowMs() + 30000;
      this.lastBeatAt = nowMs();
      this.onProgress = null;
      this.gen = (typeof Engine !== 'undefined' && Engine) ? Engine.runId : 0;
      this.resyncCount = 0;     /* 连续重同步次数，成功一次即清零 */
      this.pausedLogged = false;
      this.lastResyncAt = 0;
    }

    get idArr() {
      return [this.parentAreaId, this.areaId, this.seq, this.roomId];
    }

    stop() {
      this.stopped = true;
    }

    applyState(d) {
      if (!d) return;
      const iv = Number(d.heartbeat_interval || d.heartBeatInterval);
      if (iv > 0 && iv < 600) this.interval = iv;
      if (d.secret_key) this.secretKey = d.secret_key;
      if (Array.isArray(d.secret_rule) && d.secret_rule.length) this.secretRule = d.secret_rule;
      const ts = Number(d.timestamp);
      if (ts > 0) {
        this.ts = ts;
        this.ets = ts;
      }
      /* 服务端可能返回「当前时刻」而非推进时间；若不加下限会连续发心跳，服务端按心跳数累计、
         比真实耗时多记几倍。这里强制两次心跳至少间隔一个 interval。 */
      this.nextAt = Math.max((this.ts + this.interval) * 1000, nowMs() + this.interval * 1000);
    }

    async spyder() {
      /* 关键：签名用的 ts 必须与请求参数里的 ts 是同一个值，
         否则服务端会返回 sign check failed */
      const ts = nowMs();
      const payload = {
        platform: 'web',
        parent_id: this.parentAreaId,
        area_id: this.areaId,
        seq_id: this.seq,
        room_id: this.roomId,
        buvid: this.device[0],
        uuid: this.device[1],
        ets: this.ets,
        time: this.interval,
        ts: ts
      };
      let s = JSON.stringify(payload);
      const rules = this.secretRule || [];
      for (let i = 0; i < rules.length; i++) {
        const out = await Crypto.hmacHex(Number(rules[i]), this.secretKey, s);
        if (!out) return null;
        s = out;
      }
      return { s: s, ts: ts };
    }

    async beatE() {
      const j = await API.traceE(this.idArr, this.device, this.ruid);
      if (Number(j.code) !== 0) {
        Log.warn('观时', '房间 ' + this.roomId + ' E 心跳失败：' + (j.message || j.code));
        return false;
      }
      this.applyState(j.data);
      /* 重新 E 后 seq 从 0 重新开始（实测服务端接受） */
      this.seq = 0;
      if (!Cfg.v.watch || Cfg.v.watch.logHeartbeat !== false) {
        Log.log('观时', '房间 ' + this.roomId + ' E 心跳成功：interval ' + this.interval + 's，目标 ' + hms(this.targetSec));
      }
      return true;
    }

    async beatX() {
      const sig = await this.spyder();
      if (!sig || !sig.s) {
        Log.warn('观时', '房间 ' + this.roomId + ' 心跳签名失败（secret_rule 不支持），已跳过该房间');
        return false;
      }
      const j = await API.traceX({
        s: sig.s,
        id: this.idArr,
        device: this.device,
        ruid: this.ruid,
        ets: this.ets,
        benchmark: this.secretKey,
        time: this.interval,
        ts: sig.ts
      });
      if (Number(j.code) !== 0) {
        Log.warn('观时', '房间 ' + this.roomId + ' X 心跳失败：' + (j.message || j.code));
        return false;
      }
      this.seq++;
      this.beats = (Number(this.beats) || 0) + 1;
      this.applyState(j.data);
      /* 每次成功心跳都留痕，便于核对 B 站侧计时 */
      if (!Cfg.v.watch || Cfg.v.watch.logHeartbeat !== false) {
        Log.log('观时', '房间 ' + this.roomId + ' 心跳 #' + this.beats + ' 成功：累计 ' + hms(this.watched) +
          ' / 目标 ' + hms(this.targetSec) + '，间隔 ' + this.interval + 's，seq ' + this.seq);
      }
      return true;
    }

    /* 后台策略：默认在页面不可见时暂停心跳，回到前台后由 run() 重新 E 对齐。
       隐藏标签的定时器会被压到 1 次/分钟，硬发只会撞 time check failed */
    async waitNext() {
      while (!this.stopped) {
        if (!Cfg.v.watch.bgContinue && typeof PageState !== 'undefined' && !PageState.realVisible()) {
          if (!this.pausedLogged) {
            this.pausedLogged = true;
            Log.log('观时', '房间 ' + this.roomId + ' 已切到后台，暂停心跳（回到前台自动续挂）');
          }
          await sleep(1000);
          continue;
        }
        if (this.pausedLogged) {
          this.pausedLogged = false;
          Log.log('观时', '房间 ' + this.roomId + ' 回到前台，准备重新对齐心跳');
        }
        const remain = this.nextAt - nowMs();
        if (remain <= 0) return true;
        await sleep(Math.min(remain, 1000));
      }
      return false;
    }

    /* 时间戳过期后重新 E：拿到新的 timestamp / interval / secret_key。
       实测：time check failed 后原会话立即重发仍然失败，重新 E 一次即可恢复 */
    async resync() {
      if (nowMs() - this.lastResyncAt > 60000) {
        this.lastResyncAt = nowMs();
        Log.log('观时', '房间 ' + this.roomId + ' 心跳时间戳已过期，重新对齐');
      }
      const ok = await this.beatE();
      if (!ok) return false;
      this.lastBeatAt = nowMs();
      return true;
    }

    async run() {
      const self = this;
      if (!Auth.buvid) {
        Log.error('观时', '缺少 buvid，无法执行观看任务');
        return { ok: false, seconds: 0 };
      }
      if (!this.areaId || !this.parentAreaId) {
        Log.warn('观时', '房间 ' + this.roomId + ' 缺少分区信息，跳过');
        return { ok: false, seconds: 0 };
      }
      if (!(await this.beatE())) return { ok: false, seconds: 0 };
      this.lastBeatAt = nowMs();
      this.watched = 0;
      this.resyncCount = 0;
      let driftFail = false;

      while (!this.stopped && this.watched < this.targetSec && (typeof Engine === 'undefined' || !Engine || this.gen === Engine.runId)) {
        if (isCrossDayDanger()) {
          Log.log('观时', '临近跨天，停止房间 ' + this.roomId + ' 的心跳');
          break;
        }
        if (!(await this.waitNext())) break;
        /* 迟到太多：先重发 E 对齐时间戳，不硬发注定失败的 X */
        if (watchDriftTooLarge(nowMs(), this.nextAt, this.interval)) {
          if (!(await this.resync())) { driftFail = true; break; }
          continue;
        }
        const ok = await this.beatX();
        if (!ok) {
          /* time check failed / 网络错误：重同步后继续；连续 3 次仍失败才结束会话 */
          if (this.resyncCount >= 3) { driftFail = true; break; }
          this.resyncCount++;
          if (!(await this.resync())) { driftFail = true; break; }
          continue;
        }
        this.resyncCount = 0;
        const now = nowMs();
        const delta = Math.min((now - this.lastBeatAt) / 1000, this.interval * 2);
        this.lastBeatAt = now;
        this.watched += delta;
        if (typeof this.onProgress === 'function') {
          try { this.onProgress(self); } catch (e) { /* ignore */ }
        }
      }
      return { ok: this.watched >= this.targetSec - 1, seconds: Math.round(this.watched), drift: driftFail };
    }
  };

  /* ==================================================================
   * 9. 任务执行器
   * ================================================================== */
  const TASK_NAME = { light: '点亮', like: '点赞', danmu: '弹幕', watch: '观时', share: '分享' };

  /* 是否允许超过服务端任务上限：必须在设置里填了数字并开启该项开关。
     上限留空/0 时是「跟随服务端」，没有可超过的目标 */
  function overServer(name) {
    if (typeof Cfg === 'undefined' || !Cfg || !Cfg.v) return false;
    const conf = Cfg.v.taskLimit || {};
    if (Math.round(Number(conf[name]) || 0) <= 0) return false;
    const b = conf.brk;
    return typeof b === 'boolean' ? b : !!(b && b[name] === true);
  }

  /* 超上限提示只打一条：同一房间同一任务同一天里，反复调度不应反复刷屏 */
  const overNotice = new Set();
  function logOverOnce(meta, name, target, unit) {
    if (!meta) return;
    const k = String(meta.roomId) + ':' + name + ':' + target;
    if (overNotice.has(k)) return;
    overNotice.add(k);
    Log.log(TASK_NAME[name] || name, '房间 ' + meta.roomId + ' 已到 B 站任务上限，按设置继续做到 ' +
      target + (unit || '') + '（超出部分不计亲密度）');
  }

  /* ---------------- 表情弹幕 ---------------- */
  const EMOTE_TTL = 6 * 60 * 60 * 1000;
  const EMOTE_MISS_TTL = 10 * 60 * 1000;
  const emoteCache = new Map();   /* roomId -> {at, ttl, list} */
  const emoteMissLogged = new Set();  /* 已经提示过「没有可用表情」的房间 */
  const sharePending = new Set(); /* 正在调分享接口的房间，防止刷新时旧任务与新任务并发重复调用 */
  const EMOTE_TIER_NAME = { room: '房间专属', fans: '粉丝团', guard: '大航海', charge: '充电' };

  /* 表情的实际分类。面板上的分组与字段对应关系：
     - 房间专属表情：谁都可以发，没有解锁文字，也没有等级/礼物要求
     - 粉丝团表情（UP主大表情）：点亮灯牌后可发等级 1 的部分，等级越高解锁越多
     - 大航海表情：舰长/提督/总督专属，需付费身份
     - 充电表情：包月充电专属，表情标识形如 upower_[UPOWER_<mid>_<名字>]
     - 通用表情：官方小表情，pkg_type=1，不在 UP 专属范围内 */
  function emoteTier(pkg, e) {
    const label = String(e.unlock_show_text || '') + ' ' + String(pkg.pkg_name || '') + ' ' + String(pkg.pkg_descript || '');
    const uniq = String(e.emoticon_unique || '');
    if (/充电|upower/i.test(label) || /^upower_/i.test(uniq)) return 'charge';
    if (/大航海|舰长|提督|总督|荣耀/.test(label)) return 'guard';
    /* 有等级要求或带「粉丝团/勋章」标签的，都归入粉丝团表情。
       注意 unlock_need_gift 很可能是粉丝灯牌的礼物 id，不能据此判定为付费表情 */
    if (/粉丝|勋章/.test(label) || Number(e.unlock_need_level) > 0) return 'fans';
    return 'room';
  }

  /* 服务端的 perm 表示「当前账号此刻能不能发」：1 可用，0 需解锁。
     缺少该字段时返回 null，交给调用方退回解锁条件推断 */
  function emotePerm(e, pkg) {
    if (e.perm != null && e.perm !== '') return Number(e.perm) === 1;
    if (pkg.pkg_perm != null && pkg.pkg_perm !== '') return Number(pkg.pkg_perm) === 1;
    return null;
  }

  /* 挑出当前可发、且确实属于本直播间的表情。
     不能只看包类型：2026-10-30 实测服务端有 pkg_type=5 的「装扮表情」包
     （upower_[酷仔] 这类，账号自选的 B 站装扮），perm=1，会被误当成可用表情发出去。
     因此分两层判断：
       ① 包类型：pkg_type=2 是「房间专属 / UP主大表情」，整体属于当前直播间；
          1（通用）、3（emoji 小表情）、5（装扮）一律排除
       ② 标识兜底：unique 以 room_<直播间号>_ 或 upower_[UPOWER_<主播uid>_ 开头
     只看前缀会漏掉标识格式不同的房间（例如短号、旧格式），实测就出现过
     「主播明明配了房间专属表情却一个都取不到」的情况，所以以包类型为主 */
  function pickUsableEmotes(pkgs, meta) {
    const roomId = String((meta && meta.roomId) || '');
    const uid = String((meta && meta.uid) || '');
    const roomTag = roomId ? ('room_' + roomId + '_') : '';
    const chargeTag = uid ? ('upower_[UPOWER_' + uid + '_') : '';
    const all = [];
    const seen = new Set();
    (Array.isArray(pkgs) ? pkgs : []).forEach((pkg) => {
      if (!pkg || !Array.isArray(pkg.emoticons)) return;
      const type = Number(pkg.pkg_type);
      if (type === 1 || type === 3 || type === 5) return;
      const byType = type === 2;
      pkg.emoticons.forEach((e) => {
        if (!e || !e.emoticon_unique) return;
        const uniq = String(e.emoticon_unique);
        const own = byType ||
          (roomTag && uniq.indexOf(roomTag) === 0) ||
          (chargeTag && uniq.indexOf(chargeTag) === 0);
        if (!own) return;
        if (seen.has(e.emoticon_unique)) return;
        seen.add(e.emoticon_unique);
        all.push({
          emoticon_unique: String(e.emoticon_unique),
          name: String(e.emoji || e.descript || ''),
          url: String(e.url || ''),
          width: Number(e.width) || 0,
          height: Number(e.height) || 0,
          bulge_display: Number(e.bulge_display) || 0,
          tier: emoteTier(pkg, e),
          perm: emotePerm(e, pkg),
          needLevel: Number(e.unlock_need_level) || 0
        });
      });
    });
    let list = all.filter((x) => x.perm === true);
    if (!list.length) {
      /* 接口没有给出可用标记（或某些版本 perm 恒为 0）：退回解锁条件，
         只保留点亮粉丝团即可用的那一档，付费身份与充电仍然排除 */
      list = all.filter((x) => x.needLevel <= 1 && x.tier !== 'guard' && x.tier !== 'charge');
    }
    return list;
  }

  /* 表情弹幕的成功判定：code 0 且未被关键字（k）/敏感词（f）过滤 */
  function emoteOk(j) {
    const m = String((j && (j.msg || j.message)) || '');
    return Number(j && j.code) === 0 && m !== 'k' && m !== 'f';
  }

  const Tasks = {
    /* 该房间当前可发的 UP 表情；失败与空结果都缓存一小段时间，避免反复打接口 */
    async emotes(meta) {
      const roomId = String(meta.roomId);
      const hit = emoteCache.get(roomId);
      if (hit && nowMs() - hit.at < hit.ttl) return hit.list;
      let list = [];
      let ttl = EMOTE_TTL;
      let pkgs = [];
      try {
        pkgs = await API.emoticons(meta.roomId);
        list = pickUsableEmotes(pkgs, meta);
      } catch (e) {
        ttl = EMOTE_MISS_TTL;
        Log.warn('弹幕', '房间 ' + roomId + ' 读取表情失败：' + (e.message || e) + '，改用文字弹幕');
      }
      if (!list.length) {
        ttl = Math.min(ttl, EMOTE_MISS_TTL);
        /* 每个房间只提示一次，一行结论，不打印接口返回内容 */
        if (!emoteMissLogged.has(roomId)) {
          emoteMissLogged.add(roomId);
          Log.log('弹幕', '房间 ' + roomId + ' 没有可用的房间表情，改用文字');
        }
      } else {
        Log.log('弹幕', '房间 ' + roomId + ' 可用免费表情 ' + list.length + ' 个');
      }
      emoteCache.set(roomId, { at: nowMs(), ttl: ttl, list: list });
      return list;
    },

    /* 点赞：小批量上报 + 随机间隔，按 B 站返回的每轮次数与每日上限执行 */
    async like(meta, opts) {
      const o = opts || {};
      const roomId = meta.roomId;
      /* 同弹幕：刷新/停止后本轮作废，旧循环必须立刻退出 */
      const runId = Engine.runId;
      const t = await Data.tasks(meta.uid);
      if (!t.ok) return { status: 'fail', reason: '任务信息读取失败：' + t.reason };

      const item = findTaskInfo(t.tasks, 'like');
      if (!item) return { status: 'na', reason: '任务列表里没有点赞任务' };
      /* 开启超上限且设置值还没做满时，即使服务端显示完成也要继续做 */
      const over = overServer('like') && o.maxRounds != null && o.maxRounds > 0;
      if (!o.force && isTaskDone(item) && !over) return { status: 'done' };

      const perRound = parseTitleCount(item.title) || 30;
      const limit = parseDailyLimit(item.sub_title);
      /* 剩余量按实际进度算：服务端停在 5/5 时不能当成「只差服务端剩余轮次」，
         否则每次重跑都会把设置值再从服务端数字往后推一遍。
         基线由 progressOf 在服务端到上限时自动补上（含已有次数反推） */
      const prog = Engine.progressOf(meta, 'like');
      let needRounds = limit ? Math.max(0, limit.limit - prog.cur) : 1;
      if (o.rounds != null) needRounds = Math.max(1, Math.min(needRounds, o.rounds));
      /* 房间自定义上限：例如设 2 轮，就只做 2 轮，服务端剩下的留给明天。
         开启超上限时按「设置值 - 实际进度」算，不再被服务端剩余轮次截断 */
      if (o.maxRounds != null && o.maxRounds > 0) {
        const bySetting = Math.max(0, o.maxRounds - prog.cur);
        needRounds = over ? bySetting : Math.min(needRounds, bySetting);
      }
      if (needRounds <= 0) return { status: 'done' };
      /* 这里才真的要超过服务端上限：提示每个房间每天只打一条，避免每次调度都刷一遍 */
      if (over && isTaskDone(item)) logOverOnce(meta, 'like', o.maxRounds, ' 轮');

      const capClicks = Number(Cfg.v.like.capClicks) || 310;
      const already = Number(Daily.get(meta).like) || 0;
      const planned = needRounds * perRound;
      const budget = Math.max(0, Math.min(planned, capClicks - already));
      /* 保护上限先到：今天不可能再做满设置值，按完成处理，避免对账反复重跑 */
      const cappedOut = budget < planned;
      const capNew = cappedOut ? Engine.noteCapOut(meta, 'like', o.maxRounds || 0, capClicks) : false;
      if (budget <= 0) {
        Daily.done(meta, 'like', true);
        if (capNew) Log.warn('点赞', '房间 ' + roomId + ' 已达每房间点赞保护上限（' + capClicks + ' 次），今日不再点赞');
        return { status: 'done', reason: '已达本房间每日点赞上限' };
      }

      Log.log('点赞', '房间 ' + roomId + ' 计划点赞 ' + budget + ' 次（每轮 ' + perRound + ' 次，剩 ' + needRounds + ' 轮）');
      let sent = 0;
      let failCount = 0;
      let sentRounds = 0;
      let lastLim = limit || null;

      while (sent < budget && Engine.running && Engine.runId === runId &&
        !isCrossDayDanger() && Engine.taskOn(meta, 'like')) {
        const bMin = Math.max(1, Math.min(Number(Cfg.v.like.batchMin) || 10, perRound));
        const bMax = Math.max(bMin, Math.min(Number(Cfg.v.like.batchMax) || 20, perRound));
        let batch = rand(bMin, bMax);
        batch = Math.min(batch, budget - sent);

        let j = null;
        try {
          j = await API.likeReport(meta.roomId, meta.uid, batch);
        } catch (e) {
          j = { code: -1, message: e.message || '网络错误' };
        }
        if (!j || Number(j.code) !== 0) {
          failCount++;
          if (Engine.running) Daily.setErr(meta, '点赞失败：' + ((j && j.message) || '未知'), 'like');
          Log.warn('点赞', '房间 ' + roomId + ' 点赞上报失败：' + ((j && j.message) || '未知') + '，第 ' + failCount + ' 次');
          if (failCount >= 3) return { status: 'fail', reason: '连续失败：' + ((j && j.message) || '未知') };
          if (!(await Engine.taskSleep(3000 + failCount * 4000, meta, 'like'))) return { status: 'halt', reason: '房间任务开关已关闭' };
          continue;
        }
        failCount = 0;
        sent += batch;
        Daily.add(meta, 'like', batch);
        Engine.touch();

        /* 每凑满一轮就核对一次，避免超出每日上限 */
        if (sent >= perRound * (sentRounds + 1)) {
          sentRounds = Math.floor(sent / perRound);
          const t2 = await Data.tasks(meta.uid, true);
          if (t2.ok) {
            const item2 = findTaskInfo(t2.tasks, 'like');
            /* 超上限模式下，服务端显示完成不代表做到设置值，继续做 */
            if (isTaskDone(item2) && (!over || sentRounds >= needRounds)) {
              Daily.done(meta, 'like', true);
              Log.ok('点赞', '房间 ' + roomId + ' 点赞任务已完成（本次 ' + sent + ' 次）');
              return { status: 'done', sent: sent };
            }
            const lim2 = parseDailyLimit(item2 && item2.sub_title);
            if (lim2) {
              lastLim = lim2;
              Log.log('点赞', '房间 ' + roomId + ' 服务端进度 ' + lim2.current + '/' + lim2.limit + ' 轮');
            }
            /* 服务端刚做到上限：基线固定在整轮边界上（本批多发的几次不算），
               之后多做的轮次才计入超上限进度 */
            if (over && lim2 && lim2.limit > 0 && lim2.current >= lim2.limit) {
              const rr = Daily.get(meta);
              if (!rr.overBase.like || Number(rr.overBase.like.srv) < lim2.limit) {
                Engine.markOverBase(meta, 'like', lim2.limit,
                  (Number(rr.like) || 0) - (sent - sentRounds * perRound));
              }
            }
            if (!over && lim2 && lim2.current >= lim2.limit) {
              Daily.done(meta, 'like', true);
              return { status: 'done', sent: sent };
            }
          }
        }

        const gap = rand(Number(Cfg.v.like.gapMin) || 8, Number(Cfg.v.like.gapMax) || 18);
        if (sent >= budget) break;
        if (!(await Engine.taskSleep(gap * 1000, meta, 'like'))) return { status: 'halt', reason: '房间任务开关已关闭' };
      }

      if (!Engine.taskOn(meta, 'like')) return { status: 'halt', reason: '房间任务开关已关闭' };
      if (Engine.runId !== runId) return { status: 'halt', reason: '引擎已重启' };

      const t3 = await Data.tasks(meta.uid, true);
      const done = t3.ok && isTaskDone(findTaskInfo(t3.tasks, 'like'));
      /* 超上限时以实际进度为准：服务端 is_done 只代表做到了服务端上限，
         用户中途停止也会走到这里，直接写完成会留下「5/10 ✓」 */
      const reachedTarget = !over || (o.maxRounds > 0 && Engine.progressOf(meta, 'like').cur >= o.maxRounds);
      /* 本房间允许的轮次已经做完（自定义上限低于服务端剩余轮次时，服务端不会 is_done），
         按当天完成处理，不写红字 */
      const reachedPlan = o.maxRounds > 0 && sent >= planned;
      if ((done || reachedPlan || cappedOut) && (reachedTarget || cappedOut)) {
        Daily.done(meta, 'like', true);
        if (cappedOut && !reachedPlan) {
          if (capNew) {
            Log.warn('点赞', '房间 ' + roomId + ' 已达每房间点赞保护上限（设置 ' + o.maxRounds +
              ' 轮，实际 ' + Math.floor(sent / perRound) + ' 轮），今日不再继续');
          }
        } else if (done) {
          Log.ok('点赞', '房间 ' + roomId + ' 点赞任务已完成（本次 ' + sent + ' 次）');
        } else if (over) {
          Log.ok('点赞', '房间 ' + roomId + ' 已做到设置上限 ' + o.maxRounds + ' 轮' +
            (lastLim ? '（服务端 ' + lastLim.current + '/' + lastLim.limit + ' 轮）' : '') +
            '，超出部分不计亲密度');
        } else {
          Log.ok('点赞', '房间 ' + roomId + ' 已做到本房间上限 ' + o.maxRounds + ' 轮' +
            (lastLim ? '（服务端 ' + lastLim.current + '/' + lastLim.limit + ' 轮，剩余留给明天）' : ''));
        }
        return { status: 'done', sent: sent };
      }
      if (Engine.running) Daily.setErr(meta, '点赞未达上限但任务未完成', 'like');
      return { status: 'fail', reason: '本次 ' + sent + ' 次后任务仍未完成' + (lastLim ? '（服务端进度 ' + lastLim.current + '/' + lastLim.limit + ' 轮）' : ''), sent: sent };
    },

    /* 发弹幕：默认只对未开播的房间发送，可在设置里放开到开播中的房间。
       内容优先用该直播间的免费表情（房间专属 / 粉丝团），取不到或发不出去时回落到文字列表 */
    async danmu(meta, opts) {
      const o = opts || {};
      const roomId = meta.roomId;
      /* 记住启动时的轮次：刷新/停止后本轮次作废，循环要立刻退出，
         否则旧任务会在新引擎启动后继续发送（同一房间出现两条循环） */
      const runId = Engine.runId;
      const onlyNotLive = o.ignoreLiveRule ? false : !!Cfg.v.danmu.onlyWhenNotLive;
      if (meta.liveStatus === 1 && onlyNotLive) {
        return { status: 'skip', reason: '主播正在直播，按设置不在开播房间发弹幕' };
      }

      const t = await Data.tasks(meta.uid);
      if (!t.ok) return { status: 'fail', reason: '任务信息读取失败：' + t.reason };
      const item = findTaskInfo(t.tasks, 'sendDanmu');
      if (!item) return { status: 'na', reason: '任务列表里没有发弹幕任务' };
      const over = overServer('danmu') && o.maxCount != null && o.maxCount > 0;
      if (!o.force && isTaskDone(item) && !over) return { status: 'done' };

      const limit = parseDailyLimit(item.sub_title);
      /* 没有进度信息时按调用方要求的条数发（点亮需要发满服务端任务要求的条数），
         有进度时只补差额；以前这里固定 1 条，点亮会一直差几条 */
      const prog = Engine.progressOf(meta, 'danmu');
      let need = limit ? Math.max(0, limit.limit - prog.cur) : (o.count != null ? o.count : 1);
      if (o.count != null) need = Math.max(0, Math.min(need, o.count));
      /* 房间自定义上限：例如设 3 条，就只发 3 条。
         开启超上限时按「设置值 - 实际进度」算，不再被服务端剩余条数截断 */
      if (o.maxCount != null && o.maxCount > 0) {
        const bySetting = Math.max(0, o.maxCount - prog.cur);
        need = over ? bySetting : Math.min(need, bySetting);
      }
      if (need <= 0) return { status: 'done' };
      if (over && isTaskDone(item)) logOverOnce(meta, 'danmu', o.maxCount, ' 条');
      /* 这一批会跨过服务端上限：基线提前落在「服务端还能计入的那几条」之后，
         否则本批剩下的条数会被当成已计入，进度永远差一轮 */
      if (over && limit && limit.limit > 0 && limit.current < limit.limit && limit.current + need >= limit.limit) {
        const rr = Daily.get(meta);
        if (!rr.overBase.danmu || Number(rr.overBase.danmu.srv) < limit.limit) {
          Engine.markOverBase(meta, 'danmu', limit.limit, (Number(rr.danmu) || 0) + (limit.limit - limit.current));
        }
      }

      const list = (o.list && o.list.length ? o.list : Cfg.v.danmu.list)
        .map((s) => String(s || '').trim())
        .filter(Boolean);
      if (!list.length) return { status: 'fail', reason: '弹幕列表为空' };

      /* 表情弹幕：默认开启。只要当前账号能发就发（房间专属 / 粉丝团 / 大航海 / 充电）。
         实测表情弹幕会计入「发送弹幕」任务，点亮流程同样优先使用表情 */
      let useEmote = !o.noEmote && !!Cfg.v.danmu.useRoomEmoticons;
      let emotes = [];
      if (useEmote) {
        emotes = await this.emotes(meta);
        if (!emotes.length) useEmote = false;
      }

      /* 随机顺序：每次任务从打乱后的列表里取，避免每天重复同一个表情 */
      const emoteOrder = emotes.slice();
      for (let i = emoteOrder.length - 1; i > 0; i--) {
        const j = rand(0, i);
        const tmp = emoteOrder[i];
        emoteOrder[i] = emoteOrder[j];
        emoteOrder[j] = tmp;
      }
      const tierCount = {};
      emotes.forEach((x) => { tierCount[x.tier] = (tierCount[x.tier] || 0) + 1; });
      const tierText = Object.keys(tierCount).map((k) => (EMOTE_TIER_NAME[k] || k) + ' ' + tierCount[k]).join('、');

      Log.log('弹幕', '房间 ' + roomId + ' 计划发送 ' + need + ' 条弹幕' +
        (useEmote ? '（可用表情 ' + emotes.length + ' 个：' + tierText + '）' : '（文字）'));
      let okCount = 0;
      let idx = 0;
      for (let i = 0; i < need && Engine.running && Engine.runId === runId &&
        !isCrossDayDanger() && Engine.taskOn(meta, 'danmu'); i++) {
        let sentOk = false;

        /* ① 先试可发表情（顺序已随机）。频率过快只等 5 秒重试，不切文字；
              只有表情本身不可用才在本次调用内改用文字 */
        if (useEmote) {
          for (let retry = 0; retry < 3 && !sentOk && Engine.runId === runId; retry++) {
            const em = emoteOrder[(i + retry) % emoteOrder.length];
            let je = null;
            try {
              je = await API.sendEmoticon(roomId, em);
            } catch (e) {
              je = { code: -1, net: true, message: e.message || '网络错误' };
            }
            if (emoteOk(je)) {
              sentOk = true;
              okCount++;
              Daily.add(meta, 'danmu', 1);
              Engine.touch();
              Log.log('弹幕', '房间 ' + roomId + ' 已发送表情「' + (em.name || em.emoticon_unique) + '」');
              break;
            }
            const etxt = String((je && (je.message || je.msg)) || '');
            if (/禁言|禁止发言/.test(etxt)) {
              if (Engine.running) Daily.setErr(meta, '弹幕被拒绝：' + etxt, 'danmu');
              return { status: 'blocked', reason: etxt };
            }
            /* 限速不是表情的问题：等 5 秒重试，连续 3 次仍被限速就放弃本次任务，
               交给失败退避；绝不因为限速改用文字 */
            if (/频率|太快|频繁|稍后再/.test(etxt)) {
              if (retry >= 2) {
                if (Engine.running) Daily.setErr(meta, '弹幕被限速：' + etxt, 'danmu');
                return { status: 'fail', reason: '发送过快，重试 3 次仍被限速' };
              }
              Log.warn('弹幕', '房间 ' + roomId + ' 发送过快，5 秒后重试表情');
              if (!(await Engine.taskSleep(5000, meta, 'danmu'))) return { status: 'halt', reason: '任务已停止' };
              continue;
            }
            /* 网络类错误（请求异常）：不是表情的问题，本条走文字，下一条继续试表情 */
            if (!je || je.net) {
              Log.warn('弹幕', '房间 ' + roomId + ' 表情请求失败（' + (etxt || '网络错误') + '），本条改用文字');
              break;
            }
            /* 其余失败（未解锁、已下架、无权限等）按「表情本身不可用」处理：
               本次调用改用文字，下一次调用仍从表情开始 */
            useEmote = false;
            emoteCache.delete(String(roomId));
            Log.warn('弹幕', '房间 ' + roomId + ' 表情不可用（' + (etxt || ('code ' + (je && je.code))) + '），本次改用文字弹幕');
            break;
          }
          if (Engine.runId !== runId) return { status: 'halt', reason: '引擎已重启' };
        }

        /* ② 表情没发出去，用文字兜底（原有重试逻辑） */
        if (!sentOk) {
          for (let tryN = 0; tryN < 4 && !sentOk && Engine.running && Engine.runId === runId; tryN++) {
            /* 风控冷却期间先等一等，别硬撞 */
            if (Net.blocked() && !(await Engine.taskSleep(Math.min(Net.blockedLeft() + 800, 20000), meta, 'danmu'))) return { status: 'halt', reason: '房间任务开关已关闭' };
            const msg = list[(idx++) % list.length];
            let j = null;
            try {
              j = await API.sendDanmu(roomId, msg);
            } catch (e) {
              j = { code: -1, message: e.message || '网络错误' };
            }
            const code = Number(j && j.code);
            if (code === 0 && (j.msg === '' || j.msg == null)) {
              sentOk = true;
              okCount++;
              Daily.add(meta, 'danmu', 1);
              Engine.touch();
              break;
            }
            const txt = String((j && (j.message || j.msg)) || '');
            if (/禁言|禁止发言|无权限|没有权限|权限不足|等级不足/.test(txt)) {
              if (Engine.running) Daily.setErr(meta, '弹幕被拒绝：' + txt, 'danmu');
              return { status: 'blocked', reason: txt };
            }
            if (/频率|太快|频繁|稍后再/.test(txt)) {
              /* 与表情一致：限速只等 5 秒重试，不换类型 */
              const wait = 5;
              Log.warn('弹幕', '房间 ' + roomId + ' 发送过快，等 ' + wait + ' 秒再试');
              if (!(await Engine.taskSleep(wait * 1000, meta, 'danmu'))) return { status: 'halt', reason: '任务已停止' };
              continue;
            }
            if (code === 0 && j.msg === 'k') {
              Log.warn('弹幕', '房间 ' + roomId + ' 弹幕可能含屏蔽词：' + msg);
            } else if (code === 0 && j.msg === 'f') {
              Log.warn('弹幕', '房间 ' + roomId + ' 弹幕被过滤：' + msg);
            } else {
              Log.warn('弹幕', '房间 ' + roomId + ' 发送失败：' + (txt || ('code ' + code)));
            }
            if (!(await Engine.taskSleep(rand(2500, 6000), meta, 'danmu'))) return { status: 'halt', reason: '房间任务开关已关闭' };
          }
        }

        if (!sentOk) {
          if (Engine.running) Daily.setErr(meta, '弹幕发送失败', 'danmu');
          return { status: 'fail', reason: '弹幕连续发送失败' };
        }
        if (i < need - 1 && !(await Engine.taskSleep(rand(Number(Cfg.v.danmu.gapMin) || 6, Number(Cfg.v.danmu.gapMax) || 14) * 1000, meta, 'danmu'))) return { status: 'halt', reason: '房间任务开关已关闭' };
      }

      if (!Engine.taskOn(meta, 'danmu')) return { status: 'halt', reason: '房间任务开关已关闭' };
      /* 刷新/停止后本轮次已作废：不要把结果写到新一轮头上 */
      if (Engine.runId !== runId) return { status: 'halt', reason: '引擎已重启' };

      const t2 = await Data.tasks(meta.uid, true);
      const done = t2.ok && isTaskDone(findTaskInfo(t2.tasks, 'sendDanmu'));
      /* 本次计划的条数已经发完就算完成：自定义上限低于服务端任务条数时，
         服务端当然不会 is_done（截图里的「5/5 ✓ + 红字」就是这么来的）。
         超上限模式还要看实际进度是否到了设置值 */
      const reachedLimit = o.maxCount > 0 && need > 0 && okCount >= need;
      const reachedTarget = !over || (o.maxCount > 0 && Engine.progressOf(meta, 'danmu').cur >= o.maxCount);
      if ((done || reachedLimit) && reachedTarget) {
        Daily.done(meta, 'danmu', true);
        Log.ok('弹幕', '房间 ' + roomId + (done
          ? ' 弹幕任务已完成'
          : ' 已做到本房间上限 ' + o.maxCount + ' 条（服务端任务还有剩余，明天继续）') + '（本次 ' + okCount + ' 条）');
        return { status: 'done', sent: okCount };
      }
      return { status: 'fail', reason: '已发送 ' + okCount + ' 条但任务未完成', sent: okCount };
    },

    /* 分享直播间：App 粉丝团第 6 项任务，每个房间每日 1 次、亲密度 +2。
       服务端没有查询接口，只能靠前后对比判断。三个指标依次尝试：
         ① today_feed（今日亲密度）—— 最准，但储蓄模式的牌子拿不到这个字段
         ② intimacy（当前亲密度）—— 储蓄模式下仍然有，可作为兜底
         ③ free_intimacy（已储蓄亲密度）—— 收益进了储蓄池时靠它
       任意一项上涨即算成功；三项都读不到才判「待确认」。 */
    async share(meta) {
      const key = String(meta.roomId);
      if (sharePending.has(key)) return { status: 'halt', reason: '分享正在处理，跳过重复调用' };
      sharePending.add(key);
      try {
        return await this._share(meta);
      } finally {
        sharePending.delete(key);
      }
    },

    async _share(meta) {
      const roomId = meta.roomId;
      /* 每天只有一次机会：接口调用过就不再重复调用。
         以前只在内存里 park「待确认」，刷新插件就忘了，会把已分享过的房间再调一遍 */
      const rec0 = Daily.get(meta);
      if (rec0.shareTried) {
        return { status: 'defer', reason: '今日已调用过分享，不再重复' };
      }
      const medal = Data.medalByUid(meta.uid) || Data.medalOf(roomId);
      if (!medal || !medal.medal) {
        /* 没有这枚牌子，分享也涨不到亲密度 */
        return { status: 'na', reason: '该直播间不在你的粉丝牌里，分享不产生亲密度' };
      }
      const snap = (it) => {
        const m = (it && it.medal) || {};
        return {
          hasToday: m.today_feed != null,
          today: Number(m.today_feed) || 0,
          intimacy: Number(m.intimacy) || 0,
          level: Number(m.level) || 0
        };
      };
      /* 取基准前先刷一次：同房间的点赞/点亮可能刚刚加了亲密度，
         用旧缓存取基准会把它们的收益算到分享头上 */
      await Data.refreshMedals(true);
      const fresh = Data.medalByUid(meta.uid) || Data.medalOf(roomId);
      if (!fresh || !fresh.medal) {
        return { status: 'na', reason: '该直播间不在你的粉丝牌里，分享不产生亲密度' };
      }
      const before = snap(fresh);
      const t0 = await Data.tasks(meta.uid);
      const freeBefore = (t0 && t0.ok) ? (Number(t0.free) || 0) : 0;

      let j = null;
      try {
        j = await API.shareConf(roomId);
      } catch (e) {
        return { status: 'defer', reason: '分享接口异常：' + (e.message || '网络错误') };
      }
      const code = Number(j && j.code);
      if (j && code !== 0) {
        return { status: 'defer', reason: '分享接口返回 ' + code + ' ' + ((j && j.message) || '') };
      }

      /* 接口已经调用成功，立刻落盘「今日已尝试」：即使接下来读不到变化，
         或者中途刷新插件，也不会再调用第二次 */
      const recTry = Daily.get(meta);
      recTry.shareTried = true;
      recTry.shareTryAt = nowMs();
      Daily.save();   /* 立即落盘：这期间刷新插件或关页面也不能丢 */

      /* 服务端的数值不是立刻可见的：等 2 秒读一次，没变化再等 3 秒读一次。 */
      let gain = 0;
      let how = '';
      for (let i = 0; i < 2 && !gain; i++) {
        await sleep(i === 0 ? rand(2000, 2600) : 3000);
        await Data.refreshMedals(true);
        const after = snap(Data.medalByUid(meta.uid) || Data.medalOf(roomId));
        if (before.hasToday && after.hasToday) {
          const d1 = after.today - before.today;
          if (d1 > 0) { gain = d1; how = '今日亲密度'; break; }
        }
        const d2 = after.intimacy - before.intimacy;
        if (d2 > 0) { gain = d2; how = '总亲密度'; break; }
        /* 亲密度倒退且等级提升 = 刚好升级，说明确实涨了 */
        if (d2 < 0 && after.level > before.level) { gain = 2; how = '等级提升'; break; }
      }

      /* 前两项都不动：收益可能直接进了储蓄池 */
      if (!gain) {
        const t2 = await Data.tasks(meta.uid, true);
        if (t2 && t2.ok) {
          const d3 = (Number(t2.free) || 0) - freeBefore;
          if (d3 > 0) { gain = d3; how = '储蓄亲密度'; }
        }
      }

      if (gain > 0) {
        const r = Daily.get(meta);
        r.shareGain = (Number(r.shareGain) || 0) + gain;
        Daily.done(meta, 'share', true);
        Daily.saveSoon();
        Log.ok('分享', '房间 ' + roomId + ' 分享完成，' + how + ' +' + gain);
        return { status: 'done', gain: gain, how: how };
      }
      /* 接口通了但三项指标都没动：可能是今天已经分享过，也可能没被计入。
         不写 done，避免出现「显示完成但其实没完成」。
         「今日已尝试」已在调用成功后记下，这里只补一条短日志 */
      Log.warn('分享', '房间 ' + roomId + ' 分享已调用，未检测到亲密度变化（今天可能已分享过），今日不再尝试');
      return { status: 'defer', reason: '接口已调用但三项指标均未变化，今日不再尝试' };
    },

    /* 点亮熄灭勋章：开播 -> 点赞点亮，未开播 -> 发弹幕点亮 */
    async light(meta) {
      const roomId = meta.roomId;
      let medal = Data.medalByUid(meta.uid) || Data.medalOf(roomId);
      if (!medal) {
        await Data.refreshMedals(true);
        medal = Data.medalByUid(meta.uid) || Data.medalOf(roomId);
      }
      if (!medal) {
        /* 索引里没有这枚牌子。可能是粉丝牌列表被截断，也可能账号确实没有该粉丝牌。
           只认服务端返回的 medal_info，不再用「任务列表里有投喂灯牌」反推可以点亮：
           投喂灯牌是每个主播都有的日常任务，和账号是否持有这枚牌子无关，
           以前这条推断会让没有牌子的房间每天白发一条弹幕，然后一直重试。 */
        const t0 = await Data.tasks(meta.uid);
        const f = (t0 && t0.flag) || {};
        Log.warn('点亮', '房间 ' + roomId + '（uid ' + meta.uid + '）不在粉丝牌索引里：粉丝牌共 ' + Data.count +
          ' 个；GetActivatedMedalInfo 字段 ' + ((t0 && t0.keys) || []).join(',') +
          '；medal 字段 ' + (t0 && t0.medal ? JSON.stringify(t0.medal).slice(0, 160)
            : '无（data.level=' + f.level + '，medal_name="' + (f.medalName || '') + '"，is_lighted=' + f.isLighted + '）'));

        if (t0 && t0.medal) {
          /* 面板里没有但服务端给了：补进索引，后续渲染与多次判定都用得上 */
          medal = Data.putMedal(meta.uid, roomId, t0.medal) || { medal: t0.medal, room_info: { room_id: roomId } };
          Log.log('点亮', '房间 ' + roomId + ' 的粉丝牌信息取自服务端（粉丝牌面板里没有这一枚）');
        } else if (Data.medals.size > 0) {
          return { status: 'na', reason: '该直播间不在你的粉丝牌里，需先投喂获得粉丝牌' };
        } else {
          return { status: 'fail', reason: '粉丝牌数据未加载' };
        }
      }
      if (Number(medal.medal.is_lighted) === 1) {
        Daily.done(meta, 'light', true);
        return { status: 'done', reason: '勋章已点亮' };
      }
      Log.log('点亮', '房间 ' + roomId + ' 勋章未点亮，' + (meta.liveStatus === 1 ? '通过点赞点亮' : '通过弹幕点亮'));

      let res;
      if (meta.liveStatus === 1) res = await this.like(meta, { rounds: 1, force: true });
      else {
        /* 未开播：发弹幕点亮。条数取服务端任务要求（例如「发送10条弹幕」就要发满 10 条），
           以前截断成最多 3 条，任务永远差几条，点亮会一直失败 */
        let need = 1;
        const t0 = await Data.tasks(meta.uid);
        if (t0.ok) {
          const it = findTaskInfo(t0.tasks, 'sendDanmu');
          const lim = it ? parseDailyLimit(it.sub_title) : null;
          const n = it ? (parseTitleCount(it.title) || (lim && lim.limit)) : null;
          if (n) need = Math.min(10, n);
        }
        res = await this.danmu(meta, { count: need, force: true });
      }

      /* 点亮状态由服务端异步更新：先刷一次，没变化就等几秒再确认一次，
         避免「其实已经点亮、只是面板还没刷新」被误判成失败 */
      await Data.refreshMedals(true);
      let after = Data.medalByUid(meta.uid) || Data.medalOf(roomId);
      if (!after || Number(after.medal.is_lighted) !== 1) {
        await sleep(rand(2000, 3200));
        await Data.refreshMedals(true);
        after = Data.medalByUid(meta.uid) || Data.medalOf(roomId);
      }
      if (after && Number(after.medal.is_lighted) === 1) {
        Daily.done(meta, 'light', true);
        Daily.add(meta, 'light', 1);
        Log.ok('点亮', '房间 ' + roomId + ' 勋章已点亮');
        return { status: 'done' };
      }
      if (res.status === 'halt') return { status: 'halt', reason: res.reason };
      if (res.status === 'na') return { status: 'na', reason: res.reason };
      /* 实测：没关注主播时，即使持有粉丝牌、弹幕任务也做满，仍然点不亮。
         失败原因优先写这个，红字才说得清 */
      let reason = '仍未点亮';
      if (meta.uid) {
        try {
          const attr = await API.relation(meta.uid);
          const n = attr == null ? null : Number(attr);
          if (n != null && n !== 2 && n !== 6) reason = '未关注主播';
        } catch (e) { /* ignore */ }
      }
      return { status: 'fail', reason: reason };
    },

    /* 观看直播：E/X 心跳累计观时 */
    async watch(meta, opts) {
      const o = opts || {};
      const roomId = meta.roomId;
      const t = await Data.tasks(meta.uid);
      if (!t.ok) return { status: 'fail', reason: '任务信息读取失败：' + t.reason };
      const item = findTaskInfo(t.tasks, 'watchLive');
      if (!item) return { status: 'na', reason: '任务列表里没有观看任务' };
      const over = overServer('watch') && o.maxRounds != null && o.maxRounds > 0;
      if (isTaskDone(item) && !over) {
        Daily.done(meta, 'watch', true);
        return { status: 'done' };
      }
      const minutes = parseTitleCount(item.title) || Number(Cfg.v.watch.roundMinutes) || 15;
      const limit = parseDailyLimit(item.sub_title);
      /* 剩余轮次按实际进度算：服务端停在 5/5 时，本地可能已经多看了一轮 */
      const prog = Engine.progressOf(meta, 'watch');
      let needRounds = limit ? Math.max(0, limit.limit - prog.cur) : 1;
      if (o.maxRounds != null && o.maxRounds > 0) {
        const bySetting = Math.max(0, o.maxRounds - prog.cur);
        needRounds = over ? bySetting : Math.min(needRounds, bySetting);
      }
      if (needRounds <= 0) {
        Daily.done(meta, 'watch', true);
        return { status: 'done' };
      }
      if (over && isTaskDone(item)) logOverOnce(meta, 'watch', o.maxRounds, ' 轮');
      /* 本次会话会跨过服务端上限：基线落在服务端还能计入的轮次之后 */
      if (over && limit && limit.limit > 0 && limit.current < limit.limit && limit.current + needRounds >= limit.limit) {
        const rr = Daily.get(meta);
        if (!rr.overBase.watch || Number(rr.overBase.watch.srv) < limit.limit) {
          Engine.markOverBase(meta, 'watch', limit.limit,
            (Number(rr.watch) || 0) + (limit.limit - limit.current) * minutes * 60);
        }
      }
      const targetSec = needRounds * minutes * 60;

      if (!meta.areaId || !meta.parentAreaId) {
        const info = await API.roomInfo(roomId);
        if (info) {
          meta.areaId = info.areaId;
          meta.parentAreaId = info.parentAreaId;
          meta.liveStatus = info.liveStatus;
          meta.uname = meta.uname || info.uname;
          Data.putRoom(meta);
        }
      }
      if (!meta.areaId || !meta.parentAreaId) return { status: 'fail', reason: '缺少分区信息，无法发送心跳' };

      /* 同一房间同时只允许一个心跳会话，否则服务端会因 seq 交错而不计时 */
      if (!Engine.watchGuard) Engine.watchGuard = new Map();
      if (Engine.watchGuard.has(String(roomId))) {
        Log.warn('观时', '房间 ' + roomId + ' 已有观时在进行，跳过重复启动');
        return { status: 'defer', reason: '该房间已有观时在进行' };
      }
      Engine.watchGuard.set(String(roomId), nowMs());

      Log.log('观时', '房间 ' + roomId + ' 开始观看任务，目标 ' + Math.round(targetSec / 60) + ' 分钟');
      /* 图表上的「目标」用当日总轮次（含已完成），而不是剩余轮次 */
      Data.setWatchTarget(meta, limit ? limit.limit * minutes * 60 : targetSec, limit ? limit.limit : 1, minutes);

      /* 今日观时按每次心跳增量落盘，界面不必等 15 分钟跑完才更新 */
      const baseSec = Number(Daily.get(meta).watch) || 0;
      /* 记下重置代号：用户在会话进行中点「重置今日记录」后，这里不能再把旧累计写回去 */
      const gen = Daily.gen;
      const heart = new RoomHeart(meta, targetSec);
      const slot = { roomId: roomId, total: targetSec, done: 0, startedAt: nowMs(), heart: heart };
      Engine.watches.push(slot);
      heart.onProgress = (h) => {
        if (Daily.gen !== gen) return;
        slot.done = Math.round(h.watched);
        const r = Daily.get(meta);
        const total = baseSec + slot.done;
        if (total > (Number(r.watch) || 0)) {
          r.watch = total;
          Daily.saveSoon();
        }
        Engine.touch();
      };
      Engine.activeWatch = slot;

      let result;
      try {
        result = await heart.run();
      } finally {
        const idx = Engine.watches.indexOf(slot);
        if (idx >= 0) Engine.watches.splice(idx, 1);
        if (Engine.activeWatch === slot) Engine.activeWatch = null;
        if (Engine.watchGuard) Engine.watchGuard.delete(String(roomId));
      }

      /* 会话期间用户重置过今日记录：本次累计已作废，不再写回 */
      if (Daily.gen === gen) {
        const rw = Daily.get(meta);
        rw.watch = Math.max(Number(rw.watch) || 0, baseSec + (result.seconds || 0));
        Daily.save();
      }
      Engine.touch();

      /* 用户点停止 / 刷新页面 / 切换主控：引擎已停或已换轮次。
         这时「没看满目标时长」是预期行为，不能算失败，也不该再去拉一次接口 */
      if (!Engine.running || heart.gen !== Engine.runId) {
        Log.log('观时', '房间 ' + roomId + ' 会话被停止（已看 ' + Math.round(result.seconds) + ' 秒），本次不判定结果');
        return { status: 'halt', reason: '引擎已停止' };
      }

      /* 房间开关被关掉时主动停止会话：不记失败，也不继续重试 */
      if (!Engine.taskOn(meta, 'watch')) {
        Log.log('观时', '房间 ' + roomId + ' 的观时开关已关闭，本次中断');
        return { status: 'halt', reason: '房间任务开关已关闭' };
      }

      const t2 = await Data.tasks(meta.uid, true);
      /* 最后一次对账期间可能被刷新/停止：旧轮次不能写完成 */
      if (heart.gen !== Engine.runId) {
        Log.log('观时', '房间 ' + roomId + ' 对账期间引擎已重启，本次结果作废');
        return { status: 'halt', reason: '引擎已重启' };
      }
      const done = t2.ok && isTaskDone(findTaskInfo(t2.tasks, 'watchLive'));
      /* 超上限时以实际进度为准：服务端 is_done 只代表做到了服务端上限 */
      const reachedTarget = !over || (o.maxRounds > 0 && Engine.progressOf(meta, 'watch').cur >= o.maxRounds);
      /* 本次会话已经看满目标时长（自定义上限低于服务端剩余轮次时，服务端不会 is_done），
         按当天完成处理，不写红字 */
      const reachedPlan = !!result.ok && o.maxRounds > 0;
      if ((done || reachedPlan) && reachedTarget) {
        Daily.done(meta, 'watch', true);
        Log.ok('观时', '房间 ' + roomId + (done
          ? ' 观看任务已完成'
          : (over ? ' 已做到设置上限 ' + o.maxRounds + ' 轮（超出部分不计亲密度）'
            : ' 已做到本房间上限 ' + o.maxRounds + ' 轮（服务端任务还有剩余，明天继续）')) +
          '（累计 ' + Math.round(result.seconds / 60) + ' 分钟）');
        return { status: 'done', seconds: result.seconds };
      }
      if (!result.ok) {
        if (result.drift) {
          /* 后台节流导致的时间戳失效：属于预期情况，不写红字，交给泳道稍后重试 */
          return { status: 'fail', quiet: true, reason: '心跳时间戳多次失效（后台节流）' };
        }
        if (Engine.running) Daily.setErr(meta, '心跳中断', 'watch');
        return { status: 'fail', reason: '心跳中断，累计 ' + result.seconds + ' 秒' };
      }
      return { status: 'fail', reason: '累计 ' + result.seconds + ' 秒但任务未完成' };
    }
  };

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
      /* 撞过每房间点赞保护上限：设置值和保护上限都没放宽，今天就是做不到，
         继续按「未做满」重排只会每 2 秒重试一次、刷一行日志 */
      const co = Daily.get(meta).capOut[name];
      if (co && target <= (Number(co.target) || 0) &&
        (Number(Cfg.v.like.capClicks) || 310) <= (Number(co.cap) || 0)) return false;
      return this.progressOf(meta, name).cur < target;
    },

    /* 记下「今天撞到每房间点赞保护上限」。返回 true 表示第一次记录，
       调用方据此只打一条日志；用户之后调高 capClicks 或降低设置值时，keepOverflow 会忽略它 */
    noteCapOut(meta, name, target, cap) {
      if (!meta) return false;
      const r = Daily.get(meta);
      const prev = r.capOut[name];
      r.capOut[name] = { target: Math.round(Number(target) || 0), cap: Math.round(Number(cap) || 0) };
      Daily.saveSoon();
      return !prev;
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

    /* 储蓄亲密度已满：观时与分享不再产生收益（点赞/弹幕仍算今日互动，可维持点亮） */
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
        this.taskOn(meta, name) && !(full && (name === 'watch' || name === 'share')) &&
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
      /* 满储：观时与分享不再产生收益，直接跳过（点亮/点赞/弹幕保留） */
      if (this.isFreeFull(meta) && (name === 'watch' || name === 'share')) return 'skip';
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
          if (meta && this.isFreeFull(meta) && (name === 'watch' || name === 'share')) return 'skip';
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
          '<span class="bma-muted">观时任务仍可正常执行；若同时在其它标签页观看直播，会占用账号的并发额度。批量执行与日志见上方页签。</span></div>';
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
      /* 上限与超限规则只在「任务开关」解释一次，各任务卡片不再重复 */
      const overRow = (name) => switchRow('允许超过服务端上限', 'taskLimit.brk.' + name, brk(name),
        lim(name) > 0 ? '' : '需要先填写上限', lim(name) <= 0);
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
        '<div class="bma-muted">总开关；单个直播间可在看板「任务开关」里单独关闭，调小后做到该值即视为当天完成。每日上限留空 = 跟随 B 站上限；关闭「允许超过服务端上限」时，超出 B 站上限的部分不计亲密度，只增加风控风险。</div>'
      ));

      out.push(sec('点亮熄灭勋章',
        '<div class="bma-muted">开播中通过点赞点亮；未开播通过弹幕点亮。未关注主播无法点亮。</div>'
      ));

      out.push(sec('点赞',
        limitRow('每日点赞上限（轮）', 'taskLimit.like', lim('like')) +
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
        '<div class="bma-muted">保护上限是硬限制：即使任务上限设得更高，到了这里也会停止。</div>'
      ));

      out.push(sec('发弹幕',
        limitRow('每日弹幕上限（条）', 'taskLimit.danmu', lim('danmu')) +
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
        '<div class="bma-muted">发送过快时等待 5 秒重试，最多 3 次。</div>'
      ));

      const watchCap = Engine.effectiveWatchParallel();
      out.push(sec('观看直播',
        limitRow('每日观时上限（轮）', 'taskLimit.watch', lim('watch')) +
        overRow('watch') +
        switchRow('看板显示「观时 n/m」', 'taskLimit.show.watch', showNum('watch')) +
        switchRow('仅对开播中的直播间执行观时', 'watch.requireLive', v.watch.requireLive, '未开播的直播间同样可以记录观时；开启后只挂开播中的房间') +
        switchRow('记录观时心跳日志', 'watch.logHeartbeat', v.watch.logHeartbeat, '每次心跳成功后写入一条日志') +
        switchRow('切到后台时继续观时', 'watch.bgContinue', v.watch.bgContinue, '开启（默认）：后台继续发送，浏览器会降频，可能变慢；关闭：后台暂停心跳，回到前台自动续挂') +
        switchRow('并行执行多个直播间的观时', 'watch.multiRoom', v.watch.multiRoom, '实测同一账号同一时间只记录一个直播间的观时；开启后会向多个房间发送心跳，只会增加风控概率') +
        numberRow('最大并行直播间数' + (v.watch.multiRoom ? '' : '（未启用，固定为 1）'), 'watch.multiRoomMax', v.watch.multiRoom ? Math.max(1, Number(v.watch.multiRoomMax) || 2) : 1, 1, 999, 1, !v.watch.multiRoom) +
        '<div class="bma-muted">脚本当前并发：运行中 ' + Engine.watches.length + ' 路（上限 ' + watchCap + ' 路）。</div>'
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

