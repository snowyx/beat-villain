// 化灰（design §3 burning / §4.2 burn / §10 无血腥）。
// 收 burn 播化灰（祥云消散+赛博纸钱）+ 全屏「晦气退散」，随后进签文。

import { Villain } from '../villain.js';

export function initAsh(app) {
  const el = app.el;
  const s = app.store.state;
  el.innerHTML = `
    <div class="card ash-card">
      <div class="villain-stage" id="ash-stage">
        <canvas id="ash-canvas"></canvas>
      </div>
      <div class="ash-banner neon-title">晦气退散</div>
      <p class="subtitle">小人已化作祥云 · 共抽 ${Math.max(s.hits, s.target)} 鞋</p>
    </div>
  `;

  const canvas = el.querySelector('#ash-canvas');
  const villain = new Villain(canvas);
  villain.start();
  villain.burn();
  app._ashVillain = villain;

  // 动画时长后自动显签文。后端随 burn 一并抽签并以 fortune 增量帧下发（不带 room_state），
  // 故前端自行按化灰动画时长推进本地 phase→fortune 再路由（design §3）。
  app._ashTimer = setTimeout(() => {
    if (app.store.state.fortune || app.store._fortuneReady) {
      app.store.state.phase = 'fortune';
      app.route();
    }
  }, 2600);
}

export function teardownAsh(app) {
  if (app._ashVillain) { app._ashVillain.stop(); app._ashVillain = null; }
  if (app._ashTimer) { clearTimeout(app._ashTimer); app._ashTimer = null; }
}
