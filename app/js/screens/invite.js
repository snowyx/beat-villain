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

function inviteLink(roomCode) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/join?room=${roomCode}`;
}

function renderVictimInvite(app, el) {
  const s = app.store.state;
  const code = s.roomCode || '------';
  const link = inviteLink(code);
  el.innerHTML = `
    <div class="card">
      <h1 class="neon-title">请神婆代打</h1>
      <p class="subtitle">把坛号或链接发给神婆 · 她扫码即入坛</p>

      <div class="room-code">坛号 <span class="code-badge">${code}</span></div>

      <div class="qr-wrap"><canvas id="qr-canvas"></canvas></div>

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

  // 二维码（离线 vendored 库）
  try {
    const canvas = el.querySelector('#qr-canvas');
    if (window.qrcode && s.roomCode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      qr.renderTo(canvas, { cellSize: 5, margin: 3, dark: '#140A1F', light: '#F4C430' });
    }
  } catch (e) {
    console.debug('qr render failed', e);
  }

  el.querySelector('#copy-link').addEventListener('click', async () => {
    const hint = el.querySelector('#invite-hint');
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

      <p class="rite-identity"><span class="rite-badge">神婆</span> 你是神婆</p>
      <p class="rite-words">神婆已就位，静候苦主开坛念咒…</p>

      <div id="members" class="members-line"></div>
    </div>
  `;

  renderMembers(app, el.querySelector('#members'));
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
