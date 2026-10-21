// 音频三级回退（design §8）：mp3 优先 → Web Speech → 文字兜底。
// 咒语文案与 requirements 3.2 / design §7 一致，不改字。
// 音频须用户手势触发；首个手势解锁 Audio 与 WebAudio。

import { CONFIG } from './config.js';

// 三语咒语（design §7，锁定文案，不改字）
export const SPELL_TEXT = Object.freeze({
  'zh-HK': '打你个小人头，等你有气冇得抖！打你个小人脚，等你日日着错鞋！',
  'zh-CN': '一打小人退散，二打晦气全消，三打贵人上门，打完红包拿来！',
  'en-US': "Smack the villain's head, bad luck be gone! Smack the villain's toe, promotions roll on!",
});

// 音频与前端同托管在 app/ 下（app/assets/audio/），相对 app 根引用，
// 便于部署到任意静态平台（Cloudflare Pages 等）随前端一起带上。
const MP3_PATH = (lang) => `assets/audio/spell-${lang}.mp3`;

// 开打阶段循环 BGM（打小人）：独立 HTMLAudioElement，与 WebAudio SFX 图完全分离，
// 故 BGM 与 playSmack 永不共享节点、互不打断；loop 自循环，离开开打屏时停并清引用。
const BEAT_BGM_PATH = 'assets/audio/beat-bgm.mp3';
let bgmEl = null;

let audioCtx = null;
let unlocked = false;

/** 首个用户手势调用：解锁 WebAudio（与自动播放策略对齐）。 */
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }
  } catch {
    /* 忽略 */
  }
}

/**
 * 进入开打屏时循环播放背景音乐（打小人 BGM）。幂等：已在播则直接返回现有元素，
 * 避免重复挂载导致叠音。volume 默认 0.6（不盖过合成的 playSmack 啪声）。
 * 吞掉 play() 的 autoplay 拒绝（被浏览器自动播放策略拦截不应抛未捕获错误）。
 */
export function startBeatBgm({ volume = 0.6 } = {}) {
  if (bgmEl) return bgmEl;
  try {
    bgmEl = new Audio(BEAT_BGM_PATH);
    bgmEl.loop = true;
    bgmEl.volume = volume;
    bgmEl.play().catch(() => { /* autoplay 被拦截：静默忽略，不抛未捕获错误 */ });
  } catch {
    bgmEl = null;
  }
  return bgmEl;
}

/** 离开开打屏时停止 BGM：暂停 + 归零 + 断源 + 丢引用（无泄漏、无叠音）。 */
export function stopBeatBgm() {
  if (!bgmEl) return;
  try {
    bgmEl.pause();
    bgmEl.currentTime = 0;
    bgmEl.src = '';
  } catch {
    /* 忽略 */
  }
  bgmEl = null;
}

/**
 * 播放咒语。返回本次实际走到的层级：'mp3' | 'speech' | 'text'。
 * onText(text, lang)：当需要同屏显示原文时回调（zh-HK 走 speech 或文字兜底时）。
 */
export function playSpell(lang, { onText } = {}) {
  unlockAudio();
  const text = SPELL_TEXT[lang] || SPELL_TEXT['zh-CN'];

  // 1) mp3（清单声明可用时）
  if (CONFIG.AUDIO_MANIFEST && CONFIG.AUDIO_MANIFEST[lang]) {
    try {
      const a = new Audio(MP3_PATH(lang));
      a.play().catch(() => fallbackSpeech(lang, text, onText));
      return 'mp3';
    } catch {
      /* 落到 speech */
    }
  }

  // 2) Web Speech
  return fallbackSpeech(lang, text, onText);
}

function fallbackSpeech(lang, text, onText) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (synth && typeof window.SpeechSynthesisUtterance === 'function') {
    try {
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = lang; // zh-CN | zh-HK | en-US
      u.rate = 1.0;
      u.pitch = 1.0;
      synth.cancel();
      synth.speak(u);
      // 粤语走 Web Speech 时同屏显示原文（评审发现 8）
      if (lang === 'zh-HK' && typeof onText === 'function') onText(text, lang);
      return 'speech';
    } catch {
      /* 落到文字 */
    }
  }

  // 3) 文字兜底（不阻断流程）
  if (typeof onText === 'function') onText(text, lang);
  return 'text';
}

/** 打击音效：WebAudio 合成一声「啪」（免额外资产）。 */
export function playSmack() {
  if (!audioCtx) unlockAudio();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    // 短促噪声 burst 模拟拍打
    const dur = 0.09;
    const bufferSize = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.pow(1 - i / bufferSize, 3); // 快速衰减包络
      ch[i] = (Math.random() * 2 - 1) * env;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    // 叠一个低频「砰」
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + dur);
    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.35, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(gain).connect(audioCtx.destination);
    osc.connect(oscGain).connect(audioCtx.destination);
    src.start(now);
    osc.start(now);
    osc.stop(now + dur);
  } catch {
    /* 忽略 */
  }
}
