# Implementation Plan · 重置回到开坛立牌页、重新起花名打新小人

## 背景与设计决策（基于实读代码，非抽象）

需求：转运签屏点「🔄 再请一位小人」后，苦主回到**开坛立牌页**（altar 屏：起花名+选罪状+开坛），为一个**全新小人**重新立牌；神婆按 A1 **留在坛里**（不踢人、不散坛、房间码不变、成员保留），看「苦主正在重新立牌，稍候…」等待态；苦主重新开坛后，神婆自动看到新小人的花名/罪状，流程继续（念咒→开打）。

当前行为与症结（已读码确认）：
- `server/room-server.js` 的 `resetRoom(room)` 把 `phase=altar` 但**保留 `flower`/`crimes`**；`handleReset` 调 `resetRoom` 后 `broadcastSnapshot(room,'room_state')`。
- `app/js/main.js` 的 `screenForState` 在 `phase==='altar'` 时一律返回 `'invite'`（邀请屏）。→ 重置后回到的是「邀请屏 + 旧小人」，不符合新需求。
- `app/js/store.js` 的 `applySnapshot` 对 reset 快照（`phase==='altar' && hits===0 && 旧 hits>0`）已有绕过 `Math.max` 的归零分支，并显式清 `burned/fortune`，但**不清 `flower/crimes`**；且常规分支 `s.flower = snapshot.flower ?? s.flower` 对空串 `''` 会因 `?? `放行空串（`'' ?? x` === `''`，OK），但该 reset 分支根本没动 `flower`，会残留旧花名。
- `app/js/screens/altar.js` 的开坛按钮永远发 `create_room`（新建房间 → 换房间码、神婆掉队），重置后不能再走这条路。

### 锁定的设计（写进 design.md，供实现遵循）

**新「待重新立牌」态 = `phase==='altar'` 且 `flower===''`（空花名）**。复用 altar 阶段 + 空花名表达，不新增 phase 枚举（符合 design §3 既有五态状态机，改动面最小）。

**reset 新语义**：`resetRoom` 在原有归零基础上，**额外清空** `flower=''`、`crimes=[]`，把房间带入「待重新立牌」态（`phase=altar`、`flower=''`、`hits=0`、`lang=null`、`burned=false`、`fortune=null`）。保留 `code`/`target`/`members`/`_cleanupTimer`（不踢人、不换房间码）。

**新 `relist` 消息（C2S）**：苦主在**已存在房间**里提交新的 `flower`+`crimes`，更新房间小人身份并把房间从「待重新立牌」推进到可邀请/念咒态。
- `data`: `{ roomCode, flower, crimes[] }`。
- 权限/阶段校验：仅当 `room.phase==='altar'` **且** `room.flower===''`（待重新立牌态）允许；且发送者须为该房 `victim` 角色（房主/苦主）。`flower` 为空串或非字符串 → 视为非法，不更新。任何非法情况按 `PHASE_REJECTED` 惯例**静默回一帧 `room_state` 自愈**，不下发 `error`（与 design §4.5 一致）。
- 成功后：`room.flower=<新花名>`、`room.crimes=<新罪状>`，**`phase` 保持 `altar`**（花名非空即「已立牌/等待神婆或开始念咒」态，与首次 `create_room` 后 `phase=altar` 一致），然后 `broadcastSnapshot(room,'room_state')` 让神婆同步看到新小人。

> 为什么 relist 后保持 `phase=altar` 而非直接 `chanting`：首次 `create_room` 后房间就是 `phase=altar`、`flower` 非空，前端苦主据此显示邀请屏、神婆显示带小人信息的等待页，再由苦主点「开始念咒」发 `set_lang` 推进 `chanting`。重新立牌后复用完全相同的后续流程（邀请屏→开始念咒→念咒→开打），一致且已被现有集成测试覆盖的路径，无需新增转移。神婆已在坛，苦主邀请屏的二维码/复制对单人或双人都无害（双人时神婆已在，苦主可直接点开始念咒）。

