# 设计评审 · 赛博打小人（design.md v2 复评）

> 评审对象：`.kiro/specs/kick-bad-guy/design.md`
> 对照依据：`.kiro/specs/kick-bad-guy/requirements.md`、`00-思路与决策.md`
> 评审性质：本设计为对首轮评审（`design-review.json`：2 HIGH + 5 MEDIUM + 6 NIT，裁决 CHANGES_REQUESTED）的复评修订版。本轮独立复核，既验证首轮 13 条处置是否真正闭合，也检查是否引入新问题。
> 裁决口径：HIGH/MEDIUM 计数 > 0 即 CHANGES_REQUESTED，否则 APPROVED。

---

## 裁决摘要

**APPROVED**（0 HIGH，0 MEDIUM，3 NIT）。

首轮 2 HIGH + 5 MEDIUM + 6 NIT 共 13 条均在本版逐条落地，且处置内容经独立复核确实闭合（见下「首轮findings闭合复核」）。本轮新发现 3 条均为 NIT，不构成阻断。设计在协议完整性、状态机自洽、音频回退、canvas 分享图、三语语言码、合规红线、配音 B 方案七个重点维度均可落地。

---

## 首轮 findings 闭合复核

| 首轮# | 严重度 | 复核结论 | 依据 |
| --- | --- | --- | --- |
| 1 | HIGH | **已闭合** | §13 改为显式可配 `WS_URL`（localStorage 覆盖 > 本地默认 `ws://localhost:8080` > 线上占位 `wss://REPLACE_…`），明确不做 `location.host`+`/ws` 同源推导；§5 声明裸 `ws` 监听 `0.0.0.0:8080`、`PORT` 可覆盖，并说明线上需支持 WebSocket 的运行环境（非纯 OSS）。前后端口径解耦为两个单一事实源，原「OSS 反代 /ws」的不成立前提被移除。 |
| 2 | HIGH | **已闭合** | §4.3 snapshot.members[] 增 `clientId`+`isSelf`；§4.2 member_change 项结构对齐；§4.5 写死房满=已认领 clientId 落鞋成员数达 2（在线+离线占位）、仅 join_room 路径判定；重连走 hello 带旧 clientId 复用原槽不触发 ROOM_FULL；§5 makeSnapshot/broadcastSnapshot 逐连接填 isSelf 不外泄 ws 句柄。逻辑自洽。 |
| 3 | MEDIUM | **已闭合** | §4.5 与 §3 措辞统一：PHASE_REJECTED 不下发 error 帧、仅回 room_state 自愈（开发期 console.debug）；仅 ROOM_NOT_FOUND/ROOM_FULL 面向用户提示并下发 error。 |
| 4 | MEDIUM | **已闭合** | §4.4 新增规则 7「start_beat → phase=beating → 广播 room_state」；§3 明确 phase 每次变更随 room_state 广播，前端以 snapshot.phase 为唯一路由依据。另一方切屏路径已定义。 |
| 5 | MEDIUM | **已闭合** | §4.4 写死帧渲染优先级：结构态走 room_state、高频 hits/villainStage 走 hit/villain_state 增量帧且取 `Math.max` 单调递增防回退；room_state 仅进房/重连/phase变更/切咒语下发。§4.3「唯一依据」表述据此修订，矛盾消除。 |
| 6 | MEDIUM | **已闭合** | §10 规则 1 收紧为「2–4 纯汉字 **且首字命中内置常见姓氏表**」才判疑似；非姓氏开头整活花名（甩锅侠/阴阳人/卷王）放行；内置约 100 常见姓（含常见复姓）数组；UI 常驻「一键随机花名」逃生口。误伤风险解除。 |
| 7 | MEDIUM | **已闭合** | §4.1 首帧契约 + §5 生命周期写死：连接后必须先发 hello，收 hello_ok{clientId} 后方可发业务消息；create_room/join_room 允许条件改为「hello 之后、本连接尚无房间归属」，join_room 仅首次进房、重连靠 hello 带旧 clientId。 |
| 8 | NIT | **已闭合** | §8 补：lang==='zh-HK' 走 Web Speech 回退时同屏显示粤语咒语原文。 |
| 9 | NIT | **已闭合** | §4.4 注明 villain_state 唯一用途为跨阶段一次性特效/音效触发，非常规渲染源。 |
| 10 | NIT | **已闭合** | §6 注明弹跳动画单实例，重入重置相位（retrigger）而非叠加；拖鞋印粒子有数量上限。 |
| 11 | NIT | **已闭合** | §4.5 与发现 3 一并统一，生产前端对 BAD_PAYLOAD/PHASE_REJECTED 静默。 |
| 12 | NIT | **已闭合** | §14/§5 点明刷新→旧连接 close 进 60s 回收窗口→新连接 hello 带 sessionStorage.clientId 窗口内认领的对齐关系。 |
| 13 | NIT | **已闭合** | §11 写死分享/保存判定顺序：navigator.canShare({files}) → navigator.share({files}) → a[download] → 长按提示。 |

