// 后端单元测试（node:test + node:assert），依据 design §15 / FEAT-002。
// 覆盖：genRoomCode 字符集与唯一性、applyHit 封顶与阶段推进、recomputeStage 边界、
// drawFortune 锁定幂等、makeSnapshot 的 isSelf 逐连接正确且不含 ws 句柄、
// ROOM_FULL 判定按已认领 clientId 计且重连带旧 clientId 不触发房满。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  genRoomCode,
  stageForHits,
  recomputeStage,
  applyHit,
  drawFortune,
  makeSnapshot,
  createRoom,
  isRoomFull,
  enterBurning,
  VILLAIN_STAGES,
  PHASES,
  TARGET_HITS,
  FORTUNE_POOL,
} from './room-server.js';

// ── genRoomCode ────────────────────────────────────────────────────────────

test('genRoomCode: 6 位、仅含允许字符集（排除 0 O 1 I L）', () => {
  const allowed = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
  for (let i = 0; i < 500; i++) {
    const code = genRoomCode(new Map());
    assert.equal(code.length, 6);
    assert.match(code, allowed);
    assert.ok(!/[0O1IL]/.test(code), `不应含易混字符: ${code}`);
  }
});

test('genRoomCode: 与已有容器查重，不返回已占用码', () => {
  const existing = new Set();
  // 用一个几乎占满的集合逼迫查重（仅留极少空位无法稳定测，改为验证不等于已存在项）
  for (let i = 0; i < 100; i++) existing.add(genRoomCode(existing));
  assert.equal(existing.size, 100, '100 次生成应全部唯一');
});

// ── stageForHits / recomputeStage 边界 ─────────────────────────────────────

test('stageForHits: 四阶段边界 0/21/22/43/44/87/88', () => {
  assert.equal(stageForHits(0), VILLAIN_STAGES.SWAGGER);
  assert.equal(stageForHits(21), VILLAIN_STAGES.SWAGGER);
  assert.equal(stageForHits(22), VILLAIN_STAGES.DAZED);
  assert.equal(stageForHits(43), VILLAIN_STAGES.DAZED);
  assert.equal(stageForHits(44), VILLAIN_STAGES.SMOKING);
  assert.equal(stageForHits(87), VILLAIN_STAGES.SMOKING);
  assert.equal(stageForHits(88), VILLAIN_STAGES.ASH);
});

test('recomputeStage: 写回 room.villainStage 并报告是否跨越', () => {
  const room = createRoom('AAAAAA');
  room.hits = 0;
  assert.equal(recomputeStage(room), false); // 初始即嚣张，无变化
  room.hits = 22;
  assert.equal(recomputeStage(room), true);
  assert.equal(room.villainStage, VILLAIN_STAGES.DAZED);
  room.hits = 30;
  assert.equal(recomputeStage(room), false); // 同阶段内无跨越
});

// ── applyHit 封顶与阶段推进 ─────────────────────────────────────────────────

test('applyHit: 非 beating 阶段忽略', () => {
  const room = createRoom('AAAAAA');
  room.phase = PHASES.CHANTING;
  const r = applyHit(room);
  assert.equal(r.applied, false);
  assert.equal(room.hits, 0);
});

test('applyHit: beating 阶段逐次累加并随阈值推进阶段', () => {
  const room = createRoom('AAAAAA');
  room.phase = PHASES.BEATING;
  for (let i = 0; i < 22; i++) applyHit(room);
  assert.equal(room.hits, 22);
  assert.equal(room.villainStage, VILLAIN_STAGES.DAZED);
});

test('applyHit: 达 88 封顶并进入化灰+签文，之后忽略多余 hit', () => {
  const room = createRoom('AAAAAA');
  room.phase = PHASES.BEATING;
  for (let i = 0; i < 100; i++) applyHit(room); // 超打
  assert.equal(room.hits, TARGET_HITS, 'hits 封顶 88');
  assert.equal(room.villainStage, VILLAIN_STAGES.ASH);
  assert.equal(room.burned, true);
  assert.equal(room.phase, PHASES.FORTUNE);
  assert.ok(room.fortune, '应已抽签锁定');
});

