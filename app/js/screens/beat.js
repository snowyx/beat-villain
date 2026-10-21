// 开打（design §3 beating / §4.4 落鞋同步 / §6 小人物理）。
// 挂 villain canvas、显示 hits/剩余、落鞋发 hit 并以广播渲染、
// 本地即时手感（单次弹跳+音效）不本地加计数。

import { Villain } from '../villain.js';
import { playSmack } from '../audio.js';

export function initBeat(app) {
  const el = app.el;
  const s = app.store.state;
  el.innerHTML = `
    <div class="card beat-card">
      <div class="beat-head">
        <span class="flower-tag">小人：${escapeHtml(s.flower || '小人')}</span>
        <span id="hit-count" class="hit-count">0 / ${s.target}</span>
      </div>

      <div class="villain-stage" id="villain-stage">
        <canvas id="villain-canvas"></canvas>
        <div id="stage-label" class="stage-label"></div>
      </div>

      <div class="progress"><div id="progress-fill" class="progress-fill"></div></div>

      <div class="bottom-bar">
        <button id="hit-btn" class="btn-smack" type="button">👟 抄鞋开打！</button>
      </div>
    </div>
  `;

  const canvas = el.querySelector('#villain-canvas');
  const villain = new Villain(canvas);
  villain.setStage(s.villainStage);
  villain.start();
  app._villain = villain;

  const hitCount = el.querySelector('#hit-count');
  const fill = el.querySelector('#progress-fill');
  const stageLabel = el.querySelector('#stage-label');
  const hitBtn = el.querySelector('#hit-btn');

  function renderCount() {
    const st = app.store.state;
    hitCount.textContent = `${st.hits} / ${st.target}`;
    fill.style.width = `${Math.min(100, (st.hits / st.target) * 100)}%`;
    stageLabel.textContent = st.villainStage;
    villain.setStage(st.villainStage);
  }

  // 一次有效落鞋：本地即时手感（整体弹跳+部位反应+音效），不本地加计数；
  // 权威计数由后端广播 hit 回来（方案 B：hit 帧不携带 part，部位反应纯本地呈现）。
  function smack(part) {
    app.audioUnlock();
    villain.onHit();
    villain.onHitPart(part);
    villain.swingAt(part);
    playSmack();
    app.ws.send('hit', { roomCode: app.store.state.roomCode });
  }

  // 画布点击：把 clientX/clientY 换算成画布 CSS 像素坐标，据 villain.parts 判定部位。
  function onCanvasPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const part = villain.hitPartAt(x, y);
    smack(part);
  }
  canvas.addEventListener('pointerdown', onCanvasPointer);

  // 底部按钮兜底：默认打肚子。
  hitBtn.addEventListener('click', () => smack('belly'));

  // hit 广播到达 → 也播一次弹跳（含对端落鞋），并更新权威计数
  app._beatHitUnsub = app.onHitFrame(() => {
    villain.onHit();
    villain.swingAt('belly'); // 对端 hit 帧不带 part，默认拍肚子，使两端都有挥击爽感
    renderCount();
  });
  app._beatStageUnsub = app.onVillainStateFrame(({ villainStage }) => {
    villain.onStageEffect(villainStage);
  });
  app._beatStoreUnsub = app.store.subscribe(() => renderCount());

  renderCount();
}

export function teardownBeat(app) {
  if (app._villain) { app._villain.stop(); app._villain = null; }
  app._beatHitUnsub?.();
  app._beatStageUnsub?.();
  app._beatStoreUnsub?.();
  app._beatHitUnsub = app._beatStageUnsub = app._beatStoreUnsub = null;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
