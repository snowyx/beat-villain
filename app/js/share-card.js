// 分享图生成（design §11 / 民俗合规 §3）。
// 离屏 canvas 750×1334 竖版赛博符咒图；toBlob PNG；
// 保存/分享判定顺序：navigator.canShare({files}) → a[download] → 提示长按。
// 页脚保留合规小字。系统字体栈，无需等待 web font。

const RED = '#E23A3A';
const GOLD = '#F4C430';
const PURPLE = '#A24BFF';
const INK = '#140A1F';

const W = 750;
const H = 1334;
const KAI = '"STKaiti","KaiTi","BiauKai","楷体",serif';

/**
 * 绘制分享图到离屏 canvas，返回该 canvas。
 * data: { flower, crimes[], hits, fortune:{yi,ji,guiren}, roomCode }
 */
export function drawShareCard(data = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const {
    flower = '小人',
    crimes = [],
    hits = 88,
    fortune = { yi: '', ji: '', guiren: '' },
    roomCode = '',
  } = data;

  // 1) 夜市底 + 霓虹紫径向辉光
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, W * 0.9);
  glow.addColorStop(0, 'rgba(162,75,255,0.30)');
  glow.addColorStop(0.6, 'rgba(226,58,58,0.10)');
  glow.addColorStop(1, 'rgba(20,10,31,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // 2) 符咒框（朱砂红边 + 鎏金描边）
  const m = 48;
  ctx.lineWidth = 6;
  ctx.strokeStyle = RED;
  strokeRoundRect(ctx, m, m, W - m * 2, H - m * 2, 28);
  ctx.lineWidth = 2;
  ctx.strokeStyle = GOLD;
  strokeRoundRect(ctx, m + 10, m + 10, W - (m + 10) * 2, H - (m + 10) * 2, 22);

  // 顶部「敕令」牌匾
  const plaqueW = 220;
  const plaqueH = 96;
  const px = (W - plaqueW) / 2;
  const py = 70;
  ctx.fillStyle = RED;
  fillRoundRect(ctx, px, py, plaqueW, plaqueH, 14);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  strokeRoundRect(ctx, px, py, plaqueW, plaqueH, 14);
  ctx.fillStyle = GOLD;
  ctx.font = `bold 64px ${KAI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('敕令', W / 2, py + plaqueH / 2 + 4);

  // 副标题
  ctx.font = `28px ${KAI}`;
  ctx.fillStyle = PURPLE;
  ctx.fillText('赛博打小人 · 转运符', W / 2, py + plaqueH + 44);

  // 3) 花名（居中大字，金描边）
  ctx.font = `30px ${KAI}`;
  ctx.fillStyle = '#d9c7ff';
  ctx.fillText('小人花名', W / 2, 330);
  ctx.font = `bold 92px ${KAI}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = RED;
  ctx.strokeText(flower, W / 2, 410);
  ctx.fillStyle = GOLD;
  ctx.fillText(flower, W / 2, 410);

  // 4) 罪状牌（红底金字小牌）
  ctx.font = `30px ${KAI}`;
  let cy = 520;
  const chips = (crimes || []).slice(0, 6);
  const perRow = 2;
  const chipW = 260;
  const chipH = 58;
  const gap = 24;
  const totalW = perRow * chipW + (perRow - 1) * gap;
  const startX = (W - totalW) / 2;
  chips.forEach((c, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = startX + col * (chipW + gap);
    const y = cy + row * (chipH + 18);
    ctx.fillStyle = 'rgba(226,58,58,0.85)';
    fillRoundRect(ctx, x, y, chipW, chipH, 12);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    strokeRoundRect(ctx, x, y, chipW, chipH, 12);
    ctx.fillStyle = GOLD;
    ctx.fillText(c, x + chipW / 2, y + chipH / 2);
  });
  const rows = Math.ceil(chips.length / perRow) || 1;
  cy = cy + rows * (chipH + 18) + 40;

  // 5) 鞋数战绩
  ctx.font = `bold 72px ${KAI}`;
  ctx.fillStyle = GOLD;
  ctx.shadowColor = PURPLE;
  ctx.shadowBlur = 24;
  ctx.fillText(`共抽 ${hits} 鞋 · 已化灰`, W / 2, cy + 40);
  ctx.shadowBlur = 0;
  cy += 120;

  // 分隔
  ctx.strokeStyle = 'rgba(244,196,48,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m + 60, cy);
  ctx.lineTo(W - m - 60, cy);
  ctx.stroke();
  cy += 60;

  // 6) 签文：宜 / 忌 / 贵人
  const lines = [
    ['宜', fortune.yi || '—', GOLD],
    ['忌', fortune.ji || '—', RED],
    ['贵人', fortune.guiren || '—', PURPLE],
  ];
  ctx.textAlign = 'center';
  for (const [label, val, color] of lines) {
    ctx.font = `bold 44px ${KAI}`;
    ctx.fillStyle = color;
    ctx.fillText(`${label}  ${val}`, W / 2, cy);
    cy += 78;
  }

  // 7) 页脚合规小字（民俗合规 §3，强制保留）
  ctx.font = `24px ${KAI}`;
  ctx.fillStyle = 'rgba(217,199,255,0.8)';
  ctx.fillText('民俗数字化体验 · 娱乐解压，非指向真人', W / 2, H - 120);
  ctx.font = `20px ${KAI}`;
  ctx.fillStyle = 'rgba(244,196,48,0.6)';
  ctx.fillText('打小人 · 粤港澳民间习俗' + (roomCode ? ` · 坛号 ${roomCode}` : ''), W / 2, H - 84);

  return canvas;
}

/** 导出为 PNG Blob。 */
export function cardToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * 保存/分享（design §11 判定顺序）：
 *   1) navigator.canShare({files}) → navigator.share
 *   2) a[download]
 *   3) 渲染到页面 + 提示长按
 * 返回走到的方式：'share' | 'download' | 'longpress'。
 */
export async function saveOrShareCard(canvas, { fileName = 'cyber-villain.png', hintEl } = {}) {
  const blob = await cardToBlob(canvas);
  if (!blob) return 'longpress';
  const file = new File([blob], fileName, { type: 'image/png' });

  // 1) 系统分享（移动端优先）
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: '赛博打小人 · 转运符' });
      return 'share';
    }
  } catch {
    // 用户取消或不支持 → 落到下载
  }

  // 2) a[download]（桌面）
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'download';
  } catch {
    // 落到长按提示
  }

  // 3) 渲染到页面 + 提示长按
  if (hintEl) {
    const img = new Image();
    img.src = canvas.toDataURL('image/png');
    img.alt = '赛博打小人转运符';
    img.style.maxWidth = '100%';
    hintEl.innerHTML = '';
    hintEl.appendChild(img);
    const tip = document.createElement('p');
    tip.textContent = '长按图片保存';
    hintEl.appendChild(tip);
  }
  return 'longpress';
}

// ── 圆角矩形工具 ──
function pathRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fillRoundRect(ctx, x, y, w, h, r) { pathRoundRect(ctx, x, y, w, h, r); ctx.fill(); }
function strokeRoundRect(ctx, x, y, w, h, r) { pathRoundRect(ctx, x, y, w, h, r); ctx.stroke(); }
