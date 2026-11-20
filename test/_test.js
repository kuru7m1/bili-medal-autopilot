/* 本地自测：在 Node 里用最小 DOM 桩跑一遍脚本，验证语法之外的运行期引用与渲染函数 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.resolve(__dirname, '..', 'bili-medal-autopilot.user.js');
if (!fs.existsSync(FILE)) {
  console.error('找不到构建产物：' + FILE);
  console.error('请先运行：pwsh -File .\\build.ps1');
  process.exit(1);
}
let code = fs.readFileSync(FILE, 'utf8');

/* 在 IIFE 结尾暴露内部对象供测试（不写入交付文件） */
const marker = '})();';
const idx = code.lastIndexOf(marker);
if (idx < 0) throw new Error('未找到 IIFE 结尾');
const expose = `
  try {
    globalThis.__TEST__ = {
      Crypto, Wbi, API, Net, Cfg, Daily, Data, Engine, UI, Actions, Auth, Wbi,
      parseDailyLimit, parseRoomInput, parseTitleCount, findTaskInfo, medalFromFlat, currentPageRoomId,
      Tabs, RoomView, ListView, LogView, SetView, TASK_NAME, hms, clock, Enhance,
      Tasks, RoomHeart, Notify, Leader, Log, pickUsableEmotes, roomTaskOn, watchDriftTooLarge
    };
  } catch (e) { globalThis.__EXPOSE_ERROR__ = e; }
`;
code = code.slice(0, idx) + expose + code.slice(idx);

