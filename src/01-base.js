// ==UserScript==
// @name         bilibili粉丝团任务工具
// @name:en      bili-medal-autopilot
// @namespace    https://github.com/kuru7m1
// @version      1.0.0
// @description  白名单批量完成B站直播粉丝团任务（点亮熄灭勋章/点赞/发弹幕/观看直播）+ 亲密度面板 + 直播体验优化
// @description:en  Batch complete Bilibili live fan-medal tasks for whitelisted rooms, intimacy panel and live UX tweaks.
// @author       kuru7m1
// @license      MIT
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
  const VERSION = '1.0.0';

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
