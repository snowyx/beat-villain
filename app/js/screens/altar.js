// 开坛（design §3 altar / §4.1 create_room / 民俗合规 §1 花名拦截）。
// 花名接 compliance 拦截、6 罪状多选、一键随机花名、缺失禁用提交 → create_room。

import { checkFlower, randomFlower } from '../compliance.js';

const CRIMES = ['抢功劳', '甩锅侠', '阴阳怪气', '已读不回', '画饼大师', '卷王本卷'];

export function initAltar(app) {
  const el = app.el;
  el.innerHTML = `
    <div class="card">
      <h1 class="neon-title">开坛立牌</h1>
      <p class="subtitle">起个花名 · 列数罪状 · 请神婆代打</p>

      <label class="field-label" for="flower-input">小人花名（填代号，别打真人）</label>
      <div class="flower-row">
        <input id="flower-input" class="text-input" type="text" maxlength="12"
               placeholder="如：甩锅侠 / 卷王本卷" autocomplete="off" />
        <button id="random-flower" class="btn-ghost" type="button" title="一键随机花名">🎲</button>
      </div>
      <p id="flower-hint" class="hint"></p>

      <p class="field-label">他犯了啥（可多选）</p>
      <div id="crimes" class="crime-grid">
        ${CRIMES.map((c) => `<button class="crime-chip" type="button" data-crime="${c}">${c}</button>`).join('')}
      </div>

      <div class="bottom-bar">
        <button id="create-room" class="btn-primary" type="button" disabled>🔥 开坛</button>
      </div>
    </div>
  `;

  const input = el.querySelector('#flower-input');
  const hint = el.querySelector('#flower-hint');
  const randomBtn = el.querySelector('#random-flower');
  const crimesEl = el.querySelector('#crimes');
  const createBtn = el.querySelector('#create-room');

  const selected = new Set();

  function validate() {
    const name = input.value.trim();
    const ok = name.length >= 1 && selected.size >= 1;
    createBtn.disabled = !ok;
  }

  input.addEventListener('input', () => {
    hint.textContent = '';
    hint.className = 'hint';
    validate();
  });

  randomBtn.addEventListener('click', () => {
    input.value = randomFlower();
    hint.textContent = '';
    hint.className = 'hint';
    validate();
  });

  crimesEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.crime-chip');
    if (!chip) return;
    const c = chip.dataset.crime;
    if (selected.has(c)) {
      selected.delete(c);
      chip.classList.remove('on');
    } else {
      selected.add(c);
      chip.classList.add('on');
    }
    validate();
  });

  createBtn.addEventListener('click', () => {
    const flower = input.value.trim();
    const verdict = checkFlower(flower);
    if (verdict.blocked) {
      hint.textContent = '请填花名/代号，别打真人~（可点 🎲 随机）';
      hint.className = 'hint err';
      return;
    }
    if (selected.size < 1) return;
    createBtn.disabled = true;
    app.ws.send('create_room', { flower, crimes: [...selected] });
  });

  validate();
}
