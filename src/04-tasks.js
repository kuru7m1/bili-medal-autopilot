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
