// canvas 2D 纸扎卡通人形（design §6 / 民俗合规 §2）。
// 人形分头/躯干(肚子)/两条腿三区（含两条手臂），金边纸片质感，只用四色。
// 四阶段：嚣张 0–2 / 懵逼 3–4 / 冒烟 5–7 / 化灰 8（随累计鞋数递进）。
// 每收一条 hit 广播播一次阻尼正弦整体弹跳（单实例 tween，重入 retrigger 重置相位）
//   + 拖鞋印粒子（有上限）。
// 部位反应（onHitPart）：打头/肚子/腿各有差异化本地呈现 + 拟声词文字粒子，
//   叠加在当前阶段表情之上，纯前端即时反馈，不影响整体弹跳单实例规则。
// 化灰 = 金/紫祥云粒子上飘淡出 + 赛博纸钱；无任何血腥元素（朱砂红不作血）。

const RED = '#E23A3A';
const GOLD = '#F4C430';
const PURPLE = '#A24BFF';
const INK = '#140A1F';
const PAPER = '#F3E6C8'; // 纸扎米黄纸面（非四色之一，仅作纸张本体底色，描边用 GOLD）

const STAGE = { SWAGGER: '嚣张', DAZED: '懵逼', SMOKING: '冒烟', ASH: '化灰' };

// 部位相对 cx,cy 的布局矩形（CSS 像素，供绘制与点击判定复用；避免魔法数散落）。
// 坐标系原点在人形中心 (cx,cy)，y 向下为正。
const PARTS = {
  head: { x: -22, y: -72, w: 44, h: 42 },
  belly: { x: -30, y: -28, w: 60, h: 56 },
  legs: { x: -26, y: 30, w: 52, h: 50 },
};

// 拟声词：按部位 + 鎏金黄/霓虹紫描边短暂上飘淡出。
const ONOMATOPOEIA = {
  head: ['哐', '咚'],
  belly: ['呃', '嗷'],
  legs: ['嘶', '噢'],
};

export class Villain {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.stage = STAGE.SWAGGER;
    this.running = false;

    // 单实例整体弹跳 tween（retrigger 重置相位）
    this.bounce = { active: false, t: 0, dur: 0.38, amp: 0 };
    this.shakeT = 0;

    // 部位局部反应：按部位的短时衰减变量（0→无反应），各自独立不影响整体弹跳。
    this.partReact = { head: 0, belly: 0, legs: 0 };

    // 拟声词文字粒子（上限）
    this.words = [];
    this.WORD_MAX = 10;
    // 打头冒金星粒子（上限）
    this.stars = [];
    this.STAR_MAX = 18;

    // 拖鞋印粒子（上限）
    this.slippers = [];
    this.SLIPPER_MAX = 14;

    // 化灰粒子
    this.ashParticles = [];
    this.joss = [];
    this.burning = false;
    this.burnT = 0;

