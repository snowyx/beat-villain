# 设计文档 · 赛博打小人（Cyber Beat the Villain）

> 参赛作品：InfoQ × 亚马逊云科技「Kiro 鬼点子计划」
> 本文档为 Kiro Spec 驱动开发的第二份产出物（design），承接 `requirements.md`，作为参赛材料之一。
> 权威依据：`1-kickbadguy/00-思路与决策.md`（已确认「全按推荐方案」，配音采用 B 方案）与 `requirements.md`。

## 1. 概述（Overview）

赛博打小人是一款 **H5 竖屏多人解压仪式应用**：前端为纯静态单页（`app/`），后端为单文件 Node WebSocket 房间服务（`server/`，`ws` 库，内存存房间，无数据库）。苦主开坛立牌、起花名、选罪状，生成房间码/邀请链接/二维码；神婆扫码进房代打；双方选三语咒语念开打令，抄鞋抽打至 18 鞋，小人化灰（祥云消散），最后 canvas 生成赛博符咒转运签。**任一方落鞋经 WebSocket 实时同步给房间内所有人，后端内存状态是单一事实源。**

本设计锁定以下技术栈，一经批准不再更改：

- **前端**：原生 HTML + CSS + 原生 ES Module JavaScript（无前端框架、无构建步骤），`canvas` 用于绘制小人与分享图，`window.speechSynthesis`（Web Speech API）用于语音回退，原生 `WebSocket` 客户端。二维码采用 vendored 的轻量库 `qrcode`（UMD 单文件放入 `app/vendor/qrcode.min.js`，离线可用，不走 npm 运行时依赖）。
- **后端**：Node.js（建议 ≥ 18）+ `ws` 库，单文件 `server/room-server.js`，房间状态存进程内存（`Map`），无数据库、无持久化。
- **预生成脚本**：Node.js，`scripts/generate-audio.mjs`，从环境变量 `ELEVENLABS_API_KEY` 读 key，本次不运行。
- **音频资产**：`assets/audio/` 下的三语咒语 mp3（本次不预生成，运行时以 Web Speech 占位）。

选择「原生、无构建」而非引入 Vite/React：本作品是 2 天内交付的单页玩具，玩法集中在一个 canvas 舞台 + 几个流程态，引入框架和构建链只会增加交付风险与评审理解成本；纯静态文件也让「部署成在线链接」最简单（任意静态托管直接上传）。

## 2. 整体架构（Architecture）

```
┌───────────────────────────────────────────────────────────────────────┐
│                          浏览器（H5 竖屏 375px）                          │
│                                                                         │
│   app/                                                                  │
│   ├── index.html         单页容器（所有流程态同页切换）                    │
│   ├── css/theme.css      港式霓虹纸扎风（朱砂红×鎏金黄×霓虹紫）            │
│   ├── js/                                                               │
│   │   ├── main.js        入口：路由(hash)、读 config、装配各模块           │
│   │   ├── config.js      运行时配置（WS 地址可配）                         │
│   │   ├── ws-client.js   WebSocket 客户端：发送/接收/重连/状态分发          │
│   │   ├── store.js       前端本地镜像（以 room_state 快照为准）            │
│   │   ├── screens/       各流程态 UI（altar/invite/spell/beat/ash/fortune）│
│   │   ├── villain.js     canvas 小人：弹跳物理 + 四阶段表情               │
│   │   ├── audio.js       配音回退策略（mp3 优先 → Web Speech → 文字）      │
│   │   ├── share-card.js  canvas 绘制赛博符咒分享图                        │
│   │   └── compliance.js  花名真实姓名拦截                                 │
│   └── vendor/qrcode.min.js                                              │
│                                                                         │
│   assets/audio/  spell-zh-CN.mp3 / spell-zh-HK.mp3 / spell-en-US.mp3    │
│                  （本次缺省不存在 → 运行时回退 Web Speech）                │
└───────────────┬─────────────────────────────────────────────────────────┘
                │  WebSocket（JSON 文本帧）
                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                 server/room-server.js（单文件 Node + ws）                 │
│                                                                         │
│   rooms: Map<roomCode, Room>      ← 单一事实源，纯内存                     │
│   Room { code, flower, crimes[], lang, hits, villainStage,               │
│          phase, burned, fortune, members: Map<clientId, Member> }        │
│                                                                         │
│   职责：建房/进房、权威累加落鞋、相位推进、化灰判定、抽签、广播、清理        │
└───────────────────────────────────────────────────────────────────────┘

         离线/开发期（不在运行路径内）
┌───────────────────────────────────────────────────────────────────────┐
│ scripts/generate-audio.mjs  读 ELEVENLABS_API_KEY → 写 assets/audio/*.mp3 │
│                              本次不运行；key 仅来自环境变量                 │
└───────────────────────────────────────────────────────────────────────┘
```

数据流向一句话：**所有会改变共享进度的动作（落鞋、切咒语、化灰、抽签、进出房）都只经后端改内存并广播 `room_state`；前端不自行推进共享进度，只渲染后端下发的权威快照。** 纯本地表现（单次弹跳动画、音效播放、分享图绘制）在前端独立完成，不回传后端。

## 3. 房间状态机（Room State Machine）

房间在后端用一个 `phase` 字段表示仪式阶段。状态与允许的转移如下：

```
            create_room                join_room(神婆)
  (无)  ──────────────▶  altar ──────────────────────────┐
  开坛                      │                              │(成员变化不改 phase)
                           │ set_lang 任一次 / 点"开始念咒" │
                           ▼                               ▼
                        chanting  ◀───────────────────────┘
                     (念咒·可反复切换语言并播放开打令)
                           │ 任一成员 start_beat
                           ▼
                        beating
                 (接收 hit，后端 hits++ 直到 18)
                           │ hits >= 8（后端判定）
                           ▼
                        burning  ──(化灰动画时长后，由后端定时或"下一步")──▶
                 (广播 burn 事件)                                            │
                           ▼                                                │
                        fortune  ◀──────────────────────────────────────────┘
                 (后端抽签一次并锁定，广播 fortune；可重复请求分享图，签文不变)
                           │ 任一成员 reset（fortune / burning 阶段均可）
                           ▼
                 altar（待重新立牌：flower='' 空）
                 (reset：保留成员/房间码，hits 归 0、lang 清空、burned=false、
                  fortune=null，并清空 flower=''/crimes=[]，神婆留在坛里看「正在重新立牌」)
                           │ 苦主 relist（提交新 flower + crimes）
                           ▼
                 altar（已立牌：flower 非空）
                 (与首次 create_room 后同态，复用邀请→念咒→开打流程)
```

