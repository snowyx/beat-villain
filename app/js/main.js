// 入口（design §3 phase 路由 / §4 协议装配 / §13 hash 路由）。
// location.hash 路由（检测 #/join?room= 自动带入房间码）；
// 按 snapshot.phase 唯一路由切屏；装配 ws/store/各 screen。

import { WsClient } from './ws-client.js';
import { Store } from './store.js';
import { unlockAudio } from './audio.js';

import { initAltar } from './screens/altar.js';
import { initInvite, refreshInviteMembers } from './screens/invite.js';
import { initSpell, teardownSpell } from './screens/spell.js';
import { initBeat, teardownBeat } from './screens/beat.js';
import { initAsh, teardownAsh } from './screens/ash.js';
import { initFortune } from './screens/fortune.js';

const SCREENS = ['altar', 'invite', 'spell', 'beat', 'ash', 'fortune'];

const app = {
  ws: new WsClient(),
  store: new Store(),
  pendingJoinRoom: null,
  current: null, // 当前屏 key
  _inviteSubview: null, // invite 子视图标记：'shaman-pending' | 'shaman-waiting' | 'in-room'
  _hitFrameHandlers: new Set(),
  _villainStateHandlers: new Set(),

  audioUnlock() {
    unlockAudio();
  },

  onHitFrame(fn) {
    this._hitFrameHandlers.add(fn);
    return () => this._hitFrameHandlers.delete(fn);
  },
  onVillainStateFrame(fn) {
    this._villainStateHandlers.add(fn);
    return () => this._villainStateHandlers.delete(fn);
  },

  route() {
    renderRoute(this);
  },
};

