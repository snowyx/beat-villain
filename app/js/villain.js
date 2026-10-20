// canvas 2D 纸片人（design §6 / 民俗合规 §2）。
// 四阶段：嚣张 0–21 / 懵逼 22–43 / 冒烟 44–87 / 化灰 88。
// 每收一条 hit 广播播一次阻尼正弦弹跳（单实例 tween，重入 retrigger 重置相位）
//   + 拖鞋印粒子（有上限）。
// 化灰 = 金/紫祥云粒子上飘淡出 + 赛博纸钱；无任何血腥元素（朱砂红不作血）。

const RED = '#E23A3A';
const GOLD = '#F4C430';
const PURPLE = '#A24BFF';
const INK = '#140A1F';

const STAGE = { SWAGGER: '嚣张', DAZED: '懵逼', SMOKING: '冒烟', ASH: '化灰' };

export class Villain {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.stage = STAGE.SWAGGER;
    this.running = false;

    // 单实例弹跳 tween（retrigger 重置相位）
    this.bounce = { active: false, t: 0, dur: 0.38, amp: 0 };
    this.shakeT = 0;

    // 拖鞋印粒子（上限）
    this.slippers = [];
    this.SLIPPER_MAX = 14;

    // 化灰粒子
    this.ashParticles = [];
    this.joss = [];
    this.burning = false;
    this.burnT = 0;