首轮 13 条全部真实闭合，无「名义修复、实质仍悬」的情况。

---

## 本轮新发现（findings）

### NIT-1：§4.1 首帧契约中「回 `BAD_PAYLOAD` 并忽略」的措辞与 §4.5「BAD_PAYLOAD 不下发 error 帧」存在字面张力

**位置**：§4.1 首帧契约段「在 `hello_ok` 之前到达的任何业务消息一律**回** `BAD_PAYLOAD` 并忽略」 vs §4.5 BAD_PAYLOAD 行「**不下发面向用户的提示**；后端仅 `console.debug`，前端忽略」。

**问题**：§4.1 用「回 `BAD_PAYLOAD`」，字面可读作「向客户端回发一帧 `error{code:BAD_PAYLOAD}`」；而 §4.5 明确 BAD_PAYLOAD 不下发 error 帧、仅服务端 console.debug。两处若按字面执行会矛盾（是否发帧）。这是 §4.5 narrative 已统一后，§4.1 的旧措辞未同步收口。实现者可能据 §4.1 发帧。

**具体修复**：把 §4.1 的「一律回 `BAD_PAYLOAD` 并忽略」改为「一律按 `BAD_PAYLOAD` 归类并忽略（不下发 `error` 帧，仅 `console.debug`，与 §4.5 一致）」。纯措辞对齐，不改逻辑。

---

### NIT-2：`room_state` 信封字段与 §4 统一信封存在层级歧义（`data.snapshot` vs `data`=snapshot）

**位置**：§4 统一信封 `{ "type", "data": {…}, "ts" }` vs §4.2 `room_state | { snapshot }` 与 §4.3 示例（直接给出 snapshot 对象，未包一层 `data`）。

**问题**：统一信封规定所有帧字段放在 `data` 下，则 room_state 的完整帧应为 `{ "type":"room_state", "data": { "snapshot": {…} } }`；而 §4.2 的 data 列写「`{ snapshot }`」说明确实是 `data.snapshot`。但 §4.3 的 JSON 示例直接是 snapshot 裸对象，未标明它对应 `data.snapshot` 还是 `data` 本身。room_created/room_joined 的 data 列为 `{ roomCode, role, snapshot }`（snapshot 是 data 的一个键），而 hit/burn/fortune 的 data 则是扁平字段。实现者需要明确：snapshot 永远是 `data.snapshot` 一个键，还是某些帧里 data 直接等于 snapshot。

**具体修复**：在 §4.3 开头加一句「snapshot 始终作为所在帧 `data.snapshot` 的值（即 `room_state` 帧为 `data:{snapshot:{…}}`，`room_created`/`room_joined` 为 `data:{roomCode,role,snapshot:{…}}`）」。消除裸对象示例的层级歧义。

