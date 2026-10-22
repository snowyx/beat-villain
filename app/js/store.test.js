// 前端 Store 纯函数单测（node:test + node:assert），依据 FEAT-002。
// 覆盖：(a) hits 单调递增防回退；(b) reset 快照让本地 hits 真正归 0、
// burned/fortune 清空、villainStage 回「嚣张」（绕过 Math.max 单调递增防回退）。
//
// 从仓库根运行：node --test app/js/store.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Store } from './store.js';

test('applyHit: hits 单调递增，乱序到达不回退', () => {
  const store = new Store();
  store.applyHit({ hits: 3 });
  assert.equal(store.state.hits, 3);
  store.applyHit({ hits: 7 });
  assert.equal(store.state.hits, 7);
  // 旧/乱序的小值不得令计数回退
  store.applyHit({ hits: 5 });
  assert.equal(store.state.hits, 7);
});

test('applySnapshot reset：phase=altar & hits=0 快照让本地 hits 真正归 0、签文清空', () => {
  const store = new Store();
  // 先推到满鞋化灰出签态
  store.applyHit({ hits: 18, villainStage: '化灰' });
  store.setBurned();
  store.applyFortune({ yi: '摸鱼', ji: '背锅', guiren: '食堂阿姨' });
  assert.equal(store.state.hits, 18);
  assert.equal(store.state.burned, true);
  assert.ok(store.state.fortune);

  // 重开一坛广播的快照：phase=altar、hits=0、burned=false、fortune=null
  store.applySnapshot({
    roomCode: 'A7K9QX',
    phase: 'altar',
    hits: 0,
    burned: false,
    fortune: null,
    villainStage: '嚣张',
    members: [],
  });

  assert.equal(store.state.hits, 0, 'reset 后 hits 必须真正归 0（绕过 Math.max）');
  assert.equal(store.state.burned, false);
  assert.equal(store.state.fortune, null, 'reset 后签文必须清空（不被 ?? 回退）');
  assert.equal(store.state.villainStage, '嚣张');
  assert.equal(store.state.phase, 'altar');
});

test('applySnapshot: 非 reset 的普通快照仍不令 hits 回退', () => {
  const store = new Store();
  store.applyHit({ hits: 10 });
  // beating 阶段快照带较小 hits（乱序/旧帧）不得回退
  store.applySnapshot({
    roomCode: 'A7K9QX',
    phase: 'beating',
    hits: 4,
    members: [],
  });
  assert.equal(store.state.hits, 10, '普通快照仍走 Math.max 单调递增');
});