// ── hash 路由：检测 #/join?room=CODE ──
function parseJoinRoom() {
  const hash = location.hash || '';
  const m = hash.match(/#\/join\?room=([A-Z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

// ── 把 phase 映射到屏 key（snapshot.phase 为唯一路由依据）──
function screenForState(state) {
  // 神婆待进房（有 pendingJoinRoom 且本端尚无房间）→ invite（进房确认）
  if (app.pendingJoinRoom && !state.roomCode) return 'invite';
  switch (state.phase) {
    case 'altar':
      return 'invite'; // 建房后进入邀请屏
    case 'chanting':
      return 'spell';
    case 'beating':
      return 'beat';
    case 'burning':
      return 'ash';
    case 'fortune':
      return 'fortune';
    default:
      return 'altar'; // 尚无房间：开坛
  }
}

function showOnly(key) {
  for (const k of SCREENS) {
    const node = document.getElementById(`screen-${k}`);
    if (node) node.classList.toggle('active', k === key);
  }
}

function teardownCurrent() {
  switch (app.current) {
    case 'spell': teardownSpell(app); break;
    case 'beat': teardownBeat(app); break;
    case 'ash': teardownAsh(app); break;
    default: break;
  }
}

// invite 屏有三个子视图，共用 screen key 'invite'，仅靠 initInvite 内逻辑区分：
//   shaman-pending：神婆进房确认屏（有 pendingJoinRoom 且本端尚无房间）；
//   shaman-waiting：神婆已进房 → 开坛法事等待页（role==='shaman'）；
//   in-room：苦主在房邀请屏（坛号/二维码/开始念咒）。
// 子视图切换时 key 不变、已挂载，挂载守卫会提前 return 导致停在旧子视图——
// 故需按子视图语义切换强制重渲染一次（与 renderRoute 的 subviewChanged 协调）。
function inviteSubview(appRef) {
  if (appRef.pendingJoinRoom && !appRef.store.state.roomCode) return 'shaman-pending';
  if (appRef.store.state.role === 'shaman') return 'shaman-waiting';
  return 'in-room';
}

function renderRoute(appRef = app) {
  const state = appRef.store.state;
  const key = screenForState(state);
  const el = document.getElementById(`screen-${key}`);
  if (!el) return;

  // invite 子视图标记（仅 key==='invite' 时有意义）：pending 确认屏 ↔ 在房屏。
  const subview = key === 'invite' ? inviteSubview(appRef) : null;
  // 若目标屏未变且已挂载，避免 ash/beat 等重复重建。
  // 例外：invite 子视图语义已切换（确认屏→在房屏）时不得提前 return，须强制重渲染。
  const subviewChanged = key === 'invite' && subview !== appRef._inviteSubview;
  if (appRef.current === key && el.dataset.mounted === '1' && !subviewChanged) {
    return;
  }

  teardownCurrent();
  appRef.el = el;

  switch (key) {
    case 'altar': initAltar(appRef); break;
    case 'invite': initInvite(appRef); break;
    case 'spell': initSpell(appRef); break;
    case 'beat': initBeat(appRef); break;
    case 'ash': initAsh(appRef); break;
    case 'fortune': initFortune(appRef); break;
  }

  // 标记挂载态（供下次比较）
  for (const k of SCREENS) {
    const n = document.getElementById(`screen-${k}`);
    if (n) n.dataset.mounted = k === key ? '1' : '0';
  }
  appRef.current = key;
  // 记录本次 invite 子视图标记供下次比较；非 invite 屏清空。
  appRef._inviteSubview = subview;
  showOnly(key);
}

// ── ws 事件装配 ──
function wireWs() {
  const { ws, store } = app;

  ws.on('room_created', (d) => {
    store.applySnapshot(d.snapshot, { role: d.role });
    app.pendingJoinRoom = null;
    renderRoute();
  });

  ws.on('room_joined', (d) => {
    store.applySnapshot(d.snapshot, { role: d.role });
    app.pendingJoinRoom = null;
    renderRoute();
  });

  ws.on('room_state', (d) => {
    store.applySnapshot(d.snapshot);
    renderRoute();
  });

  ws.on('member_change', (d) => {
    store.setMembers(d.members);
    renderRoute();
    // invite 屏 key/子视图不变时 renderRoute 守卫会提前 return、不重建屏，
    // 成员行不会刷新；此处就地重绘 #members，使神婆进房后苦主侧即时显示其在线。
    if (app.current === 'invite') refreshInviteMembers(app);
  });

  ws.on('hit', (d) => {
    store.applyHit(d);
    for (const fn of app._hitFrameHandlers) {
      try { fn(d); } catch (e) { console.error(e); }
    }
  });

  ws.on('villain_state', (d) => {
    store.applyVillainState(d);
    for (const fn of app._villainStateHandlers) {
      try { fn(d); } catch (e) { console.error(e); }
    }
  });

  ws.on('burn', (d) => {
    // burn 帧带权威 hits=8：合并进 store（Math.max 单调递增）确保化灰显示 8 鞋。
    if (d && typeof d.hits === 'number') store.applyHit({ hits: d.hits, villainStage: '化灰' });
    store.setBurned();
    // phase→burning/fortune 会随后续 room_state 路由；burn 增量帧本身不改 phase，
    // 但 ash 屏依赖 burned 标志呈现，这里确保切到 ash。
    if (store.state.phase === 'beating') {
      store.state.phase = 'burning';
    }
    renderRoute();
  });

  ws.on('fortune', (d) => {
    store.applyFortune(d);
    // fortune 为增量帧、不随 room_state 下发；据协议到达 fortune 即仪式进入签文态。
    // 先置 phase=burning（若还没），让 ash 屏的化灰动画播完后由其定时器切到 fortune。
    if (store.state.phase === 'beating') store.state.phase = 'burning';
    store._fortuneReady = true;
    renderRoute();
  });

  ws.on('error', (d) => {
    handleError(d);
  });

  ws.on('_disconnected', () => {
    store.setConnected(false);
  });

  // 连接成功（hello_ok）后标记已连接
  ws.on('hello_ok', () => {
    store.setConnected(true);
  });
}

function handleError(d) {
  const code = d && d.code;
  // 只有 ROOM_NOT_FOUND / ROOM_FULL 面向用户提示（design §4.5）
  if (code === 'ROOM_NOT_FOUND' || code === 'ROOM_FULL') {
    const msg = code === 'ROOM_NOT_FOUND' ? '房间不存在或已散场' : '房间已满，这坛不缺人~';
    showToast(msg);
    // 神婆停留在进房界面
    const btn = document.querySelector('#confirm-join');
    if (btn) btn.disabled = false;
  }
}

function showToast(text) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ── 启动 ──
function boot() {
  // 调试/自动化可见入口（无行为副作用）：便于端到端验证读取当前屏与 villain 实例。
  if (typeof window !== 'undefined') window.__app = app;
  wireWs();

  // 首个用户手势解锁音频
  const unlockOnce = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce);

  // hash 路由：神婆邀请链接
  app.pendingJoinRoom = parseJoinRoom();

  app.ws.connect();
  renderRoute(); // 初始渲染（altar 或 神婆进房确认）

  window.addEventListener('hashchange', () => {
    app.pendingJoinRoom = parseJoinRoom();
    if (app.pendingJoinRoom && !app.store.state.roomCode) renderRoute();
  });
}

boot();
