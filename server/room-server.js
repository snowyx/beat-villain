// 赛博打小人 · 单文件 Node WebSocket 内存房间服务
// 依据 design.md §4（协议）/§5（后端）/§7（文案库）/§15（可测性）与 FEAT-002。
//
// 设计要点：
//   - 后端内存 Map 是「单一事实源」：所有改变共享进度的动作只经后端改内存并广播。
//   - 裸 ws server（不引入 HTTP / 路径路由），监听 0.0.0.0:PORT（默认 8080）。
//   - 首帧契约：每条连接必须先发 hello → 收 hello_ok{clientId} 后方可发业务消息。
//   - 落鞋 hits 由后端权威累加（不信任客户端计数），封顶 8，达 8 化灰并抽签锁定。
//
// 可测性：纯函数（genRoomCode/recomputeStage/applyHit/drawFortune/makeSnapshot）
// 直接 export，供 room-server.test.js 导入；仅当作为入口直接运行时才启动监听。

import { WebSocketServer, WebSocket } from 'ws';

// ──────────────────────────────────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────────────────────────────────

export const TARGET_HITS = 8;

// 房间码字符集：大写字母+数字，排除易混的 0 O 1 I L
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ROOM_CODE_LEN = 6;

// 四阶段阈值（design §6）：0–2 嚣张 / 3–4 懵逼 / 5–7 冒烟 / 8 化灰
export const VILLAIN_STAGES = Object.freeze({
  SWAGGER: '嚣张',
  DAZED: '懵逼',
  SMOKING: '冒烟',
  ASH: '化灰',
});

export const PHASES = Object.freeze({
  ALTAR: 'altar',
  CHANTING: 'chanting',
  BEATING: 'beating',
  BURNING: 'burning',
  FORTUNE: 'fortune',
});

export const LANGS = Object.freeze(['zh-CN', 'zh-HK', 'en-US']);

const ROLES = Object.freeze({ VICTIM: 'victim', SHAMAN: 'shaman' });
const MAX_MEMBERS = 2;
const CLEANUP_DELAY_MS = 60_000;

// 签文库（design §7）：宜 / 忌 / 贵人，各列抽一
export const FORTUNE_POOL = Object.freeze({
  yi: Object.freeze(['摸鱼', '早退', '已读不回', '理直气壮', '点奶茶', '装死', '准点下班']),
  ji: Object.freeze(['背锅', '开会', '改需求', '内卷', '接盘', '周末加班', '空降任务']),
  guiren: Object.freeze(['隔壁组老王', '楼下保安大叔', '食堂阿姨', '匿名递拖鞋的你', '算法推荐的猫']),
});

// ──────────────────────────────────────────────────────────────────────────
// 内存状态（单一事实源）
// ──────────────────────────────────────────────────────────────────────────

const rooms = new Map(); // roomCode -> Room
const socketMeta = new WeakMap(); // ws -> { clientId, roomCode, role }

// Room 形状：
// { code, flower, crimes, lang, hits, target, villainStage, phase,
//   burned, fortune, members: Map<clientId, { role, ws, online }>,
//   _cleanupTimer }

// ──────────────────────────────────────────────────────────────────────────
// 纯函数 / 可测函数
// ──────────────────────────────────────────────────────────────────────────

/**
 * 生成 6 位房间码，排除易混字符，并与给定 rooms 容器查重。
 * @param {Map|Set} [existing] 已占用的房间码容器（默认模块内 rooms）
 */
export function genRoomCode(existing = rooms) {
  const has = (code) =>
    existing instanceof Map || existing instanceof Set
      ? existing.has(code)
      : false;
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LEN; i++) {
      const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      code += ROOM_CODE_ALPHABET[idx];
    }
  } while (has(code));
  return code;
}

/**
 * 按 hits 推算小人阶段（design §6 边界）：
 * hits<3 嚣张 / <5 懵逼 / <8 冒烟 / 8 化灰
 */
export function stageForHits(hits) {
  if (hits < 3) return VILLAIN_STAGES.SWAGGER;
  if (hits < 5) return VILLAIN_STAGES.DAZED;
  if (hits < 8) return VILLAIN_STAGES.SMOKING;
  return VILLAIN_STAGES.ASH;
}

/**
 * 重算并写回 room.villainStage。返回阶段是否发生跨越（供广播 villain_state 判断）。
 */
export function recomputeStage(room) {
  const next = stageForHits(room.hits);
  const changed = room.villainStage !== next;
  room.villainStage = next;
  return changed;
}

/**
 * 从签文库各列抽一，组装 {yi,ji,guiren}。
 * 若 room 已有 fortune 则直接返回（锁定幂等）。
 */