**前端路由（`screenForState`）新规则**，以 `role` + `phase` + `flower` 区分开坛立牌页与邀请屏：
- 神婆待进房（`pendingJoinRoom && !roomCode`）→ `invite`（进房确认）——保持现状。
- `phase==='altar'` 且 `flower` 为空（待重新立牌）：
  - 苦主（`role!=='shaman'`，含 role 未定兜底）→ `altar`（开坛立牌页）。
  - 神婆（`role==='shaman'`）→ `invite`（走等待页子视图，显示「苦主正在重新立牌」）。
- `phase==='altar'` 且 `flower` 非空：→ `invite`（现有逻辑：苦主邀请屏 / 神婆带小人信息等待页）。
- 其余 phase（chanting/beating/burning/fortune）→ 现状不变。

**altar.js 双路径开坛**：`initAltar` 读 `app.store.state.roomCode` 判断——
- 无 `roomCode`（首次）→ 发 `create_room`（现状）。
- 有 `roomCode`（重置后重新立牌）→ 发 `relist { roomCode, flower, crimes }`。
- 两路径都先过 `checkFlower` 拦截（合规红线，重新立牌同样拦真名）。按钮文案可据路径微调（如「🔥 重新开坛」）但非必须。

**invite.js 神婆等待页 `renderShamanWaiting`**：当 `flower` 为空（待重新立牌）时显示「苦主正在重新立牌，稍候…」而非旧小人信息/空白；`flower` 非空时显示新小人花名+罪状（现状）。

**store.js reset 分支清 flower/crimes**：在既有 `phase==='altar' && hits===0 && 旧 hits>0` 绕过分支里，额外把 `s.flower`、`s.crimes` 按快照值显式写入（快照此时为 `flower:''`、`crimes:[]`），使本地镜像真正清空，不被 `?? s.flower` 或「未赋值」残留旧值。注意：reset 分支的触发条件是「旧 hits>0」；本任务 reset 必然从 fortune（hits=18）发起，条件成立。但为稳健，建议该分支改为「识别 reset 快照」后统一处理 flower/crimes/burned/fortune 清空（见步骤 4）。

**合规与风格**：不改四色 `#E23A3A/#F4C430/#A24BFF/#140A1F` + 纸面米黄 `#F3E6C8` 的任何锁定值；新增/改造的等待页文案沿用现有 `.rite-*` 纸扎风 class；`checkFlower` 在重新立牌路径仍生效；不碰 villain/beat/share-card/audio/ws-client 等既有功能。

### 单人 vs 双人
- 单人（仅苦主）：reset→苦主回 altar 屏→重新 `relist`→回邀请屏→点开始念咒→……全程无神婆，relist 校验只认 victim，OK。
- 双人（苦主+神婆）：reset→苦主回 altar 屏、神婆看「正在重新立牌」等待页→苦主 relist→双方收 `room_state`、神婆自动看到新小人→苦主点开始念咒→念咒/开打同步，房间码与成员不变。

---

## 任务清单

- [ ] 1. 后端 `resetRoom` 扩展为清空 flower/crimes，进入「待重新立牌」态。
      在 `resetRoom(room)` 原有归零（hits/villainStage/burned/fortune/lang/phase=altar）基础上，追加 `room.flower=''`、`room.crimes=[]`。保留 `code/target/members/_cleanupTimer`。更新函数上方注释说明新语义。
      Files: `server/room-server.js`
      Verify: `cd server && npm test` —— 下一步会改 reset 单测，本步先确保函数编译通过、现有其它单测不回归（reset 相关单测会在步骤 6 同步更新，允许本步该用例暂红，最终步骤 6 后全绿）。

