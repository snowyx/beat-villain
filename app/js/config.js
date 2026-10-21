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
  TARGET_HITS: 8,

  // mp3 静态清单（design §8）：本次不预生成，三者皆 false → 运行时走 Web Speech。
  // scripts/generate-audio.mjs 生成 mp3 后，手动把对应项置 true 即走 mp3 分支。
  AUDIO_MANIFEST: { 'zh-CN': false, 'zh-HK': false, 'en-US': false },
};
