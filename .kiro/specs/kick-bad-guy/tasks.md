# 实现任务清单 · 赛博打小人（Cyber Beat the Villain）

> 参赛作品：InfoQ × 亚马逊云科技「Kiro 鬼点子计划」
> 本文档为 Kiro Spec 驱动开发的第三份产出物（tasks），承接已批准的 `requirements.md` 与 `design.md`（design-review 裁决 APPROVED），作为参赛材料之一。
> 权威依据：`00-思路与决策.md`（全按推荐、配音 B 方案）、`requirements.md`、`design.md`。
>
> 约定：每项为可独立验证的小步，按依赖排序，完成后代码库仍可构建/运行。文件路径均相对 `1-kickbadguy/`。
> 环境：Node ≥ 18（本机 v26，支持 `ws`、原生 `fetch`、`node:test`）。前端纯静态、零构建。
> 锁定决策（不可更改）：H5 竖屏单页 / WebSocket 双角色实时房 / 配音 B 方案（Web Speech + mp3 回退，ElevenLabs 脚本不跑、key 不入库）/ `ws` 单文件内存房间 / 港式霓虹纸扎风。

---

## A. 仓库骨架与 Kiro Steering / 合规·视觉规范

- [ ] 1. 建立仓库骨架与密钥卫生文件。
      创建目录 `app/`（含 `css/`、`js/`、`js/screens/`、`vendor/`）、`server/`、`scripts/`、`assets/audio/`；创建 `assets/audio/.gitkeep`、`.env.example`（仅一行 `ELEVENLABS_API_KEY=`，无值）、`.gitignore`（忽略 `.env`、`node_modules/`、`assets/audio/*.mp3`、`.DS_Store`）。
      Files: `app/`、`server/`、`scripts/`、`assets/audio/.gitkeep`、`.env.example`、`.gitignore`
      Verify: `ls -R app server scripts assets` 显示目录齐全；`cat .gitignore` 含上述四项；`.env.example` 不含任何 key 值。

- [ ] 2. 编写 Kiro Steering 合规红线文件 `.kiro/steering/民俗合规.md`。
      内容覆盖 design §10 与 requirements 11/12/13：花名真实姓名拦截规则（2–4 纯汉字且首字命中常见姓氏表、姓+称谓；整活花名放行；一键随机花名逃生口）、无血腥（仅卡通纸片人 + 祥云消散、朱砂红不用于「血」）、民俗定位标注与页脚声明、音频不含真实个人信息。写明「本 steering 供每轮实现自动遵守」。
      Files: `.kiro/steering/民俗合规.md`
      Verify: 文件存在且含「花名拦截 / 无血腥 / 民俗定位 / 页脚声明」四节；与 requirements 11/12/13 条款可对应。

- [ ] 3. 编写 Kiro Steering 视觉风格文件 `.kiro/steering/视觉风格.md`。
      内容覆盖 design §9：配色变量（`--zhu-sha-red:#E23A3A`、`--liu-jin-gold:#F4C430`、`--neon-purple:#A24BFF`、`--ink:#140A1F`）、霓虹辉光做法、港式招牌楷体栈、375px 竖屏小程序骨相布局、纸扎/香烛 Emoji + canvas 元素、响应式与横屏提示。写明「供每轮实现自动遵守」。
      Files: `.kiro/steering/视觉风格.md`
      Verify: 文件存在且含配色十六进制值与 375px 骨相约定；与 design §9 一致。

## B. 后端 WebSocket 房间服务（`server/`）

- [ ] 4. 创建 `server/package.json`。
      `type: "module"`、`dependencies.ws`（固定版本，如 `"8.18.0"`）、脚本 `"start": "node room-server.js"` 与 `"test": "node --test"`；Node engines `>=18`。
      Files: `server/package.json`
      Verify: `cd server && npm install` 成功装到 `ws`；`cat package.json` 脚本与依赖正确。

