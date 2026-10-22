// 后端集成测试（node:test + 真实 ws 客户端），依据 design §15 / FEAT-002。
// 两个连接走：hello→建房→进房→切咒语→连打到 18→化灰→签文 全链路，
// 断言两端 room_state/burn/fortune 一致、hits 封顶 18、断线重连后快照对齐。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { startServer, TARGET_HITS } from './room-server.js';

// 在随机空闲端口起服务，避免与默认 8080 冲突。
function startTestServer() {
  return new Promise((resolve) => {
    const wss = startServer(0);
    wss.on('listening', () => resolve({ wss, port: wss.address().port }));
  });
}

// 轻量客户端封装：连接、发帧、等待指定 type 的帧。
class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.queue = [];
    this.waiters = [];
    this.opened = new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      // 优先交给匹配的等待者
      const idx = this.waiters.findIndex((w) => w.type === msg.type);
      if (idx !== -1) {
        const [w] = this.waiters.splice(idx, 1);
        w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  send(type, data = {}) {
    this.ws.send(JSON.stringify({ type, data, ts: Date.now() }));
  }

  waitFor(type, timeoutMs = 3000) {
    const queued = this.queue.findIndex((m) => m.type === type);
    if (queued !== -1) {
      const [m] = this.queue.splice(queued, 1);
      return Promise.resolve(m);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
      this.waiters.push({
        type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  async hello(clientId) {
    await this.opened;
    this.send('hello', clientId ? { clientId } : {});
    const ok = await this.waitFor('hello_ok');
    this.clientId = ok.data.clientId;
    return this.clientId;
  }

  close() {
    return new Promise((res) => {
      this.ws.once('close', res);
      this.ws.close();
    });
  }
}

function snapOf(msg) {
  return msg.data.snapshot || msg.data;
}

test('集成：双客户端全链路 hello→建房→进房→切咒语→打到18→化灰→签文', async (t) => {
  const { wss, port } = await startTestServer();
  const url = `ws://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => wss.close(res)));

  const victim = new Client(url);
  const shaman = new Client(url);

  await victim.hello();
  await shaman.hello();
  assert.ok(victim.clientId && shaman.clientId);
  assert.notEqual(victim.clientId, shaman.clientId);

  // 建房
  victim.send('create_room', { flower: '卷王本卷', crimes: ['抢功劳', '甩锅侠'] });
  const created = await victim.waitFor('room_created');
  const roomCode = created.data.roomCode;
  assert.equal(created.data.role, 'victim');
  assert.equal(snapOf(created).phase, 'altar');

  // 神婆进房：锁死后端进房契约（FEAT-001 步骤2）——
  // 防止将来误改后端把「神婆进坛卡住」问题甩回前端。
  shaman.send('join_room', { roomCode });
  const joined = await shaman.waitFor('room_joined');
  assert.equal(joined.data.role, 'shaman');
  const joinedSnap = snapOf(joined);
  assert.equal(joinedSnap.phase, 'altar', '进房快照 phase 应为 altar');
  assert.equal(joinedSnap.members.length, 2, '进房后房内应有苦主+神婆两人');
  const shamanSelf = joinedSnap.members.find((m) => m.isSelf);
  assert.ok(shamanSelf, '进房快照应含 isSelf 成员项');
  assert.equal(shamanSelf.role, 'shaman', '神婆自身成员项 role 应为 shaman');
  // 苦主收到 member_change
  const vMember = await victim.waitFor('member_change');
  assert.equal(vMember.data.count, 2);

  // 切咒语：全房广播 room_state，两端一致
  shaman.send('set_lang', { roomCode, lang: 'zh-HK' });
  const vLang = await victim.waitFor('room_state');
  const sLang = await shaman.waitFor('room_state');
  assert.equal(snapOf(vLang).lang, 'zh-HK');
  assert.equal(snapOf(sLang).lang, 'zh-HK');
  assert.equal(snapOf(vLang).phase, 'chanting');

  // 开打：phase=beating 随 room_state 广播
  victim.send('start_beat', { roomCode });
  const vBeat = await victim.waitFor('room_state');
  const sBeat = await shaman.waitFor('room_state');
  assert.equal(snapOf(vBeat).phase, 'beating');
  assert.equal(snapOf(sBeat).phase, 'beating');

  // 连打到 18：两端各打一部分（后端权威累加，累计超过 18 次）
  // 监听 burn/fortune（两端都应收到）
  const vBurn = victim.waitFor('burn');
  const sBurn = shaman.waitFor('burn');
  const vFortune = victim.waitFor('fortune');
  const sFortune = shaman.waitFor('fortune');

  for (let i = 0; i < 12; i++) victim.send('hit', { roomCode });
  for (let i = 0; i < 12; i++) shaman.send('hit', { roomCode }); // 累计超打，验证封顶

  const [vb, sb, vf, sf] = await Promise.all([vBurn, sBurn, vFortune, sFortune]);
  assert.equal(vb.data.hits, TARGET_HITS);
  assert.equal(sb.data.hits, TARGET_HITS);
  // 两端签文一致
  assert.deepEqual(
    { yi: vf.data.yi, ji: vf.data.ji, guiren: vf.data.guiren },
    { yi: sf.data.yi, ji: sf.data.ji, guiren: sf.data.guiren },
  );

  // 断线重连：苦主断开后带旧 clientId 重连，快照对齐（phase=fortune、hits=18、签文同值）
  const oldClientId = victim.clientId;
  await victim.close();
  const reconnected = new Client(url);
  await reconnected.hello(oldClientId);
  assert.equal(reconnected.clientId, oldClientId, '重连应认领原 clientId');
  const aligned = await reconnected.waitFor('room_state');
  const snap = snapOf(aligned);
  assert.equal(snap.phase, 'fortune');
  assert.equal(snap.hits, TARGET_HITS);
  assert.deepEqual(snap.fortune, { yi: vf.data.yi, ji: vf.data.ji, guiren: vf.data.guiren });
  // 重连未触发房满（未新增槽），成员仍为 2
  assert.equal(snap.members.length, 2);

  await shaman.close();
  await reconnected.close();
});

test('集成：fortune 后 reset 清空小人身份进入待重新立牌态，成员/房间码保留、进度归零', async (t) => {
  const { wss, port } = await startTestServer();
  const url = `ws://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => wss.close(res)));

  const victim = new Client(url);
  const shaman = new Client(url);

  await victim.hello();
  await shaman.hello();

  victim.send('create_room', { flower: '卷王本卷', crimes: ['抢功劳', '甩锅侠'] });
  const created = await victim.waitFor('room_created');
  const roomCode = created.data.roomCode;

  shaman.send('join_room', { roomCode });
  await shaman.waitFor('room_joined');
  await victim.waitFor('member_change');

  shaman.send('set_lang', { roomCode, lang: 'zh-HK' });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  victim.send('start_beat', { roomCode });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  const vFortune = victim.waitFor('fortune');
  const sFortune = shaman.waitFor('fortune');
  for (let i = 0; i < 18; i++) victim.send('hit', { roomCode });
  await Promise.all([vFortune, sFortune]);

  // 重开一坛：两端各收一帧 room_state，进度归零、花名/罪状清空、成员/房间码保留
  victim.send('reset', { roomCode });
  const vReset = await victim.waitFor('room_state');
  const sReset = await shaman.waitFor('room_state');
  const vs = snapOf(vReset);
  const ss = snapOf(sReset);

  for (const snap of [vs, ss]) {
    assert.equal(snap.phase, 'altar');
    assert.equal(snap.hits, 0);
    assert.equal(snap.burned, false);
    assert.equal(snap.fortune, null);
    assert.equal(snap.lang, null);
    assert.equal(snap.members.length, 2);
    assert.equal(snap.roomCode, roomCode);
    assert.equal(snap.flower, '', 'reset 后花名清空（待重新立牌）');
    assert.deepEqual(snap.crimes, [], 'reset 后罪状清空');
  }

  await victim.close();
  await shaman.close();
});

test('集成：reset 后 relist 重新立牌，神婆同步看到新小人、房间码/成员不变，后续流程可继续', async (t) => {
  const { wss, port } = await startTestServer();
  const url = `ws://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => wss.close(res)));

  const victim = new Client(url);
  const shaman = new Client(url);

  await victim.hello();
  await shaman.hello();

  victim.send('create_room', { flower: '卷王本卷', crimes: ['抢功劳'] });
  const created = await victim.waitFor('room_created');
  const roomCode = created.data.roomCode;

  shaman.send('join_room', { roomCode });
  await shaman.waitFor('room_joined');
  await victim.waitFor('member_change');

  shaman.send('set_lang', { roomCode, lang: 'zh-HK' });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  victim.send('start_beat', { roomCode });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  const vFortune = victim.waitFor('fortune');
  const sFortune = shaman.waitFor('fortune');
  for (let i = 0; i < 18; i++) victim.send('hit', { roomCode });
  await Promise.all([vFortune, sFortune]);

  // reset 进入待重新立牌态
  victim.send('reset', { roomCode });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  // 苦主重新立牌：提交全新小人身份
  victim.send('relist', { roomCode, flower: '新花名', crimes: ['摸鱼'] });
  const vRelist = await victim.waitFor('room_state');
  const sRelist = await shaman.waitFor('room_state');
  const vs = snapOf(vRelist);
  const ss = snapOf(sRelist);

  for (const snap of [vs, ss]) {
    assert.equal(snap.phase, 'altar', 'relist 后 phase 维持 altar');
    assert.equal(snap.flower, '新花名', '两端同步看到新花名');
    assert.deepEqual(snap.crimes, ['摸鱼'], '两端同步看到新罪状');
    assert.equal(snap.hits, 0);
    assert.equal(snap.members.length, 2, '成员保留');
    assert.equal(snap.roomCode, roomCode, '房间码不变');
  }

  // 后续流程可继续：苦主 set_lang 推进 chanting
  victim.send('set_lang', { roomCode, lang: 'zh-CN' });
  const vLang = await victim.waitFor('room_state');
  const sLang = await shaman.waitFor('room_state');
  assert.equal(snapOf(vLang).phase, 'chanting');
  assert.equal(snapOf(sLang).phase, 'chanting');

  await victim.close();
  await shaman.close();
});

test('集成：relist 在非待立牌态被静默拒绝（只回一帧 room_state、flower 不变，不下发 error）', async (t) => {
  const { wss, port } = await startTestServer();
  const url = `ws://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => wss.close(res)));

  const victim = new Client(url);
  await victim.hello();

  // 刚建房：flower 非空的 altar（非「待重新立牌」态）
  victim.send('create_room', { flower: '甩锅侠', crimes: ['抢功劳'] });
  const created = await victim.waitFor('room_created');
  const roomCode = created.data.roomCode;
  assert.equal(snapOf(created).phase, 'altar');

  // 此时 flower 非空，relist 应被静默拒绝：只回一帧 room_state、flower 不变
  victim.send('relist', { roomCode, flower: '新花名', crimes: ['摸鱼'] });
  const state = await victim.waitFor('room_state');
  assert.equal(snapOf(state).flower, '甩锅侠', 'relist 非待立牌态不更新 flower');
  assert.equal(snapOf(state).phase, 'altar');

  await assert.rejects(
    victim.waitFor('error', 300),
    /timeout waiting for error/,
    'relist 非法阶段不得下发 error 帧',
  );

  await victim.close();
});

test('集成：relist 由非苦主（神婆）发起被静默拒绝、flower 不变', async (t) => {
  const { wss, port } = await startTestServer();
  const url = `ws://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => wss.close(res)));

  const victim = new Client(url);
  const shaman = new Client(url);
  await victim.hello();
  await shaman.hello();

  victim.send('create_room', { flower: '卷王本卷', crimes: ['抢功劳'] });
  const created = await victim.waitFor('room_created');
  const roomCode = created.data.roomCode;

  shaman.send('join_room', { roomCode });
  await shaman.waitFor('room_joined');
  await victim.waitFor('member_change');

  shaman.send('set_lang', { roomCode, lang: 'zh-HK' });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  victim.send('start_beat', { roomCode });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  const vFortune = victim.waitFor('fortune');
  const sFortune = shaman.waitFor('fortune');
  for (let i = 0; i < 18; i++) victim.send('hit', { roomCode });
  await Promise.all([vFortune, sFortune]);

  victim.send('reset', { roomCode });
  await victim.waitFor('room_state');
  await shaman.waitFor('room_state');

  // 神婆（非苦主）发 relist → 静默拒绝，只回一帧 room_state、flower 仍为空
  shaman.send('relist', { roomCode, flower: '神婆乱填', crimes: ['摸鱼'] });
  const sState = await shaman.waitFor('room_state');
  assert.equal(snapOf(sState).flower, '', '非苦主 relist 不更新 flower');

  await assert.rejects(
    shaman.waitFor('error', 300),
    /timeout waiting for error/,
    'relist 越权不得下发 error 帧',
  );

  await victim.close();
  await shaman.close();
});

test('集成：非法阶段 reset 被静默拒绝（只回一帧 room_state，不下发 error）', async (t) => {
  const { wss, port } = await startTestServer();
  const url = `ws://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => wss.close(res)));

  const victim = new Client(url);
  await victim.hello();

  victim.send('create_room', { flower: '甩锅侠', crimes: [] });
  const created = await victim.waitFor('room_created');
  const roomCode = created.data.roomCode;
  assert.equal(snapOf(created).phase, 'altar');

  // altar 阶段直接 reset → 静默回一帧 room_state 自愈、phase 仍 altar
  victim.send('reset', { roomCode });
  const state = await victim.waitFor('room_state');
  assert.equal(snapOf(state).phase, 'altar');

  // 不应收到 error 帧（短超时内 waitFor('error') 应 reject）
  await assert.rejects(
    victim.waitFor('error', 300),
    /timeout waiting for error/,
    'reset 非法阶段不得下发 error 帧',
  );

  await victim.close();
});

test('集成：第三连接进房被 ROOM_FULL 拒；set_lang 对不存在房间回 ROOM_NOT_FOUND', async (t) => {
  const { wss, port } = await startTestServer();
  const url = `ws://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => wss.close(res)));

  const a = new Client(url);
  const b = new Client(url);
  const c = new Client(url);
  await a.hello();
  await b.hello();
  await c.hello();

  a.send('create_room', { flower: '甩锅侠', crimes: [] });
  const created = await a.waitFor('room_created');
  const roomCode = created.data.roomCode;

  b.send('join_room', { roomCode });
  await b.waitFor('room_joined');

  // 第三连接进房 → ROOM_FULL
  c.send('join_room', { roomCode });
  const err = await c.waitFor('error');
  assert.equal(err.data.code, 'ROOM_FULL');

  // 不存在房间 → ROOM_NOT_FOUND
  c.send('set_lang', { roomCode: 'ZZZZZZ', lang: 'zh-CN' });
  const err2 = await c.waitFor('error');
  assert.equal(err2.data.code, 'ROOM_NOT_FOUND');

  await a.close();
  await b.close();
  await c.close();
});
