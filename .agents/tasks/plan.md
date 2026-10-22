# Implementation Plan — 修复两个前端 bug（ROOM_NOT_FOUND / 转运签重置按钮不可见）

项目：赛博打小人 H5（纯静态前端 + 单文件 Node ws 后端）。零构建、原生 ES Module。
后端已验证正常（npm test 18/18 绿），本次不改后端协议/状态机。两个 bug 根因都在前端。

## 根因结论（已通过逐一读码核实）

**BUG 1（神婆点「进坛代打」报 ROOM_NOT_FOUND）：根因是前端缺少心跳保活。**
- `app/js/ws-client.js` 从不发任何 `ping`。苦主 create_room 后停在邀请屏（改 host-override、复制链接、看二维码）期间，连接零数据往来。浏览器后台标签 / 代理 / NAT 常在 ~30–60s 空闲后静默断开 WebSocket。
- 苦主是房间唯一在线成员：一旦其连接被掐断，后端 `handleClose` 置 `member.online=false` 并 `cleanupRoom` 启动 60s（CLEANUP_DELAY_MS）删除。神婆在删除后 join → 后端 `handleJoinRoom` 找不到房间 → `ROOM_NOT_FOUND`（见 room-server.js `handleJoinRoom`）。
- 后端重连认领链路本身正确（`handleHello`→`findMemberByClientId`→`online=true` 并清 `_cleanupTimer`），前端 `_open` 重连也确实带上 sessionStorage 里的旧 `clientId`。但 sessionStorage 是「每标签页」隔离的，且空闲断开后浏览器可能不会主动触发 `close`/重连（后台标签节流），所以**靠重连兜底不可靠；正确修法是从源头保活，让连接根本不被判空闲**。
- 后端已支持 `ping→pong`（room-server.js `routeMessage` 的 `case 'ping'`），前端只需定时发 `ping`。
- join 时序（`_queue` flush）已正确：`send('join_room', …)` 在 `hello_ok` 前自动排队、之后 flush，无需改动，仅在验证时确认。

**BUG 2（转运签页看不到「🔄 再请一位小人」按钮）：根因是 `.bottom-bar` CSS 布局未支持双按钮堆叠。**
- `fortune.js` 的 `.bottom-bar` 里确实同时有 `#share-btn`（btn-primary）和 `#reset-btn`（btn-ghost），按钮代码存在。
- `theme.css` 的 `.bottom-bar` 是 `position:absolute; left/right:16px; bottom:16px`，**没有 flex/gap/方向**。`#share-btn` 为 `width:100%` 块级，第二个按钮 `#reset-btn` 紧贴其后、无间距，整条 bar 又被钉在卡片底部 `bottom:16px`，在 375×667 竖屏下第二个按钮被挤出卡片 `padding-bottom:90px` 的可视区 / 视口底部，表现为「看不到重置按钮」。
- 修法：把 `.bottom-bar` 改为纵向 flex 堆叠 + gap，让两个按钮各占一行且都在视区内；并给 `.fortune-card` 预留足够底部空间避免遮挡。其它使用 `.bottom-bar` 的屏（invite/spell/beat 等）只有单个按钮，纵向 flex 对其无副作用（单子项布局不变）。

---

## 计划条目（按依赖顺序，各自独立可验证）

- [ ] 1. BUG1 — 在 WsClient 加定时 ping 心跳保活。
      在 `app/js/ws-client.js` 的 WsClient 增加心跳：`hello_ok` 收到后启动一个 `setInterval`（约 20000ms，小于常见 30–60s 空闲阈值），仅当 `this.ws.readyState===OPEN && this._helloAcked` 时发 `_raw({type:'ping', data:{}})`；在 `close` 事件处理与 `close()` 方法里清除该定时器（新增 `_clearHeartbeat()`，在 `_open` 的 `close` 回调、手动 `close()` 内调用，重连 `_open` 时重新在 hello_ok 后启动）。ping 不走业务 `send()`（避免 hello 前排队），用 `_raw` 直发。不改协议、不改其它帧逻辑。
      Files: app/js/ws-client.js
      Verify: `node --test app/js/store.test.js app/js/screens/invite.test.js app/js/compliance.test.js` 全绿（现有单测不回归）；`cd server && npm test` 仍 18/18 绿（未动后端）；手动/脚本验证见条目 4。