- [ ] 5. 实现房间服务核心状态机与协议 `server/room-server.js`（单文件）。
      依 design §4/§5：裸 `new WebSocketServer({ host:'0.0.0.0', port: Number(process.env.PORT)||8080 })`；`rooms: Map`、`socketMeta: WeakMap`；实现 `genRoomCode`（6 位、排除 0/O/1/I/L、查重）、`makeSnapshot(room, selfClientId)`（含逐连接 `isSelf`、`clientId`，不外泄 ws 句柄）、`broadcast`/`broadcastSnapshot`/`singleSend`、`applyHit`（封顶 88、幂等、非 beating 忽略）、`recomputeStage`（阈值 0–21/22–43/44–87/88）、`enterBurning`（广播 `burn`→`drawFortune` 锁定→`phase=fortune`→广播 `fortune`）、`drawFortune`（§7 签文库各列抽一、锁定幂等）、`cleanupRoom`（在线为 0 延时 60s 回收）。消息路由：强制首帧 `hello`→`hello_ok`，之后 `create_room`/`join_room`/`set_lang`/`start_beat`/`hit`/`ping`；错误码 `ROOM_NOT_FOUND`/`ROOM_FULL` 下发 error 帧，`BAD_PAYLOAD`/`PHASE_REJECTED` 静默回快照不断连；房满 = 已认领 clientId 落鞋成员数达 2（重连带旧 clientId 不占新槽）。phase 变更一律随 `room_state` 广播。
      Files: `server/room-server.js`
      Verify: `cd server && npm start` 能监听 8080 不报错（随后 Ctrl-C）；语法 `node --check room-server.js` 通过。

- [ ] 6. 为后端纯函数/状态机写单元测试并运行。
      用 `node:test` + `node:assert`，覆盖 design §15：`genRoomCode` 字符集与唯一性、`applyHit` 封顶与阶段推进、`recomputeStage` 边界（0/21/22/43/44/87/88）、`drawFortune` 锁定幂等、`makeSnapshot` 的 `isSelf` 逐连接正确且不含 ws 句柄、`ROOM_FULL` 判定按已认领 clientId 计且重连不触发房满。为可测性可将纯函数从 `room-server.js` 导出（或抽到同目录被引用的模块）。
      Files: `server/room-server.test.js`（必要时轻量重构 `server/room-server.js` 以导出纯函数）
      Verify: `cd server && npm test` 全部用例通过。

- [ ] 7. 后端集成测试：双客户端全链路。
      用 `ws` 客户端起两个连接走「hello→建房→进房→切咒语→连打到 88→化灰→签文」，断言两端 `room_state`/`burn`/`fortune` 一致、`hits` 以后端为准封顶 88、断线重连后快照对齐。
      Files: `server/room-server.integration.test.js`
      Verify: `cd server && npm test` 含集成用例并通过（或单独 `node --test room-server.integration.test.js`）。

## C. 前端 H5 单页应用（`app/`）

- [ ] 8. 搭建单页容器与运行时配置。
      `app/index.html`（375px 竖屏骨相、同页各流程态容器 altar/invite/spell/beat/ash/fortune、页脚合规声明、引入 `css/theme.css` 与 `js/main.js` 作为 ES Module、引入 `vendor/qrcode.min.js`）；`app/js/config.js`（`WS_URL` 按 design §13：`localStorage` 覆盖 > localhost 默认 `ws://localhost:8080` > 线上占位 `wss://REPLACE_WITH_ROOM_SERVER_HOST`，`TARGET_HITS:88`，`AUDIO_MANIFEST` 三者 false）；vendored `app/vendor/qrcode.min.js`（轻量 UMD 二维码库，离线可用）。
      Files: `app/index.html`、`app/js/config.js`、`app/vendor/qrcode.min.js`
      Verify: 用 `python3 -m http.server` 在 `app/` 根起静态服务，浏览器打开首页无控制台报错、可见港式霓虹首页与页脚声明。

- [ ] 9. 实现港式霓虹纸扎风样式 `app/css/theme.css`。
      依 design §9 与 steering 视觉风格：配色 CSS 变量、霓虹辉光 text/box-shadow、楷体招牌、375px 居中骨相、底部操作条、金边纸纹卡片、辉光呼吸动画（节制）、横屏轻提示。
      Files: `app/css/theme.css`
      Verify: 静态服务下各流程态容器呈现霓虹纸扎风，375px 竖屏布局正确、桌面宽屏居中留白。