**重开一坛转移（reset 新语义）**：`fortune` 或 `burning` 阶段任一成员发 `reset` → 后端把共享进度重置为开坛初态并 `phase=altar`，**清空 `flower=''`/`crimes=[]`（旧小人送走，进入「待重新立牌」态）**，但**保留房间成员（不踢人、不换房间码）**。具体重置：`hits=0`、`villainStage=嚣张`、`burned=false`、`fortune=null`、`lang=null`、`phase=altar`、`flower=''`、`crimes=[]`。随后广播 `room_state`：**苦主**据 `flower` 为空回到开坛立牌页（起花名/选罪状/重新开坛），**神婆**留在坛里看「苦主正在重新立牌，稍候…」等待态。非 `fortune`/`burning` 阶段收到 `reset` 按 `PHASE_REJECTED` 惯例静默回一帧 `room_state` 自愈、不下发 `error`（见 §4.5）。

**重新立牌转移（relist）**：`altar` 且 `flower===''`（待重新立牌）态，**苦主**发 `relist{ roomCode, flower, crimes[] }` → 后端校验（仅 `victim`、仅待重新立牌态、`flower` 去空白后非空）通过后写回 `room.flower`/`room.crimes`，**`phase` 维持 `altar`**（花名非空即「已立牌」态，与首次 `create_room` 后一致），广播 `room_state` 让神婆同步看到新小人花名/罪状，随后复用邀请→念咒→开打流程继续。校验不过（非苦主 / 非待立牌态 / `flower` 空）按 `PHASE_REJECTED` 惯例静默回一帧 `room_state` 自愈、不下发 `error`（见 §4.5）。**前端据 `phase=altar` 时 `flower` 空/非空区分开坛立牌页与邀请屏/神婆等待页**。单人（仅苦主）与双人均可重置→重新立牌→跑完下一局，房间码不变、成员保留。

各状态语义与转移规则：

- **altar（开坛/等待神婆）**：房间刚创建或重开后，`hits=0`，`villainStage=嚣张`，`lang` 未定，成员含苦主。等待神婆进房；神婆进/出房只改成员列表，不改 `phase`。允许从此态进入 `chanting`（任一成员选定语言或点「开始念咒」）。此态按 `flower` 分两种子态：`flower` 非空＝「已立牌」（苦主显示邀请屏、神婆显示带小人信息的等待页）；`flower===''`＝「待重新立牌」（reset 后，苦主显示开坛立牌页重打新小人、神婆显示「正在重新立牌」等待页），苦主 `relist` 提交新 `flower`/`crimes` 后回到「已立牌」子态。
- **chanting（念咒）**：已进入念咒界面，可反复切换三语语言、反复播放开打令。`set_lang` 在此态或 `altar` 态均允许，后端把 `lang` 同步全房。任一成员点「开打」→ `beating`。为避免误触回退，`chanting` 不允许回到 `altar`。
- **beating（开打）**：接受 `hit` 事件，后端对 `hits` 累加（权威），据 `hits/18` 推进 `villainStage`。达到 18 自动 → `burning`。此态忽略 `set_lang`（咒语已定）。
- **burning（化灰）**：后端在 `hits` 首次达到 18 的那一刻把 `phase` 置为 `burning`、`burned=true`，广播 `burn` 事件；此后 **忽略一切 `hit`**（计数封顶 18，幂等）。后端在广播 `burn` 后进入 `fortune`：MVP 采用「后端随 `burn` 一并抽签并把 `phase` 置为 `fortune`」，前端自行按动画时长先播化灰、再显签文，避免再引入一次服务端定时器往返。
- **fortune（出签）**：签文在进入该态时由后端抽取并**锁定**（存入 `room.fortune`），广播 `fortune`。重连或重复请求只回同一签文；分享图在前端用该签文重复绘制，签文不变。**已提供 `reset` 重开一坛**：任一成员可从此态发 `reset` 回到 `altar`「待重新立牌」态（清空 `flower`/`crimes`、进度归零、保留成员），苦主随后 `relist` 为全新小人重新立牌，见本节「重开一坛转移」「重新立牌转移」与 §4.1。

非法转移处理：后端对与当前 `phase` 不符的客户端消息一律**静默忽略并回一帧当前权威 `room_state`**（例如 `beating` 阶段收到 `set_lang`，或 `burning/fortune` 阶段收到 `hit`），**不下发 `error` 帧、不中断连接**（归类为 `PHASE_REJECTED`，开发期仅 `console.debug`；与 §4.5 措辞一致）。这保证断线重连、双端时序错位时状态自愈。

**phase 变更一律随 `room_state` 广播（评审发现 4 的处置）**：`phase` 的每一次变更（`altar→chanting`、`chanting→beating`、`→burning`、`→fortune`）都通过向全房广播 `room_state` 下发；**前端以 `snapshot.phase` 为唯一的界面路由依据**，据此切屏（例如任一成员 `start_beat` 使 `phase=beating` 后，广播的 `room_state` 让所有成员自动切到开打界面）。高频的 `hit`/`villain_state` 增量帧（§4.2）不改 `phase`、不用于路由，仅用于计数与表情/特效渲染（见 §4.4）。

## 4. WebSocket 消息协议（Protocol）

传输层为单一 WebSocket 连接，所有帧为 **JSON 文本**。统一信封：

```jsonc
{ "type": "<消息类型>", "data": { /* 该类型字段 */ }, "ts": 1690000000000 }
```

`ts` 为发送方毫秒时间戳（可选，用于调试）。客户端用 `type` 分发。房间码 `roomCode` 为 **6 位大写字母数字**（排除易混的 0/O/1/I/L），在后端生成并保证全局唯一（冲突则重取）。`clientId` 由后端在首次连接时下发，客户端在后续消息中回带，用于断线重连识别同一成员。

### 4.1 客户端 → 服务端（C2S）

| type | data 字段 | 说明 | 允许的 phase |
| --- | --- | --- | --- |
| `hello` | `{ clientId? }` | **连接建立后的强制首帧**；带旧 `clientId` 表示重连认领，不带则后端新建 | 任意（须最先发） |
| `create_room` | `{ flower, crimes[] }` | 苦主开坛。`flower`=花名（已过前端拦截），`crimes`=罪状标签数组 | 已收 `hello_ok`、本连接尚无房间归属 |
| `join_room` | `{ roomCode, role? }` | 神婆**首次**进房。`role` 缺省为 `shaman` | 已收 `hello_ok`、本连接尚无房间归属 |
| `set_lang` | `{ roomCode, lang }` | 选/切咒语语言。`lang ∈ {"zh-CN","zh-HK","en-US"}` | altar / chanting |
| `start_beat` | `{ roomCode }` | 从念咒进入开打 | chanting |
| `hit` | `{ roomCode }` | 落鞋一次（抄鞋）。计数由**后端**累加，不信任客户端传计数 | beating |
| `reset` | `{ roomCode }` | 重开一坛→「待重新立牌」态（保留成员/房间码；清空 `flower=''`/`crimes=[]`、重置 `hits=0`、`phase=altar`、`lang=null`、`fortune=null`、`burned=false`） | fortune / burning |
| `relist` | `{ roomCode, flower, crimes[] }` | 苦主在「待重新立牌」态提交全新小人身份（更新 `flower`/`crimes`，`phase` 维持 `altar`，广播 `room_state` 同步神婆） | altar 且 `flower===''`、仅 `victim` |
| `ping` | `{}` | 保活（可选，见 §4.4） | 任意 |

