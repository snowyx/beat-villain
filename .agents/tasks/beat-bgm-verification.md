# 开打阶段 BGM + 同步滚动字幕 — 验证记录（第 1 轮）

纯前端改动。改动文件：`app/js/audio.js`、`app/js/screens/beat.js`、`app/css/theme.css`（加上已由资产准备步骤预置的 `app/assets/audio/beat-bgm.mp3`）。无后端/协议/状态机改动。

## 自动化测试

- 后端 `cd server && npm test` → **15 pass / 0 fail**（15/15 全绿，未破坏 iter3）。
- 前端合规 `node --test app/js/compliance.test.js` → **8 pass / 0 fail**（8/8，花名拦截逻辑未动）。
- 语法门 `node --check app/js/audio.js`、`node --check app/js/screens/beat.js` → 均 0。
- CSS 调色板门：新增规则仅引用 `var(--liu-jin-gold|--zhu-sha-red|--neon-purple|--ink)` 四个锁定变量，外加既有正文中性色 `#fff` / `rgba(243,230,200,…)`；diff 未引入任何新的具名 hex。

## HTTP 资源检查

`curl -I http://localhost:5173/assets/audio/beat-bgm.mp3`：
```
HTTP/1.0 200 OK
Content-type: audio/mpeg
Content-Length: 312068
```

## 真实浏览器验证（agent-browser，经真实 WS 协议驱动到开打阶段）

驱动路径（单客户端走真实协议）：`create_room` → `set_lang(zh-HK)` → `start_beat` → `hit`×8 → 后端化灰+抽签。
观测结果：`afterCreate=altar` → `afterLang=chanting` → `afterBeat=beating(current=beat)` → `hits=8, phase=fortune(current=fortune)`。

(a) **BGM 启动**：开打屏存在 `audio` 元素，`src=http://localhost:5173/assets/audio/beat-bgm.mp3`，`loop=true`，`volume=0.6`。入屏时因是脚本驱动（非信任手势）`paused=true` —— 这正是 autoplay 被拦截的场景，已被 `.catch(()=>{})` 静默吞掉（控制台 0 错误）。随后真实点击「抄鞋开打！」按钮（信任手势）后再次 `play()`：`paused=false`、`currentTime` 推进(0.37s)、无 error —— 确认手势携带进入时正常循环播放。

(b) **同步滚动字幕**：四行粤语经文逐字正确（打你个小人头…/手…/脚…/身…）。入屏初始高亮第 0 行；间隔 ~3s 两次采样高亮行：
- sample1 idx=0「打你个小人头 等你成世 冇出头」
- sample2 idx=1「打你个小人手 等你成日 做小偷」
两次不同 → 逐行循环高亮生效。字幕区位于 villain 画布之下、开打按钮之上（subTop=437 > stageBottom=399，btnTop=565 > subBottom），不遮挡画布与交互。

(c) **打击/鞋拔子挥击/部位反应**：villain 实例 `onHit/onHitPart/swingAt/hitPartAt` 均在；触发后 `swinging=true`（鞋拔子挥击），部位反应可调用；权威计数经后端广播回显（hit-count 正常递增到 8）。iter3 的神婆开坛法事页、鞋拔子挥击、部位反应均未受影响（`villain.js`/`altar.js` 未改）。

(d) **离开开打屏后 BGM 停止**：进入化灰/签文后，`app._beatBgm=null`、`app._beatSubtitleTimer=null`、页面内 beat-bgm 的 live audio 元素数=0、无任一在播 —— 无泄漏、无叠音。

## 控制台错误状态

全程 **0 个控制台错误**（自装 hook：console.error / window.onerror / unhandledrejection 计数为 0；CDP console 缓冲为空）。被捕获的 autoplay 拒绝未冒泡为控制台错误。

## 合规三红线

1. 花名拦截 `compliance.js` 未触碰；字幕为固定民俗经文，不走 `playSpell`。
2. 无血腥；`--zhu-sha-red` 仅作文字霓虹辉光，绝不作血。
3. 民俗定位 footer 未动（改动限 `#screen-beat` 内）。
