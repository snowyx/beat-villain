// 前端运行时配置（design §13）。
// WS_URL 单一事实源，优先级：localStorage 覆盖 > 按当前访问主机名自动推导 > 线上占位。
//   - 本地开发：浏览器开 localhost → 连 ws://localhost:8080
//   - 内网共享：同事用你的内网 IP 打开（如 http://10.253.38.145:5173）→
//     自动连 ws://10.253.38.145:8080（后端端口固定 8080），无需任何手动配置。
//   - 公网 https 部署：页面走 https 时自动用 wss://<同主机>:8080；
//     若后端在别处，用 localStorage.setItem('WS_URL','wss://room.example.com') 覆盖。

const ROOM_PORT = 8080; // 后端房间服务端口（与 server 默认一致）

function deriveWsUrl() {
  if (typeof location === 'undefined') return `ws://localhost:${ROOM_PORT}`;
  const host = location.hostname || 'localhost';
  // 页面用 https 时 WebSocket 必须用 wss（避免混合内容被浏览器拦截）。
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${host}:${ROOM_PORT}`;
}

export const CONFIG = {
  WS_URL:
    (typeof localStorage !== 'undefined' && localStorage.getItem('WS_URL')) ||
    deriveWsUrl(),

  // 落鞋目标（与后端 TARGET_HITS 一致）。
  TARGET_HITS: 18,

  // mp3 静态清单（design §8）：对应项为 true 时优先播 assets/audio/spell-<lang>.mp3，否则走 Web Speech。
  //   - zh-CN 普通话：无 mp3，走浏览器 Web Speech（系统普通话嗓音质量尚可）
  //   - zh-HK 粤语：用预置 mp3（spell-zh-HK.mp3），补上浏览器缺粤语嗓音的短板
  //   - en-US 英语：用 ElevenLabs 预生成 mp3（spell-en-US.mp3，Harry 战士腔）
  AUDIO_MANIFEST: { 'zh-CN': false, 'zh-HK': true, 'en-US': true },
};
