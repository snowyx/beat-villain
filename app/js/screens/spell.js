// 念咒（design §3 chanting / §4 set_lang / §7 咒语 / §8 回退）。
// 三语选择 → set_lang 全房同步；念咒调 audio；start_beat 进入开打。

import { playSpell, SPELL_TEXT } from '../audio.js';

const LANGS = [
  { code: 'zh-CN', label: '普通话' },
  { code: 'zh-HK', label: '粤语' },
  { code: 'en-US', label: 'English' },
];

export function initSpell(app) {
  const el = app.el;
  el.innerHTML = `
    <div class="card">
      <h1 class="neon-title">三语念咒</h1>
      <p class="subtitle">选语言 · 念开打令 · 全坛同步</p>

      <div class="lang-row">
        ${LANGS.map((l) => `<button class="lang-chip" type="button" data-lang="${l.code}">${l.label}</button>`).join('')}
      </div>

      <div class="spell-box">
        <p id="spell-text" class="spell-text"></p>
        <p id="speech-note" class="hint"></p>
      </div>

      <button id="chant-btn" class="btn-ghost" type="button">🔊 念咒</button>

      <div class="bottom-bar">
        <button id="start-beat" class="btn-primary" type="button">👟 开打！</button>
      </div>
    </div>
  `;

  const spellText = el.querySelector('#spell-text');
  const speechNote = el.querySelector('#speech-note');

  function reflectLang() {
    const lang = app.store.state.lang || 'zh-CN';
    el.querySelectorAll('.lang-chip').forEach((c) => {
      c.classList.toggle('on', c.dataset.lang === lang);
    });
    spellText.textContent = SPELL_TEXT[lang] || '';
    speechNote.textContent = '';
  }

  el.querySelector('.lang-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.lang-chip');
    if (!chip) return;
    app.audioUnlock();
    app.ws.send('set_lang', { roomCode: app.store.state.roomCode, lang: chip.dataset.lang });
  });

  el.querySelector('#chant-btn').addEventListener('click', () => {
    const lang = app.store.state.lang || 'zh-CN';
    const level = playSpell(lang, {
      onText: (text) => {
        spellText.textContent = text;
        speechNote.textContent =
          lang === 'zh-HK'
            ? '（粤语咒语原文如上，当前嗓音可能以普通话读出）'
            : '当前环境不支持语音朗读，请照念上方咒语';
      },
    });
    if (level === 'speech' && lang !== 'zh-HK') speechNote.textContent = '';
  });

  el.querySelector('#start-beat').addEventListener('click', () => {
    app.audioUnlock();
    app.ws.send('start_beat', { roomCode: app.store.state.roomCode });
  });

  // 订阅语言同步
  app._spellUnsub = app.store.subscribe(() => reflectLang());
  reflectLang();
}

export function teardownSpell(app) {
  if (app._spellUnsub) {
    app._spellUnsub();
    app._spellUnsub = null;
  }
}