---

### NIT-3：`burning→fortune` 的 phase 切换帧数与「phase 变更一律随 room_state 广播」规则的交互未写死

**位置**：§3 burning 段「后端随 burn 一并抽签并把 phase 置为 fortune」+ §4.2 `burn`/`fortune` 为纯增量帧（走普通 broadcast，不含 snapshot）+ §3「phase 每次变更随 room_state 广播，前端以 snapshot.phase 为唯一路由依据」。

**问题**：§3 规定 phase 每次变更都随 room_state 广播、前端以 snapshot.phase 为唯一路由依据；但 §4.4/§4.2 说 burn、fortune 是纯增量帧（不带 snapshot）。那么 `→burning` 与 `→fortune` 两次 phase 变更究竟是否各跟一帧 room_state？若严格按「phase 变更一律随 room_state 广播」，burn/fortune 之外还应各有一帧 room_state；若 burn/fortune 帧本身即作为切屏信号，则与「snapshot.phase 为唯一路由依据」冲突。前端据哪个信号从 beating 切到化灰屏/签文屏，存在两种合理实现。

**具体修复**：在 §4.4 规则 3 补一句写死口径，二选一并明确：
- 方案 A（推荐，省往返）：`burn`、`fortune` 帧本身即承载 `phase` 字段（`burn{hits:88, phase:"burning"}`、`fortune{yi,ji,guiren, phase:"fortune"}`），前端对这两帧例外地也接受其 phase 做路由；或
- 方案 B：`→burning`、`→fortune` 各随一帧 `room_state`（burn/fortune 仅作特效/签文数据载体）。
明确选定其一，避免实现者各自理解。

---

## 已验证的假设（Verified Assumptions）

1. **三语咒语文案三处逐字一致**：`grep` 比对 `00-思路与决策.md`、`requirements.md`、`design.md` 三处咒语，zh-HK/zh-CN/en-US 三条逐字节一致，无漂移。§7 明确「引用需求 3.2，不改字」。
2. **BCP-47 语言码合法且自洽**：zh-CN（普通话）、zh-HK（香港地区中文，用于粤语区内容的标准标签）、en-US 均为合法 IETF 语言标签，与 `SpeechSynthesisUtterance.lang`、`spell-<lang>.mp3` 命名、`AUDIO_MANIFEST` 键一致。设计正确承认浏览器多无内置粤语嗓音、将回退到可用中文嗓音属可接受降级（§8），未夸大。
3. **配音 B 方案严格落地**：运行路径（§8）只走 mp3 优先→Web Speech→文字兜底，运行时不调用 ElevenLabs；预生成脚本（§12）本次不运行、key 仅来自 `process.env.ELEVENLABS_API_KEY`、未设置即 `console.error`+`process.exit(1)` 且绝不写占位 key；`.gitignore` 忽略 `.env` 与 `assets/audio/*.mp3`，`.env.example` 仅含变量名无值。符合需求 8 全部验收项与 NFR 密钥红线。
4. **WebSocket 协议完整可实现**：C2S（hello/create_room/join_room/set_lang/start_beat/hit/ping）与 S2C（hello_ok/room_created/room_joined/room_state/hit/villain_state/burn/fortune/member_change/error）消息类型、data 字段、允许 phase、广播 vs 单播规则、房间内存状态形状（Room/members Map）均已定义。后端为单一事实源、不接受客户端上报计数、applyHit 封顶 88、Node 单线程串行化并发 hit——满足需求 4.6/7。
5. **房间状态机自洽**：altar→chanting→beating→burning→fortune 单向推进，非法转移静默忽略回 room_state 自愈，phase 变更随 room_state 广播、前端以 snapshot.phase 路由。无死锁/无歧义回退（chanting 不回 altar 有明确理由）。
6. **音频 mp3→Web Speech→文字三级回退明确**：§8 伪码给出判定次序；mp3 存在性用静态 `AUDIO_MANIFEST` 清单（本次三者皆 false）而非运行时探测，理由充分（避免 404 噪声、静态托管响应不一致）。
7. **canvas 分享图可落地**：§11 给出 750×1334 离屏 canvas、七层绘制结构、`toBlob` 导出 PNG、分享/保存判定顺序（canShare→share→a[download]→长按）、系统字体栈避免 web font 未就绪。签文用后端锁定值重复绘制保证一致。
8. **`ws` 裸 server 监听形态成立**：`new WebSocketServer({ host:'0.0.0.0', port })` 为 `ws` 库支持的用法（库内部自建 HTTP server，默认接受任意路径升级请求），§5 对「无 HTTP/路径路由、前端连 `wss://host` 无路径也能握手」的描述与库行为一致。
9. **合规三红线均有设计落点**：真名拦截（§10 启发式姓氏表+称谓+随机花名逃生口，需求 11）、化灰无血腥（§10/§5.4 唯祥云消散、朱砂红不用于血，需求 12）、页脚声明+民俗定位+鹅颈桥背景+分享图小字（§10/§11，需求 11.4/13）。音频不含真实个人信息（Web Speech 只读固定咒语不读花名）。
10. **终态与幂等正确**：fortune 后端只抽一次并锁定、重连返回同值（需求 6.2）；burning 后忽略 hit、封顶 88 幂等（需求 4.6/5.5）。
11. **无实现代码为预期状态**：app/server/scripts/assets 目前均无代码，属 design 阶段完成、tasks/实现尚未开始的必然状态，不作为缺陷。