> 协议刻意**不接受客户端上报的落鞋计数**：`hit` 只是「我打了一下」的信号，权威 `hits` 由后端 `++`。这是满足需求 4.6「后端为权威值，避免并发不一致」的关键设计。

**首帧契约（评审发现 7 的处置）**：每条 WebSocket 连接建立后**必须先发 `hello`**；后端回 `hello_ok{clientId}`（新连接生成新 `clientId`；若 `hello` 带的旧 `clientId` 在某房间内有对应成员则按重连认领该 `clientId`）之后，客户端方可发 `create_room` / `join_room` 等业务消息。在 `hello_ok` 之前到达的任何业务消息一律回 `BAD_PAYLOAD` 并忽略（此时后端还未给该连接分配 `clientId`，`room.members` 无从用稳定 key 存成员）。因此「建房前」不是房间 `phase`（房间尚不存在），`create_room` 的前置条件写为「`hello` 之后、本连接尚无房间归属」而非某个 phase。`join_room` 仅用于**首次**进房；**重连不重发 `join_room`**，而是靠 `hello` 携带旧 `clientId` 认领原成员槽（见下方 ROOM_FULL 与 §14）。

### 4.2 服务端 → 客户端（S2C）

| type | data 字段 | 说明 |
| --- | --- | --- |
| `hello_ok` | `{ clientId }` | 下发/确认客户端身份 |
| `room_created` | `{ roomCode, role:"victim", snapshot }` | 建房成功，苦主角色确定 |
| `room_joined` | `{ roomCode, role:"shaman", snapshot }` | 进房成功，下发完整快照 |
| `room_state` | `{ snapshot }` | 全量房间快照（广播或单播对齐）。见 §4.3 |
| `hit` | `{ hits, villainStage, by }` | 落鞋广播增量：最新权威 `hits`、小人阶段、落鞋者角色 `by` |
| `villain_state` | `{ villainStage, hits }` | 小人阶段变化（阶段跨越阈值时单独广播，便于前端切表情/音效） |
| `burn` | `{ hits:8 }` | 化灰广播：触发祥云消散 + 赛博纸钱 + 「晦气退散」 |
| `fortune` | `{ yi, ji, guiren }` | 签文广播：宜 / 忌 / 贵人，三项锁定值 |
| `member_change` | `{ members:[{clientId,role,online,isSelf}], count }` | 成员进出/在线态变化。`members[]` 项结构与 §4.3 snapshot 一致（含 `clientId`/`isSelf`，`isSelf` 逐连接填充） |
| `error` | `{ code, message }` | 业务错误（见 §4.5），不中断连接 |

### 4.3 房间快照 `snapshot` 结构

`room_state` / `room_created` / `room_joined` 都携带同一结构的快照，作为前端**结构性状态**的渲染依据（高频 `hits`/`villainStage` 走增量帧，见 §4.4 的帧渲染优先级）：

```jsonc
{
  "roomCode": "A7K9QX",
  "phase": "beating",              // altar|chanting|beating|burning|fortune
  "flower": "卷王本卷",
  "crimes": ["抢功劳", "阴阳怪气"],
  "lang": "zh-HK",                 // 未定时为 null
  "hits": 4,                       // 权威落鞋计数，0..18
  "target": 18,
  "villainStage": "懵逼",           // 嚣张|懵逼|冒烟|化灰
  "burned": false,
  "fortune": null,                  // { yi, ji, guiren } 或 null
  "members": [                      // 成员：稳定标识 + 角色 + 在线态 + 是否本人
    { "clientId": "c_ab12", "role": "victim", "online": true,  "isSelf": true  },
    { "clientId": "c_cd34", "role": "shaman", "online": false, "isSelf": false }
  ]
}
```

**成员标识与 `isSelf`（评审发现 2 的处置）**：每个成员项带稳定的 `clientId`（后端在 `hello` 时分配/认领），使前端能在刷新/重连时判断「数组里哪个是我」，并支持未来围观（P1）出现多个同 `role` 成员时仍可区分。`isSelf` 由**后端按收信方逐连接填充**——广播同一快照时，后端为每条连接把其自身 `clientId` 对应项的 `isSelf` 置 `true`、其余置 `false`（即每条连接收到的 `members` 数组内容相同、仅 `isSelf` 标记不同）。前端不再靠 `role` 做隐式主键。`member_change.members[]` 采用与此处完全一致的成员项结构（见 §4.2）。

### 4.4 广播规则

1. **落鞋同步**：任一方发 `hit`，后端对权威 `hits` 累加（封顶 18），然后**向房间内所有在线成员广播** `hit`（含最新 `hits`、`villainStage`、落鞋者 `by`）。若该次落鞋跨越了阶段阈值，追加广播一帧 `villain_state`；若达到 18，追加广播 `burn` 并随后 `fortune`。**发起者也收到广播**，前端以广播到达为准渲染计数，本地点击只先播放「单次弹跳 + 音效」的即时手感，不本地加计数（避免与权威值打架）。
2. **切咒语同步**：`set_lang` → 更新 `room.lang` → 向全房广播 `room_state`，全房共用同一语言。
3. **化灰 / 签文同步**：由后端单点判定与抽取，`burn`、`fortune` 广播给全房，保证所有人看到一致的化灰时刻与同一签文。
4. **进出房同步**：成员进/出/断线 → 广播 `member_change` + `room_state`。
5. **新进房单播对齐**：新成员进房先单播 `room_joined`（含完整快照），再广播 `member_change` 给其余人；重连成员也用 `room_state` 单播对齐到权威态。
6. **保活**：MVP 依赖浏览器/`ws` 默认行为即可；可选在后端用 `ws` 的 `ping/pong`（30s 心跳）检测死连接并清理。此为可选优化，不是功能需求。
7. **开打同步（评审发现 4 的处置）**：任一成员发 `start_beat` → 后端 `phase=beating` → 向全房广播 `room_state`；前端据 `snapshot.phase` 切到开打界面（phase 变更一律随 `room_state` 广播，见 §3）。

**帧渲染优先级 / 字段来源（评审发现 5 的处置，写死以防抖动）**：落鞋高频路径只发 `hit` 增量帧（`{hits, villainStage, by}`），**不**跟发全量 `room_state`；`room_state` 仅在进房 / 重连 / `phase` 变更 / 切咒语时下发。因此前端渲染分两类来源：

- **结构性状态**（`phase` / `lang` / `flower` / `crimes` / `members` / `fortune` / `burned`）以 `room_state` 为准；
- **高频 `hits` 与 `villainStage`** 以 `hit` / `villain_state` 增量帧为准，且对 `hits` 取**单调递增** `local = Math.max(local, msg.hits)` 防止增量帧乱序到达导致计数回退闪烁；`room_state` 到达时同样用 `Math.max` 合并 `hits`，不令其倒退。

