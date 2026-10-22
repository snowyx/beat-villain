// 邀请（design §3 / §4.1 join_room / §13 邀请链接+二维码）。
// 苦主视角：显示房间码 + 复制邀请链接 + qrcode 二维码 + 「开始念咒」。
// 神婆视角（#/join?room=）：进房确认 → join_room；进房成功后 → 开坛法事等待页。
// ROOM_NOT_FOUND / ROOM_FULL 提示由 main.js handleError 处理。

export function initInvite(app) {
  const el = app.el;
  const s = app.store.state;
  // 神婆待进房：有邀请房间号且本端尚无房间 → 进房确认屏。
  const isShamanPending = app.pendingJoinRoom && !s.roomCode;

  if (isShamanPending) {
    renderShamanJoin(app, el);
  } else if (s.role === 'shaman') {
    // 已进房神婆 → 开坛法事等待页（不显示二维码/复制邀请链接/开始念咒）。
    renderShamanWaiting(app, el);
  } else {
    // role 未定或为苦主 → 兜底走苦主邀请屏，绝不误伤苦主路径。
    renderVictimInvite(app, el);
  }
}

// 成员在线态就地刷新：member_change 到达时，invite 屏 key/子视图不变，
// renderRoute 的挂载守卫会提前 return、不重建屏，导致成员行停留在旧态
// （神婆进房后苦主仍显示「神婆 ➖」）。故由 main.js 在 invite 屏已挂载时
// 直接调用本函数，只重绘 #members 一处，不重建整屏（保留二维码/输入态）。
export function refreshInviteMembers(app) {
  const box = document.querySelector('#screen-invite #members');
  if (box) renderMembers(app, box);
}

// 邀请链接拼接纯逻辑：可注入 location-like 对象，便于 node:test 无 DOM 单测。
// hostOverride（形如 '10.1.2.3:5173'）存在时用它替换 host 段，使复制/二维码
// 指向内网同事能访问的地址；否则沿用现状 origin+pathname。
export function buildInviteLink(roomCode, hostOverride, loc = location) {
  if (hostOverride) {
    return `${loc.protocol}//${hostOverride}${loc.pathname}#/join?room=${roomCode}`;
  }
  return `${loc.origin}${loc.pathname}#/join?room=${roomCode}`;
}

export function inviteLink(roomCode, hostOverride) {
  return buildInviteLink(roomCode, hostOverride);
}

// localhost / 127.0.0.1 场景：复制出的链接只能本机用，需引导换内网 IP。
export function isLocalHost(loc = location) {
  return loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
}

// 二维码渲染（离线 vendored 库）复用逻辑：随 host-override 输入实时刷新。
function renderQr(canvas, link, hasRoom) {
  try {
    if (canvas && window.qrcode && hasRoom) {
      const qr = window.qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      qr.renderTo(canvas, { cellSize: 5, margin: 3, dark: '#140A1F', light: '#F4C430' });
    }
  } catch (e) {
    console.debug('qr render failed', e);
  }
}

function renderVictimInvite(app, el) {
  const s = app.store.state;
  const code = s.roomCode || '------';
  const local = isLocalHost();
  // localhost 场景：默认用当前 host 作为可编辑初值，引导换内网 IP。
  const hostOverrideBlock = local
    ? `
      <input id="host-override" class="host-override" type="text" value="${escapeHtml(location.host)}" spellcheck="false" autocomplete="off">
      <p class="hint">localhost 链接只能本机用；分享给同事请把地址里的 localhost 换成你的内网 IP（如 10.x.x.x），终端执行 ipconfig getifaddr en0 查看</p>`
    : '';
  const initialLink = inviteLink(code, local ? location.host : undefined);
  el.innerHTML = `
    <div class="card">
      <h1 class="neon-title">请神婆代打</h1>
      <p class="subtitle">把坛号或链接发给神婆 · 她扫码即入坛</p>

      <div class="room-code">坛号 <span class="code-badge">${code}</span></div>

      <div class="qr-wrap"><canvas id="qr-canvas"></canvas></div>

      ${hostOverrideBlock}
      <div class="invite-actions">
        <button id="copy-link" class="btn-ghost" type="button">📋 复制邀请链接</button>
      </div>
      <p id="invite-hint" class="hint"></p>

      <div id="members" class="members-line"></div>

      <div class="bottom-bar">
        <button id="to-spell" class="btn-primary" type="button">🧙 开始念咒</button>
      </div>
    </div>
  `;

  const canvas = el.querySelector('#qr-canvas');
  const hostInput = el.querySelector('#host-override');
  renderQr(canvas, initialLink, !!s.roomCode);

  // host-override 输入变化：实时用修正后的 host 重拼链接并刷新二维码，
  // 使二维码与复制链接始终一致指向可访问地址。
  if (hostInput) {
    hostInput.addEventListener('input', () => {
      const host = hostInput.value.trim() || location.host;
      renderQr(canvas, inviteLink(code, host), !!s.roomCode);
    });
  }

  el.querySelector('#copy-link').addEventListener('click', async () => {
    const hint = el.querySelector('#invite-hint');
    // 有 host-override 输入框则读其值（空则回退 location.host）；否则无 override。
    const hostOverride = hostInput ? (hostInput.value.trim() || location.host) : undefined;
    const link = inviteLink(code, hostOverride);
    try {
      await navigator.clipboard.writeText(link);
      hint.textContent = '已复制邀请链接 ✅';
      hint.className = 'hint ok';
    } catch {
      hint.textContent = link;
      hint.className = 'hint';
    }
  });

  el.querySelector('#to-spell').addEventListener('click', () => {
    // 未定语言时默认普通话触发进入 chanting（后端据 set_lang 推进 phase）
    app.audioUnlock();
    app.ws.send('set_lang', { roomCode: s.roomCode, lang: s.lang || 'zh-CN' });
  });

  renderMembers(app, el.querySelector('#members'));
}