---

## 未验证 / 存在残余风险的假设（Unverified / Residual-Risk Assumptions）

1. **【未验证·已设计层缓解】** `navigator.canShare({files})` / `navigator.share({files})` 在目标浏览器矩阵（尤其 iOS Safari、Android 各 WebView）对「文件分享」的实际可用性无法在本评审环境实测。设计已通过 §11 的三级判定顺序（canShare→share→a[download]→长按提示）把不可用情形兜底到「长按图片保存」，风险落到可控。实现后需真机验证 iOS/Android 至少一条路径可用。
2. **【未验证·已设计层缓解】** 浏览器 zh-HK 粤语嗓音存在性因浏览器而异（多数无内置粤语嗓音，回退行为各异）。设计已承认此降级并在 §8 加「zh-HK 走 Web Speech 时同屏显示粤语原文」补偿观感，不阻断流程。属可接受 MVP 局限。
3. **【未验证·环境依赖】** 线上 WebSocket 可达性依赖「把房间服务部署到支持 ws 升级的运行环境（容器/VM/支持升级的反代），前端 `CONFIG.WS_URL` 直连其公网地址」。设计已正确排除纯 OSS 反代的不成立前提（首轮 HIGH-1 的修复），但实际部署目标环境是否具备（HTTPS 下须 wss、证书、公网可达）需实现/部署阶段确认，非设计缺陷。
4. **【已知 MVP 局限·设计已声明】** 刷新/重连认领依赖 `sessionStorage.clientId` 且与 60s `cleanupRoom` 窗口对齐；关闭标签页或超窗口后重进可能触发 ROOM_FULL。设计 §14 已显式标注为已知局限、P1 可用持久 clientId 优化，不阻断 MVP。

---

## 结论

设计已针对首轮全部 13 条 findings 完成实质性闭合，重点维度（协议完整性、状态机自洽、音频三级回退、canvas 分享图、三语 BCP-47 码、合规三红线、配音 B 方案）均经核验可落地。本轮 3 条新发现全部为 NIT（措辞/信封层级/phase 切换帧数的实现期口径澄清），不构成阻断。

**裁决：APPROVED。** 建议在进入 tasks/实现前顺手采纳 NIT-1/2/3 的措辞澄清，以免实现者在首帧错误处理、信封层级、化灰切屏信号三处各自理解。
