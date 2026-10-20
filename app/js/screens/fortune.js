// 出签（design §3 fortune / §4.2 fortune / §11 分享图）。
// 收 fortune 显宜/忌/贵人，调 share-card 生成/保存分享图。

import { drawShareCard, saveOrShareCard } from '../share-card.js';

export function initFortune(app) {
  const el = app.el;
  const s = app.store.state;
  const f = s.fortune || { yi: '—', ji: '—', guiren: '—' };
  el.innerHTML = `
    <div class="card fortune-card">
      <h1 class="neon-title">转运签</h1>
      <p class="subtitle">小人已化灰 · 贵人将至</p>

      <div class="fortune-list">
        <div class="fortune-item yi"><span class="fl">宜</span><span class="fv">${escapeHtml(f.yi)}</span></div>
        <div class="fortune-item ji"><span class="fl">忌</span><span class="fv">${escapeHtml(f.ji)}</span></div>
        <div class="fortune-item gr"><span class="fl">贵人</span><span class="fv">${escapeHtml(f.guiren)}</span></div>
      </div>

      <div id="card-hint" class="card-hint"></div>

      <div class="bottom-bar">
        <button id="share-btn" class="btn-primary" type="button">🧧 生成转运符分享图</button>
      </div>
    </div>
  `;

  el.querySelector('#share-btn').addEventListener('click', async () => {
    const btn = el.querySelector('#share-btn');
    const hintEl = el.querySelector('#card-hint');
    btn.disabled = true;
    btn.textContent = '绘制中…';
    try {
      const st = app.store.state;
      const canvas = drawShareCard({
        flower: st.flower,
        crimes: st.crimes,
        hits: st.hits,
        fortune: st.fortune || f,
        roomCode: st.roomCode,
      });
      const how = await saveOrShareCard(canvas, { hintEl });
      if (how === 'download') hintEl.textContent = '已保存转运符 PNG ✅';
      else if (how === 'share') hintEl.textContent = '已唤起系统分享 ✅';
      // longpress 已在 saveOrShareCard 内渲染图片+提示
    } catch (e) {
      console.error(e);
      hintEl.textContent = '生成失败，请重试';
    } finally {
      btn.disabled = false;
      btn.textContent = '🧧 生成转运符分享图';
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