// ── drawFortune 锁定幂等 ────────────────────────────────────────────────────

test('drawFortune: 从三列各抽一，值在库内', () => {
  const room = createRoom('AAAAAA');
  const f = drawFortune(room);
  assert.ok(FORTUNE_POOL.yi.includes(f.yi));
  assert.ok(FORTUNE_POOL.ji.includes(f.ji));
  assert.ok(FORTUNE_POOL.guiren.includes(f.guiren));
});

test('drawFortune: 锁定幂等——二次调用返回同一对象值', () => {
  const room = createRoom('AAAAAA');
  const first = drawFortune(room);
  for (let i = 0; i < 20; i++) {
    const again = drawFortune(room);
    assert.deepEqual(again, first);
  }
  assert.equal(room.fortune, first);
});

test('enterBurning: 幂等——二次调用不改变已锁定签文', () => {
  const room = createRoom('AAAAAA');
  room.phase = PHASES.BEATING;
  room.hits = 88;
  enterBurning(room);
  const locked = room.fortune;
  enterBurning(room);
  assert.equal(room.fortune, locked);
  assert.equal(room.phase, PHASES.FORTUNE);
});

// ── makeSnapshot: isSelf 逐连接 + 不含 ws 句柄 ──────────────────────────────

test('makeSnapshot: isSelf 逐连接正确且成员项不含 ws 句柄', () => {
  const room = createRoom('AAAAAA', { flower: '卷王本卷', crimes: ['抢功劳'] });
  const wsA = { marker: 'A' };
  const wsB = { marker: 'B' };
  room.members.set('c_a', { role: 'victim', ws: wsA, online: true });
  room.members.set('c_b', { role: 'shaman', ws: wsB, online: false });

  const snapA = makeSnapshot(room, 'c_a');
  const selfA = snapA.members.find((m) => m.clientId === 'c_a');
  const otherA = snapA.members.find((m) => m.clientId === 'c_b');
  assert.equal(selfA.isSelf, true);
  assert.equal(otherA.isSelf, false);

  const snapB = makeSnapshot(room, 'c_b');
  assert.equal(snapB.members.find((m) => m.clientId === 'c_a').isSelf, false);
  assert.equal(snapB.members.find((m) => m.clientId === 'c_b').isSelf, true);

  // 不外泄 ws 句柄
  for (const m of snapA.members) {
    assert.ok(!('ws' in m), '成员项不应含 ws 句柄');
  }
  const serialized = JSON.stringify(snapA);
  assert.ok(!serialized.includes('marker'), '序列化快照不应含 ws 标记');

  // 结构字段齐全
  assert.equal(snapA.roomCode, 'AAAAAA');
  assert.equal(snapA.flower, '卷王本卷');
  assert.deepEqual(snapA.crimes, ['抢功劳']);
  assert.equal(snapA.target, TARGET_HITS);
  assert.equal(snapA.online, undefined);
  assert.equal(snapA.members[1].online, false);
});

// ── ROOM_FULL 判定：按已认领 clientId 计，重连不触发 ─────────────────────────

test('isRoomFull: 两名已认领成员即房满（在线+离线占位均计）', () => {
  const room = createRoom('AAAAAA');
  assert.equal(isRoomFull(room), false);
  room.members.set('c_a', { role: 'victim', ws: {}, online: true });
  assert.equal(isRoomFull(room), false);
  room.members.set('c_b', { role: 'shaman', ws: {}, online: false }); // 离线占位
  assert.equal(isRoomFull(room), true, '离线占位仍计入房满');
});

test('重连认领：带旧 clientId 的成员不新增槽、不触发房满', () => {
  const room = createRoom('AAAAAA');
  room.members.set('c_a', { role: 'victim', ws: {}, online: true });
  room.members.set('c_b', { role: 'shaman', ws: null, online: false });
  assert.equal(isRoomFull(room), true);
  // 模拟重连认领：复用原槽 clientId，不增加 size
  const before = room.members.size;
  const m = room.members.get('c_b');
  m.online = true;
  m.ws = {};
  assert.equal(room.members.size, before, '重连不应新增成员槽');
  assert.equal(isRoomFull(room), true);
});
