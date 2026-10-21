// 开打（design §3 beating / §4.4 落鞋同步 / §6 小人物理）。
// 挂 villain canvas、显示 hits/剩余、落鞋发 hit 并以广播渲染、
// 本地即时手感（单次弹跳+音效）不本地加计数。

import { Villain } from '../villain.js';
import { playSmack, startBeatBgm, stopBeatBgm } from '../audio.js';

// 开打字幕（粤语打小人经文，逐字锁定，不改一字）。
const BEAT_SUBTITLES = Object.freeze([
  '打你个小人头 等你成世 冇出头',
  '打你个小人手 等你成日 做小偷',
  '打你个小人脚 等你成世 冇得走',
  '打你个小人身 等你成世 冇运番',
]);
const LINE_MS = 2800; // 每行高亮时长（固定拍，与 BGM 解耦，各自循环）

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

      <div class="beat-subtitles" id="beat-subtitles">
        ${BEAT_SUBTITLES.map((line) => `<div class="beat-sub-line">${line}</div>`).join('')}
      </div>

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

  // 背景音乐：进入开打屏循环播放（对齐既有手势解锁机制；autoplay 被拦截已在 helper 内吞掉）。
  app.audioUnlock();
  app._beatBgm = startBeatBgm({ volume: 0.6 });

  // 同步滚动字幕：固定拍逐行高亮，循环；与音频是否成功播放无关。
  const subLines = el.querySelectorAll('.beat-sub-line');
  let subIdx = 0;
  function highlight(i) {
    subLines.forEach((node, idx) => node.classList.toggle('on', idx === i));
  }
  highlight(0);
  app._beatSubtitleTimer = setInterval(() => {
    subIdx = (subIdx + 1) % subLines.length;
    highlight(subIdx);
  }, LINE_MS);
}

export function teardownBeat(app) {
  if (app._villain) { app._villain.stop(); app._villain = null; }
  app._beatHitUnsub?.();
  app._beatStageUnsub?.();
  app._beatStoreUnsub?.();
  app._beatHitUnsub = app._beatStageUnsub = app._beatStoreUnsub = null;

  // 停 BGM（暂停+归零+断源+丢引用）并清字幕定时器——离开开打屏唯一保证钩子，无泄漏/叠音。
  stopBeatBgm();
  app._beatBgm = null;
  if (app._beatSubtitleTimer) { clearInterval(app._beatSubtitleTimer); app._beatSubtitleTimer = null; }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