- [ ] 2. 后端新增 `handleRelist` 并接入 switch 分发。
      新增 `handleRelist(ws, meta, data)`：用 `requireRoom` 取房；校验 `meta.role==='victim'`（非苦主→静默回快照）、`room.phase==='altar' && room.flower===''`（非待重新立牌态→`PHASE_REJECTED` 静默回快照并 `console.debug`）、`data.flower` 为非空字符串且 `trim().length>=1`（否则静默回快照）；校验通过则 `room.flower=data.flower`、`room.crimes=Array.isArray(data.crimes)?data.crimes:[]`、`phase` 维持 `altar`，再 `broadcastSnapshot(room,'room_state')`。在 `routeMessage` 的 `switch(type)` 中新增 `case 'relist': handleRelist(ws, meta, data); break;`（紧邻 `create_room`/`reset`）。`makeSnapshot` 字段无需新增（flower/crimes 已在快照内）。
      Files: `server/room-server.js`
      Verify: `cd server && npm test` —— 配合步骤 6 的新用例确认 relist 成功/越权/非法阶段分支；本步可先 `node -e "import('./server/room-server.js')"`（从项目根）确认模块加载无语法错误。

- [ ] 3. 前端 `screenForState` 区分开坛立牌页与邀请屏。
      在 `app/js/main.js` 的 `screenForState(state)` 中，于 `case 'altar'` 分支内按 `state.flower` 与 `state.role` 分流：`flower` 为空（`!state.flower`）且 `role!=='shaman'`→返回 `'altar'`；`flower` 为空且 `role==='shaman'`→返回 `'invite'`（神婆等待页）；`flower` 非空→返回 `'invite'`（现状）。保留现有「神婆待进房」最前置判断。注意 `inviteSubview`/`subviewChanged` 逻辑：reset 后神婆仍落在 `invite` 屏且子视图仍为 `shaman-waiting`，需确保 `renderShamanWaiting` 能据 `flower` 变化重绘（见步骤 7 的强制重渲染说明）。
      Files: `app/js/main.js`
      Verify: `node --test app/js/screens/*.test.js app/js/store.test.js`（纯函数不覆盖路由，路由由步骤 9 手测冒烟验证）；本步主要确保无语法错误、现有前端单测全绿。

- [ ] 4. 前端 `store.js` reset 快照清空 flower/crimes。
      在 `applySnapshot` 的 reset 绕过分支（`snapshot.phase==='altar' && snapshot.hits===0 && s.hits>0`）内追加：`s.flower = snapshot.flower ?? ''`、`s.crimes = Array.isArray(snapshot.crimes) ? snapshot.crimes : []`，使本地镜像花名/罪状真正清空（类比既有 burned/fortune 的显式清空，绕过常规 `?? s.flower` 残留）。更新该分支上方注释。
      Files: `app/js/store.js`
      Verify: `node --test app/js/store.test.js` —— 步骤 8 会新增「reset 快照清空 flower/crimes」断言；本步确保现有 3 个 store 用例仍绿。

- [ ] 5. 前端 `altar.js` 双路径开坛（create_room / relist）。
      在 `initAltar` 的 `createBtn` 点击处理里，读 `app.store.state.roomCode`：有值 → `app.ws.send('relist', { flower, crimes: [...selected] })`（带 `roomCode: app.store.state.roomCode`）；无值 → 维持现状 `app.ws.send('create_room', { flower, crimes:[...selected] })`。两分支都先过 `checkFlower`（现有拦截逻辑保留在前，命中真名则 return 不发送）。可据 `roomCode` 是否存在把按钮文案设为「🔥 重新开坛」/「🔥 开坛」（可选，纸扎风文案，不改样式）。
      Files: `app/js/screens/altar.js`
      Verify: `node --test app/js/compliance.test.js`（确认 checkFlower 未被破坏）；altar 屏行为由步骤 9 手测冒烟验证。