export function drawFortune(room) {
  if (room && room.fortune) return room.fortune;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fortune = {
    yi: pick(FORTUNE_POOL.yi),
    ji: pick(FORTUNE_POOL.ji),
    guiren: pick(FORTUNE_POOL.guiren),
  };
  if (room) room.fortune = fortune;
  return fortune;
}

/**
 * 产出房间快照（design §4.3）。
 * 成员项暴露 {clientId, role, online, isSelf}，isSelf 由 selfClientId 逐连接计算；
 * 绝不外泄 ws 句柄。
 */
export function makeSnapshot(room, selfClientId) {
  const members = [];
  for (const [clientId, m] of room.members) {
    members.push({
      clientId,
      role: m.role,
      online: m.online,
      isSelf: clientId === selfClientId,
    });
  }
  return {
    roomCode: room.code,
    phase: room.phase,
    flower: room.flower,
    crimes: room.crimes,
    lang: room.lang,
    hits: room.hits,
    target: room.target,
    villainStage: room.villainStage,
    burned: room.burned,
    fortune: room.fortune,
    members,
  };
}

/**
 * 权威落鞋：仅 beating 阶段生效，hits 封顶 8；达 8 触发化灰。
 * 返回描述本次 hit 结果的对象，供路由决定广播哪些帧。
 */
export function applyHit(room) {
  if (room.phase !== PHASES.BEATING) {
    return { applied: false, stageChanged: false, burned: false };
  }
  room.hits = Math.min(TARGET_HITS, room.hits + 1);
  const stageChanged = recomputeStage(room);
  let burned = false;
  if (room.hits >= TARGET_HITS && room.phase === PHASES.BEATING) {
    enterBurning(room);
    burned = true;
  }
  return { applied: true, stageChanged, burned };
}

/**
 * 房满判定（design §4.5）：已认领 clientId 的落鞋成员数达 MAX_MEMBERS。
 * 在线+离线占位都计入（离线成员在回收前仍占槽）。
 */
export function isRoomFull(room) {
  return room.members.size >= MAX_MEMBERS;
}

// ──────────────────────────────────────────────────────────────────────────
// 房间 / 成员构造
// ──────────────────────────────────────────────────────────────────────────