    this._raf = null;
    this._last = 0;
    this._smokePuffs = [];
    this._resize();
    window.addEventListener('resize', this._resizeBound = () => this._resize());
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 360;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.W = w;
    this.H = h;
  }

  setStage(stage) {
    this.stage = stage || this.stage;
  }

  /** 收到一条 hit 广播：retrigger 单实例弹跳 + 加拖鞋印粒子。 */
  onHit() {
    this.bounce.active = true;
    this.bounce.t = 0; // retrigger：重置相位，不叠加新 tween
    this.bounce.amp = 1;
    this.shakeT = 0.18;
    this._addSlipper();
  }

  /** 跨阶段一次性特效（villain_state）：进「冒烟」播一次烟雾。 */
  onStageEffect(stage) {
    if (stage === STAGE.SMOKING) {
      for (let i = 0; i < 6; i++) this._addSmoke();
    }
  }

  /** 化灰：启动祥云消散 + 赛博纸钱。 */
  burn() {
    if (this.burning) return;
    this.burning = true;
    this.burnT = 0;
    this.stage = STAGE.ASH;
    const cx = this.W / 2;
    const cy = this.H * 0.52;
    // 纸片人碎成金/紫祥云粒子上飘
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 46;
      this.ashParticles.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r * 1.2,
        vx: (Math.random() - 0.5) * 24,
        vy: -30 - Math.random() * 70,
        life: 1,
        size: 3 + Math.random() * 5,
        color: Math.random() < 0.5 ? GOLD : PURPLE,
      });
    }
    // 赛博纸钱（🧧 + 金箔矩形）
    for (let i = 0; i < 12; i++) {
      this.joss.push({
        x: cx + (Math.random() - 0.5) * this.W * 0.7,
        y: cy + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 50,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 4,
        emoji: Math.random() < 0.5 ? '🧧' : null,
        life: 1,
      });
    }
  }

  _addSlipper() {
    if (this.slippers.length >= this.SLIPPER_MAX) this.slippers.shift();
    this.slippers.push({
      x: this.W * (0.25 + Math.random() * 0.5),
      y: this.H * (0.62 + Math.random() * 0.18),
      rot: (Math.random() - 0.5) * 1.2,
      life: 1,
      scale: 0.8 + Math.random() * 0.5,
    });
  }

  _addSmoke() {
    this._smokePuffs.push({
      x: this.W / 2 + (Math.random() - 0.5) * 30,
      y: this.H * 0.3,
      vy: -20 - Math.random() * 20,
      life: 1,
      size: 8 + Math.random() * 10,
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this._update(dt);
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._resizeBound) window.removeEventListener('resize', this._resizeBound);
  }

  _update(dt) {
    if (this.bounce.active) {
      this.bounce.t += dt;
      if (this.bounce.t >= this.bounce.dur) this.bounce.active = false;
    }
    if (this.shakeT > 0) this.shakeT -= dt;

    for (const s of this.slippers) s.life -= dt * 1.1;
    this.slippers = this.slippers.filter((s) => s.life > 0);

    for (const p of this._smokePuffs) { p.y += p.vy * dt; p.life -= dt * 0.8; p.size += dt * 6; }
    this._smokePuffs = this._smokePuffs.filter((p) => p.life > 0);

    if (this.burning) {
      this.burnT += dt;
      for (const p of this.ashParticles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 6 * dt; // 轻微回落的祥云飘感
        p.vx *= 0.99;
        p.life -= dt * 0.55;
      }
      this.ashParticles = this.ashParticles.filter((p) => p.life > 0);
      for (const j of this.joss) {
        j.x += j.vx * dt;
        j.y += j.vy * dt;
        j.vy += 20 * dt;
        j.rot += j.vr * dt;
        j.life -= dt * 0.4;
      }
      this.joss = this.joss.filter((j) => j.life > 0);
    }
  }

  _draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.W, this.H);

    // 夜市暗底径向辉光
    const bg = ctx.createRadialGradient(this.W / 2, this.H / 2, 20, this.W / 2, this.H / 2, this.W * 0.8);
    bg.addColorStop(0, 'rgba(162,75,255,0.18)');
    bg.addColorStop(1, 'rgba(20,10,31,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.W, this.H);

    // 拖鞋印
    for (const s of this.slippers) this._drawSlipperMark(s);

    if (this.burning) {
      this._drawBurn();
      ctx.restore();
      return;
    }

    // 弹跳位移（阻尼正弦）：y = A·e^(-t/τ)·sin(ωt)
    let bounceY = 0;
    let squash = 1;
    if (this.bounce.active) {
      const t = this.bounce.t;
      const tau = 0.12;
      const omega = 26;
      const damp = Math.exp(-t / tau);
      bounceY = -14 * damp * Math.sin(omega * t);
      squash = 1 + 0.12 * damp * Math.cos(omega * t);
    }
    const shakeX = this.shakeT > 0 ? Math.sin(performance.now() / 18) * 4 * (this.shakeT / 0.18) : 0;

    this._drawVillain(this.W / 2 + shakeX, this.H * 0.52 + bounceY, squash);

    // 烟雾
    for (const p of this._smokePuffs) {
      ctx.globalAlpha = Math.max(0, p.life) * 0.5;
      ctx.fillStyle = '#9aa';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  _drawSlipperMark(s) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, s.life) * 0.55;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.scale(s.scale, s.scale);
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawVillain(cx, cy, squash) {
    const ctx = this.ctx;
    const w = 72;
    const h = 96 * squash;
    ctx.save();
    ctx.translate(cx, cy);

    // 纸片身体（卡通纸扎，金边）
    ctx.fillStyle = '#F3E6C8';
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    roundRect(ctx, -w / 2, -h / 2, w, h, 10);
    ctx.fill();
    ctx.stroke();

    // 纸纹竖线
    ctx.strokeStyle = 'rgba(226,58,58,0.15)';
    ctx.lineWidth = 1;
    for (let i = -w / 2 + 12; i < w / 2; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, -h / 2 + 6);
      ctx.lineTo(i, h / 2 - 6);
      ctx.stroke();
    }

    // 脸（随阶段变化）
    this._drawFace(ctx, h);
    ctx.restore();
  }

  _drawFace(ctx, h) {
    const eyeY = -h * 0.18;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;

    if (this.stage === STAGE.SWAGGER) {
      // 叉腰咧嘴挑衅：斜挑眉 + 坏笑
      ctx.beginPath(); ctx.moveTo(-18, eyeY - 6); ctx.lineTo(-6, eyeY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(18, eyeY - 6); ctx.lineTo(6, eyeY); ctx.stroke();
      dot(ctx, -12, eyeY + 2, 3); dot(ctx, 12, eyeY + 2, 3);
      ctx.beginPath(); ctx.arc(0, eyeY + 24, 14, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      // 挑衅吐舌
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.ellipse(4, eyeY + 32, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
    } else if (this.stage === STAGE.DAZED) {
      // 懵逼：圈圈眼 + 问号
      ctx.lineWidth = 2.5;
      circle(ctx, -12, eyeY + 2, 7); circle(ctx, 12, eyeY + 2, 7);
      ctx.beginPath(); ctx.arc(0, eyeY + 26, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = PURPLE;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('?', 18, eyeY - 14);
    } else if (this.stage === STAGE.SMOKING) {
      // 冒烟：X 眼 + 歪嘴 + 裂纹
      cross(ctx, -12, eyeY + 2, 7); cross(ctx, 12, eyeY + 2, 7);
      ctx.beginPath(); ctx.moveTo(-10, eyeY + 28); ctx.lineTo(10, eyeY + 22); ctx.stroke();
      // 裂纹（非血腥，纸裂）
      ctx.strokeStyle = 'rgba(162,75,255,0.6)';
      ctx.beginPath(); ctx.moveTo(-4, eyeY + 40); ctx.lineTo(2, eyeY + 52); ctx.lineTo(-2, eyeY + 60); ctx.stroke();
      // 头顶冒烟符号
      ctx.fillStyle = '#aab';
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.5 - i * 0.12;
        ctx.beginPath();
        ctx.arc((i - 1) * 8, eyeY - 30 - i * 10 + Math.sin(performance.now() / 300 + i) * 3, 7 - i, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawBurn() {
    const ctx = this.ctx;
    // 祥云粒子
    for (const p of this.ashParticles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    // 赛博纸钱
    for (const j of this.joss) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, j.life);
      ctx.translate(j.x, j.y);
      ctx.rotate(j.rot);
      if (j.emoji) {
        ctx.font = '22px serif';
        ctx.textAlign = 'center';
        ctx.fillText(j.emoji, 0, 0);
      } else {
        ctx.fillStyle = GOLD;
        ctx.fillRect(-10, -6, 20, 12);
        ctx.strokeStyle = RED;
        ctx.lineWidth = 1;
        ctx.strokeRect(-10, -6, 20, 12);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

// ── 绘图小工具 ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
function cross(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke();
}
