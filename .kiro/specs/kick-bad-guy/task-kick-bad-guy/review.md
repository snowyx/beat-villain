# 赛博打小人 MVP 整体评审

把一桩粤港澳民俗「打小人」做成了一条完整的两人在线解压仪式：苦主开坛立牌起花名、选罪状，生成房间码/邀请链接/二维码请神婆扫码进房，双方选三语咒语念开打令，抄鞋抽打至 88 鞋，小人祥云化灰、撒赛博纸钱，最后 canvas 出「宜/忌/贵人」转运签并可分享。前端为零构建纯静态 H5 竖屏单页，后端为单文件 `ws` 内存房间服务作单一事实源，配音走 B 方案（Web Speech 回退 + mp3 优先 + ElevenLabs 预生成脚本但本次不跑）。实现与 requirements / design / tasks 及全部锁定决策一致。

Watch for: 无阻断性问题。三条硬性安全门槛全部通过（confirmed）——仓库未跟踪任何 mp3、未跟踪任何 `.env`、代码中无硬编码 API key。

**Verdict**: APPROVED

## High-level view

玩法循环七步在 `app/js/main.js` 完整装配：`screenForState` 以后端快照 `phase` 为唯一路由依据，altar→invite(开坛后)→spell(chanting)→beat(beating)→ash(burning)→fortune 一路贯通，burn/fortune 增量帧经本地 phase 推进衔接化灰动画与签文，符合 design §3/§4.4 对「burn/fortune 为增量帧不随 room_state 下发」的约定。

安全与密钥门槛是本次评审的重点，全部通过。`git ls-files` 确认跟踪文件里没有任何 `.mp3`、没有 `.env`（只有 `.env.example` 与 `assets/audio/{.gitkeep,README.md}`）；`.gitignore` 忽略 `.env`、`node_modules/`、`assets/audio/*.mp3`、`.DS_Store`；全仓 grep 未命中任何形如 `sk_…` 的密钥或内联赋值的 key。`scripts/generate-audio.mjs` 只从 `process.env.ELEVENLABS_API_KEY` 读 key，缺失即 `exit(1)` 不写占位，日志只打印「已读取 key（已隐藏）」，默认 voiceId 是公开预制音色非密钥。

合规三红线落地到位。花名拦截 `compliance.js` 为纯函数：姓氏表（约 100 单姓 + 常见复姓）+ 姓+称谓结尾判疑似真名，整活花名/特征词放行，并配「一键随机花名」逃生口。化灰仅「祥云消散」——`villain.js` 的 burn 只产金/紫粒子上飘 + 🧧 纸钱，无伤口、无红色液体（朱砂红仅用于符咒边与拖鞋印）。民俗定位与页脚声明常驻 `index.html`，canvas 分享图 `share-card.js` 页脚保留「民俗数字化体验 · 娱乐解压，非指向真人」。

三语发声 `audio.js` 为 mp3 优先 → Web Speech(`zh-CN`/`zh-HK`/`en-US`) → 文字兜底三级回退，`zh-HK` 走 Web Speech 时同屏显示粤语原文；三语咒语文案与 requirements 3.2 逐字一致。后端 `room-server.js` 为裸 `WebSocketServer`、`rooms: Map` 内存房间、`ws@8.18.0` 单依赖、房满判定/重连认领/88 封顶幂等与 design 一致，FEAT-002 记录单元 15 + 集成 2 全绿。

<details>
<summary>Issues (0)</summary>

无阻断性问题，亦无需下一轮修复的 finding。

</details>

<details>
<summary>Details</summary>

### 安全门槛：无 mp3 / 无 .env / 无硬编码 key（confirmed）

三项硬门槛逐一抽查，均通过。`git ls-files | grep -iE '\.mp3$|\.env$|assets/audio'` 只返回 `.env.example`、`assets/audio/.gitkeep`、`assets/audio/README.md`；`git status --short` 工作树干净，`assets/audio/` 目录实际只有 `.gitkeep` 与 `README.md`。`.gitignore` 四项齐备（`.env`、`node_modules/`、`assets/audio/*.mp3`、`.DS_Store`），意味着即便本地生成了 mp3 也不会误入库。

