# 三语咒语音频目录（assets/audio/）

本目录存放「开打令」三语咒语的预生成语音文件，供前端「mp3 优先」播放分支使用。

## 文件命名

命名与 `requirements.md` 8.6、前端 `app/js/config.js` 的 `AUDIO_MANIFEST`、脚本输出保持一致：

- `spell-zh-CN.mp3` —— 普通话
- `spell-zh-HK.mp3` —— 粤语
- `spell-en-US.mp3` —— 英语

## 本次交付状态：缺省为空 → 运行时 Web Speech 回退

本次交付**不预生成**任何 mp3（不实际调用 ElevenLabs、不消费额度）。
因此本目录当前仅有 `.gitkeep` 与本说明文件，没有 mp3。

前端据此走配音 B 方案的回退：**mp3 优先 → Web Speech API 朗读 → 文字兜底**。
`AUDIO_MANIFEST` 三者皆为 `false` 时，念咒直接走 Web Speech / 文字兜底，不阻断流程。

> 注：`.gitignore` 忽略 `assets/audio/*.mp3`，生成物不会被提交。

## 如何生成（可选，需要高质量配音时）

1. 设置环境变量（key 绝不写入代码或提交）：
   ```bash
   export ELEVENLABS_API_KEY=你的key
   ```
2. 运行预生成脚本：
   ```bash
   node scripts/generate-audio.mjs
   ```
   脚本会把三语咒语合成为上面三个 mp3 写入本目录。未设置 `ELEVENLABS_API_KEY` 时脚本会报错并退出，不生成任何文件。
3. 生成成功后，手动把 `app/js/config.js` 的 `AUDIO_MANIFEST` 对应语言项置为 `true`，前端即自动走 mp3 分支。
