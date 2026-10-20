#!/usr/bin/env node
// ElevenLabs 三语咒语预生成脚本（赛博打小人 · 配音 B 方案 / design §12 / requirements 8）
//
// 职责：把三语「开打令」咒语文案批量合成为 mp3，输出到 assets/audio/，
//       供前端「mp3 优先」分支使用。
//
// 安全红线（requirements 8.4 / 8.5）：
//   - API key 仅从环境变量 process.env.ELEVENLABS_API_KEY 读取；
//   - 绝不硬编码、绝不写入占位 key、绝不进入提交；
//   - 日志绝不打印完整 key（仅提示「已读取 key（已隐藏）」）。
//
// 本次交付不运行（requirements 8.3）：脚本作为可运行但默认不执行的工具存在，
// 本次不实际调用 ElevenLabs API、不消费额度、不预生成真实 mp3。
//
// 运行：先 `export ELEVENLABS_API_KEY=...`，再 `node scripts/generate-audio.mjs`。
// Node 要求：Node 18+（使用内置 fetch，无需额外依赖）。

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// —— 三语咒语文案 ——
// 注意：必须与 requirements.md 3.2 的「开打令节选」保持一致，改咒语文案时两处同步。
// 来源：00-思路与决策.md → requirements.md 3.2。
const SPELL_TEXT = {
  'zh-CN': '一打小人退散，二打晦气全消，三打贵人上门，打完红包拿来！',
  'zh-HK': '打你个小人头，等你有气冇得抖！打你个小人脚，等你日日着错鞋！',
  'en-US': "Smack the villain's head, bad luck be gone! Smack the villain's toe, promotions roll on!",
};

// —— 语音音色（voiceId）配置 ——
// voiceId 非密钥，可公开配置：优先取各语言专属环境变量，否则回退到脚本顶部常量。
// 需要换音色时改这里或设对应环境变量即可（如 ELEVENLABS_VOICE_ZH_CN）。
// 默认值为 ElevenLabs 预制公共音色 "Rachel"（仅占位，可按语言替换为更合适的音色）。
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const VOICE_IDS = {
  'zh-CN': process.env.ELEVENLABS_VOICE_ZH_CN || DEFAULT_VOICE_ID,
  'zh-HK': process.env.ELEVENLABS_VOICE_ZH_HK || DEFAULT_VOICE_ID,
  'en-US': process.env.ELEVENLABS_VOICE_EN_US || DEFAULT_VOICE_ID,
};

// ElevenLabs TTS 模型（非密钥，可配置）。multilingual 模型可读中英文。
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

// 输出目录：assets/audio/（相对脚本定位，避免工作目录差异）。
const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = resolve(__dirname, '..', 'assets', 'audio');

function outputPath(lang) {
  // 命名与 requirements 8.6 / 前端 AUDIO_MANIFEST 一致：spell-<lang>.mp3
  return resolve(AUDIO_DIR, `spell-${lang}.mp3`);
}

async function synthesize(apiKey, lang) {
  const text = SPELL_TEXT[lang];
  const voiceId = VOICE_IDS[lang];
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    let bodyPreview = '';
    try {
      bodyPreview = (await res.text()).slice(0, 300);
    } catch {
      bodyPreview = '(无法读取响应体)';
    }
    if (res.status === 401 || res.status === 403) {
      console.error(
        `[${lang}] 认证失败（HTTP ${res.status}）：请检查 ELEVENLABS_API_KEY 是否有效。`
      );
    }
    const err = new Error(`HTTP ${res.status}: ${bodyPreview}`);
    err.status = res.status;
    throw err;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const dest = outputPath(lang);
  await writeFile(dest, buf);
  return dest;
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('缺少 ELEVENLABS_API_KEY。请先 `export ELEVENLABS_API_KEY=...` 再运行。');
    console.error('（本脚本仅从环境变量读 key，绝不读取硬编码/占位 key；未设置时不生成任何 mp3。）');
    process.exit(1);
  }
  // 仅提示已读取，绝不打印完整 key。
  console.log('已读取 ELEVENLABS_API_KEY（已隐藏）。');

  const langs = Object.keys(SPELL_TEXT);
  let ok = 0;
  let fail = 0;

  for (const lang of langs) {
    try {
      console.log(`[${lang}] 合成中…`);
      const dest = await synthesize(apiKey, lang);
      ok += 1;
      console.log(`[${lang}] 已写入 ${dest}`);
    } catch (err) {
      fail += 1;
      if (err && err.code && err.path) {
        // 写文件失败：打印目标路径与错误。
        console.error(`[${lang}] 写文件失败（${err.path}）：${err.message}`);
      } else {
        console.error(`[${lang}] 合成失败，已跳过：${err?.message ?? err}`);
      }
    }
  }

  console.log(`完成：成功 ${ok} / 失败 ${fail}（共 ${langs.length} 条）。`);
  if (ok > 0) {
    console.log(
      '生成成功后，请手动把 app/js/config.js 的 AUDIO_MANIFEST 对应语言置为 true，前端即走 mp3 分支。'
    );
  }
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('脚本异常终止：', err?.message ?? err);
  process.exit(1);
});