全仓 grep `sk_[a-zA-Z0-9]{20,}` 及内联 key 赋值无命中。`scripts/generate-audio.mjs` 的 key 处理符合 requirements 8.4/8.5：唯一来源 `process.env.ELEVENLABS_API_KEY`，未设置时 `console.error` 提示并 `process.exit(1)` 且不写任何占位；日志只打印「已读取 ELEVENLABS_API_KEY（已隐藏）」。`xi-api-key` 是 HTTP 头名不是密钥，`DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'` 是 ElevenLabs 公开预制音色 Rachel 的 voiceId、非敏感信息。

### 玩法循环完整性（confirmed）

`main.js` 的 `screenForState` 把后端 `phase` 映射到六屏，`renderRoute` 以此切屏并在 `room_created`/`room_joined`/`room_state`/`member_change`/`hit`/`villain_state`/`burn`/`fortune` 各事件后重路由。开坛→立牌→念咒→打→化灰→签文→分享图七环均有对应 screen 模块与 handler。

值得记录的协议衔接点：后端 `burn`/`fortune` 是增量帧、不随 `room_state` 下发（见 FEAT-002 协议事实与 design §4.4）。前端据此在 `burn` 帧合并权威 `hits=88`、本地把 `phase` 由 `beating` 推进到 `burning` 让 ash 屏接管化灰动画，再在 `fortune` 帧置 `_fortuneReady`，由 ash 屏动画结束的定时器切到 fortune。这是对「增量帧不携带 phase」这一后端约定的正确前端补偿，不是状态机漏洞。

### 合规三红线（confirmed）

花名拦截 `compliance.js` 为可被 `node:test` 直接导入的纯函数：规则 1「2–4 纯汉字且首字命中姓氏表」（复姓优先）、规则 2「姓 + 称谓结尾」判疑似真名；`PLAYFUL_MARKERS`（本卷/某人/侠/怪…）与非中文/含数字符号一律放行，避免「甩锅侠」「卷王本卷」误伤；`randomFlower()` 作逃生口且必然通过 `checkFlower`。FEAT-003 记录 `compliance.test.js` 8 suites 全绿（真名张三/王小明/李先生/欧阳娜/诸葛明拦、整活花名放行）。

化灰无血腥：`villain.js` 的 `burn()` 只生成金（`#F4C430`）/紫（`#A24BFF`）祥云粒子上飘淡出 + 🧧/金箔矩形纸钱；四阶段脸谱为纸裂/X 眼/冒烟符号，裂纹用紫色描边明示「纸裂非血」。朱砂红仅用于符咒边框与拖鞋印，`_drawBurn` 全程无红色液体、无伤口。

民俗定位与声明：`index.html` 页脚常驻「本应用为民俗文化体验与解压娱乐」与「『打小人』为粤港澳民间习俗（惊蛰日鹅颈桥下最盛）· 本作品为其民俗数字化体验」；`share-card.js` 分享图页脚绘「民俗数字化体验 · 娱乐解压，非指向真人」+「打小人 · 粤港澳民间习俗」，保证传播物带声明。

### 三语发声与咒语文案（confirmed）

`audio.js` 的 `playSpell` 严格三级回退：`AUDIO_MANIFEST[lang]` 为真才走 mp3（本次三者 false → 不走）、否则 Web Speech（`u.lang` 分别置 `zh-CN`/`zh-HK`/`en-US`）、再否则文字兜底且不阻断流程。`zh-HK` 走 Web Speech 时通过 `onText` 同屏显示粤语原文（design 评审发现 8 的处置）。`SPELL_TEXT` 三语文案与 requirements 3.2、与 `scripts/generate-audio.mjs` 内常量逐字一致。打击音效用 WebAudio 合成「啪」，免额外资产。

### 后端：单文件 ws + 内存房间（confirmed）