- [ ] 10. 实现 WebSocket 客户端、本地状态镜像与路由装配。
      `app/js/ws-client.js`（连接 `CONFIG.WS_URL`、首帧发 `hello` 带 `sessionStorage` 旧 clientId、收发 JSON 帧、断线重连、按 type 分发；`hits` 取 `Math.max` 单调递增防回退）；`app/js/store.js`（结构性状态以 `room_state` 为准、高频 hits/villainStage 以增量帧为准）；`app/js/main.js`（`location.hash` 路由：检测 `#/join?room=` 自动带入房间码；按 `snapshot.phase` 唯一路由切屏；装配各 screen 模块）。
      Files: `app/js/ws-client.js`、`app/js/store.js`、`app/js/main.js`
      Verify: 后端 `npm start` 运行时，前端首页点「开坛」能经 WS 建房并收到 `room_created`（控制台可见房间码），刷新后经 `hello` 重连对齐。

- [ ] 11. 实现合规拦截与音频回退模块。
      `app/js/compliance.js`（design §10 花名拦截：trim 长度 1–12、2–4 纯汉字且首字命中内置约 100 常见姓氏/复姓表、姓+称谓结尾判疑似真名，整活花名放行；随机花名生成；纯函数便于单测）；`app/js/audio.js`（三级回退：mp3 优先→Web Speech(`zh-CN`/`zh-HK`/`en-US`)→文字兜底；`zh-HK` 走 Web Speech 时同屏显示粤语原文；用户手势解锁音频；打击音效用 WebAudio 合成「啪」声）。
      Files: `app/js/compliance.js`、`app/js/audio.js`
      Verify: 为 `compliance.js` 写一组真名/花名样例的 `node:test` 纯函数单测并通过（`node --test app/js/compliance.test.js`，需用 ESM 可直接导入的纯函数）；页面点「念咒」在无 mp3 环境触发 Web Speech 或文字兜底、不阻断流程。

- [ ] 12. 实现 canvas 小人（弹跳物理 + 四阶段表情）。
      `app/js/villain.js`：canvas 2D 纸片人四阶段（嚣张/懵逼/冒烟/化灰，阈值同后端）；每收到一条 `hit` 广播播一次阻尼正弦弹跳（单实例 tween，重入重置相位 retrigger）、拖鞋印粒子（数量上限）；化灰为金/紫祥云粒子上飘淡出 + 赛博纸钱，无任何血腥元素。
      Files: `app/js/villain.js`
      Verify: 开打界面点击/滑动小人区域可见弹跳 + 表情随 hits 推进；打满 88 呈现祥云化灰（无红色液体/伤口）。

- [ ] 13. 实现六个流程态屏幕模块。
      `app/js/screens/altar.js`（开坛表单：花名输入接 compliance 拦截、6 罪状多选、一键随机花名、校验禁用提交→发 `create_room`）、`invite.js`（房间码 + 复制邀请链接 + qrcode 生成二维码；神婆带 `#/join?room=` 进房确认→`join_room`，`ROOM_NOT_FOUND`/`ROOM_FULL` 提示）、`spell.js`（三语选择→`set_lang` 全房同步、念咒调 audio、`start_beat`）、`beat.js`（挂 villain canvas、显示 hits/剩余、落鞋发 `hit` 并以广播渲染、本地即时手感）、`ash.js`（收 `burn` 播化灰+纸钱+「晦气退散」全屏飘字）、`fortune.js`（收 `fortune` 显「宜/忌/贵人」、调 share-card 生成分享图）。
      Files: `app/js/screens/altar.js`、`app/js/screens/invite.js`、`app/js/screens/spell.js`、`app/js/screens/beat.js`、`app/js/screens/ash.js`、`app/js/screens/fortune.js`
      Verify: 静态服务 + 后端运行，单浏览器可从开坛一路走到签文；控制台无未捕获异常。

- [ ] 14. 实现 canvas 分享图生成 `app/js/share-card.js`。
      design §11：离屏 canvas 750×1334 竖版符咒图（夜市底 + 符咒框 + 花名 + 罪状牌 + 「共抽 N 鞋·已化灰」+ 宜/忌/贵人 + 页脚「民俗数字化体验」合规小字）；导出 `toBlob` PNG；保存/分享判定顺序：`navigator.canShare({files})`→`a[download]`→提示长按保存；系统字体栈避免字体未就绪。
      Files: `app/js/share-card.js`
      Verify: 签文界面点「保存/分享」生成非空 PNG（桌面触发下载），图内含花名/罪状/鞋数/签文/合规小字。

## D. ElevenLabs 预生成脚本（`scripts/`）