这替代了初稿「`room_state` 是唯一渲染依据」的表述（§4.3 据此修订）。

**`villain_state` 用途界定（评审发现 9 的处置）**：`hit` 帧已带 `villainStage` 足够前端切表情；`villain_state` 的**唯一用途是「跨阶段时的一次性特效 / 音效触发」**（如进入「冒烟」时播一次烟雾特效），不作为常规计数/表情渲染源，实现时不对它重复处理计数。

### 4.5 错误码（`error.code`）

| code | 触发条件 | 前端表现 |
| --- | --- | --- |
| `ROOM_NOT_FOUND` | `join_room`/`set_lang`/`hit` 的 `roomCode` 不存在或已回收 | **下发 `error` 帧** → 提示「房间不存在或已散场」，神婆停留进房界面（需求 2.5） |
| `ROOM_FULL` | `join_room` 时该房**已认领 `clientId` 的落鞋成员数（在线+离线占位）已达 2** | **下发 `error` 帧** → 提示「房间已满」，拒绝该角色加入（需求 2.7） |
| `BAD_PAYLOAD` | 消息缺字段 / `lang` 非法 / JSON 解析失败 / `hello_ok` 前发业务消息 | **不下发面向用户的提示**；后端仅 `console.debug`，前端忽略该操作并以 `room_state` 对齐（若已有房间） |
| `PHASE_REJECTED` | 消息与当前 `phase` 不符（含 `reset` 在非 fortune/burning 阶段，如 altar/chanting/beating；含 `relist` 在非「待重新立牌」态或由非苦主发起） | **不下发 `error` 帧**；后端仅回一帧 `room_state` 使前端自愈（开发期 `console.debug`），见 §3 非法转移 |

**错误帧下发规则（评审发现 3、11 的处置，全文统一）**：只有 `ROOM_NOT_FOUND` 与 `ROOM_FULL` 会向客户端下发 `error` 帧并面向用户提示；`PHASE_REJECTED` 与 `BAD_PAYLOAD` 是**内部归类，不下发 `error` 帧**（开发期可在服务端 `console.debug`），只回一帧 `room_state`（若该连接已有房间归属）让前端自愈。所有错误一律**不中断 WebSocket 连接**。

**房满判定口径（评审发现 2 的处置）**：房满 = 该房 `members`（`Map<clientId, …>`）中**已认领 `clientId` 的落鞋成员数达到 2**，不论在线与否（离线成员在 `cleanupRoom` 回收前仍占槽，为重连保留位置）。判定只发生在 `join_room`（首次进房）路径：若已满则回 `ROOM_FULL`。**重连不占新槽**——重连走 `hello` 携带旧 `clientId`，命中则复用原成员槽、把 `online` 置回 `true`、不触发 `ROOM_FULL`；只有带陌生 `clientId` 或不带 `clientId` 的 `join_room` 才可能触发房满。

## 5. 后端详细设计（`server/room-server.js`）

单文件、单进程、内存存储。

**监听形态（评审发现 1 的处置）**：后端为裸 `ws` 服务，用 `new WebSocketServer({ host, port })` 直接监听，**不**引入 HTTP 服务器 / 路径路由。默认监听 `0.0.0.0`、端口 `8080`，端口可用环境变量 `PORT` 覆盖：

```js
const PORT = Number(process.env.PORT) || 8080;
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });
// 房间服务与静态前端分开部署：前端用 config.js 的 WS_URL 直连本服务公网地址，
// 不依赖静态托管域名做 /ws 反代（见 §13）。线上需把本服务置于支持
// WebSocket 的运行环境（容器/VM/支持 ws 升级的反代），非纯 OSS。
```

`ws` 库裸 server 默认接受任意路径的升级请求，故前端即便连到 `wss://host`（无路径）也能握手；本设计不使用 URL 路径做路由。核心数据：

```js
const rooms = new Map();           // roomCode -> Room
const socketMeta = new WeakMap();  // ws -> { clientId, roomCode, role }

// Room 形状
// { code, flower, crimes, lang, hits, target:18, villainStage, phase,
//   burned, fortune, members: Map<clientId, { role, ws, online }> }
```

关键函数：

- `genRoomCode()`：6 位、排除易混字符、与 `rooms` 查重。
- `makeSnapshot(room, selfClientId)`：按 §4.3 产出快照。成员项暴露 `{clientId, role, online, isSelf}`——`isSelf` 由 `selfClientId` 逐连接计算（广播时对每条连接各算一次），**不外泄 `ws` 句柄**；`clientId` 是成员稳定标识，可外泄（它仅用于前端识别「哪个是我」与重连认领，不含真实身份信息）。
- `broadcast(room, msg)`：遍历 `members` 在线 `ws` 发送同一 JSON。**例外**：携带 `snapshot` 的 `room_state`/`member_change` 需逐连接把 `isSelf` 按收信方 `clientId` 填充，因此这类帧用 `broadcastSnapshot(room)`——对每条在线连接各调一次 `makeSnapshot(room, 其 clientId)` 后发送（内容相同、仅 `isSelf` 不同）。纯增量帧（`hit`/`villain_state`/`burn`/`fortune`）用普通 `broadcast` 发同一 JSON。
- `singleSend(ws, msg)`：对单连接发送（含发送前 `readyState === OPEN` 判断）。
- `applyHit(room)`：`if (room.phase !== 'beating') return;` → `room.hits = Math.min(18, room.hits + 1)` → `recomputeStage(room)` → 若达 18 则 `enterBurning(room)`。**幂等封顶**保证重复/竞态 `hit` 不越界。
- `recomputeStage(room)`：按 §6 阈值把 `hits` 映射到四阶段，阶段变化时标记需广播 `villain_state`。
- `enterBurning(room)`：`phase='burning'；burned=true`；广播 `burn`；随后 `room.fortune = drawFortune()`；`phase='fortune'`；广播 `fortune`。
- `drawFortune()`：从预置文案库（§7）各列随机抽一条，组装 `{yi,ji,guiren}`，**写入 `room.fortune` 后锁定**；若已存在则直接返回，保证重连一致。
- `cleanupRoom(room)`：当房间内 `online` 成员为 0，用一个短延时（如 60s）后若仍无人则 `rooms.delete(code)`（需求 7.6；留出窗口支持短暂断线重连）。

连接生命周期（遵守 §4.1 首帧契约）：`connection` → **强制先收 `hello`**（不带 `clientId` 则生成新 `clientId`；带旧 `clientId` 且命中某房成员则按重连认领该槽、`online=true`、不占新槽、不触发 `ROOM_FULL`）→ 回 `hello_ok{clientId}` → 之后才按消息 `type` 路由；`hello_ok` 之前到达的业务消息回 `BAD_PAYLOAD` 忽略 → `close` 时把该成员 `online=false`、广播 `member_change`、触发 `cleanupRoom` 60s 延时。刷新即新连接，靠 `sessionStorage` 里的旧 `clientId` 在 60s 窗口内经 `hello` 认领（§14）。