function renderShamanJoin(app, el) {
  const room = app.pendingJoinRoom;
  el.innerHTML = `
    <div class="card">
      <h1 class="neon-title">神婆入坛</h1>
      <p class="subtitle">受邀代打小人</p>
      <div class="room-code">坛号 <span class="code-badge">${room}</span></div>
      <p class="hint">确认进入该坛，助苦主抽鞋打小人。</p>
      <p id="join-hint" class="hint err"></p>
      <div class="bottom-bar">
        <button id="confirm-join" class="btn-primary" type="button">🧙‍♀️ 进坛代打</button>
      </div>
    </div>
  `;
  el.querySelector('#confirm-join').addEventListener('click', () => {
    app.audioUnlock();
    el.querySelector('#confirm-join').disabled = true;
    app.ws.send('join_room', { roomCode: room, role: 'shaman' });
  });
}

// 神婆已进房 → 开坛法事等待页。港式开坛仪式氛围，静候苦主念咒。
// 绝不渲染二维码 / 复制邀请链接 / 开始念咒按钮，也不绑定任何 set_lang。
// phase 转 chanting 后由既有 phase 路由自动切走本页。
function renderShamanWaiting(app, el) {
  const s = app.store.state;
  const flower = s.flower || '小人';
  const crimes = Array.isArray(s.crimes) ? s.crimes : [];
  // 罪状牌：神婆受邀代打，须知打的是谁、犯了啥（数据来自后端 join 快照）。
  const crimesHtml = crimes.length
    ? crimes.map((c) => `<span class="crime-chip-view">${escapeHtml(c)}</span>`).join('')
    : '<span class="rite-nocrime">（苦主未列罪状）</span>';

  el.innerHTML = `
    <div class="card altar-rite">
      <h1 class="neon-title">开坛法事</h1>
      <p class="rite-status">已入坛 · 静候开坛</p>

      <div class="rite-altar" aria-hidden="true">
        <span class="rite-item rite-candle">🕯️</span>
        <span class="rite-item rite-talisman">🧧</span>
        <span class="rite-item rite-fire">🔥</span>
        <span class="rite-item rite-talisman">🧧</span>
        <span class="rite-item rite-candle">🕯️</span>
      </div>

      <div class="rite-target">
        <p class="rite-target-label">今日要打的小人</p>
        <p class="rite-target-name">${escapeHtml(flower)}</p>
        <p class="rite-target-label">罪状</p>
        <div class="rite-crimes">${crimesHtml}</div>
      </div>

      <p class="rite-identity"><span class="rite-badge">神婆</span> 你是神婆</p>
      <p class="rite-words">神婆已就位，静候苦主开坛念咒…</p>

      <div id="members" class="members-line"></div>
    </div>
  `;

  renderMembers(app, el.querySelector('#members'));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderMembers(app, box) {
  if (!box) return;
  const members = app.store.state.members || [];
  const victim = members.find((m) => m.role === 'victim');
  const shaman = members.find((m) => m.role === 'shaman');
  const dot = (m) => (m ? (m.online ? '🟢' : '⚪️') : '➖');
  box.innerHTML = `
    <span>苦主 ${dot(victim)}</span>
    <span>神婆 ${dot(shaman)}</span>
  `;
}