- [ ] 15. 实现 ElevenLabs 三语咒语预生成脚本 `scripts/generate-audio.mjs`（本次不运行）。
      design §12：仅从 `process.env.ELEVENLABS_API_KEY` 读 key，未设置则 `console.error` 提示并 `exit(1)`、绝不硬编码/写占位 key；内置与 requirements 3.2 一致的三语 `SPELL_TEXT`（注释标注须与 requirements 同步）；对 `zh-CN/zh-HK/en-US` 各调一次 TTS（Node18+ `fetch`，voiceId 从环境变量/顶部常量非密钥配置），写 `assets/audio/spell-<lang>.mp3`；每请求 try/catch、非 2xx 跳过并汇总、401/403 明确提示、不打印完整 key；注释说明生成后把 `config.js` 的 `AUDIO_MANIFEST` 置 true。
      Files: `scripts/generate-audio.mjs`
      Verify: 不设置 env 时 `node scripts/generate-audio.mjs` 打印缺 key 提示并以非零码退出，且不产生任何 mp3、不泄露 key（本次不实际调用 API）。

## E. 资产目录与 README 参赛说明

- [ ] 16. 编写 `assets/audio/README.md` 占位说明。
      说明本目录存放 `spell-zh-CN.mp3`/`spell-zh-HK.mp3`/`spell-en-US.mp3`（命名与 requirements 8.6 一致）；本次缺省为空→运行时 Web Speech 回退；由 `scripts/generate-audio.mjs` 在设置 `ELEVENLABS_API_KEY` 后生成；生成后手动把 `config.js` `AUDIO_MANIFEST` 对应项置 true。
      Files: `assets/audio/README.md`
      Verify: 文件存在、命名与前端清单/脚本输出一致。

- [ ] 17. 编写参赛说明 `1-kickbadguy/README.md`。
      含：一句话卖点；玩法介绍（开坛→请神婆→三语念咒→抄鞋开打→化灰→转运签）；本地运行确切命令两部分——后端 `cd server && npm install && npm start`（监听 8080，`PORT` 可覆盖），前端 `cd app && python3 -m http.server 5173` 后浏览器开 `http://localhost:5173/`（线上改 `config.js` 的 `WS_URL` 或 `localStorage.setItem('WS_URL',…)`）；技术架构（纯静态 H5 + 单文件 ws 内存房间 + Web Speech/mp3 回退 + canvas 分享图）；合规说明（三红线）；以及约 200 字「本项目全程用 Kiro 的 Spec / Steering / Hooks 能力完成」段落并指向 `.kiro/`（specs 三文档 + steering 两文档 + hook）。
      Files: `1-kickbadguy/README.md`
      Verify: `cat README.md` 含一句话卖点、两段本地运行命令、技术架构、合规说明、约 200 字 Kiro 能力段并指向 `.kiro/` 目录。

## F. 运行时集成验证与清理

- [ ] 18. 前端静态服务走通全流程（单端）。
      起 `cd app && python3 -m http.server 5173` 与 `cd server && npm start`，浏览器走完开坛→邀请→念咒（Web Speech/文字兜底）→开打到 88→化灰→签文→生成分享图；确认页脚合规声明与分享图合规小字在位、无血腥元素、无控制台未捕获错误。
      Files: 无（验证步骤）
      Verify: 全流程走通并生成分享图；若发现缺陷回到对应 C 组任务修复后复验。

- [ ] 19. 后端启动 + 双客户端实时同步验证。
      后端运行下，开两个浏览器标签（或一标签作苦主、另一作神婆经邀请链接进房），一方落鞋/切咒语/化灰/出签，另一方实时同步一致；验证 `ROOM_FULL`（第三连接进房被拒）与断线刷新重连后状态对齐。
      Files: 无（验证步骤）
      Verify: 双端 hits/咒语/化灰/签文一致；第三者进房提示房间已满；刷新重连对齐权威态。

- [ ] 20. 清理临时文件并收尾。
      删除验证过程产生的临时文件/日志；确认未生成/未提交任何 mp3 与 `.env`，`.gitignore` 生效；确认 `.kiro/specs/kick-bad-guy/` 三文档齐全、`.kiro/steering/` 两文档齐全。
      Files: 无（清理步骤）
      Verify: `git status` 无意外临时产物；`ls assets/audio` 仅含 `.gitkeep` 与 `README.md`（无 mp3）；specs/steering 文档齐全。