并发一致性：Node 单线程事件循环，`applyHit` 等状态变更无需锁；「双方同时落鞋」在事件循环中被串行化为两次 `applyHit`，权威 `hits` 自然正确累加，这正是「后端为单一事实源」的落地。

## 6. 小人表情阶段与物理（`villain.js`）

四阶段按 `hits` 占 `target=18` 的比例推进（需求 4.4）：

| 阶段 | 区间（hits） | 视觉 |
| --- | --- | --- |
| 嚣张 | 0 – 5 | 叉腰、咧嘴、微微抖动挑衅 |
| 懵逼 | 6 – 10 | 眼睛变圈、冒问号 |
| 冒烟 | 11 – 17 | 头顶冒烟、身体倾斜、裂纹 |
| 化灰 | 18（终态） | 祥云消散（见 §9 合规） |

阈值取 `Math.floor` 的整数边界：`stage = hits<6?嚣张 : hits<11?懵逼 : hits<18?冒烟 : 化灰`。人形分头/肚子/腿三区，按点击落点本地播差异化被打反应（打头→晃头转圈眼+冒金星、打肚子→弓身捂肚『呃』、打腿→跳脚）与拟声词文字粒子，部位反应本地即时、计数走后端权威（方案 B，hit 帧不携带 part）。小人用 canvas 2D 绘制纸扎卡通人形；每次落鞋触发一次整体弹跳：以阻尼正弦 `y = A·e^(−t/τ)·sin(ωt)` 的缩放/位移做 300–400ms 弹跳回弹，叠加一个抖动与「拖鞋印」粒子。弹跳是纯前端表现，每收到一条 `hit` 广播就播一次，不依赖本地计数。**高频连打下弹跳动画为单实例（评审发现 10 的处置）**：收到新 `hit` 时**重置该单一 tween 的相位（retrigger，`t=0`）而非叠加新 tween**，避免多条广播密集到达时动画堆叠/卡顿；「拖鞋印」粒子可独立短暂叠加（数量有上限）。

## 7. 文案库（罪状 / 咒语 / 签文）

- **罪状标签（固定 6 项，需求 1.2）**：抢功劳、甩锅侠、阴阳怪气、已读不回、画饼大师、卷王本卷。
- **三语咒语（引用需求 3.2，不改字）**：
  - `zh-HK`：打你个小人头，等你有气冇得抖！打你个小人脚，等你日日着错鞋！
  - `zh-CN`：一打小人退散，二打晦气全消，三打贵人上门，打完红包拿来！
  - `en-US`：Smack the villain's head, bad luck be gone! Smack the villain's toe, promotions roll on!
- **签文库（`drawFortune` 从三列各抽一）**，无厘头整活风，MVP 预置如下，可在实现时微调扩充：
  - 宜：摸鱼、早退、已读不回、理直气壮、点奶茶、装死、准点下班
  - 忌：背锅、开会、改需求、内卷、接盘、周末加班、空降任务
  - 贵人：隔壁组老王、楼下保安大叔、食堂阿姨、匿名递拖鞋的你、算法推荐的猫

签文库放在后端常量中（因为抽签在后端），前端仅展示下发值。

## 8. 音频回退方案（`audio.js`）

实现需求 3.4 / 3.5 / 8.1 的三级回退，按语言 `lang` 播报对应咒语：

```
playSpell(lang):
  1) 若 assets/audio/spell-<lang>.mp3 可用（见探测） → new Audio(url).play()
  2) 否则若 window.speechSynthesis 存在 →
        u = new SpeechSynthesisUtterance(SPELL_TEXT[lang])
        u.lang = lang   // "zh-CN" | "zh-HK" | "en-US"
        speechSynthesis.cancel(); speechSynthesis.speak(u)
  3) 否则 → 在界面以文字展示 SPELL_TEXT[lang] + 「当前环境不支持语音朗读」提示；不阻断开打
```

mp3 存在性探测策略：MVP 采用**静态清单**——`config.js` 里维护 `AUDIO_MANIFEST = { 'zh-CN': false, 'zh-HK': false, 'en-US': false }`（本次三者皆 `false`，因不预生成 mp3）。当 `scripts/generate-audio.mjs` 真正生成文件后，手动把对应项置 `true` 即走 mp3 分支。选清单而非运行时 `HEAD`/`fetch` 探测：避免每次念咒产生网络往返与 404 噪声，且静态托管对缺失文件的响应不一致，清单更可控。`en-US` 文案含西文标点，`SpeechSynthesisUtterance` 原样朗读即可；`zh-HK` 粤语音色依赖浏览器是否装有粤语嗓音，缺失时浏览器通常回退到可用中文嗓音，属可接受降级（仍不阻断流程）。**粤语走 Web Speech 分支时的体验补偿（评审发现 8 的处置）**：当 `lang==='zh-HK'` 且走到第 2 级（Web Speech）回退时，**同屏显示粤语咒语原文**；因回退嗓音多会用普通话读粤语字（如「冇」「着」），同屏原文可补偿观感割裂。此为低成本界面补偿，不改变回退层级逻辑。

音频由**用户手势触发**（点「念咒/开打」按钮）以满足浏览器自动播放策略；首个手势同时解锁后续 `new Audio()` 与打击音效。打击音效为前端本地短 mp3/WebAudio 合成音（P0 可用 WebAudio 合成「啪」声，免额外资产）。

## 9. 视觉风格实现要点（`css/theme.css` + canvas）

港式霓虹纸扎风，375px 竖屏小程序骨相（需求 9）：

- **配色变量**（CSS custom properties）：`--zhu-sha-red:#E23A3A`（朱砂红，主色/按钮/符咒边）、`--liu-jin-gold:#F4C430`（鎏金黄，标题/描边/纸钱）、`--neon-purple:#A24BFF`（霓虹紫，发光点缀/辅助）、深色底 `--ink:#140A1F`（夜市暗底）。
- **霓虹感**：关键标题与按钮用多层 `text-shadow`/`box-shadow` 霓虹辉光（内白外彩），紫/金描边；可加极缓的辉光呼吸动画（`@keyframes glow`），注意性能只对少量元素用。
- **港式招牌楷体感**：首选系统楷体栈（如 `"STKaiti","KaiTi","BiauKai", serif`），标题可叠加金色描边与红底牌匾样式模拟灯牌招牌；不内嵌大字体文件以保持纯静态轻量。
- **骨相布局**：根容器固定 `max-width:375px` 居中，`min-height:100dvh`，整体竖排；底部保留 tab 感操作条（当前态主按钮区）；卡片用圆角 + 金边 + 轻微纸纹（CSS 渐变模拟）。
- **纸扎/香烛元素**：用 Emoji + canvas 组合（🧧🕯️🔥 作点缀，小人与纸钱用 canvas 画），避免大量位图资产。
- **响应式**：以 375 为基准用 `clamp()`/`vw` 适配更宽屏（居中留白），竖屏优先；横屏给轻提示「建议竖屏」。