- [ ] 6. 后端测试：reset 新语义 + relist 单元/集成用例。
      单元（`server/room-server.test.js`）：改「resetRoom」用例断言 `room.flower===''`、`room.crimes` 为空数组（在既有保留/归零断言基础上补充），把「保留花名/罪状」的旧断言改为「清空花名/罪状、保留房间码与成员」。
      集成（`server/room-server.integration.test.js`）：
        (a) 改「fortune 后 reset 重开一坛」用例：reset 后两端 `room_state` 的 `flower===''`、`crimes` 为空数组、`phase==='altar'`、成员=2、roomCode 不变（替换原「花名/罪状保留」断言）。
        (b) 新增「relist 重新立牌」用例：建房→进房→念咒→打到18→reset→苦主 `send('relist',{roomCode,flower:'新花名',crimes:['摸鱼']})`→两端各收 `room_state`，断言 `flower==='新花名'`、`crimes` 含 `'摸鱼'`、`phase==='altar'`、成员=2、roomCode 不变；随后苦主 `set_lang` 能推进 `chanting`（验证后续流程可继续）。
        (c) 新增「relist 越权/非法阶段静默拒绝」用例：非待立牌态（如刚建房 flower 非空的 altar、或 fortune 阶段）发 relist → 只回一帧 `room_state`、`flower` 不变、`waitFor('error',300)` 应 reject（不下发 error）。
      Files: `server/room-server.test.js`, `server/room-server.integration.test.js`
      Verify: `cd server && npm test` —— 全部单元+集成用例通过（含改后的 reset、新增 relist 三组）。

- [ ] 7. 前端 `invite.js` 神婆等待页「待重新立牌」态。
      改造 `renderShamanWaiting`：当 `s.flower` 为空时，`rite-target` 区显示「苦主正在重新立牌，稍候…」文案（替代小人花名/罪状区），`rite-words` 文案改为如「小人已送走，静候苦主重新立牌…」；`s.flower` 非空时维持现状（显示花名+罪状）。沿用现有 `.rite-*` 纸扎风 class，不改 CSS 锁定色。确认 reset→relist 过程中该页能随 `member_change`/`room_state` 到达重绘：relist 后后端广播 `room_state`，main.js `room_state` 处理会 `applySnapshot`+`renderRoute`；此时神婆 `invite` 子视图仍是 `shaman-waiting`、key 未变，`subviewChanged` 为 false 会提前 return 不重建 → 需在 `room_state` 到达时对 `invite` 屏神婆等待页做就地重绘（类比现有 `refreshInviteMembers`），或在 `screenForState`/`renderRoute` 对 shaman-waiting 增加一个「flower 空↔非空」的子态比较使其强制重渲染。推荐：在 main.js `room_state` 处理里，若 `app.current==='invite'` 且神婆态，调用一个 invite 导出的 `refreshShamanWaiting(app)`（新增，仅重绘等待页 DOM），与 `refreshInviteMembers` 并列。
      Files: `app/js/screens/invite.js`, `app/js/main.js`
      Verify: `node --test app/js/screens/invite.test.js` —— 现有邀请链接纯函数用例仍绿（渲染为 DOM，等待页视觉由步骤 9 手测）。

- [ ] 8. 前端 `store.test.js` 补充 reset 清空 flower/crimes 断言。
      在「applySnapshot reset」用例里，先设 `store.state.flower='旧花名'`、`store.state.crimes=['抢功劳']`（或通过一次带 flower 的快照设置），reset 快照带 `flower:''`、`crimes:[]`，断言 reset 后 `store.state.flower===''`、`store.state.crimes` 为空数组。保留原 hits/burned/fortune/villainStage/phase 断言。
      Files: `app/js/store.test.js`
      Verify: `node --test app/js/store.test.js` —— 新增断言与现有用例全绿。

- [ ] 9. 前端手测冒烟（单人+双人重置重开全链路）。
      起后端（`cd server && node room-server.js`）与静态前端（任意静态服务器 serve `app/`），浏览器走：单人——开坛立牌→开坛→邀请屏→开始念咒→念咒→开打→化灰→转运签→点「🔄 再请一位小人」→**回到开坛立牌页**（起花名+选罪状可编辑、无旧小人残留）→重新开坛→邀请屏→……跑完第二局；双人——苦主开坛、神婆扫邀请链接进坛→打到化灰→转运签 reset→苦主回开坛立牌页、**神婆看到「苦主正在重新立牌，稍候…」**→苦主重新起花名选罪状开坛→**神婆自动看到新小人花名+罪状**→继续念咒/开打，全程房间码不变、神婆不掉线。顺带回归：神婆法事页花名罪状、拖鞋挥击/部位反应、开打 BGM+四句字幕、三语配音、18 下化灰、内网 IP 自动适配+复制降级、19 罪状多选、邀请链接 host-override、ws 心跳、转运签重置按钮可见；reset 后 hits 归 0。
      Files: 无（仅运行验证）
      Verify: 手测通过上述单人+双人两条链路，无旧小人残留、神婆等待/同步正确、房间码不变；控制台无报错。关闭临时起的服务进程。