- [ ] 2. BUG2 — 把 `.bottom-bar` 改为纵向堆叠并保证两按钮可见。
      在 `app/css/theme.css` 的 `.bottom-bar` 规则加 `display:flex; flex-direction:column; gap:10px;`（保留现有 `position:absolute; left/right:16px; bottom:16px`）。确认 `.fortune-card`（复用 `.card`，`padding-bottom:90px`）在双按钮下仍有足够底部留白；若双按钮总高超过 90px，把 `.fortune-card` 的 `padding-bottom` 增至约 150px（仅针对 `.fortune-card`，不改全局 `.card`），确保 375×667 下两按钮完整落在视区、不被卡片裁切。仅用锁定四色变量，不新增色值，不破坏合规。
      Files: app/css/theme.css
      Verify: 浏览器在 375×667 视口走到转运签屏（脚本把房间推进到 fortune，或手动打满 18 下），截图确认 `#share-btn` 与 `#reset-btn` 两个按钮都可见且不重叠；见条目 5。

- [ ] 3. 整体回归与控制台检查。
      两个前端服务按需启动：`cd server && npm start`（:8080）、`cd app && python3 -m http.server 5173`（:5173）。浏览器打开 http://localhost:5173/ 走一遍完整闭环（开坛→邀请→念咒→开打 18 下→化灰→转运签→重置），确认既有功能不受影响：神婆法事页看花名/罪状、拖鞋挥击、部位反应、开打 BGM+四句字幕、三语配音、18 下化灰、内网 IP 自动适配、19 罪状、邀请链接 host-override、reset 重开。控制台 0 error。
      Files: 无（验证步骤）
      Verify: 控制台无 error；完整闭环可走通；localhost 单机（两标签页）仍可用。

- [ ] 4. BUG1 端到端验证（挂机跨过 cleanup 窗口后神婆仍能进房）。
      用 Node ws 客户端脚本或 agent-browser/Playwright：苦主 create_room 后**停留 ≥70s**（跨过 60s CLEANUP_DELAY_MS 窗口）不发任何业务消息，仅靠心跳保活；随后神婆用该 roomCode `join_room`，断言返回 `room_joined`（members=2）而非 `ROOM_NOT_FOUND`。再做一次对照：若临时禁用心跳，应复现 ROOM_NOT_FOUND，以证明心跳是根因修复（对照为可选，跑完删除临时脚本）。
      Files: 临时脚本（验证后删除）
      Verify: 停留 ≥70s 后神婆 join 成功、不报房间不存在；心跳期间后端不触发 cleanup（房间仍在 `rooms`）。

- [ ] 5. BUG2 端到端验证（375 小屏重置按钮可见可点、重开闭环）。
      用 Node ws 客户端把房间推进到 fortune（或浏览器打满 18 下），浏览器在 375×667 视口截图确认「🔄 再请一位小人」按钮可见；点击 `#reset-btn` 后断言两端收到 `room_state`（phase=altar、hits=0），可再来一局。
      Files: 临时脚本（验证后删除）
      Verify: 截图中 reset 按钮在视区内且可点；点击后 hits 归零、phase 回 altar，能再玩一局。

- [ ] 6. 收尾合规核对与清理。
      确认只用四色 `#E23A3A/#F4C430/#A24BFF/#140A1F`（+米黄 `#F3E6C8`），未破坏 compliance.js 三红线；`app/assets/audio` 下三个 mp3 未删改；`.env`/`node_modules` 未被提交（`git status` 核对）；删除所有验证临时文件。
      Files: 无（核对/清理）
      Verify: `git status` 干净（仅 ws-client.js、theme.css 改动）；无临时文件残留；`cd server && npm test` 18/18 绿、前端三组单测全绿。

## 不破坏性与合规保障
- BUG1 只在 ws-client 层加 ping 定时器，不触碰任何业务帧或后端；ping 在后端已有 `pong` 分支，零协议变更。
- BUG2 只调 `.bottom-bar`（纵向 flex）与 `.fortune-card` 底部留白；单按钮屏不受影响；色值全部沿用锁定四色变量。
- 全程不动后端、不动 mp3、不提交 .env/node_modules。localhost 单机双标签页体验保持可用（评委单机试用路径不受影响）。