所有视觉严格遵守 §10 合规：卡通纸片、无写实人像、无血腥。

## 10. 合规实现点（`compliance.js` + 全局）

对应需求 11 / 12 / 13，均在前端与文案层落地（后端不存真实身份信息）：

- **花名真实姓名拦截（需求 11，含评审发现 6 的处置）**：在开坛表单提交前对 `flower` 做启发式校验，命中则**阻止提交**并提示「请填花名/代号，别打真人~」。拦截规则（输入校验：必填、字符串、`trim` 后长度 1–12）：
  1. **姓氏开头的疑似真名**：`2–4 个纯汉字、不含数字/符号/空格` **且首字命中内置常见姓氏表** → 判疑似真名（如「张三」「王小明」「欧阳娜」）。内置姓氏表为约 100 个常见单姓 + 常见复姓（`["王","李","张","刘","陈","杨","黄","赵","吴","周", … ,"欧阳","司马","上官","诸葛", …]`，作为 `compliance.js` 的常量数组；来源为公开《百家姓》常见姓氏，不含任何真实个人信息）。
  2. **姓 + 称谓**：匹配 `(先生|女士|小姐|总|老师|经理|主任|医生|律师|同学)$` 结尾且前缀为 1–2 个汉字 → 疑似。
  非姓氏开头的 2–4 字纯汉字词**予以放行**（如罪状风格花名「甩锅侠」「阴阳人」「卷王」不被误拦，解决评审发现 6 的误伤）；非中文、含数字/符号、或命中花名特征词（「本卷」「某人」「隔壁」「大王」等）也放行。该校验为**合规引导而非严格鉴别**；为兜住极少数误拦，UI 在花名输入区**常驻「一键随机花名」按钮**作为逃生口（需求 11.3）。校验失败不入网络请求。
- **化灰无血腥（需求 12）**：小人终态唯一表现为「祥云消散」——canvas 上纸片人碎成金色/紫色祥云粒子上飘淡出，撒「赛博纸钱」（🧧/金箔矩形粒子）。全程**不绘制**任何红色液体、伤口、断裂人体；朱砂红仅用于符咒/UI，不用于「血」。
- **民俗定位与页脚声明（需求 11.4 / 13）**：页脚常驻「本应用为民俗文化体验与解压娱乐」；首页/关于处标注「『打小人』为粤港澳民间习俗（惊蛰日鹅颈桥下最盛），本作品为其民俗数字化体验」。分享图上保留「民俗数字化体验」小字（见 §11），保证传播物也带声明（需求 6.5）。
- **音频无真实个人信息（需求 13.3）**：咒语文案为固定非指向性文本，花名已被拦截为非真名，Web Speech 只朗读固定咒语不朗读花名。

## 11. 分享图生成（`share-card.js`）

需求 6.3/6.4/6.5：用离屏 `canvas` 绘制一张竖版赛博符咒图（建议 750×1334，2x 以便清晰保存/分享）：

绘制图层（自下而上）：
1. **底**：深色夜市底 + 霓虹紫辉光径向渐变。
2. **符咒框**：朱砂红符咒边框 + 鎏金黄描边，顶部「敕令」式牌匾。
3. **花名**：居中大字（楷体感、金色描边），标注为「小人花名」。
4. **罪状**：罪状标签以红底金字小牌排布。
5. **鞋数**：大号「共抽 {hits} 鞋 · 已化灰」战绩。
6. **签文**：三行「宜 {yi} / 忌 {ji} / 贵人 {guiren}」。
7. **页脚合规小字**：「民俗数字化体验 · 娱乐解压，非指向真人」+ 可选作品名/房间码水印。

导出：`canvas.toBlob(blob => ...)` 生成 PNG。**分享 / 保存的判定顺序写死（评审发现 13 的处置，因 iOS Safari 对 canvas blob 的 `a[download]` 支持历来受限）**：
1. 若 `navigator.canShare?.({ files:[file] })` 为真（移动端，尤其 iOS）→ 走系统分享面板 `navigator.share({ files:[file] })`；
2. 否则若支持 `a[download]`（桌面主流浏览器）→ 创建 `a[download]` 触发下载；
3. 两者皆不可用 → 把图片渲染到页面并提示「长按图片保存」。

即「移动端优先系统分享，桌面走下载，皆不可用才提示长按」。签文用后端下发的锁定值绘制，多次生成同图。字体加载：用系统字体栈，无需等待 web font，避免 canvas 绘制时字体未就绪。

## 12. ElevenLabs 预生成脚本设计（`scripts/generate-audio.mjs`）

需求 8.2–8.6。Node ES Module 脚本，**本次不运行**，仅作可运行工具存在；职责：把三语咒语文案批量合成 mp3 输出到 `assets/audio/`。

- **Key 来源**：仅 `process.env.ELEVENLABS_API_KEY`。启动即校验：未设置则 `console.error` 提示「请先 `export ELEVENLABS_API_KEY=...` 再运行」并 `process.exit(1)`，**绝不写入占位 key、绝不硬编码、绝不进入提交**（需求 8.4/8.5）。仓库提供 `.env.example`（仅含变量名无值）与 `.gitignore` 忽略 `.env` 与 `assets/audio/*.mp3`（避免误传生成物/密钥痕迹）。
- **输入**：复用与前端同源的三语咒语常量（`scripts/` 内置一份与 §7 一致的 `SPELL_TEXT`，或从一个共享 JSON 读取，避免文案漂移——MVP 采用脚本内常量，并在注释标注须与 `requirements.md` 3.2 保持一致）。
- **调用**：对 `zh-CN/zh-HK/en-US` 三条文案各调用一次 ElevenLabs TTS（可按语言配不同 voiceId，voiceId 从环境变量或脚本顶部常量配置，非密钥），把返回音频流写入 `assets/audio/spell-<lang>.mp3`（命名与需求 8.6/前端清单一致）。
- **网络与错误**：用 Node 18+ 内置 `fetch`；对每个请求做 try/catch：HTTP 非 2xx → 打印状态码与响应体摘要并对该语言跳过（不中断其余语言），最终汇总成功/失败数；401/403 → 明确提示「检查 ELEVENLABS_API_KEY 是否有效」。写文件失败 → 打印目标路径与错误。
- **安全**：脚本不打印完整 key（如需日志仅打印「已读取 key（已隐藏）」）。
- **生成后对接**：生成成功后，开发者把 `config.js` 的 `AUDIO_MANIFEST` 对应语言置 `true`，前端即自动走 mp3 分支（§8）。

## 13. 前端运行时配置（`app/js/config.js`）

满足需求 10.3「WebSocket 地址可配」。**采用显式可配地址，不做 `location.host` + `/ws` 的同源推导**（评审发现 1 的处置，见下）：