    // 部位布局（CSS 像素，相对画布中心，供 beat.js 点击判定复用）。
    this.parts = PARTS;

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
    // 人形中心（供点击判定换算绝对部位矩形）。
    this.cx = w / 2;
    this.cy = h * 0.52;
  }

  setStage(stage) {
    this.stage = stage || this.stage;
  }

  /**
   * 命中部位判定：传入画布 CSS 像素坐标 (x,y)，返回 'head'|'belly'|'legs'。
   * 落在人形外或无法判定默认 'belly'（保证每次点击都算一次有效落鞋）。
   */
  hitPartAt(x, y) {
    const lx = x - this.cx;
    const ly = y - this.cy;
    for (const key of ['head', 'belly', 'legs']) {
      const r = this.parts[key];
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return key;
    }
    return 'belly';
  }

  /** 收到一条 hit 广播：retrigger 单实例整体弹跳 + 加拖鞋印粒子。 */
  onHit() {
    this.bounce.active = true;
    this.bounce.t = 0; // retrigger：重置相位，不叠加新 tween
    this.bounce.amp = 1;
    this.shakeT = 0.18;
    this._addSlipper();
  }

  /**
   * 部位命中本地反应（part ∈ 'head'|'belly'|'legs'）：差异化局部变形 + 拟声词粒子，
   * 叠加在当前阶段表情之上。纯前端即时呈现，不走后端、不加计数。
   */
  onHitPart(part) {
    if (this.burning) return;
    const key = this.parts[part] ? part : 'belly';
    this.partReact[key] = 1; // retrigger：重置该部位短时衰减变量
    this._addWord(key);
    if (key === 'head') this._addStars();
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

  _addWord(part) {
    if (this.words.length >= this.WORD_MAX) this.words.shift();
    const pool = ONOMATOPOEIA[part] || ONOMATOPOEIA.belly;
    const r = this.parts[part];
    // 拟声词出现在被打部位附近（相对中心的局部坐标，绘制时平移到 cx,cy）。
    this.words.push({
      text: pool[Math.floor(Math.random() * pool.length)],
      lx: r.x + r.w / 2 + (Math.random() - 0.5) * 24,
      ly: r.y + r.h / 2,
      life: 1,
      color: Math.random() < 0.5 ? GOLD : PURPLE,
      size: 22 + Math.random() * 8,
    });
  }

  _addStars() {
    const r = this.parts.head;
    const n = Math.min(6, this.STAR_MAX - this.stars.length);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.stars.push({
        lx: r.x + r.w / 2,
        ly: r.y + r.h / 2,
        vx: Math.cos(a) * (18 + Math.random() * 30),
        vy: Math.sin(a) * (18 + Math.random() * 30) - 10,
        life: 1,
        size: 3 + Math.random() * 3,
      });
    }
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

    // 部位短时衰减（约 0.4s 衰减完）
    for (const k of ['head', 'belly', 'legs']) {
      if (this.partReact[k] > 0) this.partReact[k] = Math.max(0, this.partReact[k] - dt * 2.6);
    }

    for (const s of this.slippers) s.life -= dt * 1.1;
    this.slippers = this.slippers.filter((s) => s.life > 0);

    // 拟声词上飘淡出
    for (const w of this.words) { w.ly -= dt * 34; w.life -= dt * 1.4; }
    this.words = this.words.filter((w) => w.life > 0);

    // 金星
    for (const st of this.stars) {
      st.lx += st.vx * dt;
      st.ly += st.vy * dt;
      st.vy += 40 * dt;
      st.life -= dt * 1.8;
    }
    this.stars = this.stars.filter((st) => st.life > 0);

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

    // 整体弹跳位移（阻尼正弦）：y = A·e^(-t/τ)·sin(ωt)
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

    this._drawVillain(this.cx + shakeX, this.cy + bounceY, squash);

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

  /**
   * 纸扎卡通人形：头(含脸) + 躯干(肚子) + 两条腿 + 两条手臂，金边纸片 + 纸纹竖线。
   * 各部位带自己的被打局部反应（晃动/弓起/弹开），叠加在整体 squash 之上。
   */
  _drawVillain(cx, cy, squash) {
    const ctx = this.ctx;
    const P = this.parts;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, squash); // 整体挤压（整体弹跳的一部分）

    // 衰减反应强度（0–1）与由其驱动的偏移/角度
    const rh = this.partReact.head;
    const rb = this.partReact.belly;
    const rl = this.partReact.legs;
    const now = performance.now();

    // ── 两条腿（打腿→弹开/跳脚）──
    const legKick = rl * 10 * Math.sin(now / 40);
    this._drawLeg(ctx, P.legs, -1, legKick, rl);
    this._drawLeg(ctx, P.legs, 1, -legKick, rl);

    // ── 两条手臂（嚣张叉腰；打肚子时内收捂肚）──
    this._drawArm(ctx, P.belly, -1, rb);
    this._drawArm(ctx, P.belly, 1, rb);

    // ── 躯干 / 肚子（打肚子→弓起/捂肚，整体轻微下压）──
    ctx.save();
    const bellyBow = rb * 6; // 弓起下压
    ctx.translate(0, bellyBow);
    this._drawPaperRect(ctx, P.belly.x, P.belly.y, P.belly.w, P.belly.h, 10);
    ctx.restore();

    // ── 头（含脸）（打头→猛烈晃动+转圈眼/冒金星）──
    ctx.save();
    const headShake = rh > 0 ? Math.sin(now / 16) * 8 * rh : 0;
    const headTilt = rh * 0.25 * Math.sin(now / 22);
    ctx.translate(headShake, 0);
    ctx.rotate(headTilt);
    this._drawPaperRect(ctx, P.head.x, P.head.y, P.head.w, P.head.h, 9);
    // 细脖子连接
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    roundRect(ctx, -6, P.head.y + P.head.h - 2, 12, 10, 3);
    ctx.fill();
    ctx.stroke();
    // 脸：阶段表情 + 部位反应（打头→转圈眼）叠加
    this._drawFace(ctx, P.head, rh, rb);
    ctx.restore();

    ctx.restore(); // 撤销 squash/translate

    // ── 部位粒子（金星 / 拟声词）在未经 squash 的坐标系内绘制 ──
    ctx.save();
    ctx.translate(cx, cy);
    for (const st of this.stars) {
      ctx.globalAlpha = Math.max(0, st.life);
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 6;
      star(ctx, st.lx, st.ly, st.size, st.size * 0.45, 5);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const w of this.words) {
      ctx.globalAlpha = Math.max(0, w.life);
      ctx.font = `bold ${w.size}px "STKaiti","KaiTi","楷体",serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = w.color;
      ctx.strokeText(w.text, w.lx, w.ly);
      ctx.fillStyle = '#fff';
      ctx.fillText(w.text, w.lx, w.ly);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** 画一块金边纸片（米黄纸面 + 竖纸纹）。坐标相对当前 translate 原点。 */
  _drawPaperRect(ctx, x, y, w, h, r) {
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.stroke();
    // 纸纹竖线
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(226,58,58,0.15)';
    ctx.lineWidth = 1;
    for (let i = x + 12; i < x + w; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, y + 4);
      ctx.lineTo(i, y + h - 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 一条腿（side=-1 左 / 1 右），kick 为跳脚的水平位移。 */
  _drawLeg(ctx, legs, side, kick, react) {
    const legW = 14;
    const gap = 4;
    const x = side < 0 ? -legW - gap : gap;
    ctx.save();
    // 打腿时整条腿轻微上抬 + 外甩
    ctx.translate(kick, -react * 6);
    this._drawPaperRect(ctx, x, legs.y, legW, legs.h, 6);
    // 纸鞋（红）
    ctx.fillStyle = RED;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x - 3, legs.y + legs.h - 6, legW + 8, 10, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** 一条手臂（side=-1 左 / 1 右）。嚣张阶段叉腰；打肚子 react→内收捂肚。 */
  _drawArm(ctx, belly, side, react) {
    const armW = 11;
    const armH = 36;
    // 基础：叉腰（手肘外张）。捂肚时内收。
    const baseX = side < 0 ? belly.x - armW + 2 : belly.x + belly.w - 2;
    const inset = react * 14 * -side; // 向中心收
    ctx.save();
    ctx.translate(baseX + inset, belly.y + 6);
    this._drawPaperRect(ctx, 0, 0, armW, armH, 5);
    ctx.restore();
  }

  _drawFace(ctx, head, reactHead, reactBelly) {
    const hcx = head.x + head.w / 2;
    const hcy = head.y + head.h / 2;
    ctx.save();
    ctx.translate(hcx, hcy);
    const eyeY = -4;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;

    // 打头反应：转圈眼 + 冒金星（视觉在粒子里），表情叠加
    if (reactHead > 0.15) {
      ctx.lineWidth = 2.5;
      // 转圈眼（@ 形螺旋）
      spiralEye(ctx, -9, eyeY, 6);
      spiralEye(ctx, 9, eyeY, 6);
      // 龇牙咧嘴（挨打）
      ctx.beginPath(); ctx.arc(0, eyeY + 16, 7, 0, Math.PI, false); ctx.stroke();
      ctx.restore();
      return;
    }
    // 打肚子反应：『呃』痛苦表情（紧闭眼 + 张嘴）
    if (reactBelly > 0.15) {
      ctx.beginPath(); ctx.moveTo(-14, eyeY); ctx.lineTo(-4, eyeY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(14, eyeY); ctx.lineTo(4, eyeY); ctx.stroke();
      // 张大的『呃』嘴
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.ellipse(0, eyeY + 15, 6, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    // 无部位反应 → 阶段表情
    if (this.stage === STAGE.SWAGGER) {
      // 叉腰咧嘴挑衅：斜挑眉 + 坏笑
      ctx.beginPath(); ctx.moveTo(-15, eyeY - 7); ctx.lineTo(-4, eyeY - 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15, eyeY - 7); ctx.lineTo(4, eyeY - 2); ctx.stroke();
      dot(ctx, -9, eyeY, 2.6); dot(ctx, 9, eyeY, 2.6);
      ctx.beginPath(); ctx.arc(0, eyeY + 12, 9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.ellipse(3, eyeY + 17, 3.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    } else if (this.stage === STAGE.DAZED) {
      // 懵逼：圈圈眼 + 问号
      circle(ctx, -9, eyeY, 5); circle(ctx, 9, eyeY, 5);
      ctx.beginPath(); ctx.arc(0, eyeY + 13, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = PURPLE;
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('?', 13, eyeY - 10);
    } else if (this.stage === STAGE.SMOKING) {
      // 冒烟：X 眼 + 歪嘴 + 纸裂纹
      cross(ctx, -9, eyeY, 5); cross(ctx, 9, eyeY, 5);
      ctx.beginPath(); ctx.moveTo(-8, eyeY + 14); ctx.lineTo(8, eyeY + 10); ctx.stroke();
      ctx.strokeStyle = 'rgba(162,75,255,0.6)';
      ctx.beginPath(); ctx.moveTo(-3, eyeY + 20); ctx.lineTo(1, eyeY + 27); ctx.lineTo(-1, eyeY + 32); ctx.stroke();
    }
    ctx.restore();
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
// 转圈眼（晕眩螺旋）
function spiralEye(ctx, x, y, r) {
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 4; a += 0.3) {
    const rr = (a / (Math.PI * 4)) * r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
}
// 五角星（冒金星）
function star(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