export function createRoom(code, { flower = '', crimes = [] } = {}) {
  return {
    code,
    flower,
    crimes: Array.isArray(crimes) ? crimes : [],
    lang: null,
    hits: 0,
    target: TARGET_HITS,
    villainStage: VILLAIN_STAGES.SWAGGER,
    phase: PHASES.ALTAR,
    burned: false,
    fortune: null,
    members: new Map(),
    _cleanupTimer: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 发送 / 广播
// ──────────────────────────────────────────────────────────────────────────

function frame(type, data) {
  return JSON.stringify({ type, data, ts: Date.now() });
}

export function singleSend(ws, type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(frame(type, data));
  }
}

/** 普通广播：对全房在线成员发同一 JSON（增量帧 hit/villain_state/burn/fortune）。 */
function broadcast(room, type, data) {
  const payload = frame(type, data);
  for (const m of room.members.values()) {
    if (m.online && m.ws && m.ws.readyState === WebSocket.OPEN) {
      m.ws.send(payload);
    }
  }
}

/**
 * 携带 snapshot 的帧（room_state / member_change）逐连接把 isSelf 填充后发送。
 * 每条连接内容相同、仅 isSelf 标记不同。
 */
function broadcastSnapshot(room, type = 'room_state') {
  for (const [clientId, m] of room.members) {
    if (!m.online || !m.ws || m.ws.readyState !== WebSocket.OPEN) continue;
    const snapshot = makeSnapshot(room, clientId);
    const data = type === 'member_change'
      ? { members: snapshot.members, count: snapshot.members.length }
      : { snapshot };
    m.ws.send(frame(type, data));
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 状态推进
// ──────────────────────────────────────────────────────────────────────────

/**
 * 化灰：phase=burning,burned=true,广播 burn → 抽签锁定 → phase=fortune,广播 fortune。
 * 幂等：已 burned 直接返回。
 */
export function enterBurning(room) {
  if (room.burned && room.phase !== PHASES.BEATING) return;
  room.phase = PHASES.BURNING;
  room.burned = true;
  room.hits = Math.min(TARGET_HITS, room.hits);
  recomputeStage(room);
  broadcast(room, 'burn', { hits: TARGET_HITS });
  drawFortune(room);
  room.phase = PHASES.FORTUNE;
  broadcast(room, 'fortune', { ...room.fortune });
}

/** 在线成员为 0 时，延时 CLEANUP_DELAY_MS 后若仍空则回收房间。 */
function cleanupRoom(room) {
  const anyOnline = [...room.members.values()].some((m) => m.online);
  if (anyOnline) return;
  if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
  room._cleanupTimer = setTimeout(() => {
    const stillEmpty = ![...room.members.values()].some((m) => m.online);
    if (stillEmpty) rooms.delete(room.code);
  }, CLEANUP_DELAY_MS);
  if (typeof room._cleanupTimer.unref === 'function') room._cleanupTimer.unref();
}

// ──────────────────────────────────────────────────────────────────────────
// clientId 生成
// ──────────────────────────────────────────────────────────────────────────

let clientSeq = 0;
function genClientId() {
  clientSeq += 1;
  return `c_${Date.now().toString(36)}${clientSeq.toString(36)}${Math.floor(
    Math.random() * 1e6,
  ).toString(36)}`;
}

/** 在所有房间里查找带某 clientId 的成员，用于重连认领。 */
function findMemberByClientId(clientId) {
  if (!clientId) return null;
  for (const room of rooms.values()) {
    const m = room.members.get(clientId);
    if (m) return { room, member: m };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// 消息路由
// ──────────────────────────────────────────────────────────────────────────

function sendError(ws, code, message) {
  singleSend(ws, 'error', { code, message });
}

function handleHello(ws, data) {
  const oldClientId = data && typeof data.clientId === 'string' ? data.clientId : null;
  const hit = findMemberByClientId(oldClientId);
  let clientId;
  if (hit) {
    // 重连认领原槽：online=true，不占新槽、不触发 ROOM_FULL
    clientId = oldClientId;
    const { room, member } = hit;
    member.online = true;
    member.ws = ws;
    if (room._cleanupTimer) {
      clearTimeout(room._cleanupTimer);
      room._cleanupTimer = null;
    }
    socketMeta.set(ws, { clientId, roomCode: room.code, role: member.role });
    singleSend(ws, 'hello_ok', { clientId });
    // 重连后单播权威快照对齐，并广播成员在线态变化
    singleSend(ws, 'room_state', { snapshot: makeSnapshot(room, clientId) });
    broadcastSnapshot(room, 'member_change');
  } else {
    clientId = genClientId();
    socketMeta.set(ws, { clientId, roomCode: null, role: null });
    singleSend(ws, 'hello_ok', { clientId });
  }
}

function handleCreateRoom(ws, meta, data) {
  if (meta.roomCode) {
    // 已有房间归属：静默回快照
    const room = rooms.get(meta.roomCode);
    if (room) singleSend(ws, 'room_state', { snapshot: makeSnapshot(room, meta.clientId) });
    return;
  }
  const flower = data && typeof data.flower === 'string' ? data.flower : '';
  const crimes = data && Array.isArray(data.crimes) ? data.crimes : [];
  const code = genRoomCode();
  const room = createRoom(code, { flower, crimes });
  room.members.set(meta.clientId, { role: ROLES.VICTIM, ws, online: true });
  rooms.set(code, room);
  meta.roomCode = code;
  meta.role = ROLES.VICTIM;
  singleSend(ws, 'room_created', {
    roomCode: code,
    role: ROLES.VICTIM,
    snapshot: makeSnapshot(room, meta.clientId),
  });
}

function handleJoinRoom(ws, meta, data) {
  const roomCode = data && typeof data.roomCode === 'string' ? data.roomCode : null;
  const room = roomCode ? rooms.get(roomCode) : null;
  if (!room) {
    sendError(ws, 'ROOM_NOT_FOUND', '房间不存在或已散场');
    return;
  }
  if (meta.roomCode === room.code) {
    // 已在房中：静默回快照
    singleSend(ws, 'room_state', { snapshot: makeSnapshot(room, meta.clientId) });
    return;
  }
  // 房满判定：已认领 clientId 成员数达 2（仅首次进房路径）
  if (isRoomFull(room)) {
    sendError(ws, 'ROOM_FULL', '房间已满');
    return;
  }
  const role = data && data.role === ROLES.VICTIM ? ROLES.VICTIM : ROLES.SHAMAN;
  room.members.set(meta.clientId, { role, ws, online: true });
  meta.roomCode = room.code;
  meta.role = role;
  if (room._cleanupTimer) {
    clearTimeout(room._cleanupTimer);
    room._cleanupTimer = null;
  }
  // 新进房先单播完整快照，再广播成员变化给全房
  singleSend(ws, 'room_joined', {
    roomCode: room.code,
    role,
    snapshot: makeSnapshot(room, meta.clientId),
  });
  broadcastSnapshot(room, 'member_change');
}

function requireRoom(ws, meta, data) {
  const roomCode = data && typeof data.roomCode === 'string' ? data.roomCode : meta.roomCode;
  const room = roomCode ? rooms.get(roomCode) : null;
  if (!room) {
    sendError(ws, 'ROOM_NOT_FOUND', '房间不存在或已散场');
    return null;
  }
  return room;
}

function handleSetLang(ws, meta, data) {
  const room = requireRoom(ws, meta, data);
  if (!room) return;
  const lang = data && data.lang;
  if (!LANGS.includes(lang)) {
    // BAD_PAYLOAD：静默，回快照
    console.debug('[BAD_PAYLOAD] set_lang invalid lang', lang);
    singleSend(ws, 'room_state', { snapshot: makeSnapshot(room, meta.clientId) });
    return;
  }
  if (room.phase !== PHASES.ALTAR && room.phase !== PHASES.CHANTING) {
    // PHASE_REJECTED：静默回快照自愈
    console.debug('[PHASE_REJECTED] set_lang in phase', room.phase);
    singleSend(ws, 'room_state', { snapshot: makeSnapshot(room, meta.clientId) });
    return;
  }
  room.lang = lang;
  if (room.phase === PHASES.ALTAR) room.phase = PHASES.CHANTING;
  broadcastSnapshot(room, 'room_state');
}

function handleStartBeat(ws, meta, data) {
  const room = requireRoom(ws, meta, data);
  if (!room) return;
  if (room.phase !== PHASES.CHANTING) {
    console.debug('[PHASE_REJECTED] start_beat in phase', room.phase);
    singleSend(ws, 'room_state', { snapshot: makeSnapshot(room, meta.clientId) });
    return;
  }
  room.phase = PHASES.BEATING;
  broadcastSnapshot(room, 'room_state');
}

function handleHit(ws, meta, data) {
  const room = requireRoom(ws, meta, data);
  if (!room) return;
  if (room.phase !== PHASES.BEATING) {
    console.debug('[PHASE_REJECTED] hit in phase', room.phase);
    singleSend(ws, 'room_state', { snapshot: makeSnapshot(room, meta.clientId) });
    return;
  }
  const by = meta.role || null;
  const result = applyHit(room);
  if (!result.applied) return;
  // 落鞋高频路径只发 hit 增量帧（不跟发全量 room_state）
  broadcast(room, 'hit', { hits: room.hits, villainStage: room.villainStage, by });
  if (result.stageChanged && !result.burned) {
    broadcast(room, 'villain_state', { villainStage: room.villainStage, hits: room.hits });
  }
  // burn / fortune 已在 applyHit→enterBurning 内广播
}

function routeMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.debug('[BAD_PAYLOAD] JSON parse failed');
    return;
  }
  if (!msg || typeof msg.type !== 'string') {
    console.debug('[BAD_PAYLOAD] missing type');
    return;
  }
  const { type, data } = msg;

  // 首帧契约：hello 之前不接受业务消息
  const meta = socketMeta.get(ws);
  if (type === 'hello') {
    handleHello(ws, data);
    return;
  }
  if (!meta || !meta.clientId) {
    // hello_ok 之前到达的业务消息：回 BAD_PAYLOAD 忽略
    console.debug('[BAD_PAYLOAD] business message before hello_ok:', type);
    return;
  }

  switch (type) {
    case 'create_room':
      handleCreateRoom(ws, meta, data);
      break;
    case 'join_room':
      handleJoinRoom(ws, meta, data);
      break;
    case 'set_lang':
      handleSetLang(ws, meta, data);
      break;
    case 'start_beat':
      handleStartBeat(ws, meta, data);
      break;
    case 'hit':
      handleHit(ws, meta, data);
      break;
    case 'ping':
      singleSend(ws, 'pong', {});
      break;
    default:
      console.debug('[BAD_PAYLOAD] unknown type', type);
  }
}

function handleClose(ws) {
  const meta = socketMeta.get(ws);
  if (!meta || !meta.roomCode) return;
  const room = rooms.get(meta.roomCode);
  if (!room) return;
  const member = room.members.get(meta.clientId);
  if (member) {
    member.online = false;
    member.ws = null;
  }
  broadcastSnapshot(room, 'member_change');
  cleanupRoom(room);
}

// ──────────────────────────────────────────────────────────────────────────
// 服务启动（仅作为入口直接运行时）
// ──────────────────────────────────────────────────────────────────────────

export function startServer(port = Number(process.env.PORT) || 8080) {
  const wss = new WebSocketServer({ host: '0.0.0.0', port });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => routeMessage(ws, raw.toString()));
    ws.on('close', () => handleClose(ws));
    ws.on('error', () => {
      /* 忽略单连接错误，不中断服务 */
    });
  });
  wss.on('listening', () => {
    console.log(`[room-server] listening on ws://0.0.0.0:${port}`);
  });
  return wss;
}

// 测试辅助：清空内存状态
export function __resetState() {
  for (const room of rooms.values()) {
    if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
  }
  rooms.clear();
}

export { rooms };

// 作为入口直接运行时启动监听；被 import（测试）时不启动。
const isEntry = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const thisPath = new URL(import.meta.url).pathname;
    return entry === thisPath || entry.endsWith('room-server.js');
  } catch {
    return false;
  }
})();

if (isEntry) {
  startServer();
}