```js
export const CONFIG = {
  // 房间服务地址的单一事实源。优先级：localStorage 覆盖 > 本地默认 > 线上占位。
  //   - 本地开发：默认连本机房间服务 ws://localhost:8080
  //   - 线上部署：把下面的 REPLACE_WITH_ROOM_SERVER_HOST 改成实际房间服务地址
  //     （例如 wss://room.example.com），或在浏览器控制台执行
  //     localStorage.setItem('WS_URL','wss://room.example.com') 临时覆盖。
  WS_URL:
    localStorage.getItem('WS_URL') ||
    ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'ws://localhost:8080'
      : 'wss://REPLACE_WITH_ROOM_SERVER_HOST'),
  TARGET_HITS: 18,
  AUDIO_MANIFEST: { 'zh-CN': false, 'zh-HK': false, 'en-US': false },
};
```

**为什么不用同源 `/ws` 推导**：后端是裸 `ws` 房间服务（§5），没有 HTTP 服务器 / 路径路由；需求 10.1 又允许前端托管于「任意静态托管 / OSS」，而 OSS 不具备 WebSocket 反代能力。若前端在生产用 `location.host`+`/ws`，连接目标 host 会落在静态托管域名上，无法到达独立监听的 Node 房间服务，联调必然失败。因此前端连接地址与后端监听地址解耦为两个显式配置：前端用 `CONFIG.WS_URL` 直连房间服务公网地址，后端用 `PORT` 决定监听端口（见 §5）。两端口径的单一事实源分别是 `config.js` 的 `WS_URL` 与后端的 `PORT`/监听声明，不再相互推导。

邀请链接形如 `https://<host>/#/join?room=A7K9QX`；前端 `main.js` 用 `location.hash` 路由，检测到 `join?room=` 自动带入房间码进入进房确认（需求 2.3）。二维码用 `vendor/qrcode.min.js` 对邀请链接本地生成（需求 2.1）。

## 14. 边界与异常（Edge Cases）

- **双方同时落鞋**：事件循环串行化两次 `applyHit`，`hits` 正确 +2，两条 `hit` 广播先后到达，前端按最新 `hits` 渲染（可能跳 1 格，可接受）。
- **落鞋越界**：`applyHit` 封顶 8 且 `burning/fortune` 阶段忽略 `hit`，杜绝超打。
- **断线重连**：客户端重连时**在 `hello` 帧带旧 `clientId`**（非重发 `join_room`），后端认领同一成员槽、`online=true`、不占新槽、不触发 `ROOM_FULL`，随后单播 `room_state` 对齐计数/阶段/签文（需求 4.7/7.5）。重连窗口由 `cleanupRoom` 延时（60s）保障。
- **房间已散**：重连超窗口房间已回收 → 后续 `set_lang`/`hit`/`join_room` 回 `ROOM_NOT_FOUND`，前端提示「房间已散场」。
- **第三人进房**：`join_room` 时已认领落鞋成员数满 2 → `ROOM_FULL`（MVP 不含围观，围观属 P1）。
- **刷新页面（与回收窗口对齐，评审发现 12 的处置）**：刷新会断开旧连接，后端把该成员 `online=false` 并开启 60s `cleanupRoom` 回收窗口；浏览器把 `clientId` 存在 `sessionStorage`（同标签页刷新保留、关闭标签页清除，生命周期与 60s 窗口基本吻合）。新连接发 `hello` 携带 `sessionStorage` 里的旧 `clientId`，在窗口内命中则**认领原槽、不触发 `ROOM_FULL`**；若无 `sessionStorage.clientId` 或已超窗口回收，则作为新成员（可能触发 `ROOM_FULL`，属已知 MVP 局限，可在 P1 用持久 `clientId` 优化）。
- **语音不可用**：mp3 缺失且无 `speechSynthesis` → 文字兜底，不阻断（需求 3.5）。
- **签文一致性**：`fortune` 后端只抽一次并锁定，任何重复请求/重连返回同值（需求 6.2）。
- **非法/半包消息**：`BAD_PAYLOAD`，忽略并回快照，不断连。

## 15. 可测试性（Testability）

- **后端单元可测**（纯函数/状态机，Node 原生 `node:test` 或 `assert`，无框架依赖，符合「轻量」）：`genRoomCode()` 唯一性与字符集、`applyHit()` 封顶与阶段推进、`recomputeStage()` 四阶段阈值边界（0/2/3/4/5/7/8）、`drawFortune()` 锁定幂等、`makeSnapshot(room, selfClientId)` 的 `isSelf` 逐连接正确且不外泄 `ws` 句柄、`ROOM_FULL` 判定按已认领 `clientId` 落鞋成员数计且重连带旧 `clientId` 不触发房满。
- **后端集成可测**：用 `ws` 客户端起两个连接走「建房→进房→切咒语→连打到 18→化灰→签文」全链路，断言两端收到的 `room_state`/`burn`/`fortune` 一致；断线重连后快照对齐。
- **前端可测/可手测**：`compliance.js` 的拦截规则用一组真名/花名样例做纯函数单测；`audio.js` 回退分支用桩（stub `window.speechSynthesis` 与 `AUDIO_MANIFEST`）验证三级选择；UI 流程以人工 smoke test（可挂 Kiro hook 在改前端后提示跑冒烟）。
- **难测点与对策**：canvas 像素输出不做像素级断言，仅测绘制函数「不抛错 + 产出非空 blob」；动画时序属观感，走人工验收。

## 16. 目录结构落地（Project Layout）

```
1-kickbadguy/
├── 00-思路与决策.md
├── README.md                         ← 参赛说明 + 200 字 demo + Kiro 能力清单（后续步骤产出）
├── .env.example                      ← 仅含 ELEVENLABS_API_KEY= 变量名，无值
├── .gitignore                        ← 忽略 .env、node_modules、assets/audio/*.mp3
├── .kiro/
│   ├── specs/kick-bad-guy/
│   │   ├── requirements.md           ← 已产出
│   │   ├── design.md                 ← 本文档
│   │   └── tasks.md                  ← 后续步骤产出
│   └── steering/
│       ├── 民俗合规.md                ← 合规红线（供 Kiro 每轮遵守）
│       └── 视觉风格.md                ← 港式霓虹纸扎风（供 Kiro 每轮遵守）
├── app/                              ← 纯静态前端
│   ├── index.html
│   ├── css/theme.css
│   ├── js/
│   │   ├── main.js
│   │   ├── config.js
│   │   ├── ws-client.js
│   │   ├── store.js
│   │   ├── audio.js
│   │   ├── villain.js
│   │   ├── share-card.js
│   │   ├── compliance.js
│   │   └── screens/   (altar.js, invite.js, spell.js, beat.js, ash.js, fortune.js)
│   └── vendor/qrcode.min.js
├── server/
│   ├── room-server.js                ← 单文件 ws 房间服务（内存）
│   └── package.json                  ← 仅依赖 ws，启动脚本 "start": "node room-server.js"
├── scripts/
│   └── generate-audio.mjs            ← ElevenLabs 预生成脚本（本次不运行）
└── assets/
    └── audio/                        ← 三语咒语 mp3 输出目录（本次为空 → 运行时 Web Speech 回退）
        └── .gitkeep
```

