// invite.js 邀请链接拼接纯函数单测（node:test，无 DOM）。
// 运行：node --test app/js/screens/invite.test.js
// 覆盖 FEAT-001 验收：无 override 用 origin+pathname；传 host override 替换 host 段。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInviteLink, isLocalHost } from './invite.js';

// 局域网 IP 主机 location-like 对象。
const ipLoc = {
  protocol: 'http:',
  host: '10.0.0.5:5173',
  origin: 'http://10.0.0.5:5173',
  pathname: '/',
  hostname: '10.0.0.5',
};

// localhost 主机 location-like 对象。
const localLoc = {
  protocol: 'http:',
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  pathname: '/',
  hostname: 'localhost',
};

test('(a) 具体 IP 主机、无 override → 链接含该 IP 且 #/join?room=<code>', () => {
  const link = buildInviteLink('ABC123', undefined, ipLoc);
  assert.equal(link, 'http://10.0.0.5:5173/#/join?room=ABC123');
  assert.ok(link.includes('10.0.0.5'));
  assert.ok(link.includes('#/join?room=ABC123'));
});

test('(b) localhost 主机、无 override → 链接含 localhost', () => {
  const link = buildInviteLink('ABC123', undefined, localLoc);
  assert.equal(link, 'http://localhost:5173/#/join?room=ABC123');
  assert.ok(link.includes('localhost'));
});

test("(c) 传 override '10.0.0.5:5173' → 链接 host 段为 10.0.0.5:5173", () => {
  const link = buildInviteLink('ABC123', '10.0.0.5:5173', localLoc);
  assert.equal(link, 'http://10.0.0.5:5173/#/join?room=ABC123');
  assert.ok(link.includes('10.0.0.5:5173'));
  assert.ok(link.includes('#/join?room=ABC123'));
});

test('无 override 等于 origin+pathname+#/join?room=<code>', () => {
  const link = buildInviteLink('ZZZ999', undefined, ipLoc);
  assert.equal(link, `${ipLoc.origin}${ipLoc.pathname}#/join?room=ZZZ999`);
});

test('override 使用 location.protocol 拼接', () => {
  const httpsLoc = { ...ipLoc, protocol: 'https:' };
  const link = buildInviteLink('CODE42', '192.168.1.8:5173', httpsLoc);
  assert.equal(link, 'https://192.168.1.8:5173/#/join?room=CODE42');
});

test('isLocalHost 判定 localhost / 127.0.0.1 为真，IP 为假', () => {
  assert.equal(isLocalHost(localLoc), true);
  assert.equal(isLocalHost({ ...localLoc, hostname: '127.0.0.1' }), true);
  assert.equal(isLocalHost(ipLoc), false);
});