`server/room-server.js` 为裸 `WebSocketServer`（无 HTTP/路径路由），`rooms: Map` 为单一事实源，`socketMeta: WeakMap` 存连接元数据，监听 `0.0.0.0:PORT`（默认 8080）。`package.json` `type: module`、单依赖 `ws@8.18.0` 固定版本、`start: node room-server.js`、`engines.node>=18`——与锁定决策完全吻合。首帧契约 `hello→hello_ok{clientId}`、落鞋后端权威累加封顶 88 幂等、房满=已认领 clientId 成员数达 2、重连带旧 clientId 认领原槽不占新槽、60s 延时回收等均在 design 对齐。FEAT-002 记录 `npm test` 15 单元 + 2 集成全绿（双客户端 hello→建房→进房→切咒语→打到 88→化灰→签文一致、重连对齐、第三连接 ROOM_FULL、不存在房间 ROOM_NOT_FOUND）。按「不重复验证」约定，采信该证据，未重跑。

### ElevenLabs 脚本（confirmed）

`scripts/generate-audio.mjs` 为可运行但本次不跑的工具：key 仅环境变量、缺失即 `exit(1)`、每语言请求 try/catch、非 2xx 打状态码+响应摘要并跳过、401/403 明确提示检查 key、汇总成功/失败数、有失败非零退出、写文件失败打印路径。生成成功后提示手动把 `config.js` 的 `AUDIO_MANIFEST` 对应项置 `true`，与前端 mp3 分支闭环。

### README 与 Kiro 能力说明（confirmed）

`README.md` 六要素齐全：一句话卖点、玩法六步、两段本地运行确切命令（后端 `cd server && npm install && npm start` 监听 8080/PORT 可覆盖；前端 `cd app && python3 -m http.server 5173` 开 localhost:5173，线上改 `config.js` 的 `WS_URL` 或 `localStorage` 覆盖）、技术架构、合规三红线、以及明确写出「全程用 Kiro 的 Spec / Steering / Hooks 完成」并指向 `.kiro/`（specs 三文档 + steering 两文档 + hook）的能力段。

### 港式霓虹纸扎视觉（confirmed，经文件核对）

配色变量在 `villain.js`/`share-card.js` 锁定朱砂红 `#E23A3A`、鎏金黄 `#F4C430`、霓虹紫 `#A24BFF`、夜市暗底 `#140A1F`，与 design §9/steering 一致；分享图用楷体栈 `"STKaiti","KaiTi","BiauKai"`、敕令牌匾、符咒框、霓虹辉光（`shadowBlur`）。`index.html` 为 375px 竖屏骨相 + 横屏轻提示。像素级观感属人工验收范畴，FEAT-003 已记录 Playwright 真浏览器跑通并截图确认，采信。

</details>

<details>
<summary>文件地图</summary>

- `app/index.html` — 单页六流程态容器 + 页脚合规声明 + 横屏提示 + 内联 favicon
- `app/js/main.js` — 入口：hash 路由、phase→屏路由、ws 事件装配、burn/fortune 增量帧衔接
- `app/js/compliance.js` — 花名真名拦截纯函数 + 一键随机花名
- `app/js/audio.js` — 三语三级音频回退 + WebAudio 打击音效，咒语文案锁定
- `app/js/villain.js` — canvas 纸片人四阶段 + 弹跳 + 祥云化灰（无血腥）
- `app/js/share-card.js` — 750×1334 canvas 符咒分享图 + 分享/下载/长按判定 + 合规小字
- `app/js/{config,ws-client,store}.js` + `screens/{altar,invite,spell,beat,ash,fortune}.js` — 配置/客户端/状态镜像/六屏
- `server/room-server.js` — 单文件 ws 内存房间服务（单一事实源）
- `server/package.json` — type:module、ws@8.18.0、start/test 脚本
- `scripts/generate-audio.mjs` — ElevenLabs 预生成脚本（key 仅环境变量、本次不跑）
- `.env.example` / `.gitignore` — 密钥卫生（无值；忽略 .env 与 mp3）
- `README.md` — 参赛说明 + 本地运行命令 + Kiro 能力段
- `.kiro/steering/{民俗合规,视觉风格}.md`、`.kiro/hooks/前端改动跑冒烟测试.kiro.hook` — 常驻规则与自动校验

全量改动见 `git -C /Users/zhangji1641/codebase/kiro-idea/1-kickbadguy log` 与 `git show`。

</details>