/* ---------------- 最小 DOM 桩 ---------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this._attrs = {};
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.classList = {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c; }
  insertBefore(c, ref) { this.children.push(c); if (c) c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 430, bottom: 580, width: 430, height: 580 }; }
  get offsetWidth() { return 430; }
  get offsetHeight() { return 580; }
  get offsetLeft() { return 20; }
  get offsetTop() { return 80; }
}

const doc = new El('document');
doc.documentElement = new El('html');
doc.head = new El('head');
doc.body = new El('body');
doc.createElement = (t) => new El(t);
doc.getElementById = () => null;
doc.querySelector = () => null;
doc.querySelectorAll = () => [];
doc.addEventListener = () => {};
doc.removeEventListener = () => {};
doc.cookie = 'DedeUserID=12345; bili_jct=testcsrf; LIVE_BUVID=XY1234567890';
doc.visibilityState = 'visible';
doc.hidden = false;
doc.hasFocus = () => true;

const storage = new Map();
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => { storage.set(k, String(v)); },
  removeItem: (k) => { storage.delete(k); }
};

const fetchStub = async () => ({
  ok: true,
  status: 200,
  text: async () => '{"code":0,"data":{}}'
});

const win = globalThis;
win.window = win;
win.document = doc;
win.localStorage = localStorageStub;
win.fetch = fetchStub;
win.location = { pathname: '/12345', href: 'https://live.bilibili.com/12345', search: '', hash: '' };
win.addEventListener = () => {};
win.removeEventListener = () => {};
win.prompt = () => '999';
win.innerWidth = 1600;
win.innerHeight = 900;
win.Notification = undefined;
win.AbortController = AbortController;

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name + ' -> ' + (e && e.message ? e.message : e)]);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || '不相等') + '：' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); }
/* 当天日期串：清空今日记录时要保留 date，否则 Engine.tick 的跨天检查会把房间记录再清一次 */
function todayOf() {
  const x = new Date();
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

/* ---------------- 运行脚本 ---------------- */
let evalError = null;
try {
  vm.runInThisContext(code, { filename: FILE });
} catch (e) {
  evalError = e;
}

if (evalError) {
  console.log('脚本执行抛错：', evalError && evalError.stack);
  process.exitCode = 1;
  return;
}

const T = win.__TEST__;
/* 真实分页实现：后续用例会覆盖 T.API.allMedals，先留一份引用给分页测试用 */
const realAllMedals = T.API.allMedals;
if (!T) {
  console.log('未能暴露内部对象：', win.__EXPOSE_ERROR__ && win.__EXPOSE_ERROR__.stack);
  process.exitCode = 1;
  return;
}

/* ---------------- 单元测试 ---------------- */
check('MD5 标准向量 abc', () => {
  assertEq(T.Crypto.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
});
check('MD5 空串', () => {
  assertEq(T.Crypto.md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
});
check('MD5 中文 UTF-8', () => {
  assertEq(T.Crypto.md5('中文'), 'a7bac2239fcdcb3a067903d8077c4a07');
});
check('HMAC-MD5 标准向量', () => {
  assertEq(T.Crypto.hmacMd5Hex('key', 'The quick brown fox jumps over the lazy dog'), '80070713463e7749b90c2dc24911e275');
});
check('parseDailyLimit', () => {
  const r = T.parseDailyLimit('3/10');
  assertEq(r.current, 3);
  assertEq(r.limit, 10);
  assertEq(T.parseDailyLimit('无'), null);
});
check('parseTitleCount', () => {
  assertEq(T.parseTitleCount('每30次点赞'), 30);
  assertEq(T.parseTitleCount('无数字'), null);
});
check('parseRoomInput 房间号', () => {
  assertEq(T.parseRoomInput('12345').value, 12345);
  assertEq(T.parseRoomInput('12345').type, 'room');
});
check('parseRoomInput 链接', () => {
  assertEq(T.parseRoomInput('https://live.bilibili.com/22637261?spm=x').value, 22637261);
  assertEq(T.parseRoomInput('live.bilibili.com/blanc/12345').value, 12345);
});
check('parseRoomInput uid', () => {
  assertEq(T.parseRoomInput('uid:672328094').type, 'uid');
  assertEq(T.parseRoomInput('uid:672328094').value, 672328094);
});
check('粉丝牌：接口平铺返回时也能识别出牌子', () => {
  const flat = T.medalFromFlat({ medal_name: '火羽', level: 3, is_lighted: 0, intimacy: 120, next_intimacy: 500 }, 2094031249);
  assert(!!flat, '平铺字段应识别为持有粉丝牌');
  assertEq(flat.target_id, 2094031249);
  assertEq(flat.level, 3);
  assertEq(T.medalFromFlat({ medal_name: '', level: 0, is_lighted: 0 }, 1), null, '没有牌子时不应误判');
  assertEq(T.medalFromFlat(null, 1), null);
});
check('WBI 签名格式', () => {
  T.Wbi.mixin = 'TESTMIXIN';
  const q = T.Wbi.sign({ b: 2, a: 1 });
  assert(/^a=1&b=2&wts=\d+&w_rid=[0-9a-f]{32}$/.test(q), q);
  const raw = q.replace(/&w_rid=[0-9a-f]{32}$/, '');
  assertEq(q.slice(-32), T.Crypto.md5(raw + 'TESTMIXIN'));
  T.Wbi.mixin = '';
});
check('Cfg / Daily 基本读写', () => {
  T.Cfg.load();
  assert(Array.isArray(T.Cfg.v.whitelist));
  T.Daily.load();
  const r = T.Daily.get('123');
  assertEq(r.like, 0);
  T.Daily.add('123', 'like', 5);
  assertEq(T.Daily.get('123').like, 5);
  T.Daily.done('123', 'like', true);
  assert(T.Daily.isDone('123', 'like'));
});
check('配置：表情弹幕默认开启', () => {
  const prev = win.localStorage.getItem('bma.config.v1');
  win.localStorage.removeItem('bma.config.v1');
  T.Cfg.load();
  assertEq(T.Cfg.v.danmu.useRoomEmoticons, true, '表情弹幕应默认开启');
  if (prev == null) win.localStorage.removeItem('bma.config.v1');
  else win.localStorage.setItem('bma.config.v1', prev);
  T.Cfg.load();
});
check('表情分类：只认本直播间的专属/粉丝团/大航海/充电', () => {
  const meta = { roomId: 7201, uid: 7201 };
  const pkgs = [
    { pkg_type: 1, pkg_name: '通用表情', emoticons: [{ emoticon_unique: 'official_1', emoji: '狗头', perm: 1 }] },
    { pkg_type: 3, pkg_name: 'emoji', emoticons: [{ emoticon_unique: 'emoji_208', emoji: '[dog]', perm: 1 }] },
    {
      pkg_type: 2,
      pkg_name: '房间专属表情',
      emoticons: [{ emoticon_unique: 'room_7201_1', emoji: '好耶', url: 'u1', perm: 1 }]
    },
    {
      pkg_type: 2,
      pkg_name: 'UP主大表情',
      emoticons: [
        { emoticon_unique: 'room_7201_2', emoji: '粉丝团1', perm: 1, unlock_show_text: '粉丝团', unlock_need_level: 1, unlock_need_gift: 31164 },
        { emoticon_unique: 'room_7201_3', emoji: '粉丝团2', perm: 0, unlock_show_text: '粉丝团', unlock_need_level: 2 },
        { emoticon_unique: 'room_7201_4', emoji: '舰长', perm: 1, unlock_show_text: '大航海' },
        { emoticon_unique: 'upower_[UPOWER_7201_x]', emoji: '充电', perm: 1 }
      ]
    },
    {
      /* 2026-10-30 新增的装扮表情：账号自选的 B 站装扮，不属于本直播间 */
      pkg_type: 5,
      pkg_name: '装扮表情',
      emoticons: [{ emoticon_unique: 'upower_[酷仔]', emoji: '酷仔', perm: 1 }, { emoticon_unique: 'upower_[赞了]', emoji: '赞了', perm: 1 }]
    },
    {
      /* 类型未知的包只能靠标识判断，room_9999_ 不是本房间，应排除 */
      pkg_type: 0,
      pkg_name: '未知包',
      emoticons: [{ emoticon_unique: 'room_9999_1', emoji: '别的主播', perm: 1 }]
    },
    {
      /* pkg_type=2 属于本房间的表情包：即使标识不是 room_<房间号>_ 前缀也要收下，
         实测有房间的专属表情标识格式不同，只按前缀会一个都取不到 */
      pkg_type: 2,
      pkg_name: '房间专属表情',
      emoticons: [{ emoticon_unique: 'emoticon_888', emoji: '旧格式', perm: 1 }]
    }
  ];
  const list = T.pickUsableEmotes(pkgs, meta);
  const uniq = list.map((x) => x.emoticon_unique);
  assertEq(uniq.indexOf('official_1'), -1, '官方通用表情不应纳入');
  assertEq(uniq.indexOf('emoji_208'), -1, '官方小表情（pkg_type=3）不应纳入');
  assertEq(uniq.indexOf('upower_[酷仔]'), -1, '装扮表情不应纳入');
  assertEq(uniq.indexOf('room_9999_1'), -1, '其他直播间的表情不应纳入');
  assert(uniq.indexOf('emoticon_888') >= 0, 'pkg_type=2 的表情包应整体纳入，不看标识前缀');
  assertEq(uniq.indexOf('room_7201_3'), -1, 'perm=0 的未解锁表情不应纳入');
  assert(uniq.indexOf('room_7201_1') >= 0, '房间专属表情应纳入');
  assert(uniq.indexOf('room_7201_2') >= 0, '已解锁的粉丝团表情应纳入（带灯牌礼物 id 也不能排除）');
  assertEq(list.find((x) => x.emoticon_unique === 'room_7201_1').tier, 'room', '房间专属分类错误');
  assertEq(list.find((x) => x.emoticon_unique === 'room_7201_2').tier, 'fans', '粉丝团分类错误');
  assertEq(list.find((x) => x.emoticon_unique === 'room_7201_4').tier, 'guard', '大航海分类错误');
  assertEq(list.find((x) => x.emoticon_unique.indexOf('UPOWER_7201') > 0).tier, 'charge', '充电分类错误');
  assertEq(T.pickUsableEmotes(null, meta).length, 0);
  /* 接口没给 perm 时退回解锁条件：等级 1 可用，高等级与大航海排除 */
  const noPerm = T.pickUsableEmotes([{
    pkg_type: 2,
    pkg_name: 'UP主大表情',
    emoticons: [
      { emoticon_unique: 'room_7201_5', emoji: 'a', unlock_need_level: 1 },
      { emoticon_unique: 'room_7201_6', emoji: 'b', unlock_need_level: 5 },
      { emoticon_unique: 'room_7201_7', emoji: 'c', unlock_show_text: '大航海' }
    ]
  }], meta);
  assertEq(noPerm.length, 1, '无 perm 时应按解锁条件推断，实际 ' + JSON.stringify(noPerm));
  assertEq(noPerm[0].emoticon_unique, 'room_7201_5');
});
check('配置：后台观时默认继续', () => {
  assertEq(T.Cfg.v.watch.bgContinue, true, '默认应继续');
});

check('观时心跳：迟到阈值按间隔计算', () => {
  /* interval=60：迟到 20 秒不算过期，30 秒算 */
  assertEq(T.watchDriftTooLarge(20000, 0, 60), false);
  assertEq(T.watchDriftTooLarge(30000, 0, 60), true);
  /* interval=30：阈值取 12 秒 */
  assertEq(T.watchDriftTooLarge(11000, 0, 30), false);
  assertEq(T.watchDriftTooLarge(13000, 0, 30), true);
  /* 最短 8 秒，避免极短间隔时阈值过小 */
  assertEq(T.watchDriftTooLarge(9000, 0, 10), true);
});

check('配置：分享任务默认开启', () => {
  const prev = win.localStorage.getItem('bma.config.v1');
  win.localStorage.removeItem('bma.config.v1');
  T.Cfg.load();
  assertEq(T.Cfg.v.tasks.share, true, '分享任务应默认开启');
  if (prev == null) win.localStorage.removeItem('bma.config.v1');
  else win.localStorage.setItem('bma.config.v1', prev);
  T.Cfg.load();
});
check('配置迁移：观时不再要求开播，清掉 whenWatching', () => {
  const prev = win.localStorage.getItem('bma.config.v1');
  win.localStorage.setItem('bma.config.v1', JSON.stringify({
    watch: { requireLive: true, whenWatching: 'pause', pauseWhenWatching: true, multiRoomMax: 3 }
  }));
  T.Cfg.load();
  assertEq(T.Cfg.v.watch.requireLive, false, '应迁移为不要求开播');
  assert(!Object.prototype.hasOwnProperty.call(T.Cfg.v.watch, 'whenWatching'), 'whenWatching 应被清掉');
  assert(!Object.prototype.hasOwnProperty.call(T.Cfg.v.watch, 'pauseWhenWatching'), 'pauseWhenWatching 应被清掉');
  assertEq(T.Cfg.v.watch.multiRoomMax, 3, '不应改动其他观时设置');
  /* 用户之后手动开启，再次加载不应被强制改回去 */
  T.Cfg.save();
  T.Cfg.v.watch.requireLive = true;
  T.Cfg.save();
  T.Cfg.load();
  assertEq(T.Cfg.v.watch.requireLive, true, '迁移只应生效一次');
  if (prev == null) win.localStorage.removeItem('bma.config.v1');
  else win.localStorage.setItem('bma.config.v1', prev);
  T.Cfg.load();
});
check('重置今日记录：代号递增，进行中的观时不再回写', () => {
  T.Daily.rooms = {};
  const meta = { roomId: 6101, uid: 6101 };
  T.Daily.get(meta).watch = 1800;
  const before = T.Daily.gen;
  T.Actions.resetDaily();
  assertEq(T.Daily.gen, before + 1, '重置应递增代号');
  assertEq(T.Daily.get(meta).watch, 0, '重置后累计观时应为 0');
});
check('配置：运行时改动不会污染默认值', () => {
  const prev = win.localStorage.getItem('bma.config.v1');
  win.localStorage.removeItem('bma.config.v1');
  T.Cfg.load();
  T.Cfg.v.watch.multiRoomMax = 7;
  T.Cfg.v.like.batchMin = 99;
  T.Cfg.load();
  assertEq(T.Cfg.v.watch.multiRoomMax, 2, 'watch 默认值被运行时改动污染');
  assertEq(T.Cfg.v.like.batchMin, 10, 'like 默认值被运行时改动污染');
  if (prev == null) win.localStorage.removeItem('bma.config.v1');
  else win.localStorage.setItem('bma.config.v1', prev);
  T.Cfg.load();
});
check('配置：任务上限默认留空、按任务开关', () => {
  const prev = win.localStorage.getItem('bma.config.v1');
  win.localStorage.removeItem('bma.config.v1');
  T.Cfg.load();
  assertEq(T.Cfg.v.taskLimit.like, 0, '点赞上限默认留空');
  assertEq(T.Cfg.v.taskLimit.danmu, 0, '弹幕上限默认留空');
  assertEq(T.Cfg.v.taskLimit.watch, 0, '观时上限默认留空');
  assertEq(T.Cfg.v.taskLimit.show.like, true, '默认显示进度');
  assertEq(T.Cfg.v.taskLimit.brk.like, false, '默认不超上限');

  /* 旧布尔配置迁移：三项继承同一值 */
  win.localStorage.setItem('bma.config.v1', JSON.stringify({
    taskLimit: { show: false, brk: true, like: 9, danmu: '10', watch: null }
  }));
  T.Cfg.load();
  assertEq(T.Cfg.v.taskLimit.show.like, false);
  assertEq(T.Cfg.v.taskLimit.show.danmu, false);
  assertEq(T.Cfg.v.taskLimit.show.watch, false);
  assertEq(T.Cfg.v.taskLimit.brk.like, true);
  assertEq(T.Cfg.v.taskLimit.brk.danmu, true);
  assertEq(T.Cfg.v.taskLimit.brk.watch, true);
  assertEq(T.Cfg.v.taskLimit.like, 9);
  assertEq(T.Cfg.v.taskLimit.danmu, 10);
  assertEq(T.Cfg.v.taskLimit.watch, 0, 'null 应视为留空');

  if (prev == null) win.localStorage.removeItem('bma.config.v1');
  else win.localStorage.setItem('bma.config.v1', prev);
  T.Cfg.load();
});

check('hms / clock', () => {
  assertEq(T.hms(3661), '1小时1分');
  assertEq(T.clock(65), '1:05');
});

/* ---------------- 渲染冒烟测试 ---------------- */
check('渲染 本房间（无数据占位）', () => {
  const html = T.Tabs.room();
  assert(typeof html === 'string' && html.length > 0, '空输出');
  assert(html.indexOf('正在读取房间') >= 0 || html.indexOf('当前不是直播间') >= 0, html.slice(0, 200));
});
check('今日亲密度：任务进度反推与估算兜底', () => {
  const tasks = [
    { jump_type: 'sendDanmu', sub_title: '10/10', add_text: '亲密度 +1' },
    { jump_type: 'like', sub_title: '10/10', add_text: '亲密度 +1' },
    { jump_type: 'watchLive', sub_title: '1/10', add_text: '亲密度 +1' }
  ];
  assertEq(T.RoomView.taskGain(tasks, 0), 21);
  assertEq(T.RoomView.taskGain(tasks, 3), 31, '大航海应 ×1.5');
  assertEq(T.RoomView.taskGain([], 0), 0);

  /* 服务端没给 today_feed 时，页面上的「今日亲密度」应改用任务进度估算，
     不能再显示 0，否则和下面的「明细合计」自相矛盾 */
  const roomId = T.currentPageRoomId();
  const prev = T.RoomView.data;
  T.RoomView.data = {
    roomId: roomId,
    uid: 12345,
    medal: {
      medal: { medal_name: '测试牌', level: 3, intimacy: 10, next_intimacy: 100, is_lighted: 1 },
      room_info: { room_id: Number(roomId) || 12345 }
    },
    tasks: { ok: true, tasks: [{ jump_type: 'sendDanmu', sub_title: '10/10', add_text: '亲密度 +1', is_done: 1 }] },
    guard: null,
    at: Date.now()
  };
  const html = T.Tabs.room();
  assert(html.indexOf('按任务估算') >= 0, '缺少估算提示：' + html.slice(0, 300));
  assert(html.indexOf('不含分享直播间的收益') >= 0, '缺少储蓄模式说明：' + html.slice(0, 400));
  T.RoomView.data = prev;
});
check('本房间：不再显示累计观时/弹幕与红包卡片', () => {
  const roomId = T.currentPageRoomId();
  const prev = T.RoomView.data;
  T.RoomView.data = {
    roomId: roomId,
    uid: 12345,
    medal: {
      medal: { medal_name: '测试牌', level: 3, intimacy: 10, next_intimacy: 100, is_lighted: 1 },
      room_info: { room_id: Number(roomId) || 12345 }
    },
    tasks: { ok: true, tasks: [{ jump_type: 'sendDanmu', sub_title: '10/10', add_text: '亲密度 +1', is_done: 1 }] },
    at: Date.now()
  };
  const html = T.Tabs.room();
  ['该直播间累计观时', '累计发送弹幕', '红包', 'rpScan'].forEach((k) => {
    assert(html.indexOf(k) < 0, '不应再出现：' + k);
  });
  T.RoomView.data = prev;
});
check('渲染 白名单（空）', () => {
  const html = T.Tabs.list();
  assert(html.indexOf('还没有添加任何直播间') >= 0, html.slice(0, 300));
});
check('设置：体验优化只保留首页自动暂停', () => {
  const html = T.Tabs.set();
  ['禁用 P2P', '拦截日志数据上报', '屏蔽挂机检测', '隐身入场'].forEach((k) => {
    assert(html.indexOf(k) < 0, '不应再出现：' + k);
  });
  assert(html.indexOf('暂停首页自动播放的直播') >= 0, '缺少首页自动暂停开关');
  assert(/data-bind="enhance\.pauseHome"/.test(html), '开关绑定路径不对');
});

check('首页暂停：手动播放过的视频不再自动暂停', () => {
  const v = { tagName: 'VIDEO' };
  assertEq(T.Enhance.isAuthorized(v), false, '初始不应被授权');
  T.Enhance.authorize(v);
  assertEq(T.Enhance.isAuthorized(v), true, '授权后应跳过暂停');
  T.Enhance.forget(v);
  assertEq(T.Enhance.isAuthorized(v), false, '播放结束后应撤销授权');
});


check('首页判定：只在 live.bilibili.com 根路径生效', () => {
  const loc = win.location;
  const prevHost = loc.hostname;
  const prevPath = loc.pathname;
  loc.hostname = 'live.bilibili.com';
  loc.pathname = '/';
  assertEq(T.Enhance.isHome(), true, '首页应命中');
  loc.pathname = '/12345';
  assertEq(T.Enhance.isHome(), false, '直播间页不应命中');
  loc.hostname = 'www.bilibili.com';
  loc.pathname = '/';
  assertEq(T.Enhance.isHome(), false, '非直播站不应命中');
  loc.hostname = prevHost;
  loc.pathname = prevPath;
});

check('渲染 设置', () => {
  const html = T.Tabs.set();
  ['执行', '任务开关', '点亮熄灭勋章', '点赞', '发弹幕', '观看直播', '分享直播间', '储蓄亲密度', '体验优化', '黑名单'].forEach((k) => {
    assert(html.indexOf(k) >= 0, '缺少区块：' + k);
  });
  /* 上限输入框留空、没有 1~10 的 max 限制 */
  const likeInput = /<input[^>]*data-bind="taskLimit\.like"[^>]*>/.exec(html);
  assert(likeInput, '缺少点赞上限输入');
  assert(likeInput[0].indexOf('max=') < 0, '上限不应限制输入范围');
  assert(/value=""/.test(likeInput[0]), '上限默认应为空');
});
check('渲染 日志', () => {
  const html = T.Tabs.log();
  assert(html.indexOf('复制全部') >= 0);
});

/* ---------------- 白名单 / 队列 ---------------- */
check('白名单汇总与拖拽数据结构', () => {
  T.Cfg.v.whitelist = [
    { roomId: 111, uid: 1, uname: 'A' },
    { roomId: 222, uid: 2, uname: 'B' }
  ];
  T.Cfg.v.blacklist = [222];
  const e = T.Engine.entries();
  assertEq(e.length, 1);
  assertEq(e[0].roomId, 111);
  const sum = T.Engine.summary();
  assertEq(sum.length, 2);
  assertEq(sum[1].tasks.light, T.Cfg.v.tasks.light ? 'ready' : 'off');
  const html = T.Tabs.list();
  assert(html.indexOf('执行队列') >= 0, '缺少队列区块');
  assert(html.indexOf('黑名单') >= 0, '缺少黑名单标记');
});

check('房间任务开关：默认开启，只能收紧不能放宽', () => {
  T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
  T.Cfg.v.whitelist = [
    { roomId: 7201, uid: 7201, uname: 'A', tasks: { watch: false } },
    { roomId: 7202, uid: 7202, uname: 'B' }
  ];
  T.Cfg.v.blacklist = [];
  T.Daily.rooms = {};
  const a = { roomId: 7201, uid: 7201, liveStatus: 1 };
  const b = { roomId: 7202, uid: 7202, liveStatus: 1 };
  T.Daily.done(a, 'light', true);
  T.Daily.done(b, 'light', true);

  assertEq(T.roomTaskOn(T.Cfg.v.whitelist[0], 'watch'), false);
  assertEq(T.roomTaskOn(T.Cfg.v.whitelist[1], 'watch'), true, '缺省应为开启');
  assertEq(T.Engine.taskOn(a, 'watch'), false);
  assertEq(T.Engine.taskState(a, 'watch'), 'off', '房间关闭后应为 off');
  assertEq(T.Engine.taskState(b, 'watch'), 'ready');

  /* 总开关关闭时，房间侧即使为开启也不生效 */
  T.Cfg.v.tasks.watch = false;
  T.Cfg.v.whitelist[1].tasks = { watch: true };
  assertEq(T.Engine.taskOn(b, 'watch'), false, '总开关关闭时不应生效');
  assertEq(T.Engine.taskState(b, 'watch'), 'off');
  T.Cfg.v.tasks.watch = true;
  T.Cfg.v.whitelist = [];
});

check('房间任务开关：关闭的任务不计入「全部完成」', () => {
  T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
  /* 分享也一并关掉：它现在参与收工判定（未尝试不算完成），这里只验证房间开关 */
  T.Cfg.v.whitelist = [{ roomId: 7211, uid: 7211, tasks: { watch: false, share: false } }];
  T.Daily.rooms = {};
  const m = { roomId: 7211, uid: 7211 };
  ['light', 'like', 'danmu'].forEach((n) => T.Daily.done(m, n, true));
  assertEq(T.Daily.allDone(m), false, '默认判定应仍未完成');
  assertEq(T.Engine.allDone(m), true, '关闭观时后应视为完成');
  T.Cfg.v.whitelist = [];
});

check('看板：卡片底部有任务开关按钮，浮层按总开关禁用', () => {
  T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
  T.Cfg.v.whitelist = [{ roomId: 7221, uid: 7221, uname: '按钮测试' }];
  T.Cfg.v.blacklist = [];
  T.Daily.rooms = {};
  let html = T.Tabs.list();
  assert(html.indexOf('data-act="roomTasks"') >= 0, '缺少任务开关按钮');
  assert(html.indexOf('任务开关') >= 0);
  T.ListView.taskPop = '7221';
  html = T.Tabs.list();
  assert(html.indexOf('bma-taskpop') >= 0, '浮层未渲染');
  assert(html.indexOf('data-room-task="light"') >= 0);
  T.Cfg.v.tasks.share = false;
  html = T.Tabs.list();
  const seg = html.slice(html.indexOf('data-room-task="share"'));
  assert(seg.indexOf('disabled') >= 0, '总开关关闭的任务应禁用');
  assert(html.indexOf('总开关已关闭') >= 0, '应提示总开关已关闭');
  T.Cfg.v.tasks.share = true;
  T.ListView.taskPop = '';
  T.Cfg.v.whitelist = [];
});

check('房间任务开关：写入配置并立即停止观时', () => {
  T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
  T.Cfg.v.whitelist = [{ roomId: 7231, uid: 7231, uname: 'C' }];
  T.Actions.setRoomTask('7231', 'light', false);
  assertEq(T.Cfg.v.whitelist[0].tasks.light, false);
  assertEq(T.roomTaskOn(T.Cfg.v.whitelist[0], 'light'), false);
  /* 总开关关闭时忽略房间侧操作 */
  T.Cfg.v.tasks.danmu = false;
  T.Actions.setRoomTask('7231', 'danmu', true);
  assertEq(T.Cfg.v.whitelist[0].tasks.danmu, undefined, '总开关关闭时不应写入');
  T.Cfg.v.tasks.danmu = true;

  const heart = { stopped: false, stop() { this.stopped = true; } };
  T.Engine.watches.push({ roomId: 7231, heart: heart });
  T.Engine.stopRoomTask(7231, 'watch');
  assertEq(heart.stopped, true, '关闭观时应立即停止心跳');
  T.Engine.watches = [];
  T.Cfg.v.whitelist = [];
});

check('任务可用性：未开播只能发弹幕，开播才能点赞/观时', () => {
  T.Daily.rooms = {};
  T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
  T.Cfg.v.watch.requireLive = true;

  const off = { roomId: 7001, liveStatus: 0 };
  const live = { roomId: 7002, liveStatus: 1 };
  /* 观时要求点亮已完成，先满足它，这一组只验证开播状态这一维 */
  T.Daily.done(off, 'light', true);
  T.Daily.done(live, 'light', true);

  assertEq(T.Engine.taskState(off, 'like'), 'waitLive');
  assertEq(T.Engine.taskState(off, 'watch'), 'waitLive');
  assertEq(T.Engine.taskState(off, 'danmu'), 'ready');

  assertEq(T.Engine.taskState(live, 'like'), 'ready');
  assertEq(T.Engine.taskState(live, 'watch'), 'ready');
  assertEq(T.Engine.taskState(live, 'danmu'), 'waitOffline');

  /* 没点亮时不能挂观时，即使主播正在播（与 pick('watch') 的闸门保持一致） */
  assertEq(T.Engine.taskState({ roomId: 7004, liveStatus: 1 }, 'watch'), 'waitLight');

  /* 打开「开播中也发弹幕」 */
  T.Cfg.v.danmu.onlyWhenNotLive = false;
  assertEq(T.Engine.taskState(live, 'danmu'), 'ready');
  T.Cfg.v.danmu.onlyWhenNotLive = true;

  /* 关掉「观时只在开播时」 */
  T.Cfg.v.watch.requireLive = false;
  assertEq(T.Engine.taskState(off, 'watch'), 'ready');
  T.Cfg.v.watch.requireLive = true;

  /* 状态未知时不阻拦，交给接口去判 */
  assertEq(T.Engine.taskState({ roomId: 7003, liveStatus: null }, 'like'), 'ready');
});

check('避让逻辑（当前页房间 + 可见）', () => {
  T.Cfg.v.avoidWatching = true;
  assertEq(T.Engine.isBeingWatched('12345'), true);
  assertEq(T.Engine.isBeingWatched('99999'), false);
  T.Cfg.v.avoidWatching = false;
  assertEq(T.Engine.isBeingWatched('12345'), false);
  T.Cfg.v.avoidWatching = true;
});

check('失败退避计数', () => {
  T.Engine.failState.clear();
  assertEq(T.Engine.canTry('111', 'like'), true);
  T.Engine.markFail('111', 'like');
  assertEq(T.Engine.canTry('111', 'like'), false);
  assert(T.Engine.retryInfo('111', 'like').indexOf('失败 1 次') === 0, T.Engine.retryInfo('111', 'like'));
  T.Engine.markOk('111', 'like');
  assertEq(T.Engine.canTry('111', 'like'), true);
});

check('设置项绑定路径写入', () => {
  T.UI.setBind('like.batchMin', 7);
  assertEq(T.Cfg.v.like.batchMin, 7);
  T.UI.setBind('tasks.watch', false);
  assertEq(T.Cfg.v.tasks.watch, false);
  T.UI.setBind('tasks.watch', true);

  const prevLike = T.Cfg.v.taskLimit.like;
  T.UI.setBind('taskLimit.like', '');
  assertEq(T.Cfg.v.taskLimit.like, 0, '空值应存为 0（跟随服务端）');
  T.UI.setBind('taskLimit.like', '12');
  assertEq(T.Cfg.v.taskLimit.like, 12, '上限不设输入范围');
  T.Cfg.v.taskLimit.like = prevLike;
});

check('今日记录：以 uid 为稳定键，旧 r* 键会被并入', () => {
  T.Daily.rooms = {};
  T.Data.rooms.clear();
  T.Daily.add('555666', 'like', 10);
  assertEq(T.Daily.get('555666').like, 10);
  T.Data.putRoom({ roomId: 555666, uid: 98765, key: '555666', uname: 'X', areaId: 1, parentAreaId: 2, liveStatus: 1 });
  assertEq(T.Daily.get({ roomId: 555666, uid: 98765 }).like, 10, '旧键未并入 uid 键');
  assertEq(T.Daily.keyOf({ uid: 98765 }), 'u98765');
  assertEq(T.Daily.keyOf('555666'), 'u98765', '房间号应能反查到 uid 键');
  assertEq(T.Daily.rooms.r555666, undefined, '旧 r* 键应被删除');
});

check('收工判定：分享未尝试时不算全部完成', () => {
  const prevTasks = T.Cfg.v.tasks;
  const prevTL = T.Cfg.v.taskLimit;
  const prevFull = T.Cfg.v.freeFullLite;
  T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
  T.Cfg.v.freeFullLite = false;
  T.Cfg.v.taskLimit = {
    like: 0, danmu: 0, watch: 0,
    show: { like: true, danmu: true, watch: true },
    brk: { like: false, danmu: false, watch: false }
  };
  T.Daily.date = todayOf();
  T.Daily.rooms = {};
  const meta = { roomId: 8910, uid: 8110 };
  T.Data.medals.set('u8110', { medal: { target_id: 8110, medal_id: 1, is_lighted: 1 }, room_info: { room_id: 8910 } });
  ['light', 'like', 'danmu', 'watch'].forEach((n) => T.Daily.done(meta, n, true));

  assertEq(T.Engine.allDone(meta), false, '四项做完但分享未尝试，不应算全部完成');
  T.Daily.get(meta).shareTried = true;
  assertEq(T.Engine.allDone(meta), true, '分享已尝试（待确认）应算完成');
  T.Daily.get(meta).shareTried = false;
  T.Engine.parked.set('8910:share', { kind: 'none' });
  assertEq(T.Engine.allDone(meta), true, '服务端没有分享任务时应算完成');
  T.Engine.parked.clear();
  T.Cfg.v.tasks = prevTasks;
  T.Cfg.v.taskLimit = prevTL;
  T.Cfg.v.freeFullLite = prevFull;
});

check('自己观看的时长累加到 self，不覆盖脚本观时', () => {
  T.Daily.rooms = {};
  const meta = { roomId: 8888, uid: 7777 };
  T.Daily.get(meta).watch = 120;
  T.Daily.addSelf(meta, 30);
  T.Daily.addSelf(meta, 15);
  assertEq(T.Daily.get(meta).self, 45);
  assertEq(T.Daily.get(meta).watch, 120);
});

check('每日记录：写盘带版本戳，reload 会丢弃内存旧快照', () => {
  T.Daily.date = todayOf();
  T.Daily.rooms = {};
  T.Daily.loadedAt = 0;
  const meta = { roomId: 8901, uid: 8101 };
  T.Daily.get(meta).like = 30;
  T.Daily.save();
  assert(T.Daily.savedAt > 0, '写盘应记录版本戳');
  const raw = JSON.parse(localStorageStub.getItem('bma.daily.v1'));
  assertEq(raw.savedAt, T.Daily.savedAt, '磁盘应带 savedAt');

  /* 内存里改成旧值后 reload，应以磁盘为准 */
  T.Daily.get(meta).like = 0;
  T.Daily.reload();
  assertEq(T.Daily.get(meta).like, 30, 'reload 应读回磁盘数据');
  assertEq(T.Daily.loadedAt, raw.savedAt, 'loadedAt 应同步');
});

check('每日记录：旧标签延迟写盘不会覆盖新进度', () => {
  T.Daily.date = todayOf();
  T.Daily.rooms = {};
  T.Daily.loadedAt = 100;
  T.Daily.savedAt = 100;
  const meta = { roomId: 8902, uid: 8102 };
  const cur = T.Daily.get(meta);
  cur.like = 10;
  cur.done = { like: false };
  /* 模拟另一个标签已写入更新的进度 */
  localStorageStub.setItem('bma.daily.v1', JSON.stringify({
    date: T.Daily.date,
    savedAt: 200,
    rooms: {
      u8102: { roomId: 8902, uid: 8102, like: 300, danmu: 5, done: { like: true, light: true } }
    }
  }));
  T.Daily.save();
  const merged = T.Daily.get(meta);
  assertEq(merged.like, 300, '计数应取较大值');
  assertEq(merged.danmu, 5, '对方独有的房间计数应并入');
  assertEq(merged.done.light, true, 'done 应取并集');
  assertEq(T.Daily.loadedAt > 200, true, '合并后版本应前进');
  const raw = JSON.parse(localStorageStub.getItem('bma.daily.v1'));
  assertEq(raw.rooms.u8102.like, 300, '写回的内容应包含合并结果');
});

check('任务成功后会清掉旧的错误提示', () => {
  const meta = { roomId: 9999, uid: 6666 };
  T.Daily.setErr(meta, '旧错误');
  assertEq(T.Daily.get(meta).err, '旧错误');
  T.Daily.done(meta, 'danmu', true);
  assertEq(T.Daily.get(meta).err, '');
});

check('超过 10 分钟的错误不再显示在卡片上', () => {
  T.Data.rooms.set('4321', { roomId: 4321, uid: 4321, key: '4321', liveStatus: 0, areaId: 1, parentAreaId: 2 });
  T.Cfg.v.whitelist = [{ roomId: 4321, uid: 4321, uname: 'X' }];
  const r = T.Daily.get({ roomId: 4321, uid: 4321 });
  r.err = '很久以前的错误';
  r.errAt = Date.now() - 20 * 60 * 1000;
  let s = T.Engine.summary();
  assertEq(s[0].err, '', '过期错误应被隐藏');
  r.errAt = Date.now();
  s = T.Engine.summary();
  assertEq(s[0].err, '很久以前的错误', '新鲜错误应显示');
  T.Cfg.v.whitelist = [];
});

check('观时目标会记到房间元数据上，供图表画参考线', () => {
  const meta = T.Data.putRoom({ roomId: 5555, uid: 1234, key: '5555', liveStatus: 1, areaId: 1, parentAreaId: 2 });
  T.Data.setWatchTarget(meta, 900);
  assertEq(T.Data.watchTargetOf(meta), 900);
  T.Data.setWatchTarget(meta, 3600);
  assertEq(T.Data.watchTargetOf(meta), 3600);
});
check('观时图表：10 轮任务画 9 条分隔线', () => {
  T.Data.rooms.set('7001', { roomId: 7001, uid: 7001, key: '7001', liveStatus: 1, areaId: 1, parentAreaId: 2, watchTarget: 9000, watchRounds: 10, watchRoundMin: 15 });
  T.Cfg.v.whitelist = [{ roomId: 7001, uid: 7001, uname: '图表测试' }];
  T.Daily.get({ roomId: 7001, uid: 7001 }).watch = 300;
  const html = T.Tabs.set();
  const seg = html.split('图表测试')[1] || '';
  const marks = (seg.match(/<em style="left:/g) || []).length;
  assertEq(marks, 9, '10 轮应有 9 条分隔线，实际 ' + marks);
  assert(seg.indexOf('10 轮 × 15 分') >= 0, '应显示轮次说明');
  T.Cfg.v.whitelist = [];
});
check('观时图表：2 轮竖线固定在 50%，超出上限只改红绿比例', () => {
  T.Data.rooms.set('7002', { roomId: 7002, uid: 7002, key: '7002', liveStatus: 1, areaId: 1, parentAreaId: 2, watchRounds: 2, watchRoundMin: 15, watchTarget: 1800 });
  T.Cfg.v.whitelist = [{ roomId: 7002, uid: 7002, uname: '两轮测试' }];
  const d = T.Daily.get({ roomId: 7002, uid: 7002 });
  d.watch = 900;
  d.self = 2700;
  const html = T.Tabs.set();
  const seg = html.split('两轮测试')[1] || '';
  assert(seg.indexOf('left:50.0000%') >= 0, '2 轮应有 50% 处的竖线，实际：' + seg.slice(0, 200));
  const widths = [];
  const re = /style="width:([\d.]+)%"/g;
  let m;
  while ((m = re.exec(seg))) widths.push(Number(m[1]));
  assert(widths.length >= 2, '应有绿色和红色两段');
  const sum = widths[0] + widths[1];
  assert(Math.abs(sum - 100) < 0.5, '超上限时两段合计应正好 100%，实际 ' + sum);
  T.Daily.rooms = {};
  T.Cfg.v.whitelist = [];
});
check('看板：储蓄亲密度按 xx/100 显示，可关闭', () => {
  T.Data.rooms.set('7101', { roomId: 7101, uid: 7101, key: '7101', liveStatus: 1, areaId: 1, parentAreaId: 2, freeIntimacy: 42, freeReach: false });
  T.Cfg.v.whitelist = [{ roomId: 7101, uid: 7101, uname: '储蓄测试' }];
  T.Cfg.v.showFreeIntimacy = true;
  let html = T.Tabs.list();
  assert(html.indexOf('储蓄亲密度 42 / 100') >= 0, '应显示 42/100');
  T.Cfg.v.showFreeIntimacy = false;
  html = T.Tabs.list();
  assert(html.indexOf('储蓄亲密度') < 0, '关闭后不应显示');
  T.Cfg.v.showFreeIntimacy = true;
  T.Cfg.v.whitelist = [];
});

check('看板：粉丝牌等级与亲密度（当前/升级所需），可关闭', () => {
  const roomId = 7102;
  const key = String(roomId);
  T.Data.rooms.set(key, { roomId: roomId, uid: roomId, key: key, liveStatus: 1, areaId: 1, parentAreaId: 2 });
  T.Data.medals.set(key, {
    medal: {
      target_id: roomId, medal_id: 71, medal_name: '测试牌',
      level: 8, intimacy: 23, next_intimacy: 28, is_lighted: 1
    },
    room_info: { room_id: roomId }
  });
  T.Cfg.v.whitelist = [{ roomId: roomId, uid: roomId, uname: '粉丝牌测试' }];
  T.Cfg.v.showMedalBar = true;

  let html = T.Tabs.list();
  assert(html.indexOf('bma-room-medal') >= 0, '应显示粉丝牌等级块');
  assert(html.indexOf('Lv.8') >= 0, '应显示粉丝牌等级');
  assert(html.indexOf('23 / 28') >= 0, '应显示 当前亲密度 / 升级所需');
  assert(html.indexOf('width:82%') >= 0, '进度应按 23/28 折算为 82%');

  T.Cfg.v.showMedalBar = false;
  assert(T.Tabs.list().indexOf('bma-room-medal') < 0, '关闭后不应显示');
  T.Cfg.v.showMedalBar = true;

  /* 升级所需缺失（满级或字段没返回）：只显示等级，不画条 */
  T.Data.medals.get(key).medal.next_intimacy = 0;
  html = T.Tabs.list();
  assert(html.indexOf('Lv.8') >= 0, '缺升级所需也应显示等级');
  assert(html.indexOf('bma-mbar') < 0, '缺升级所需不应画进度条');

  T.Data.medals.delete(key);
  T.Data.rooms.delete(key);
  T.Cfg.v.whitelist = [];
});

check('设置：看板显示卡片可关粉丝牌等级', () => {
  const html = T.Tabs.set();
  assert(html.indexOf('看板显示') >= 0, '缺少看板显示卡片');
  assert(/data-bind="showMedalBar"/.test(html), '开关绑定路径不对');
  assert(html.indexOf('执行队列显示粉丝牌等级与亲密度') >= 0, '缺少开关文案');
});

check('看板：储蓄亲密度达到阈值时只把数字标红', () => {
  const meta = { roomId: 7104, uid: 7104, key: '7104', liveStatus: 1, areaId: 1, parentAreaId: 2, freeReach: false };
  T.Cfg.v.whitelist = [{ roomId: 7104, uid: 7104, uname: '阈值测试' }];
  T.Cfg.v.showFreeIntimacy = true;
  T.Cfg.v.freeWarnAt = 80;

  T.Data.rooms.set('7104', Object.assign({}, meta, { freeIntimacy: 79 }));
  let html = T.Tabs.list();
  assert(html.indexOf('储蓄亲密度 79 / 100') >= 0, '未达阈值不应标红');
  assert(html.indexOf('bma-warn') < 0, '未达阈值不应出现标红样式');

  T.Data.rooms.set('7104', Object.assign({}, meta, { freeIntimacy: 80 }));
  html = T.Tabs.list();
  assert(html.indexOf('储蓄亲密度 <span class="bma-warn">80</span> / 100') >= 0, '达到阈值应只把数字标红');

  /* 阈值可调；0 表示不标红 */
  T.Cfg.v.freeWarnAt = 50;
  assert(T.Tabs.list().indexOf('<span class="bma-warn">80</span>') >= 0, '调低阈值后应标红');
  T.Cfg.v.freeWarnAt = 0;
  assert(T.Tabs.list().indexOf('bma-warn') < 0, '阈值为 0 时不应标红');
  T.Cfg.v.freeWarnAt = 80;
  T.Cfg.v.whitelist = [];
});

check('配置：储蓄亲密度标红阈值默认 80', () => {
  const prev = win.localStorage.getItem('bma.config.v1');
  win.localStorage.removeItem('bma.config.v1');
  T.Cfg.load();
  assertEq(T.Cfg.v.freeWarnAt, 80, '标红阈值应默认 80');
  if (prev == null) win.localStorage.removeItem('bma.config.v1');
  else win.localStorage.setItem('bma.config.v1', prev);
  T.Cfg.load();
});

check('看板：主播名字是新标签页直达直播间的链接', () => {
  T.Data.rooms.set('7102', { roomId: 7102, uid: 7102, key: '7102', liveStatus: 1, areaId: 1, parentAreaId: 2 });
  T.Cfg.v.whitelist = [{ roomId: 7102, uid: 7102, uname: '链接测试' }];
  const html = T.Tabs.list();
  assert(html.indexOf('href="https://live.bilibili.com/7102"') >= 0, '缺少直播间链接');
  assert(html.indexOf('target="_blank"') >= 0, '应新开标签页');
  T.Cfg.v.whitelist = [];
});
check('看板：轮播房间显示「轮播」而不是「状态未知」', () => {
  T.Data.rooms.set('7103', { roomId: 7103, uid: 7103, key: '7103', liveStatus: 2, areaId: 1, parentAreaId: 2 });
  T.Cfg.v.whitelist = [{ roomId: 7103, uid: 7103, uname: '轮播测试' }];
  T.Cfg.v.tasks.like = true;
  T.Cfg.v.tasks.watch = true;
  T.Cfg.v.watch.requireLive = true;
  const html = T.Tabs.list();
  assert(html.indexOf('轮播') >= 0, '状态标签应显示轮播');
  assert(html.indexOf('状态未知') < 0, '轮播房间不应显示状态未知');
  /* 轮播不是真开播：点赞与观时都应视为待开播（先满足点亮前置，单独验证开播维度） */
  T.Daily.done(T.Data.rooms.get('7103'), 'light', true);
  assertEq(T.Engine.taskState(T.Data.rooms.get('7103'), 'like'), 'waitLive');
  assertEq(T.Engine.taskState(T.Data.rooms.get('7103'), 'watch'), 'waitLive');
  /* 真正的未知（meta 缺失）仍要显示状态未知 */
  const unknown = T.Engine.summary().find((r) => r.roomId === 7103);
  assertEq(unknown.liveStatus, 2, '看板应把 liveStatus 原样传给渲染层');
  T.Cfg.v.whitelist = [];
});
check('心跳：服务端时间戳不推进时也不会连发', () => {
  const h = new T.RoomHeart({ roomId: 1, uid: 2, areaId: 3, parentAreaId: 4 }, 120);
  const before = Date.now();
  h.applyState({ heartbeat_interval: 30, secret_key: 'k', secret_rule: [0], timestamp: 1000 });
  assert(h.nextAt >= before + 30 * 1000 - 100, 'nextAt 应有下限，实际 ' + h.nextAt);
});
check('观时并发：并行关闭固定 1 路，开启后按房间数收敛', () => {
  T.Cfg.v.whitelist = [{ roomId: 7003, uid: 7003, uname: 'A' }, { roomId: 7004, uid: 7004, uname: 'B' }];
  T.Cfg.v.watch.multiRoom = false;
  T.Cfg.v.watch.multiRoomMax = 2;
  assertEq(T.Engine.effectiveWatchParallel(), 1, '并行关闭时固定 1 路');
  T.Cfg.v.watch.multiRoom = true;
  assertEq(T.Engine.effectiveWatchParallel(), 2, '开启后取设定值');
  T.Cfg.v.watch.multiRoomMax = 9;
  assertEq(T.Engine.effectiveWatchParallel(), 2, '不超过房间数');
  T.Cfg.v.watch.multiRoom = false;
  T.Cfg.v.watch.multiRoomMax = 2;
  T.Cfg.v.whitelist = [];
});
check('观时并发上限收紧后，多余的观时会被主动停止', () => {
  T.Cfg.v.watch.multiRoom = true;
  T.Cfg.v.watch.multiRoomMax = 2;
  const h1 = { stopped: false, stop() { this.stopped = true; } };
  const h2 = { stopped: false, stop() { this.stopped = true; } };
  T.Engine.watches = [{ roomId: 1, heart: h1 }, { roomId: 2, heart: h2 }];
  T.Cfg.v.watch.multiRoomMax = 1;
  T.Engine.guardWatchConcurrency();
  assertEq(T.Engine.watches.length, 1, '应收敛到 1 路');
  assert(h2.stopped === true, '被收掉的那一路心跳应停止');
  T.Engine.watches = [];
  T.Cfg.v.watch.whenWatching = 'skipCurrent';
  T.Cfg.v.watch.multiRoomMax = 2;
});
check('并行路数不设上限，但必须是正整数且不超过房间数', () => {
  T.Cfg.v.whitelist = [{ roomId: 7005, uid: 7005, uname: 'C' }, { roomId: 7006, uid: 7006, uname: 'D' }];
  T.Cfg.v.watch.multiRoom = true;
  T.UI.setBind('watch.multiRoomMax', 100);
  assertEq(T.Cfg.v.watch.multiRoomMax, 100, '不设上限，100 应原样保存');
  T.UI.setBind('watch.multiRoomMax', 0);
  assertEq(T.Cfg.v.watch.multiRoomMax, 1, '小于 1 应收敛为 1');
  T.UI.setBind('watch.multiRoomMax', 2);
  assertEq(T.Cfg.v.watch.multiRoomMax, 2, '正常值保持不变');
  T.Cfg.v.watch.multiRoomMax = 100;
  T.Cfg.v.watch.whenWatching = 'ignore';
  assertEq(T.Engine.effectiveWatchParallel(), 2, '实际并发不超过房间数');
  T.Cfg.v.watch.multiRoomMax = 2;
  T.Cfg.v.watch.whenWatching = 'skipCurrent';
  T.Cfg.v.whitelist = [];
});
check('观时图表：服务端模式显示轮次换算', () => {
  T.UI.watchSrv = true;
  T.Data.rooms.set('7501', { roomId: 7501, uid: 7501, key: '7501', liveStatus: 1, areaId: 1, parentAreaId: 2, watchRounds: 2, watchRoundMin: 15, watchSrvRounds: 1 });
  T.Cfg.v.whitelist = [{ roomId: 7501, uid: 7501, uname: '服务端测试' }];
  const html = T.Tabs.set();
  const seg = html.split('服务端测试')[1] || '';
  assert(seg.indexOf('服务端 1/2 轮') >= 0, '应显示服务端轮次，实际：' + seg.slice(0, 160));
  assert(html.indexOf('显示脚本记录') >= 0, '按钮应提示切回脚本口径');
  T.UI.watchSrv = false;
  T.Cfg.v.whitelist = [];
});
/* ---------------- 静态一致性检查 ---------------- */check('所有 data-act 都有处理函数', () => {
  const acts = new Set();
  const re = /data-act="([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(code))) acts.add(m[1]);
  const missing = [];
  acts.forEach((a) => { if (a !== 'close' && typeof T.Actions[a] !== 'function') missing.push(a); });
  assert(missing.length === 0, '缺少处理函数：' + missing.join(','));
  assert(acts.size >= 15, 'data-act 数量异常：' + acts.size);
});

check('所有 data-tab 都有页签实现', () => {
  const tabs = new Set();
  const re = /data-tab="([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(code))) tabs.add(m[1]);
  tabs.forEach((t) => assert(typeof T.Tabs[t] === 'function', '缺少页签：' + t));
  assertEq(tabs.size, 4);
});

check('所有开关/数值项的绑定路径都在默认配置里', () => {
  const binds = new Set();
  const re = /(?:switchRow|numberRow)\(\s*'(?:[^'\\]|\\.)*'\s*,\s*'([A-Za-z0-9_.]+)'/g;
  let m;
  while ((m = re.exec(code))) binds.add(m[1]);
  const bad = [];
  binds.forEach((b) => {
    /* overRow 之类的动态拼接（'taskLimit.brk.' + name）不参与路径检查 */
    if (/\.$/.test(b)) return;
    let cur = T.Cfg.v;
    const parts = b.split('.');
    for (let i = 0; i < parts.length; i++) {
      if (cur == null || cur[parts[i]] === undefined) { cur = undefined; break; }
      cur = cur[parts[i]];
    }
    if (cur === undefined) bad.push(b);
  });
  assert(bad.length === 0, '配置路径不存在：' + bad.join(','));
  assert(binds.size >= 10, '绑定项数量异常：' + binds.size);
});

check('接口路径全部指向 bilibili 域', () => {
  const bad = [];
  const re = /HOST\.(live|trace|main) \+ '([^']+)'/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[2][0] !== '/') bad.push(m[2]);
  }
  assert(bad.length === 0, '异常路径：' + bad.join(','));
});

/* ---------------- 异步：任务流程（接口全部 mock） ---------------- */
async function checkAsync(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name + ' -> ' + (e && e.message ? e.message : e)]);
  }
}