- [ ] 10. 更新 design.md 状态机与协议（reset 新语义 + relist 定义）。
      §3 状态机：把「重开一坛转移」改为「reset 额外清空 flower/crimes，进入『待重新立牌』态（phase=altar + flower 空）」，并补一条 `altar(待重新立牌) --relist--> altar(已立牌)` 转移（苦主提交新 flower/crimes），说明前端据 `flower` 空/非空区分开坛立牌页与邀请屏、神婆据此显示「正在重新立牌」等待页。§4.1 C2S 表新增 `relist` 行（`data:{roomCode,flower,crimes[]}`、允许 phase：altar 且 flower 空、仅 victim）。§4.5 在 `PHASE_REJECTED` 行补「relist 在非待立牌态或非苦主」归该类静默自愈。§3 reset 具体重置项补 `flower=''`、`crimes=[]`。保持四色/合规等既有表述不变。
      Files: `.kiro/specs/kick-bad-guy/design.md`
      Verify: 人工复读 §3/§4.1/§4.5 一致无矛盾（reset 新语义与 relist 转移、权限/阶段校验、PHASE_REJECTED 静默口径一致）；无需跑命令。

## 全量验收命令
- 后端：`cd server && npm test`（单元 + 集成全绿，含改后的 reset、新增 relist 三组）。
- 前端纯函数：`node --test app/js/store.test.js app/js/screens/invite.test.js app/js/compliance.test.js`（全绿）。
- 手测：步骤 9 的单人 + 双人重置重开两条链路通过。

## 已知假设/待确认（不阻塞实现）
- relist 后 `phase` 保持 `altar`（非直接 chanting），复用首次开坛后的邀请/念咒路径；若后续希望双人重新立牌后跳过邀请屏可在 relist 里按成员数判断推进 chanting，本次不做（保持与首次流程一致、最小改动）。
- 「待重新立牌」态用 `phase=altar + flower 空` 表达而不新增 phase 枚举，避免扩散状态机与所有 phase 分支改动。

## 实现验证记录（本次迭代）
- 后端：`cd server && npm test` → tests 21 pass 0 fail（含改后的 resetRoom 单测、改后的「reset 清空小人身份进入待重新立牌态」集成用例，新增 relist 三组：重新立牌同步+后续流程、非待立牌态静默拒绝、非苦主越权静默拒绝）。
- 前端纯函数：`node --test app/js/store.test.js app/js/screens/invite.test.js app/js/compliance.test.js` → tests 17 pass 0 fail（含 store reset 清空 flower/crimes 新断言）。
- 语法检查：`node --check` 过 main.js / store.js / screens/altar.js / screens/invite.js / server/room-server.js。
- 实现落点：resetRoom 清空 flower=''/crimes=[]；新增 handleRelist + switch 注册 relist；main.js screenForState 按 role+flower 分流（苦主回 altar 开坛立牌、神婆留 invite 等待页）并在 room_state 到达时 refreshShamanWaiting 强制重绘；store.js reset 分支显式清空 flower/crimes；altar.js 双路径开坛（有 roomCode→relist、无→create_room，均先过 checkFlower）；invite.js renderShamanWaiting 支持「正在重新立牌」态 + 导出 refreshShamanWaiting；design.md §3/§4.1/§4.5 同步 reset 新语义 + relist 定义/转移/校验/静默自愈。
- 手测（步骤 9）为运行期人工冒烟，未在本自动化环境执行；逻辑链路由上述后端集成用例（reset→relist→set_lang 推进 chanting、双端同步、房间码/成员不变）覆盖。
