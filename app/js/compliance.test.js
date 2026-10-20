// compliance.js 纯函数单测（node:test，无第三方框架）。
// 运行：node --test app/js/compliance.test.js
// 覆盖 FEAT-003 验收：真名拦截、整活花名放行。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFlower, randomFlower, COMMON_SURNAMES } from './compliance.js';

test('真名应被拦截（姓氏开头 2–4 纯汉字）', () => {
  for (const name of ['张三', '王小明', '李先生', '刘德', '欧阳娜', '诸葛明']) {
    const r = checkFlower(name);
    assert.equal(r.blocked, true, `应拦截：${name}（reason=${r.reason}）`);
  }
});

test('姓 + 称谓应被拦截', () => {
  for (const name of ['李先生', '王女士', '张经理', '陈老师', '赵总']) {
    assert.equal(checkFlower(name).blocked, true, `应拦截：${name}`);
  }
});

test('整活花名应放行', () => {
  for (const name of ['甩锅侠', '卷王本卷', '隔壁组某人', '阴阳人', '画饼大师', '摸鱼之光', '键盘侠']) {
    const r = checkFlower(name);
    assert.equal(r.blocked, false, `应放行：${name}（reason=${r.reason}）`);
  }
});

test('非中文 / 含数字符号 / 英文花名放行', () => {
  for (const name of ['BadGuy', '996', 'boss无情', '小人No.1', '🤬坏蛋']) {
    assert.equal(checkFlower(name).blocked, false, `应放行：${name}`);
  }
});

test('长度越界 / 非字符串放行（前置校验不触发拦截）', () => {
  assert.equal(checkFlower('').blocked, false);
  assert.equal(checkFlower('一二三四五六七八九十十一十二十三').blocked, false);
  assert.equal(checkFlower(null).blocked, false);
  assert.equal(checkFlower(12345).blocked, false);
});

test('非姓氏开头的 2–4 纯汉字词放行（避免误伤罪状风花名）', () => {
  for (const name of ['躺平', '摆烂', '咸鱼', '夺命连环']) {
    assert.equal(checkFlower(name).blocked, false, `应放行：${name}`);
  }
});

test('randomFlower 生成的花名必然放行', () => {
  for (let i = 0; i < 200; i++) {
    const f = randomFlower();
    assert.equal(checkFlower(f).blocked, false, `随机花名应放行：${f}`);
  }
});

test('姓氏表约 100 项且含常见复姓', () => {
  assert.ok(COMMON_SURNAMES.length >= 100, `姓氏表应 ≥100，实际 ${COMMON_SURNAMES.length}`);
  for (const s of ['欧阳', '司马', '上官', '诸葛']) {
    assert.ok(COMMON_SURNAMES.includes(s), `应含复姓 ${s}`);
  }
});