`.kiro/steering/` 两份文件用于让后续实现每轮自动遵守合规红线与视觉风格（对应 00 文档「Kiro 使用分」策略），其具体内容在后续步骤产出，本设计只锁定其存在与职责。

## 17. 设计与需求对照（Traceability）

| 需求 | 设计落点 |
| --- | --- |
| 1 开坛立牌 | §4.1 `create_room`、§5 建房、§10 花名拦截、§7 罪状 |
| 2 请神婆 | §4.1 `join_room`、§13 邀请链接/二维码、§4.5 `ROOM_NOT_FOUND/ROOM_FULL` |
| 3 三语念咒 | §3 chanting、§4 `set_lang`、§7 咒语、§8 回退 |
| 4 开打 | §3 beating、§4.4 落鞋同步、§5 `applyHit`、§6 阶段与物理 |
| 5 化灰 | §3 burning、§4.2 `burn`、§10 无血腥、§5 `enterBurning` |
| 6 转运签 | §3 fortune、§4.2 `fortune`、§7 签文库、§11 分享图 |
| 7 WS 同步 | §2 架构、§4 协议、§5 内存与清理 |
| 8 配音 B 方案 | §8 回退、§12 预生成脚本、§13 清单 |
| 9 H5 骨相 | §9 视觉与布局 |
| 10 部署 | §2、§13 可配 WS、§16 目录 |
| 11/12/13 合规 | §10 合规实现点、§11 分享图声明 |
| NFR | §5 一致性、§8 可降级、§12 密钥安全、§13 可移植、§15 可测试 |

---

## 评审修订记录（Review Response）

本版为对 `design-review.json`（裁决 **CHANGES_REQUESTED**，2 HIGH + 5 MEDIUM + 6 NIT）的复评修订。逐条处置如下（**全部采纳并修复**）：

| # | 严重度 | 处置 | 修复位置 |
| --- | --- | --- | --- |
| 1 | HIGH | **修复**。改为显式可配 `WS_URL`（`localStorage` 覆盖 > 本地默认 `ws://localhost:8080` > 线上占位 `wss://REPLACE_…`），不做 `location.host`+`/ws` 同源推导；后端声明裸 `ws` 监听 `0.0.0.0:8080`、`PORT` 可覆盖，并说明线上需支持 WebSocket 的运行环境（非纯 OSS），前后端口径解耦为两个单一事实源。 | §13、§5（监听形态） |
| 2 | HIGH | **修复**。snapshot / `member_change` 的 `members[]` 项加 `clientId` 与 `isSelf`（`isSelf` 由后端逐连接填充，`broadcastSnapshot` 对每条连接各算一次 snapshot）；写死房满判定 = 已认领 `clientId` 的落鞋成员数达 2（在线+离线占位），仅 `join_room` 路径判定；重连走 `hello` 带旧 `clientId` 复用原槽、不触发 `ROOM_FULL`。 | §4.3、§4.2（member_change）、§4.5（ROOM_FULL）、§5（makeSnapshot/broadcast/生命周期）、§15 |
| 3 | MEDIUM | **修复**。写死 `PHASE_REJECTED` 不下发 `error` 帧、仅回 `room_state` 自愈（开发期 `console.debug`）；仅 `ROOM_NOT_FOUND`/`ROOM_FULL` 面向用户提示并下发 `error`。§3 与 §4.5 措辞统一。 | §3、§4.5 |
| 4 | MEDIUM | **修复**。§4.4 新增规则 7「开打同步：`start_beat` → `phase=beating` → 广播 `room_state`」；§3 注明 phase 每次变更随 `room_state` 广播，前端以 `snapshot.phase` 为唯一路由依据。 | §3、§4.4 |
| 5 | MEDIUM | **修复**。写死帧渲染优先级：结构性状态走 `room_state`、高频 `hits`/`villainStage` 走 `hit`/`villain_state` 增量帧且对 `hits` 取 `Math.max` 单调递增防回退；`room_state` 仅在进房/重连/phase 变更/切咒语下发。§4.3「唯一依据」表述据此修订。 | §4.3、§4.4（帧渲染优先级） |
| 6 | MEDIUM | **修复**。收紧拦截规则 1 为「2–4 纯汉字 **且首字命中内置常见姓氏表**」才判疑似，非姓氏开头的 3 字整活花名（甩锅侠/阴阳人）放行；内置约 100 常见姓（含常见复姓）数组；UI 常驻「一键随机花名」逃生口。 | §10 规则 1 |
| 7 | MEDIUM | **修复**。写死首帧契约：连接后必须先发 `hello`，收 `hello_ok{clientId}` 后方可发 `create_room`/`join_room`；之前的业务消息回 `BAD_PAYLOAD` 忽略。`create_room`/`join_room` 的允许条件从「建房前」phase 改为「`hello` 之后、本连接无房间归属」，`join_room` 仅用于首次进房。 | §4.1（首帧契约）、§5（生命周期） |
| 8 | NIT | **修复**。`lang==='zh-HK'` 走 Web Speech 回退时同屏显示粤语咒语原文，补偿回退嗓音观感割裂。 | §8 |
| 9 | NIT | **修复**。§4.4 注明 `villain_state` 唯一用途为「跨阶段一次性特效/音效触发」，非常规渲染源。 | §4.4 |
| 10 | NIT | **修复**。§6 注明弹跳动画单实例，重入时重置相位（retrigger）而非叠加。 | §6 |
| 11 | NIT | **修复**。与发现 3 一并统一：生产前端对 `BAD_PAYLOAD`/`PHASE_REJECTED` 静默（仅 debug），只有 `ROOM_NOT_FOUND`/`ROOM_FULL` 面向用户提示。 | §4.5 |
| 12 | NIT | **修复**。§14 点明「刷新 → 旧连接 close 进入 60s 回收窗口 → 新连接 `hello` 带 `sessionStorage.clientId` 在窗口内认领」的对齐关系。 | §14、§5 |
| 13 | NIT | **修复**。§11 写死分享/保存判定顺序：移动端优先 `navigator.share({files})`（经 `navigator.canShare` 判定），桌面走 `a[download]`，皆不可用才提示长按保存。 | §11 |

评审「已验证的假设」（三语文案一致、BCP-47 语言码、配音 B 方案不调用 ElevenLabs、合规三红线落点、后端单一事实源、终态签文锁定/封顶幂等）本版均予保持，未因上述修复而变动。评审「未验证假设」中的 `navigator.share`/`zh-HK` 嗓音两项，已分别通过发现 13（判定顺序写死）与发现 8（同屏原文补偿）将风险落到设计层可控；生产 WS 可达性（发现 1）已从「OSS 反代 `/ws`」改为「显式直连独立房间服务」，不再依赖不成立的前提。`app/server/scripts/assets` 无实现代码一项，属实现前阶段的必然状态，由后续 tasks/实现步骤产出。
