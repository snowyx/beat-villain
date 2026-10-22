// 前端运行时配置（design §13）。
// WS_URL 单一事实源，优先级：localStorage 覆盖 > localhost 默认 > 线上占位。
//   - 本地开发：默认连本机房间服务 ws://localhost:8080
//   - 线上部署：把 REPLACE_WITH_ROOM_SERVER_HOST 改成实际房间服务地址
//     （如 wss://room.example.com），或在浏览器控制台执行
//     localStorage.setItem('WS_URL','wss://room.example.com') 临时覆盖。

const isLocalHost =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

export const CONFIG = {
  WS_URL:
    (typeof localStorage !== 'undefined' && localStorage.getItem('WS_URL')) ||
    (isLocalHost ? 'ws://localhost:8080' : 'wss://REPLACE_WITH_ROOM_SERVER_HOST'),

  // 落鞋目标（与后端 TARGET_HITS 一致）。
  TARGET_HITS: 18,

  // mp3 静态清单（design §8）：对应项为 true 时优先播 assets/audio/spell-<lang>.mp3，否则走 Web Speech。
  //   - zh-CN 普通话：无 mp3，走浏览器 Web Speech（系统普通话嗓音质量尚可）
  //   - zh-HK 粤语：用预置 mp3（spell-zh-HK.mp3），补上浏览器缺粤语嗓音的短板
  //   - en-US 英语：用 ElevenLabs 预生成 mp3（spell-en-US.mp3，Harry 战士腔）
  AUDIO_MANIFEST: { 'zh-CN': false, 'zh-HK': true, 'en-US': true },
};