(async () => {
await checkAsync('限速：并发请求按 gap 串行排队', async () => {
  const prev = {
    conservative: T.Cfg.v.risk.conservative,
    gapMs: T.Cfg.v.risk.gapMs,
    lastAt: T.Net.lastAt,
    chain: T.Net.paceChain
  };
  T.Cfg.v.risk.conservative = true;
  T.Cfg.v.risk.gapMs = 40;
  T.Net.lastAt = 0;
  T.Net.paceChain = null;
  const t0 = Date.now();
  let dt = 0;
  try {
    await Promise.all([T.Net.pace('/x'), T.Net.pace('/x'), T.Net.pace('/x')]);
    dt = Date.now() - t0;
  } finally {
    T.Cfg.v.risk.conservative = prev.conservative;
    T.Cfg.v.risk.gapMs = prev.gapMs;
    T.Net.lastAt = prev.lastAt;
    T.Net.paceChain = prev.chain;
  }
  assert(dt >= 70, '三个并发应排队约 2 个 gap，实际 ' + dt + 'ms');
});


await checkAsync('观时心跳：每次成功都写一条日志', async () => {
  T.Cfg.v.watch.logHeartbeat = true;
  const orig = T.Log.log;
  const seen = [];
  T.Log.log = (tag, msg) => { seen.push(String(tag) + '|' + String(msg)); };
  try {
    const h = new T.RoomHeart({ roomId: 1234, uid: 5, areaId: 1, parentAreaId: 2 }, 900);
    h.secretKey = 'k';
    h.secretRule = [];
    const now = Math.floor(Date.now() / 1000);
    T.API.traceE = async () => ({ code: 0, data: { heartbeat_interval: 30, secret_key: 'k', secret_rule: [], timestamp: now } });
    T.API.traceX = async () => ({ code: 0, data: { heartbeat_interval: 30, secret_key: 'k', secret_rule: [], timestamp: now } });
    await h.beatE();
    await h.beatX();
    assert(seen.some((s) => s.indexOf('E 心跳成功') >= 0), '应记录 E 心跳日志');
    assert(seen.some((s) => s.indexOf('心跳 #1 成功') >= 0), '应记录 X 心跳日志');
  } finally {
    T.Log.log = orig;
  }
});
await checkAsync('观时：同一房间不会启动第二个心跳会话', async () => {
  T.API.medalTasks = async () => ({
    ok: true,
    guard: 0,
    free: 0,
    reachLimit: false,
    journey: null,
    keys: [],
    medal: null,
    tasks: [{ jump_type: 'watchLive', title: '观看直播满15分钟', sub_title: '每日上限 0/1', add_text: '亲密度+1', is_done: 0 }]
  });
  T.Data.taskCache.clear();
  T.Engine.watchGuard = new Map();
  T.Engine.watchGuard.set('7401', Date.now());
  const res = await T.Tasks.watch({ roomId: 7401, uid: 7401, areaId: 1, parentAreaId: 2, liveStatus: 1 });
  assertEq(res.status, 'defer', '应拒绝重复启动，实际 ' + JSON.stringify(res));
  T.Engine.watchGuard.clear();
});

  await checkAsync('风控：单接口只冷却自己，多接口才升级为全局暂停', async () => {
    const origAuto = T.Cfg.v.autoStart;
    const origLeader = T.Leader.isLeader;
    const origAuth = T.Auth.ensure;
    const origRefresh = T.Engine.refreshStatuses;
    const origRoomRefresh = T.RoomView.refresh;
    T.Cfg.v.autoStart = false;
    T.Leader.isLeader = false;
    T.Engine.running = false;
    T.Auth.ensure = async () => true;
    T.Engine.refreshStatuses = async () => {};
    T.RoomView.refresh = async () => {};

    const origFetch = win.fetch;
    const calls = [];
    const body = (code) => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: code, message: code === 0 ? '' : 'risk' }) });
    win.fetch = async (u) => {
      const s = String(u);
      if (s.indexOf('/x/bma-test/') < 0) return body(0);
      calls.push(s);
      return body(s.indexOf('ok') >= 0 ? 0 : -352);
    };
    const R1 = 'https://api.live.bilibili.com/x/bma-test/risk1';
    const R2 = 'https://api.live.bilibili.com/x/bma-test/risk2';
    const OK = 'https://api.live.bilibili.com/x/bma-test/ok';

    const hit = async (url) => { try { await T.Net.fetchJson(url); return null; } catch (e) { return e; } };

    try {
      await new Promise((r) => setTimeout(r, 400));
      T.Net.resetRisk();

      /* 1. 单接口风控：只冷却它自己，不全局暂停 */
      const e1 = await hit(R1);
      assert(e1 && e1.risk, '应抛出风控错误');
      assertEq(calls.length, 1, '应只发 1 次请求');
      const ep1 = T.Net.eps.get('/x/bma-test/risk1');
      assert(ep1 && ep1.cooldownUntil > Date.now(), '该接口应进入冷却');
      assert(!T.Net.blocked(), '单接口风控不应全局暂停');

      /* 2. 冷却期间同接口不再发请求，其它接口照常 */
      await hit(R1);
      assertEq(calls.length, 1, '冷却期间同接口不应再请求');
      const okRes = await hit(OK);
      assertEq(okRes, null, '其它接口应正常返回');
      assertEq(calls.length, 2, '其它接口应真的发出请求');

      /* 3. 同接口连续 3 次 → 熔断 */
      T.Cfg.v.risk.epStrikes = 3;
      ep1.cooldownUntil = 0;
      await hit(R1);
      ep1.cooldownUntil = 0;
      await hit(R1);
      assert(ep1.disabledUntil > Date.now(), '第 3 次应熔断');
      const before = calls.length;
      ep1.cooldownUntil = 0;
      await hit(R1);
      assertEq(calls.length, before, '熔断后同接口不应再请求');

      /* 4. 另一个接口也风控 → 账号级全局暂停 */
      await hit(R2);
      assert(T.Net.blocked(), '两个接口都出事应升级为全局暂停');
      const blockedCalls = calls.length;
      await hit(OK);
      assertEq(calls.length, blockedCalls, '全局暂停期间任何接口都不应请求');
    } finally {
      win.fetch = origFetch;
      T.Cfg.v.autoStart = origAuto;
      T.Leader.isLeader = origLeader;
      T.Auth.ensure = origAuth;
      T.Engine.refreshStatuses = origRefresh;
      T.RoomView.refresh = origRoomRefresh;
      T.Net.resetRisk();
    }
  });
  await checkAsync('对账：清掉本地假完成、补齐观时轮次', async () => {
    T.Cfg.v.autoStart = false;
    T.Engine.running = false;
    const meta = T.Data.putRoom({ roomId: 6001, uid: 6100, key: '6001', liveStatus: 1, areaId: 5, parentAreaId: 6 });
    T.Cfg.v.whitelist = [{ roomId: 6001, uid: 6100, uname: '对账' }];
    T.Daily.rooms = {};
    T.Daily.done(meta, 'like', true);
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [
        { jump_type: 'like', title: '每30次点赞', sub_title: '1/2', add_text: '亲密度 +1', is_done: 0 },
        { jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '2/2', add_text: '亲密度 +1', is_done: 1 },
        { jump_type: 'watchLive', title: '观看直播满15分钟', sub_title: '1/2', add_text: '亲密度 +1', is_done: 0 }
      ]
    });
    T.Data.taskCache.clear();
    await T.Engine.syncTasks(true);
    assertEq(T.Daily.isDone({ roomId: 6001, uid: 6100 }, 'like'), false, '假完成应被清掉');
    assertEq(T.Daily.isDone({ roomId: 6001, uid: 6100 }, 'danmu'), true, '服务端已完成应同步');
    assertEq(T.Data.watchTargetOf(meta), 1800, '2 轮 × 15 分 = 30 分钟');
    assertEq(Number(meta.watchRounds), 2);
    T.Cfg.v.whitelist = [];
  });

  await checkAsync('服务端没有的任务显示「无任务」而不是 ✓', async () => {
    T.Data.rooms.set('6101', { roomId: 6101, uid: 6101, key: '6101', liveStatus: 1, areaId: 1, parentAreaId: 2 });
    T.Cfg.v.whitelist = [{ roomId: 6101, uid: 6101, uname: '无任务测试' }];
    T.Engine.parked.set('6101:danmu', { kind: 'none' });
    const s = T.Engine.summary();
    assertEq(s[0].tasks.danmu, 'na');
    const html = T.Tabs.list();
    assert(html.indexOf('弹幕 无任务') >= 0, '应显示「弹幕 无任务」');
    T.Engine.parked.clear();
    T.Cfg.v.whitelist = [];
  });
  await checkAsync('粉丝牌：面板条目缺 room_info 时仍能按 uid 查到', async () => {
    T.API.allMedals = async () => ([
      { medal: { medal_id: 9, target_id: 2094031249, is_lighted: 1 }, room_info: null },
      { medal: { medal_id: 1, target_id: 999999, is_lighted: 1 }, room_info: { room_id: 999999 } }
    ]);
    await T.Data.refreshMedals(true);
    assert(!!T.Data.medalByUid(2094031249), '缺 room_info 的牌子也应按 uid 索引到');
    assertEq(T.Data.count, 2, '粉丝牌数量应为 2');
    T.API.allMedals = async () => [];
  });

  await checkAsync('粉丝牌：列表不完整时保留旧索引，不判「无牌」', async () => {
    T.Data.medals.clear();
    T.Data.count = 0;
    T.API.allMedals = async () => ([
      { medal: { medal_id: 1, target_id: 777, is_lighted: 1 }, room_info: { room_id: 777 } }
    ]);
    await T.Data.refreshMedals(true);
    const before = T.Data.medalsAt;
    const size = T.Data.medals.size;
    assertEq(T.Data.medalState({ roomId: 777, uid: 777 }), 'has');
    /* 第一页就被风控：不能拿残缺结果替换索引 */
    T.API.allMedals = async () => ({ list: [], complete: false, reason: '第 1 页返回 code -352' });
    await T.Data.refreshMedals(true);
    assertEq(T.Data.medals.size, size, '不完整时不应替换索引');
    assertEq(T.Data.medalsAt, before, '不完整时不应更新成功时间');
    assertEq(T.Data.medalState({ roomId: 777, uid: 777 }), 'has', '已有牌子不应被判成无牌');
    T.API.allMedals = async () => ({ list: [], complete: true });
  });

  await checkAsync('粉丝牌：不信任 total_page，后续页有数据仍会取回', async () => {
    const orig = T.Net.fetchJson;
    T.Net.fetchJson = async (url) => {
      const m = /page=(\d+)/.exec(String(url));
      const p = Number(m && m[1]) || 1;
      if (p === 2) {
        return { code: 0, data: { list: [{ medal: { medal_id: 22, target_id: 8822, is_lighted: 1 }, room_info: { room_id: 8822 } }], page_info: { total_page: 1 } } };
      }
      if (p === 1) {
        return { code: 0, data: { list: [{ medal: { medal_id: 11, target_id: 8811, is_lighted: 1 }, room_info: { room_id: 8811 } }], page_info: { total_page: 1 } } };
      }
      return { code: 0, data: { list: [] } };
    };
    try {
      const res = await realAllMedals(12);
      assertEq(res.complete, true, '空页终止应标记完整');
      assertEq(res.list.length, 2, 'total_page 偏小不应截断第二页');
    } finally {
      T.Net.fetchJson = orig;
    }
  });

  await checkAsync('粉丝牌：中间页出错标记不完整并保留已取部分', async () => {
    const orig = T.Net.fetchJson;
    T.Net.fetchJson = async (url) => {
      const m = /page=(\d+)/.exec(String(url));
      const p = Number(m && m[1]) || 1;
      if (p === 1) {
        return { code: 0, data: { list: [{ medal: { medal_id: 11, target_id: 8811, is_lighted: 1 }, room_info: { room_id: 8811 } }], page_info: { total_page: 5 } } };
      }
      return { code: -352, message: '风控' };
    };
    try {
      const res = await realAllMedals(12);
      assertEq(res.complete, false, '中间页出错应标记不完整');
      assertEq(res.list.length, 1, '已取到的部分保留在 list 里，由调用方决定是否使用');
    } finally {
      T.Net.fetchJson = orig;
    }
  });
  await checkAsync('点亮：没有该粉丝牌时判无任务，且不发弹幕空转', async () => {
    T.Data.medals.clear();
    T.Data.taskCache.clear();
    /* 索引里有一枚别的牌子，说明粉丝牌已加载，只是没有这个房间的 */
    T.API.allMedals = async () => ([
      { medal: { medal_id: 1, target_id: 999999, is_lighted: 1 }, room_info: { room_id: 999999 } }
    ]);
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      medal: null,
      tasks: [
        { jump_type: 'feedLight', title: '投喂粉丝灯牌', sub_title: '每日上限 0/1', add_text: '亲密度+6', is_done: false },
        { jump_type: 'sendDanmu', title: '发弹幕', sub_title: '每日上限 0/2', add_text: '亲密度+1', is_done: false }
      ]
    });
    let sent = 0;
    T.API.sendDanmu = async () => { sent++; return { code: 0, msg: '' }; };
    T.Cfg.v.danmu.onlyWhenNotLive = false;
    T.Engine.running = true;
    const res = await T.Tasks.light({ roomId: 7301, uid: 7301, liveStatus: 0 });
    assertEq(res.status, 'na', JSON.stringify(res));
    assert(res.reason.indexOf('粉丝牌') >= 0, '原因应说明缺少粉丝牌：' + res.reason);
    assertEq(sent, 0, '没有粉丝牌时不应发弹幕');
  });
  await checkAsync('点亮：服务端返回 medal_info 时按服务端为准', async () => {
    T.Data.medals.clear();
    T.Data.taskCache.clear();
    T.API.allMedals = async () => ([
      { medal: { medal_id: 1, target_id: 999999, is_lighted: 1 }, room_info: { room_id: 999999 } }
    ]);
    T.API.medalTasks = async () => ({
      ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
      medal: { is_lighted: 1 },
      tasks: []
    });
    const res = await T.Tasks.light({ roomId: 7301, uid: 7301, liveStatus: 0 });
    assertEq(res.status, 'done', '服务端说已点亮就应该判完成，实际 ' + JSON.stringify(res));
    /* 恢复成「空粉丝牌列表」，与后面的用例保持一致 */
    T.API.allMedals = async () => [];
  });
  await checkAsync('分享：亲密度涨了才算完成', async () => {
    const origRefresh = T.Data.refreshMedals;
    const meta = { roomId: 7801, uid: 7801 };
    T.Daily.rooms = {};
    T.Data.taskCache.clear();
    T.Data.medals.set('u7801', { medal: { target_id: 7801, today_feed: 10 }, room_info: { room_id: 7801 } });
    T.API.shareConf = async () => ({ code: 0 });
    T.API.medalTasks = async () => ({ ok: true, free: 0, tasks: [], guard: 0 });
    let calls = 0;
    T.Data.refreshMedals = async () => {
      calls++;
      /* 第一次是取基准（保持 10），之后才是分享后的读数 */
      const tf = calls === 1 ? 10 : 12;
      T.Data.medals.set('u7801', { medal: { target_id: 7801, today_feed: tf }, room_info: { room_id: 7801 } });
      return T.Data.medals;
    };
    const res = await T.Tasks.share(meta);
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(res.gain, 2);
    assertEq(T.Daily.get(meta).shareGain, 2, '差值应记入 shareGain');
    assertEq(T.Daily.isDone(meta, 'share'), true);
    assertEq(calls, 2, '应有一次取基准 + 一次读差值');
    T.Data.refreshMedals = origRefresh;
  });
  await checkAsync('分享：接口通了但亲密度没变，不写完成', async () => {
    const origRefresh = T.Data.refreshMedals;
    const meta = { roomId: 7802, uid: 7802 };
    T.Daily.rooms = {};
    T.Data.taskCache.clear();
    T.Data.medals.set('u7802', { medal: { target_id: 7802, today_feed: 5 }, room_info: { room_id: 7802 } });
    T.API.shareConf = async () => ({ code: 0 });
    T.API.medalTasks = async () => ({ ok: true, free: 5, tasks: [], guard: 0 });
    T.Data.refreshMedals = async () => T.Data.medals;
    const res = await T.Tasks.share(meta);
    assertEq(res.status, 'defer', JSON.stringify(res));
    assertEq(T.Daily.isDone(meta, 'share'), false, '没涨亲密度不应标完成');
    assertEq(T.Daily.get(meta).shareGain || 0, 0);
    assertEq(T.Daily.get(meta).shareTried, true, '调用过接口就该落盘「今日已尝试」');
    T.Data.refreshMedals = origRefresh;
  });
  await checkAsync('分享：第一次读不到增长时会再读一次', async () => {
    const origRefresh = T.Data.refreshMedals;
    const meta = { roomId: 7804, uid: 7804 };
    T.Daily.rooms = {};
    T.Data.taskCache.clear();
    T.Data.medals.set('u7804', { medal: { target_id: 7804, today_feed: 3 }, room_info: { room_id: 7804 } });
    T.API.shareConf = async () => ({ code: 0 });
    T.API.medalTasks = async () => ({ ok: true, free: 0, tasks: [], guard: 0 });
    let calls = 0;
    T.Data.refreshMedals = async () => {
      calls++;
      if (calls >= 3) {
        T.Data.medals.set('u7804', { medal: { target_id: 7804, today_feed: 5 }, room_info: { room_id: 7804 } });
      }
      return T.Data.medals;
    };
    const res = await T.Tasks.share(meta);
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(res.gain, 2);
    assertEq(calls, 3, '取基准 1 次 + 读数 2 次');
    T.Data.refreshMedals = origRefresh;
  });
  await checkAsync('分享：储蓄模式没有 today_feed 时用总亲密度判定', async () => {
    const origRefresh = T.Data.refreshMedals;
    const meta = { roomId: 7805, uid: 7805 };
    T.Daily.rooms = {};
    T.Data.taskCache.clear();
    T.API.shareConf = async () => ({ code: 0 });
    T.API.medalTasks = async () => ({ ok: true, free: 0, tasks: [], guard: 0 });
    T.Data.medals.set('u7805', { medal: { target_id: 7805, intimacy: 17, level: 3 }, room_info: { room_id: 7805 } });
    let calls = 0;
    T.Data.refreshMedals = async () => {
      calls++;
      /* 储蓄模式下没有 today_feed 字段，只有总亲密度 */
      const intimacy = calls === 1 ? 17 : 19;
      T.Data.medals.set('u7805', { medal: { target_id: 7805, intimacy: intimacy, level: 3 }, room_info: { room_id: 7805 } });
      return T.Data.medals;
    };
    const res = await T.Tasks.share(meta);
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(res.gain, 2);
    assertEq(res.how, '总亲密度');
    T.Data.refreshMedals = origRefresh;
  });
  await checkAsync('分享：收益进了储蓄池时用储蓄亲密度判定', async () => {
    const origRefresh = T.Data.refreshMedals;
    const meta = { roomId: 7806, uid: 7806 };
    T.Daily.rooms = {};
    T.Data.taskCache.clear();
    T.API.shareConf = async () => ({ code: 0 });
    T.Data.medals.set('u7806', { medal: { target_id: 7806, intimacy: 17, level: 3 }, room_info: { room_id: 7806 } });
    let n = 0;
    T.API.medalTasks = async () => {
      n++;
      return { ok: true, free: n === 1 ? 10 : 12, tasks: [], guard: 0 };
    };
    T.Data.refreshMedals = async () => {
      T.Data.medals.set('u7806', { medal: { target_id: 7806, intimacy: 17, level: 3 }, room_info: { room_id: 7806 } });
      return T.Data.medals;
    };
    const res = await T.Tasks.share(meta);
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(res.gain, 2);
    assertEq(res.how, '储蓄亲密度');
    T.Data.refreshMedals = origRefresh;
  });
  await checkAsync('分享：没有粉丝牌时判无任务', async () => {
    const meta = { roomId: 7803, uid: 7803 };
    const res = await T.Tasks.share(meta);
    assertEq(res.status, 'na', JSON.stringify(res));
  });
  await checkAsync('储蓄亲密度：任务请求会把 free_intimacy 写回房间元数据', async () => {
    const meta = { roomId: 7005, uid: 7005, key: '7005' };
    T.Data.rooms.set('7005', meta);
    T.Data.noteFree(7005, 37, true);
    assertEq(meta.freeIntimacy, 37, '储蓄亲密度应写回房间元数据');
    assertEq(meta.freeReach, true);
    T.Data.rooms.delete('7005');
  });
  await checkAsync('被禁言时返回 blocked（不再反复重试）', async () => {    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{ jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '0/2', add_text: '亲密度 +1', is_done: 0 }]
    });
    T.Data.taskCache.clear();
    T.Cfg.v.danmu.onlyWhenNotLive = false;
    T.API.sendDanmu = async () => ({ code: 733, message: '你已经在本房间被禁言' });
    T.Engine.running = true;
    const res = await T.Tasks.danmu({ roomId: 7201, uid: 7201, liveStatus: 1 });
    assertEq(res.status, 'blocked', '应返回 blocked，实际 ' + JSON.stringify(res));
  });
  await checkAsync('房间元数据持久化：重启后不必重新请求就能识别 uid', async () => {
    T.Data.rooms.clear();
    T.Data.putRoom({ roomId: 424242, uid: 4242, key: '424242', uname: '持久化测试', areaId: 11, parentAreaId: 22, liveStatus: 1 });
    await new Promise((r) => setTimeout(r, 900));
    T.Data.rooms.clear();
    T.Data.loadRooms();
    const m = T.Data.room('424242');
    assert(m && m.uid === 4242, '房间元数据未从 localStorage 恢复');
    assertEq(T.Daily.keyOf('424242'), 'u4242');
  });

  await checkAsync('点赞任务：按接口轮次执行并自动停止', async () => {
    let clicks = 0;
    const per = 30;
    const limit = 2;
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{
        jump_type: 'like',
        title: '每' + per + '次点赞',
        sub_title: Math.floor(clicks / per) + '/' + limit,
        add_text: '亲密度 +1',
        is_done: clicks >= per * limit ? 1 : 0
      }]
    });
    T.API.likeReport = async (roomId, uid, n) => {
      clicks += n;
      return { code: 0 };
    };
    T.Cfg.v.like.gapMin = 1;
    T.Cfg.v.like.gapMax = 1;
    T.Cfg.v.like.capClicks = 310;
    T.Engine.running = true;
    T.Daily.date = '';
    T.Daily.rooms = {};
    const res = await T.Tasks.like({ roomId: 777, uid: 42 });
    assertEq(res.status, 'done', '任务未完成：' + JSON.stringify(res));
    assertEq(clicks, per * limit, '点击次数不对');
    assert(T.Daily.isDone({ roomId: 777, uid: 42 }, 'like'), '未写入完成标记');
  });

  await checkAsync('点赞任务：开启超上限后做到设置值，不被服务端完成截断', async () => {
    let clicks = 0;
    const per = 30;
    const srvLimit = 2;
    const userLimit = 4;
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: userLimit, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: true, danmu: false, watch: false }
    };
    T.API.medalTasks = async () => ({
      ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
      tasks: [{
        jump_type: 'like',
        title: '每' + per + '次点赞',
        sub_title: Math.min(Math.floor(clicks / per), srvLimit) + '/' + srvLimit,
        add_text: '亲密度 +1',
        is_done: clicks >= per * srvLimit ? 1 : 0
      }]
    });
    T.API.likeReport = async (roomId, uid, n) => { clicks += n; return { code: 0 }; };
    T.Cfg.v.like.gapMin = 1;
    T.Cfg.v.like.gapMax = 1;
    T.Cfg.v.like.capClicks = 1000;
    T.Engine.running = true;
    T.Daily.date = '';
    T.Daily.rooms = {};
    const res = await T.Tasks.like({ roomId: 778, uid: 44 }, { maxRounds: userLimit });
    assertEq(res.status, 'done', '任务未完成：' + JSON.stringify(res));
    assertEq(clicks, per * userLimit, '应做到设置值 ' + userLimit + ' 轮');
    assert(T.Daily.isDone({ roomId: 778, uid: 44 }, 'like'), '未写入完成标记');
    /* 服务端仍停在 2/2，但不能因此把本地的「做满 4 轮」反复清掉 */
    const meta = { roomId: 778, uid: 44 };
    assertEq(T.Engine.keepOverflow(meta, 'like'), false, '做满后不应继续判定未完成');
    assertEq(T.Engine.taskState(meta, 'like'), 'done', '做满后应保持完成');

    /* 每房间点赞保护上限先到：也应写完成，避免对账清掉后无限重跑 */
    clicks = 0;
    T.Daily.rooms = {};
    T.Cfg.v.like.capClicks = 90;
    const meta2 = { roomId: 779, uid: 45 };
    const res2 = await T.Tasks.like(meta2, { maxRounds: userLimit });
    assertEq(res2.status, 'done', '撞保护上限也应完成：' + JSON.stringify(res2));
    assertEq(clicks, 90, '应停在保护上限');
    assert(T.Daily.isDone(meta2, 'like'), '撞保护上限也应写完成');
    /* 撞过保护上限后，进度永远到不了设置值：不能再判定未完成，
       否则每一轮调度都会重跑一次、刷一条「已做到 B 站任务上限」 */
    assertEq(T.Engine.keepOverflow(meta2, 'like'), false, '撞保护上限后不应继续判定未完成');
    assertEq(T.Engine.taskState(meta2, 'like'), 'done', '撞保护上限后应保持完成');
    assertEq(T.Engine.noteCapOut(meta2, 'like', userLimit, 90), false, '重复记录应返回 false（不再打日志）');
    T.Daily.done(meta2, 'like', false);
    const res3 = await T.Tasks.like(meta2, { maxRounds: userLimit });
    assertEq(res3.status, 'done', '撞保护上限后再调应直接完成');
    assertEq(clicks, 90, '撞保护上限后不应再点赞');
    T.Cfg.v.like.capClicks = 310;
    T.Cfg.v.taskLimit = prevTL;
  });

  check('点赞：升级当天按已发次数反推进度，不要求重做', () => {
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: 10, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: true, danmu: false, watch: false }
    };
    const meta = { roomId: 781, uid: 50 };
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    T.Data.taskCache.set('50', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [{ jump_type: 'like', title: '点赞30次', sub_title: '5/5', is_done: 1 }]
      }
    });
    /* 1.35.0 升级上来：本地已发 300 次，服务端只认 5 轮，没有 overBase 记录 */
    T.Daily.get(meta).like = 300;
    assertEq(T.Engine.progressOf(meta, 'like').cur, 10, '300 次应按 10 轮计，而不是停在服务端的 5');
    assertEq(T.Engine.limitReached(meta, 'like'), true, '已做满不应重做');
    assertEq(T.Engine.keepOverflow(meta, 'like'), false, '已做满不应继续');

    /* 只有 60 次（脚本刚上手、其余是手动点的）：保守按服务端 5 轮算 */
    T.Daily.get(meta).like = 60;
    T.Daily.get(meta).overBase = {};
    assertEq(T.Engine.progressOf(meta, 'like').cur, 5, '本地次数少于服务端已计入时应保守');
    T.Cfg.v.taskLimit = prevTL;
    T.Data.taskCache.delete('50');
  });

  /* 用户现场：设置 10 轮、服务端 5/5 已满、本地已发 300 次，
     旧逻辑按「5/10 未完成」反复调度，2 秒刷一条日志 */
  await checkAsync('点赞：服务端已满且本地已发满，不再重复调度', async () => {
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: 10, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: true, danmu: false, watch: false }
    };
    const meta = { roomId: 782, uid: 51 };
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    T.Data.taskCache.set('51', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [{ jump_type: 'like', title: '点赞30次', sub_title: '5/5', is_done: 1 }]
      }
    });
    T.Daily.get(meta).like = 300;
    let calls = 0;
    T.API.likeReport = async (roomId, uid, n) => { calls += n; return { code: 0 }; };
    T.Cfg.v.like.capClicks = 310;
    T.Engine.running = true;

    assertEq(T.Engine.taskState(meta, 'like'), 'done', '已做满 10 轮应显示完成');
    const res = await T.Tasks.like(meta, { maxRounds: 10 });
    assertEq(res.status, 'done', '应直接返回完成：' + JSON.stringify(res));
    assertEq(calls, 0, '不应再点赞');
    /* 模拟对账把完成标记清掉：下一轮调度仍应由进度判定为完成，而不是重跑 */
    T.Daily.done(meta, 'like', false);
    assertEq(T.Engine.taskState(meta, 'like'), 'done', '清掉标记后仍应判定完成');
    const res2 = await T.Tasks.like(meta, { maxRounds: 10 });
    assertEq(res2.status, 'done', '第二次调度应直接完成');
    assertEq(calls, 0, '第二次调度不应点赞');
    T.Cfg.v.taskLimit = prevTL;
    T.Data.taskCache.delete('51');
  });

  /* 用户现场：服务端 sub_title 延迟更新，卡片显示 2/10 而实际已发 9 条 */
  check('进度分子：按本地实际完成量，不被服务端延迟拖住', () => {
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: 0, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    };
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    const meta = { roomId: 785, uid: 54 };
    T.Data.taskCache.set('54', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [
          { jump_type: 'like', title: '点赞30次', sub_title: '2/5', is_done: 0 },
          { jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '2/10', is_done: 0 },
          { jump_type: 'watchLive', title: '观看30分钟', sub_title: '1/5', is_done: 0 }
        ]
      }
    });
    const d = T.Daily.get(meta);
    d.like = 120;
    d.danmu = 9;
    d.watch = 60 * 60;
    const like = T.Engine.progressOf(meta, 'like');
    const danmu = T.Engine.progressOf(meta, 'danmu');
    const watch = T.Engine.progressOf(meta, 'watch');
    assertEq(like.cur, 4, '点赞应按已点 120 次折成 4 轮，而不是服务端 2 轮');
    assertEq(like.srvCur, 2, '服务端原始值仍要保留');
    assertEq(danmu.cur, 9, '弹幕应按已发 9 条显示，而不是服务端 2 条');
    assertEq(watch.cur, 2, '观时应按已看 60 分钟折成 2 轮（服务端 1 轮）');
    T.Cfg.v.taskLimit = prevTL;
    T.Data.taskCache.delete('54');
  });

  /* 用户现场：房间设 2 轮、服务端任务有 5 轮，做到 2 轮后不该报红字 */
  await checkAsync('点赞：做到本房间上限但服务端未完成时不报红', async () => {
    const prevTL = T.Cfg.v.taskLimit;
    const prevWL = T.Cfg.v.whitelist;
    T.Cfg.v.taskLimit = {
      like: 5, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    };
    T.Cfg.v.whitelist = [{ roomId: 786, uid: 55, limits: { like: 2 } }];
    let clicks = 0;
    const per = 30;
    const srvLimit = 5;
    T.API.medalTasks = async () => ({
      ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
      tasks: [{
        jump_type: 'like',
        title: '每' + per + '次点赞',
        sub_title: Math.min(Math.floor(clicks / per), srvLimit) + '/' + srvLimit,
        add_text: '亲密度 +1',
        is_done: clicks >= per * srvLimit ? 1 : 0
      }]
    });
    T.API.likeReport = async (roomId, uid, n) => { clicks += n; return { code: 0 }; };
    T.Cfg.v.like.gapMin = 1;
    T.Cfg.v.like.gapMax = 1;
    T.Cfg.v.like.capClicks = 310;
    T.Engine.running = true;
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    const meta = { roomId: 786, uid: 55 };
    const res = await T.Tasks.like(meta, { maxRounds: 2 });
    assertEq(res.status, 'done', '做到本房间上限应按完成处理：' + JSON.stringify(res));
    assertEq(clicks, per * 2, '应只做 2 轮');
    assertEq(T.Daily.get(meta).err || '', '', '不应写红字');
    assertEq(T.Engine.taskState(meta, 'like'), 'done', '卡片应显示完成');
    T.Cfg.v.taskLimit = prevTL;
    T.Cfg.v.whitelist = prevWL;
  });

  /* 回归：服务端停在 2/2 时，进度必须按「实际做了几轮」算。
     以前分子直接取服务端已完成数，重跑会把 2/2 当成已做完，或反过来把 4 轮又做一遍 */
  await checkAsync('点赞：超上限分两段执行，按实际轮次续做', async () => {
    const per = 30;
    const srvLimit = 2;
    const target = 4;
    let clicks = 0;
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: target, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: true, danmu: false, watch: false }
    };
    T.API.medalTasks = async () => ({
      ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
      tasks: [{
        jump_type: 'like',
        title: '每' + per + '次点赞',
        sub_title: Math.min(Math.floor(clicks / per), srvLimit) + '/' + srvLimit,
        add_text: '亲密度 +1',
        is_done: clicks >= per * srvLimit ? 1 : 0
      }]
    });
    T.API.likeReport = async (roomId, uid, n) => { clicks += n; return { code: 0 }; };
    T.Cfg.v.like.gapMin = 1;
    T.Cfg.v.like.gapMax = 1;
    T.Cfg.v.like.capClicks = 310;
    T.Engine.running = true;
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    const meta = { roomId: 780, uid: 46 };

    const r1 = await T.Tasks.like(meta, { maxRounds: srvLimit });
    assertEq(r1.status, 'done', '第一段应完成：' + JSON.stringify(r1));
    assertEq(clicks, per * srvLimit, '第一段只应做到服务端上限 2 轮');
    assertEq(T.Engine.progressOf(meta, 'like').cur, srvLimit, '服务端 2/2 时进度应为 2');

    /* 相当于插件重启后重新调度：应从实际进度 2 续做到 4 */
    T.Daily.done(meta, 'like', false);
    const r2 = await T.Tasks.like(meta, { maxRounds: target });
    assertEq(r2.status, 'done', '续做应完成：' + JSON.stringify(r2));
    assertEq(clicks, per * target, '两段合计应正好做满 4 轮');
    assertEq(T.Engine.progressOf(meta, 'like').cur, target, '进度应为 4/4');
    assertEq(T.Engine.taskState(meta, 'like'), 'done', '做满后应为完成状态');
    assertEq(T.Engine.keepOverflow(meta, 'like'), false, '做满后不应继续');

    /* 第三次调度（对账清掉完成标记后）：不应再点赞 */
    T.Daily.done(meta, 'like', false);
    const r3 = await T.Tasks.like(meta, { maxRounds: target });
    assertEq(r3.status, 'done', '做满后再调应直接返回完成');
    assertEq(clicks, per * target, '做满后不应再点赞');
    T.Cfg.v.taskLimit = prevTL;
  });

  await checkAsync('弹幕：超上限分两段执行，按实际条数续做', async () => {
    const cap = 2;
    const target = 4;
    let sent = 0;
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: 0, danmu: target, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: true, watch: false }
    };
    T.API.medalTasks = async () => ({
      ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
      tasks: [{
        jump_type: 'sendDanmu',
        title: '发送1条弹幕',
        sub_title: Math.min(sent, cap) + '/' + cap,
        add_text: '亲密度 +1',
        is_done: sent >= cap ? 1 : 0
      }]
    });
    T.API.sendDanmu = async () => { sent++; return { code: 0, msg: '' }; };
    T.Cfg.v.danmu.gapMin = 1;
    T.Cfg.v.danmu.gapMax = 1;
    T.Engine.running = true;
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    const meta = { roomId: 8901, uid: 47, liveStatus: 0 };

    const r1 = await T.Tasks.danmu(meta, { maxCount: cap, noEmote: true });
    assertEq(r1.status, 'done', '第一段应完成：' + JSON.stringify(r1));
    assertEq(sent, cap, '第一段只应发到服务端上限 2 条');
    assertEq(T.Engine.progressOf(meta, 'danmu').cur, cap, '服务端 2/2 时进度应为 2');

    T.Daily.done(meta, 'danmu', false);
    const r2 = await T.Tasks.danmu(meta, { maxCount: target, noEmote: true });
    assertEq(r2.status, 'done', '续发应完成：' + JSON.stringify(r2));
    assertEq(sent, target, '两段合计应正好 4 条');
    assertEq(T.Engine.progressOf(meta, 'danmu').cur, target, '进度应为 4/4');

    T.Daily.done(meta, 'danmu', false);
    const r3 = await T.Tasks.danmu(meta, { maxCount: target, noEmote: true });
    assertEq(r3.status, 'done', '做满后再调应直接返回完成');
    assertEq(sent, target, '做满后不应再发');
    T.Cfg.v.taskLimit = prevTL;
  });

  check('观时：服务端到上限后按本地时长折算轮次', () => {
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: 0, danmu: 0, watch: 2,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: true }
    };
    const meta = { roomId: 8902, uid: 48 };
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    T.Data.taskCache.set('48', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [{ jump_type: 'watchLive', title: '观看10分钟', sub_title: '1/1', is_done: 1 }]
      }
    });
    T.Daily.get(meta).watch = 10 * 60;
    assertEq(T.Engine.progressOf(meta, 'watch').cur, 1, '服务端 1/1 + 本地 10 分钟 = 1 轮');
    T.Daily.get(meta).watch = 20 * 60;
    assertEq(T.Engine.progressOf(meta, 'watch').cur, 2, '本地多看 10 分钟应折算成第 2 轮');
    assertEq(T.Engine.limitReached(meta, 'watch'), true, '2/2 应视为完成');
    assertEq(T.Engine.keepOverflow(meta, 'watch'), false, '做满后不应继续');
    T.Cfg.v.taskLimit = prevTL;
    T.Data.taskCache.delete('48');
  });

  check('升级兼容：1.35.0 的 overHit 不会让做过的轮次重做', () => {
    const prevTL = T.Cfg.v.taskLimit;
    T.Cfg.v.taskLimit = {
      like: 4, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: true, danmu: false, watch: false }
    };
    const meta = { roomId: 8903, uid: 49 };
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    T.Data.taskCache.set('49', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [{ jump_type: 'like', title: '点赞30次', sub_title: '2/2', is_done: 1 }]
      }
    });
    const r = T.Daily.get(meta);
    r.like = 60;
    r.overHit = { like: 4 };
    assertEq(T.Engine.progressOf(meta, 'like').cur, 4, '应按 overHit 反推为 4 轮');
    assertEq(T.Engine.limitReached(meta, 'like'), true, '升级后不应重做');
    T.Cfg.v.taskLimit = prevTL;
    T.Data.taskCache.delete('49');
  });

  check('脚本内不再引用已删除的 overHitDone', () => {
    assert(code.indexOf('overHitDone') < 0, '仍有 overHitDone 调用，运行时会报错');
  });

  await checkAsync('发弹幕任务：按开关决定是否给开播房间发', async () => {
    T.Cfg.v.danmu.onlyWhenNotLive = true;
    let sent = 0;
    const need = 2;
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{
        jump_type: 'sendDanmu',
        title: '发送1条弹幕',
        sub_title: sent + '/' + need,
        add_text: '亲密度 +1',
        is_done: sent >= need ? 1 : 0
      }]
    });
    T.API.sendDanmu = async () => {
      sent++;
      return { code: 0, msg: '' };
    };
    T.Cfg.v.danmu.gapMin = 1;
    T.Cfg.v.danmu.gapMax = 1;
    T.Engine.running = true;
    const res = await T.Tasks.danmu({ roomId: 888, uid: 43, liveStatus: 0 });
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(sent, need);

    const live = await T.Tasks.danmu({ roomId: 889, uid: 43, liveStatus: 1 });
    assertEq(live.status, 'skip', '开关打开时开播房间不应发弹幕');
    T.Cfg.v.danmu.onlyWhenNotLive = false;
    const live2 = await T.Tasks.danmu({ roomId: 890, uid: 43, liveStatus: 1 });
    assert(live2.status !== 'skip', '开关关闭时开播房间应可发弹幕，实际 ' + JSON.stringify(live2));
    T.Cfg.v.danmu.onlyWhenNotLive = true;
  });

  await checkAsync('发弹幕任务：默认先发免费表情', async () => {
    let listCalls = 0;
    let emoteSends = 0;
    let textSends = 0;
    let sentEmote = '';
    let progressed = false;
    T.API.emoticons = async () => {
      listCalls++;
      return [{
        pkg_type: 2,
        pkg_name: '房间表情',
        emoticons: [{ emoticon_unique: 'room_9101_1', emoji: '好耶', url: 'https://i0.hdslb.com/x.png', width: 100, height: 100, unlock_need_level: 1 }]
      }];
    };
    T.API.sendEmoticon = async (rid, e) => {
      emoteSends++;
      sentEmote = e && e.emoticon_unique;
      progressed = true;
      return { code: 0, msg: '' };
    };
    T.API.sendDanmu = async () => { textSends++; return { code: 0, msg: '' }; };
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{
        jump_type: 'sendDanmu',
        title: '发送1条弹幕',
        sub_title: (progressed ? 1 : 0) + '/1',
        add_text: '亲密度 +1',
        is_done: progressed ? 1 : 0
      }]
    });
    T.Data.clearTaskCache();
    T.Daily.date = '';
    T.Daily.rooms = {};
    T.Cfg.v.danmu.useRoomEmoticons = true;
    T.Cfg.v.danmu.onlyWhenNotLive = true;
    T.Engine.running = true;
    const res = await T.Tasks.danmu({ roomId: 9101, uid: 9101, liveStatus: 0 });
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(emoteSends, 1, '应发送 1 条表情弹幕');
    assertEq(sentEmote, 'room_9101_1', '应使用接口返回的表情标识');
    assertEq(textSends, 0, '表情可用时不应再发文字');
    assertEq(listCalls, 1, '表情列表只应读取一次');
  });

  await checkAsync('发弹幕任务：表情发送失败时回落到文字', async () => {
    let emoteSends = 0;
    let textSends = 0;
    let listCalls = 0;
    let progressed = false;
    T.API.emoticons = async () => {
      listCalls++;
      return [{
        pkg_type: 2,
        emoticons: [{ emoticon_unique: 'room_9102_1', emoji: '好耶', url: 'u' }]
      }];
    };
    T.API.sendEmoticon = async () => { emoteSends++; return { code: -400, message: '表情不可用' }; };
    T.API.sendDanmu = async () => {
      textSends++;
      progressed = true;
      return { code: 0, msg: '' };
    };
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{
        jump_type: 'sendDanmu',
        title: '发送1条弹幕',
        sub_title: (progressed ? 1 : 0) + '/1',
        add_text: '亲密度 +1',
        is_done: progressed ? 1 : 0
      }]
    });
    T.Data.clearTaskCache();
    T.Daily.date = '';
    T.Daily.rooms = {};
    T.Cfg.v.danmu.useRoomEmoticons = true;
    const res = await T.Tasks.danmu({ roomId: 9102, uid: 9102, liveStatus: 0 });
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(emoteSends, 1, '应尝试过一次表情');
    assertEq(textSends, 1, '表情失败后应用文字补发');
    assertEq(listCalls, 1, '首次应只读取一次表情列表');
    /* 失败后应清掉该房间缓存，下次重新读取表情（用户可能刚改过表情包配置） */
    T.Data.clearTaskCache();
    T.Daily.rooms = {};
    progressed = false;
    await T.Tasks.danmu({ roomId: 9102, uid: 9102, liveStatus: 0 });
    assertEq(listCalls, 2, '表情发送失败后应清缓存并重新读取');
  });

  await checkAsync('发弹幕任务：关闭开关后不再请求表情接口', async () => {
    let listCalls = 0;
    let textSends = 0;
    let progressed = false;
    T.API.emoticons = async () => { listCalls++; return [{ pkg_type: 2, emoticons: [{ emoticon_unique: 'room_9103_1', emoji: 'x', url: 'u' }] }]; };
    T.API.sendEmoticon = async () => ({ code: 0, msg: '' });
    T.API.sendDanmu = async () => {
      textSends++;
      progressed = true;
      return { code: 0, msg: '' };
    };
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{
        jump_type: 'sendDanmu',
        title: '发送1条弹幕',
        sub_title: (progressed ? 1 : 0) + '/1',
        add_text: '亲密度 +1',
        is_done: progressed ? 1 : 0
      }]
    });
    T.Data.clearTaskCache();
    T.Daily.date = '';
    T.Daily.rooms = {};
    T.Cfg.v.danmu.useRoomEmoticons = false;
    const res = await T.Tasks.danmu({ roomId: 9103, uid: 9103, liveStatus: 0 });
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(listCalls, 0, '关闭后不应请求表情列表');
    assertEq(textSends, 1, '关闭后应发文字');
    T.Cfg.v.danmu.useRoomEmoticons = true;
  });

  await checkAsync('发弹幕任务：表情照发，服务端计数延迟不影响完成判定', async () => {
    let emoteSends = 0;
    let textSends = 0;
    T.API.emoticons = async () => ([{ pkg_type: 2, emoticons: [{ emoticon_unique: 'room_9104_1', emoji: 'x', url: 'u' }] }]);
    T.API.sendEmoticon = async () => { emoteSends++; return { code: 0, msg: '' }; };
    T.API.sendDanmu = async () => { textSends++; return { code: 0, msg: '' }; };
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{ jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '0/1', add_text: '亲密度 +1', is_done: 0 }]
    });
    T.Data.clearTaskCache();
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    T.Cfg.v.danmu.useRoomEmoticons = true;
    const meta = { roomId: 9104, uid: 9104, liveStatus: 0 };
    /* 服务端 sub_title 一直停在 0/1：按本次计划发满即完成，不再改文字、不写红字 */
    const res = await T.Tasks.danmu(meta, { maxCount: 1 });
    assertEq(res.status, 'done', '发满计划条数应按完成处理：' + JSON.stringify(res));
    assertEq(emoteSends, 1, '应发 1 条表情');
    assertEq(textSends, 0, '不应因为服务端数字没变就改用文字');
    assertEq(!!T.Daily.get(meta).emoteOff, false, '不应再记「表情未计入」');
    assertEq(T.Daily.get(meta).err, '', '不应写红字');
  });

  await checkAsync('发弹幕任务：频率过快等 5 秒重试表情，不改文字', async () => {
    let emoteTries = 0;
    let textSends = 0;
    const waits = [];
    const origSleep = T.Engine.taskSleep;
    T.Engine.taskSleep = async (ms) => { waits.push(ms); return true; };
    try {
      T.API.emoticons = async () => ([{ pkg_type: 2, emoticons: [{ emoticon_unique: 'room_9201_1', emoji: 'x', url: 'u' }] }]);
      T.API.sendEmoticon = async () => {
        emoteTries++;
        if (emoteTries <= 2) return { code: -1, message: '您发送弹幕的频率过快' };
        return { code: 0, msg: '' };
      };
      T.API.sendDanmu = async () => { textSends++; return { code: 0, msg: '' }; };
      T.API.medalTasks = async () => ({
        ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
        tasks: [{ jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '0/1', add_text: 'x', is_done: 0 }]
      });
      T.Data.clearTaskCache();
      T.Daily.date = todayOf();
      T.Daily.rooms = {};
      T.Cfg.v.danmu.useRoomEmoticons = true;
      T.Engine.running = true;
      const meta = { roomId: 9201, uid: 9201, liveStatus: 0 };
      const res = await T.Tasks.danmu(meta, { maxCount: 1 });
      assertEq(res.status, 'done', '重试成功后应完成：' + JSON.stringify(res));
      assertEq(emoteTries, 3, '应重试表情 3 次');
      assertEq(textSends, 0, '限速不应改用文字');
      assert(waits.indexOf(5000) >= 0, '应等待 5 秒：' + JSON.stringify(waits));

      /* 连续 3 次都被限速：放弃本次任务，也不改用文字 */
      emoteTries = 0;
      T.API.sendEmoticon = async () => { emoteTries++; return { code: -1, message: '您发送弹幕的频率过快' }; };
      T.Daily.rooms = {};
      const res2 = await T.Tasks.danmu(meta, { maxCount: 1 });
      assertEq(res2.status, 'fail', '连续限速应判失败：' + JSON.stringify(res2));
      assertEq(emoteTries, 3, '最多重试 3 次');
      assertEq(textSends, 0, '连续限速也不应改用文字');
      assert(T.Daily.get(meta).err.indexOf('限速') >= 0, '红字应写明限速');
    } finally {
      T.Engine.taskSleep = origSleep;
    }
  });

  await checkAsync('发弹幕任务：表情不可用只影响本次调用', async () => {
    let emoteTries = 0;
    let textSends = 0;
    T.API.emoticons = async () => ([{ pkg_type: 2, emoticons: [{ emoticon_unique: 'room_9202_1', emoji: 'x', url: 'u' }] }]);
    T.API.sendEmoticon = async () => { emoteTries++; return { code: -1, message: '表情已下架' }; };
    T.API.sendDanmu = async () => { textSends++; return { code: 0, msg: '' }; };
    T.API.medalTasks = async () => ({
      ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
      tasks: [{ jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '0/2', add_text: 'x', is_done: 0 }]
    });
    T.Data.clearTaskCache();
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    T.Cfg.v.danmu.useRoomEmoticons = true;
    T.Engine.running = true;
    const meta = { roomId: 9202, uid: 9202, liveStatus: 0 };
    const res = await T.Tasks.danmu(meta, { maxCount: 2 });
    assertEq(res.status, 'done', '文字兜底后应完成：' + JSON.stringify(res));
    assertEq(emoteTries, 1, '表情不可用只试一次就切文字');
    assertEq(textSends, 2, '本次调用应改用文字发满 2 条');

    /* 下一次调用仍从表情开始（上次的 useEmote=false 不跨调用） */
    T.Daily.rooms = {};
    T.Data.clearTaskCache();
    await T.Tasks.danmu({ roomId: 9203, uid: 9202, liveStatus: 0 }, { maxCount: 1 });
    assertEq(emoteTries, 2, '下一次调用应重新尝试表情');
  });

  await checkAsync('刷新：等待中的任务立即退出', async () => {
    T.Engine.running = true;
    const p = T.Engine.taskSleep(3000, null, '');
    T.Engine.runId = T.Engine.runId + 1;
    const ok = await p;
    assertEq(ok, false, '轮次变化后等待应立刻返回 false');
  });

  check('停止：保留房间锁，避免新旧任务并发', () => {
    const prev = T.Engine.running;
    T.Engine.running = true;
    T.Engine.busyTask.add('9999');
    T.Engine.busyWatch.add('9999');
    T.Engine.watchGuard.set('9999', 1);
    T.Engine.stop('测试');
    assert(T.Engine.busyTask.has('9999'), 'stop 不应清空 busyTask');
    assert(T.Engine.busyWatch.has('9999'), 'stop 不应清空 busyWatch');
    assert(T.Engine.watchGuard.has('9999'), 'stop 不应清空 watchGuard');
    T.Engine.busyTask.delete('9999');
    T.Engine.busyWatch.delete('9999');
    T.Engine.watchGuard.delete('9999');
    T.Engine.running = prev;
  });

  await checkAsync('刷新：旧任务泳道在选房后复核轮次', async () => {
    const origPick = T.Engine.pick;
    const origDo = T.Engine.doRoomTasks;
    const prevRunning = T.Engine.running;
    const prevRunId = T.Engine.runId;
    let picked = 0;
    let ran = 0;
    T.Net.resetRisk();
    T.Engine.running = true;
    T.Engine.runId = prevRunId;
    T.Engine.pick = async () => {
      picked++;
      T.Engine.runId = prevRunId + 1;
      return { roomId: 9911 };
    };
    T.Engine.doRoomTasks = async () => { ran++; };
    try {
      await T.Engine.taskWorker(prevRunId);
    } finally {
      T.Engine.pick = origPick;
      T.Engine.doRoomTasks = origDo;
      T.Engine.running = prevRunning;
      T.Engine.runId = prevRunId;
    }
    assertEq(picked, 1, '应只选房一次');
    assertEq(ran, 0, '轮次变化后旧泳道不应进入任务');
  });

  await checkAsync('刷新：旧弹幕循环在下一个检查点停止', async () => {
    let emoteSends = 0;
    T.API.emoticons = async () => ([{ pkg_type: 2, emoticons: [{ emoticon_unique: 'room_9204_1', emoji: 'x', url: 'u' }] }]);
    T.API.sendEmoticon = async () => {
      emoteSends++;
      /* 模拟发送途中用户刷新插件 */
      T.Engine.runId = T.Engine.runId + 1;
      return { code: 0, msg: '' };
    };
    T.API.sendDanmu = async () => ({ code: 0, msg: '' });
    T.API.medalTasks = async () => ({
      ok: true, guard: 0, free: 0, reachLimit: false, journey: null,
      tasks: [{ jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '0/5', add_text: 'x', is_done: 0 }]
    });
    T.Data.clearTaskCache();
    T.Daily.date = todayOf();
    T.Daily.rooms = {};
    T.Cfg.v.danmu.useRoomEmoticons = true;
    T.Engine.running = true;
    const res = await T.Tasks.danmu({ roomId: 9204, uid: 9204, liveStatus: 0 }, { maxCount: 5 });
    assertEq(res.status, 'halt', '刷新后应中断：' + JSON.stringify(res));
    assertEq(emoteSends, 1, '只应发出刷新前的那一条');
  });

  await checkAsync('发弹幕任务：只有官方小表情时改用文字', async () => {
    let emoteSends = 0;
    let textSends = 0;
    let progressed = false;
    T.API.emoticons = async () => ([{
      pkg_type: 3,
      pkg_name: 'emoji',
      emoticons: [
        { emoticon_unique: 'emoji_208', emoji: '[dog]', perm: 1 },
        { emoticon_unique: 'emoji_209', emoji: '[花]', perm: 1 }
      ]
    }]);
    T.API.sendEmoticon = async () => { emoteSends++; progressed = true; return { code: 0, msg: '' }; };
    T.API.sendDanmu = async () => { textSends++; progressed = true; return { code: 0, msg: '' }; };
    T.API.medalTasks = async () => ({
      ok: true,
      guard: 0,
      free: 0,
      reachLimit: false,
      journey: null,
      tasks: [{
        jump_type: 'sendDanmu',
        title: '发送1条弹幕',
        sub_title: (progressed ? 1 : 0) + '/1',
        add_text: '亲密度 +1',
        is_done: progressed ? 1 : 0
      }]
    });
    T.Data.clearTaskCache();
    T.Daily.date = '';
    T.Daily.rooms = {};
    T.Engine.running = true;
    const res = await T.Tasks.danmu({ roomId: 9107, uid: 9107, liveStatus: 0 });
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(emoteSends, 0, '官方小表情不应作为表情弹幕发送');
    assertEq(textSends, 1, '没有 UP 表情时应改用文字');
  });

  await checkAsync('点亮任务：已点亮直接完成', async () => {
    T.Data.medals.set('u44', { medal: { is_lighted: 1, target_id: 44 }, room_info: { room_id: 999 } });
    T.Data.medals.set('999', T.Data.medals.get('u44'));
    const res = await T.Tasks.light({ roomId: 999, uid: 44, liveStatus: 1 });
    assertEq(res.status, 'done');
  });

  await checkAsync('观时心跳签名：rule 0/1 均可产出摘要', async () => {
    const heart = new T.RoomHeart({ roomId: 1, uid: 2, areaId: 3, parentAreaId: 4 }, 120);
    heart.secretKey = 'secret';
    heart.secretRule = [0];
    const h0 = await heart.spyder();
    assert(/^[0-9a-f]{32}$/.test(h0.s), 'MD5 摘要格式不对：' + h0.s);
    heart.secretRule = [1];
    const h1 = await heart.spyder();
    assert(/^[0-9a-f]{40}$/.test(h1.s), 'SHA1 摘要格式不对：' + h1.s);
    heart.secretRule = [0, 1];
    const h2 = await heart.spyder();
    assert(/^[0-9a-f]{40}$/.test(h2.s), '链式加密格式不对：' + h2.s);
  });

  await checkAsync('观时签名 ts 必须与请求参数一致（回归测试）', async () => {
    const heart = new T.RoomHeart({ roomId: 111, uid: 222, areaId: 333, parentAreaId: 444 }, 120);
    heart.secretKey = 'k0';
    heart.secretRule = [0];
    heart.seq = 5;
    heart.ets = 1700000000;
    heart.interval = 20;
    const sig = await heart.spyder();
    /* 用返回的 ts 重建签名输入，必须与 s 完全一致 */
    const payload = {
      platform: 'web',
      parent_id: 444,
      area_id: 333,
      seq_id: 5,
      room_id: 111,
      buvid: heart.device[0],
      uuid: heart.device[1],
      ets: 1700000000,
      time: 20,
      ts: sig.ts
    };
    assertEq(sig.s, T.Crypto.hmacMd5Hex('k0', JSON.stringify(payload)), '签名与 ts 不一致');
    assert(typeof sig.ts === 'number' && sig.ts > 1600000000000, 'ts 不是毫秒时间戳：' + sig.ts);
  });

  check('粉丝牌三态：未知放行、确定无牌则整间不可做', () => {
    const m = { roomId: 7301, uid: 7301, liveStatus: 1 };
    T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
    T.Daily.rooms = {};
    T.Data.medals = new Map();
    T.Data.medalsAt = 0;

    assertEq(T.Data.medalState(m), 'unknown', '未加载时应为 unknown');
    assertEq(T.Engine.taskState(m, 'light'), 'ready', '未知状态不能判定无牌');
    assertEq(T.Engine.taskState(m, 'watch'), 'waitLight', '未知状态仍按原逻辑等待点亮');

    T.Data.medalsAt = Date.now();
    assertEq(T.Data.medalState(m), 'none');
    ['light', 'like', 'danmu', 'share'].forEach((n) => {
      assertEq(T.Engine.taskState(m, n), 'nomedal', n + ' 应显示无牌');
    });
    assertEq(T.Engine.hasWork(m), false, '无牌房间不应被选走');
    assertEq(T.Engine.allDone(m), true, '无牌房间应按不适用计入完成');

    T.Data.medals.set('u7301', { medal: { target_id: 7301 } });
    assertEq(T.Data.medalState(m), 'has');
    assertEq(T.Engine.taskState(m, 'light'), 'ready');

    T.Data.medals.clear();
    T.Data.medalsAt = 0;
  });

  await checkAsync('无牌房间：当天首次遇到时确认一次，之后直接跳过', async () => {
    const m = { roomId: 7302, uid: 7302, liveStatus: 1, uname: '无牌测试' };
    T.Data.medals = new Map();
    T.Data.medalsAt = Date.now();
    let calls = 0;
    const orig = T.Data.refreshMedals;
    T.Data.refreshMedals = async () => { calls++; return T.Data.medals; };
    T.Engine.resetMedalCache();

    assertEq(await T.Engine.medalOk(m), false, '确认无牌后应跳过');
    assertEq(calls, 1, '首次遇到应强制确认一次');
    assertEq(await T.Engine.medalOk(m), false);
    assertEq(calls, 1, '同一天不再重复确认');

    T.Data.refreshMedals = orig;
    T.Engine.resetMedalCache();
    T.Data.medalsAt = 0;
  });

  await checkAsync('索引未加载成功：照常执行，不误杀房间', async () => {
    const m = { roomId: 7303, uid: 7303, liveStatus: 1 };
    T.Data.medals = new Map();
    T.Data.medalsAt = 0;
    let calls = 0;
    const orig = T.Data.refreshMedals;
    T.Data.refreshMedals = async () => { calls++; return T.Data.medals; };
    T.Engine.resetMedalCache();

    assertEq(await T.Engine.medalOk(m), true, 'unknown 必须放行');
    assertEq(calls, 1, '应在后台补拉一次');
    assertEq(T.Engine.noMedal.size, 0, '不应把房间记成无牌');

    T.Data.refreshMedals = orig;
    T.Engine.resetMedalCache();
  });

  await checkAsync('分享：今日已尝试过就不再调用接口', async () => {
    const meta = { roomId: 7806, uid: 7806 };
    T.Daily.rooms = {};
    T.Data.medals.set('u7806', { medal: { target_id: 7806, today_feed: 3 }, room_info: { room_id: 7806 } });
    let calls = 0;
    const origShare = T.API.shareConf;
    T.API.shareConf = async () => { calls++; return { code: 0 }; };
    T.Daily.get(meta).shareTried = true;
    const res = await T.Tasks.share(meta);
    assertEq(res.status, 'defer', JSON.stringify(res));
    assertEq(calls, 0, '已尝试过不应再调接口');
    T.API.shareConf = origShare;
  });

  check('分享：已尝试后固定为待确认，刷新也不会重跑', () => {
    T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
    T.Daily.rooms = {};
    const m = { roomId: 7807, uid: 7807, liveStatus: 0 };
    T.Data.medals.set('u7807', { medal: { target_id: 7807, today_feed: 3 }, room_info: { room_id: 7807 } });
    assertEq(T.Engine.taskState(m, 'share'), 'ready');
    T.Daily.get(m).shareTried = true;
    assertEq(T.Engine.taskState(m, 'share'), 'defer', '已尝试应显示待确认');
    T.Daily.get(m).done.share = true;
    assertEq(T.Engine.taskState(m, 'share'), 'done', '已完成优先于待确认');
  });

  check('红字：只有对应任务成功才清除', () => {
    const m = { roomId: 7311, uid: 7311 };
    T.Daily.rooms = {};
    T.Daily.setErr(m, '观时：心跳中断', 'watch');
    assertEq(T.Daily.get(m).errTask, 'watch');
    T.Daily.done(m, 'light', true);
    assert(T.Daily.get(m).err !== '', '点亮成功不应清掉观时的红字');
    T.Daily.done(m, 'watch', true);
    assertEq(T.Daily.get(m).err, '', '对应任务成功应清除红字');
  });

  check('红字：点一下手动清除', () => {
    const m = { roomId: 7312, uid: 7312 };
    T.Daily.rooms = {};
    T.Daily.setErr(m, '点赞：连续失败', 'like');
    T.Actions.clearErr({ getAttribute: () => '7312' });
    assertEq(T.Daily.get(m).err, '', '点击后应清除');
    assertEq(T.Actions.clearErr({ getAttribute: () => '7312' }), undefined, '重复清除不应报错');
  });

  check('满储：观时与分享跳过，点亮/点赞/弹幕保留', () => {
    T.Cfg.v.tasks = { light: true, like: true, danmu: true, watch: true, share: true };
    T.Cfg.v.freeFullLite = true;
    T.Daily.rooms = {};
    const full = { roomId: 7411, uid: 7411, liveStatus: 1, freeIntimacy: 100, freeReach: true };
    const partial = { roomId: 7412, uid: 7412, liveStatus: 1, freeIntimacy: 99 };
    T.Data.medals.set('u7411', { medal: { target_id: 7411 } });
    T.Data.medals.set('u7412', { medal: { target_id: 7412 } });

    assertEq(T.Engine.isFreeFull(full), true, '满 100 应判定满储');
    assertEq(T.Engine.isFreeFull(partial), false, '99 不应判定满储');
    assertEq(T.Engine.taskState(full, 'watch'), 'skip');
    assertEq(T.Engine.taskState(full, 'share'), 'skip');
    assertEq(T.Engine.taskState(full, 'light'), 'ready', '点亮仍要做');
    assertEq(T.Engine.taskState(full, 'like'), 'ready', '点赞仍要做');
    assertEq(T.Engine.taskState(full, 'danmu'), 'waitOffline', '直播中弹幕按设置等下播');
    T.Daily.done(partial, 'light', true);
    assertEq(T.Engine.taskState(partial, 'watch'), 'ready', '未满储应正常观时');

    ['light', 'like', 'danmu'].forEach((n) => T.Daily.done(full, n, true));
    assertEq(T.Engine.allDone(full), true, '满储时观时/分享应视为不适用');

    T.Cfg.v.freeFullLite = false;
    assertEq(T.Engine.taskState(full, 'watch'), 'ready', '关闭策略后应恢复观时');
    assertEq(T.Engine.allDone(full), false, '关闭策略后观时仍算未完成');
    T.Cfg.v.freeFullLite = true;
    T.Data.medals.delete('u7411');
    T.Data.medals.delete('u7412');
  });

  check('配置：满储只维持点亮默认开启', () => {
    assertEq(T.Cfg.v.freeFullLite, true, '默认应开启');
  });

  check('主控：Web Locks 释放会让出执行权', () => {
    const prev = {
      on: T.Leader._onChange, was: T.Leader._was, rel: T.Leader._release,
      lead: T.Leader.isLeader, mode: T.Leader.mode
    };
    const fired = [];
    T.Leader._onChange = (v) => fired.push(v);
    T.Leader._was = true;
    T.Leader.isLeader = true;
    T.Leader._release = () => fired.push('released');
    assertEq(T.Leader.release(), true, '持有锁时应能释放');
    assertEq(T.Leader.isLeader, false, '释放后不应再是主控');
    assert(fired.indexOf(false) >= 0, '应通知失去执行权');
    assert(fired.indexOf('released') >= 0, '应调用锁的释放函数');
    assertEq(T.Leader.release(), false, '未持有时释放应返回 false');
    T.Leader._onChange = prev.on;
    T.Leader._was = prev.was;
    T.Leader._release = prev.rel;
    T.Leader.isLeader = prev.lead;
    T.Leader.mode = prev.mode;
  });

  await checkAsync('主控：手动接管（租约模式）', async () => {
    const prev = {
      mode: T.Leader.mode, lead: T.Leader.isLeader, was: T.Leader._was,
      auto: T.Leader._autoStart, queued: T.Leader._queued, want: T.Leader._wantStart, manual: T.Leader._manualStart
    };
    T.Leader.mode = 'lease';
    T.Leader.isLeader = false;
    T.Leader._was = false;
    T.Leader._autoStart = false;
    T.Leader._queued = false;
    const ok = await T.Leader.takeover(800);
    assertEq(ok, true, '接管应成功');
    assertEq(T.Leader.isLeader, true, '接管后应成为主控');
    assertEq(T.Leader.autoStartAllowed(), true, '手动接管后应允许启动');
    T.Leader.mode = prev.mode;
    T.Leader.isLeader = prev.lead;
    T.Leader._was = prev.was;
    T.Leader._autoStart = prev.auto;
    T.Leader._queued = prev.queued;
    T.Leader._wantStart = prev.want;
    T.Leader._manualStart = prev.manual;
  });

  check('主控：执行方式可读', () => {
    const prev = T.Leader.mode;
    T.Leader.mode = 'locks';
    assertEq(T.Leader.describe(), 'Web Locks');
    T.Leader.mode = 'lease';
    assertEq(T.Leader.describe(), '租约');
    T.Leader.mode = prev;
  });

  check('任务上限：留空跟随服务端，房间/全局/服务端取小', () => {
    const prevTL = T.Cfg.v.taskLimit;
    const prevWL = T.Cfg.v.whitelist;
    const prevMedals = T.Data.medals;

    T.Cfg.v.taskLimit = {
      like: 0, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    };
    T.Cfg.v.whitelist = [{ roomId: 7401, uid: 7401 }];
    T.Data.medals = new Map();
    T.Data.medals.set('u7401', { medal: { target_id: 7401 }, room_info: { room_id: 7401 } });
    T.Data.taskCache.set('7401', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [
          { jump_type: 'like', title: '点赞30次', sub_title: '1/5', is_done: 0 },
          { jump_type: 'sendDanmu', title: '发送10条弹幕', sub_title: '2/10', is_done: 0 },
          { jump_type: 'watchLive', title: '观看30分钟', sub_title: '1/5', is_done: 0 }
        ]
      }
    });
    const meta = { roomId: 7401, uid: 7401 };

    assertEq(T.Engine.limitOf(meta, 'like'), 5, '留空时跟随服务端 5');
    assertEq(T.Engine.limitOf(meta, 'danmu'), 10, '弹幕跟随服务端 10');
    assertEq(T.Engine.limitOf(meta, 'light'), 0, '点亮不设上限');

    T.Cfg.v.whitelist[0].limits = { like: 2 };
    assertEq(T.Engine.limitOf(meta, 'like'), 2, '房间设 2 应生效');
    T.Cfg.v.taskLimit.like = 3;
    assertEq(T.Engine.limitOf(meta, 'like'), 2, '房间 2 与全局 3 取小');
    T.Cfg.v.taskLimit.like = 1;
    assertEq(T.Engine.limitOf(meta, 'like'), 1, '全局 1 更小');

    T.Cfg.v.taskLimit.like = 10;
    T.Cfg.v.whitelist[0].limits = { like: 8 };
    assertEq(T.Engine.limitOf(meta, 'like'), 5, '未突破时仍被服务端 5 限制');
    T.Cfg.v.taskLimit.brk.like = true;
    assertEq(T.Engine.limitOf(meta, 'like'), 8, '突破后按 8 执行');

    /* 上限留空时，开启突破也没有可超过的目标，仍跟随服务端 */
    T.Cfg.v.taskLimit.like = 0;
    assertEq(T.Engine.limitOf(meta, 'like'), 5, '留空 + 突破仍跟随服务端 5');
    T.Cfg.v.taskLimit.brk.like = false;

    T.Cfg.v.whitelist[0].limits = { like: 1 };
    assertEq(T.Engine.limitReached(meta, 'like'), true, '1/1 应视为完成');
    T.Cfg.v.whitelist[0].limits = { like: 3 };
    assertEq(T.Engine.limitReached(meta, 'like'), false, '1/3 未完成');

    /* 开启突破、上限高于服务端且还没做满：服务端完成也不算完成 */
    T.Cfg.v.taskLimit.like = 8;
    T.Cfg.v.taskLimit.brk.like = true;
    T.Cfg.v.whitelist[0].limits = { like: 8 };
    T.Data.taskCache.set('7401', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [{ jump_type: 'like', title: '点赞30次', sub_title: '5/5', is_done: 1 }]
      }
    });
    assertEq(T.Engine.keepOverflow(meta, 'like'), true, '5/8 应继续做');
    assertEq(T.Engine.limitOf(meta, 'like'), 8, '突破后目标为 8');
    T.Daily.done(meta, 'like', true);
    assertEq(T.Engine.taskState(meta, 'like'), 'ready', '超上限未做满不应显示完成');
    assertEq(T.Daily.isDone(meta, 'like'), false, '应清掉旧的完成标记');

    T.Cfg.v.whitelist[0].limits = { like: 3 };
    T.Daily.done(meta, 'like', false);
    assertEq(T.Engine.keepOverflow(meta, 'like'), false, '房间上限低于服务端完成数时不再继续');
    assertEq(T.Engine.limitReached(meta, 'like'), true, '3/3 应视为完成');

    T.Cfg.v.taskLimit = prevTL;
    T.Cfg.v.whitelist = prevWL;
    T.Data.medals = prevMedals;
    T.Data.taskCache.delete('7401');
  });

  check('卡片：任务标签显示 n/m，设置可关闭', () => {
    const prevTL = T.Cfg.v.taskLimit;
    const prevWL = T.Cfg.v.whitelist;
    const prevMedals = T.Data.medals;
    const prevPop = T.ListView.taskPop;

    T.Cfg.v.taskLimit = {
      like: 5, danmu: 10, watch: 5,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    };
    T.Cfg.v.whitelist = [{ roomId: 7401, uid: 7401, limits: { like: 2, watch: 1 } }];
    T.Data.medals = new Map();
    T.Data.medals.set('u7401', { medal: { target_id: 7401 }, room_info: { room_id: 7401 } });
    T.Data.taskCache.set('7401', {
      at: Date.now(),
      data: {
        ok: true,
        tasks: [
          { jump_type: 'like', title: '点赞30次', sub_title: '1/5', is_done: 0 },
          { jump_type: 'sendDanmu', title: '发送10条弹幕', sub_title: '2/10', is_done: 0 },
          { jump_type: 'watchLive', title: '观看30分钟', sub_title: '1/5', is_done: 0 }
        ]
      }
    });

    let html = T.ListView.render();
    assert(html.indexOf('点赞 1/2') >= 0, '点赞应显示 1/2：' + html.slice(0, 60));
    assert(html.indexOf('弹幕 2/10') >= 0, '弹幕应显示 2/10');
    assert(html.indexOf('观时 1/1') >= 0, '观时应显示 1/1 并已完成');

    /* 按任务独立控制：只关弹幕，点赞/观时应继续显示 */
    T.Cfg.v.taskLimit.show.danmu = false;
    html = T.ListView.render();
    assert(html.indexOf('2/10') < 0, '弹幕关闭后不应显示 n/m');
    assert(html.indexOf('点赞 1/2') >= 0, '点赞不应受影响');

    T.Cfg.v.taskLimit.show.danmu = true;
    T.Cfg.v.taskLimit.show.like = false;
    T.Cfg.v.taskLimit.show.watch = false;
    html = T.ListView.render();
    assert(html.indexOf('1/2') < 0 && html.indexOf('1/1') < 0, '全部关闭后不应显示 n/m');
    T.Cfg.v.taskLimit.show.like = true;
    T.Cfg.v.taskLimit.show.watch = true;

    T.ListView.taskPop = '7401';
    const pop = T.ListView.taskPopHtml();
    assert(pop.indexOf('data-room-limit="like"') >= 0, '点赞应有滑块');
    assert(pop.indexOf('data-room-limit="danmu"') >= 0, '弹幕应有滑块');
    assert(pop.indexOf('data-room-limit="watch"') >= 0, '观时应有滑块');
    assert(pop.indexOf('data-room-limit="light"') < 0, '点亮不应有滑块');

    /* 滑块最大值 = 实际生效上限：关闭超上限时被服务端压低，开启后按设置值 */
    T.Cfg.v.taskLimit.like = 9;
    let pop2 = T.ListView.taskPopHtml();
    assert(/data-room-limit="like"[^>]*data-max="5"/.test(pop2), '关闭时滑块最大值应为服务端 5');
    T.Cfg.v.taskLimit.brk.like = true;
    pop2 = T.ListView.taskPopHtml();
    assert(/data-room-limit="like"[^>]*data-max="9"/.test(pop2), '开启后滑块最大值应为设置值 9');
    T.Cfg.v.taskLimit.brk.like = false;

    /* 上限留空且还没拿到服务端进度：不显示滑块，提示跟随服务端 */
    T.Cfg.v.taskLimit = {
      like: 0, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    };
    T.Data.taskCache.delete('7401');
    const pop3 = T.ListView.taskPopHtml();
    assert(pop3.indexOf('任务上限跟随服务端') >= 0, '无上限数据时应提示跟随服务端');

    T.ListView.taskPop = prevPop;
    T.Cfg.v.taskLimit = prevTL;
    T.Cfg.v.whitelist = prevWL;
    T.Data.medals = prevMedals;
    T.Data.taskCache.delete('7401');
  });

  /* 未开播 / 任务还没同步时拿不到服务端上限：关闭超上限的滑块不能显示出高于服务端的上限 */
  check('任务开关：服务端上限未知时用上次同步值兜底', () => {
    const prevTL = T.Cfg.v.taskLimit;
    const prevWL = T.Cfg.v.whitelist;
    T.Cfg.v.tasks.like = true;
    T.Cfg.v.taskLimit = {
      like: 12, danmu: 0, watch: 0,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    };
    T.Cfg.v.whitelist = [{ roomId: 7841, uid: 7841, limits: { like: 12 } }];
    T.Data.taskCache.delete('7841');
    T.Data.putRoom({ roomId: 7841, uid: 7841, uname: '兜底测试' });
    const meta = T.Data.room('7841');

    /* 先模拟一次成功同步：此时应把服务端上限记住 */
    T.Data.taskCache.set('7841', {
      at: Date.now(),
      data: { ok: true, tasks: [{ jump_type: 'like', title: '点赞30次', sub_title: '1/5', is_done: 0 }] }
    });
    T.Engine.progressOf(meta, 'like');
    assertEq(T.Data.srvMaxOf(meta, 'like'), 5, '拉到进度时应记住服务端上限 5');

    /* 接下来拿不到任务信息（未开播/接口失败）：关闭超上限时按记下的 5 压住 */
    T.Data.taskCache.delete('7841');
    assertEq(T.Engine.globalLimitOf(meta, 'like'), 5, '未知时应用上次的服务端 5');
    assertEq(T.Engine.limitOf(meta, 'like'), 5, '房间设 12 也应被压到 5');
    T.ListView.taskPop = '7841';
    const pop = T.ListView.taskPopHtml();
    assert(/data-room-limit="like"[^>]*max="5"/.test(pop), '滑块最大值应为 5：' + pop);
    assert(/value="5"[^>]*data-room-limit="like"/.test(pop), '滑块值应为 5：' + pop);

    /* 开启超上限：完全按设置值 12 */
    T.Cfg.v.taskLimit.brk.like = true;
    assertEq(T.Engine.globalLimitOf(meta, 'like'), 12, '开启后应按设置值 12');
    assert(/data-room-limit="like"[^>]*max="12"/.test(T.ListView.taskPopHtml()), '开启后滑块最大值应为 12');

    /* 昨天的服务端上限不能拿来用 */
    T.Cfg.v.taskLimit.brk.like = false;
    meta.srvMaxDate = '2000-01-01';
    assertEq(T.Engine.globalLimitOf(meta, 'like'), 12, '跨天后应作废，回退到设置值');

    T.ListView.taskPop = '';
    T.Data.rooms.delete('7841');
    T.Data.taskCache.delete('7841');
    T.Cfg.v.taskLimit = prevTL;
    T.Cfg.v.whitelist = prevWL;
  });

  check('房间上限：调回总上限即删除覆盖值', () => {
    const prevTL = T.Cfg.v.taskLimit;
    const prevWL = T.Cfg.v.whitelist;
    T.Cfg.v.taskLimit = {
      like: 5, danmu: 10, watch: 5,
      show: { like: true, danmu: true, watch: true },
      brk: { like: false, danmu: false, watch: false }
    };
    T.Cfg.v.whitelist = [{ roomId: 7411, uid: 7411 }];

    T.Actions.setRoomLimit('7411', 'like', 3);
    assertEq(T.Cfg.v.whitelist[0].limits.like, 3);
    T.Actions.setRoomLimit('7411', 'like', 5);
    assertEq(T.Cfg.v.whitelist[0].limits, undefined, '等于总上限应删除覆盖');
    T.Actions.setRoomLimit('7411', 'danmu', 99);
    assertEq(T.Cfg.v.whitelist[0].limits, undefined, '超过总上限按总上限处理');

    /* 全局留空：滑块最大值跟随服务端，仍可单独调小 */
    T.Data.taskCache.set('7411', {
      at: Date.now(),
      data: { ok: true, tasks: [{ jump_type: 'like', title: '点赞30次', sub_title: '0/4', is_done: 0 }] }
    });
    T.Cfg.v.taskLimit.like = 0;
    T.Actions.setRoomLimit('7411', 'like', 2);
    assertEq(T.Cfg.v.whitelist[0].limits.like, 2, '全局留空时仍可按服务端上限调小');
    T.Actions.setRoomLimit('7411', 'like', 4);
    assertEq(T.Cfg.v.whitelist[0].limits, undefined, '调到服务端上限即删除覆盖');
    T.Data.taskCache.delete('7411');

    T.Cfg.v.taskLimit = prevTL;
    T.Cfg.v.whitelist = prevWL;
  });

  await checkAsync('点亮：未开播时按服务端任务条数发弹幕', async () => {
    const prevMedals = T.Data.medals;
    const prevTasks = T.Data.tasks;
    const prevRefresh = T.Data.refreshMedals;
    const prevDanmu = T.Tasks.danmu;
    const prevRooms = T.Daily.rooms;

    T.Daily.rooms = {};
    const rec = { medal: { is_lighted: 0, target_id: 7001, level: 5 }, room_info: { room_id: 7001 } };
    T.Data.medals = new Map();
    T.Data.medals.set('u7001', rec);
    T.Data.medals.set('7001', rec);
    T.Data.tasks = async () => ({
      ok: true,
      tasks: [{ jump_type: 'sendDanmu', title: '发送10条弹幕', sub_title: '0/10', is_done: 0 }]
    });

    let captured = null;
    T.Tasks.danmu = async (meta, o) => {
      captured = o;
      rec.medal.is_lighted = 1;
      return { status: 'done', sent: o.count };
    };
    T.Data.refreshMedals = async () => T.Data.medals;

    const res = await T.Tasks.light({ roomId: 7001, uid: 7001, liveStatus: 0 });
    assertEq(res.status, 'done', JSON.stringify(res));
    assertEq(captured && captured.count, 10, '应按任务要求发 10 条，实际 ' + (captured && captured.count));
    assertEq(captured && captured.noEmote, undefined, '点亮也应优先使用表情（表情计入弹幕任务）');
    assertEq(captured && captured.force, true, '点亮应按完成进度补发，不被完成标记挡住');

    T.Tasks.danmu = prevDanmu;
    T.Data.tasks = prevTasks;
    T.Data.refreshMedals = prevRefresh;
    T.Data.medals = prevMedals;
    T.Daily.rooms = prevRooms;
  });

  await checkAsync('弹幕：noEmote 时不请求表情列表', async () => {
    const prevSend = T.API.sendDanmu;
    const prevTasks = T.API.medalTasks;
    const prevEmote = T.API.emoticons;
    const prevRunning = T.Engine.running;
    const prevRooms = T.Daily.rooms;

    T.Daily.rooms = {};
    T.Engine.running = true;
    let listCalls = 0;
    let textSends = 0;
    T.API.emoticons = async () => { listCalls++; return []; };
    T.API.sendDanmu = async () => { textSends++; return { code: 0, msg: '' }; };
    T.API.medalTasks = async () => ({
      ok: true,
      tasks: [{ jump_type: 'sendDanmu', title: '发送1条弹幕', sub_title: '0/1', is_done: 0 }]
    });

    await T.Tasks.danmu({ roomId: 7003, uid: 7003, liveStatus: 0 }, { noEmote: true, force: true });
    assertEq(listCalls, 0, '点亮流程不应请求表情列表');
    assertEq(textSends, 1, '应发送 1 条文字弹幕');

    T.API.sendDanmu = prevSend;
    T.API.medalTasks = prevTasks;
    T.API.emoticons = prevEmote;
    T.Engine.running = prevRunning;
    T.Daily.rooms = prevRooms;
  });

  await checkAsync('弹幕：没有进度信息时按要求的条数发满', async () => {
    const prevSend = T.API.sendDanmu;
    const prevTasks = T.API.medalTasks;
    const prevEmote = T.API.emoticons;
    const prevGapMin = T.Cfg.v.danmu.gapMin;
    const prevGapMax = T.Cfg.v.danmu.gapMax;
    const prevRooms = T.Daily.rooms;

    T.Daily.rooms = {};
    /* 用很小的间隔：0 会被代码里的 `|| 6` 回落成 6 秒 */
    T.Cfg.v.danmu.gapMin = 0.02;
    T.Cfg.v.danmu.gapMax = 0.03;
    let sends = 0;
    T.API.sendDanmu = async () => { sends++; return { code: 0, msg: '' }; };
    T.API.emoticons = async () => [];
    T.API.medalTasks = async () => ({
      ok: true,
      tasks: [{ jump_type: 'sendDanmu', title: '发送10条弹幕', is_done: 0 }]
    });

    await T.Tasks.danmu({ roomId: 7002, uid: 7002, liveStatus: 0 }, { count: 10, force: true });
    assertEq(sends, 10, '没有 sub_title 时应按 count 发满，实际 ' + sends);

    T.API.sendDanmu = prevSend;
    T.API.medalTasks = prevTasks;
    T.API.emoticons = prevEmote;
    T.Cfg.v.danmu.gapMin = prevGapMin;
    T.Cfg.v.danmu.gapMax = prevGapMax;
    T.Daily.rooms = prevRooms;
  });

  check('粉丝牌导入：勾选计数与按钮文字同步', () => {
    const prevPicking = T.ListView.picking;
    const prevSel = T.ListView.sel;
    const prevMedals = new Map(T.Data.medals);
    const prevBody = T.UI.body;

    T.Data.medals.clear();
    T.Data.medals.set('111', { medal: { level: 8, target_id: 1, medal_name: 'A', is_lighted: 1 }, room_info: { room_id: 111 } });
    T.Data.medals.set('222', { medal: { level: 7, target_id: 2, medal_name: 'B', is_lighted: 1 }, room_info: { room_id: 222 } });
    T.ListView.picking = true;
    T.ListView.sel = new Set(['111', '222', '999']);

    T.ListView.pruneSel();
    assertEq(T.ListView.sel.size, 2, '不存在的勾选应被清掉');

    const html = T.ListView.render();
    assert(html.indexOf('导入所选（2）') >= 0, '渲染时计数应为 2，实际页面：' + html.slice(0, 80));

    const imp = { textContent: '' };
    const all = { textContent: '' };
    T.UI.body = { querySelector: (sel) => (sel.indexOf('pickImport') >= 0 ? imp : all) };
    T.ListView.syncPickBtns();
    assertEq(imp.textContent, '导入所选（2）', '勾选后应即时更新按钮文字');
    assertEq(all.textContent, '全不选', '全部勾选时应显示「全不选」');

    T.ListView.sel.delete('222');
    T.ListView.syncPickBtns();
    assertEq(imp.textContent, '导入所选（1）', '取消勾选后计数应减一');
    assertEq(all.textContent, '全选', '取消一个后应显示「全选」');

    T.ListView.picking = prevPicking;
    T.ListView.sel = prevSel;
    T.UI.body = prevBody;
    T.Data.medals.clear();
    prevMedals.forEach((v, k) => T.Data.medals.set(k, v));
  });

  /* ---------------- 输出 ---------------- */
  let pass = 0;
  let fail = 0;
  results.forEach((r) => {
    if (r[0] === 'PASS') pass++;
    else fail++;
    console.log((r[0] === 'PASS' ? '✓ ' : '✗ ') + r[1]);
  });
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();

