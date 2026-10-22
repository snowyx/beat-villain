# 重置回到开坛立牌页 + relist 重新立牌打全新小人

苦主在转运签屏点「🔄 再请一位小人」后回到开坛立牌页为全新小人重新起名选罪状，神婆留在坛里看等待态并在苦主重新立牌后自动看到新小人续局。实现方式是给 `reset` 加新语义（额外清空 `flower=''`/`crimes=[]` 进入「待重新立牌」态，`phase` 仍为 `altar`），并新增一条 `relist` C2S 消息让苦主在原房间提交新身份。前端用 `role + phase + flower` 三元组路由区分开坛立牌页、邀请屏与神婆等待页，房间码与成员全程不变。设计没有新增 phase 枚举，而是复用「`altar` + flower 空/非空」表达两个子态，改动面收敛。

Watch for: 本次 commit 顺带夹带了邀请链接复制的多级降级（`copyText`/`copy-fallback`/execCommand）与一处未提交的 `theme.css` 样式，属于另一桩「复制链接」缺陷的修复，与重启需求同坛但不同事（possible — 见下文「夹带的复制降级改动」）。核心 relist 链路本身无阻断性问题。

**Verdict**: APPROVED

## High-level view

reset 新语义落在 `resetRoom`：在原有归零基础上追加 `flower=''`、`crimes=[]`，保留 `code/target/members/_cleanupTimer`，语义与注释、design.md §3 一致。前端据 `flower` 空判定「待重新立牌」，不引入新 phase。

relist 是一条独立的权限/阶段受控消息：仅 `victim`、仅 `altar && flower===''` 态、flower trim 后非空才更新身份，任何不满足都按 `PHASE_REJECTED` 静默回一帧快照自愈、不下发 error，与既有 reset/set_lang 的失败口径统一。成功后 `phase` 维持 `altar` 并 `broadcastSnapshot`，神婆同步看到新小人，后续复用首次开坛的邀请→念咒→开打路径。

前端路由三条规则正确：`victim + altar + flower 空 → altar`、`victim + altar + flower 非空 → invite`、`shaman + altar（无论 flower）→ invite`（经由 shaman-waiting 子视图按 flower 空/非空切「正在重新立牌」与新小人信息）。关键细节是 reset→relist 时神婆 invite 屏的 key 与子视图都不变，`renderRoute` 挂载守卫会提前 return，作者用 `refreshShamanWaiting` 在 `room_state` 到达时就地强制重绘，补上了这个重渲染缺口。

store reset 分支显式写入 `s.flower = snapshot.flower ?? ''`、`s.crimes = ...`，绕过常规 `?? s.flower` 可能的旧值残留，reset 后 hits 仍归 0（既有分支逻辑未变）。altar 双路径按 `roomCode` 有无分流 relist/create_room，两路径都先过 `checkFlower`。

合规面保持：无 `.env`/`node_modules`/mp3 入库，`compliance.js` 未改，新增 CSS 仅用锁定四色 + ink。

<details>
<summary>Issues (2)</summary>

1. **夹带的复制降级改动** — commit 与未提交的 `theme.css` 把邀请链接复制的多级降级（clipboard→execCommand→手动复制框）一并带入，属于另一桩「复制链接不生效」缺陷，与重启需求同坛不同事；功能无害且色彩合规，但建议确认是否应单独成提交/单独评审。(possible)
2. **relist 被拒后 altar 按钮不回弹（仅对抗性客户端可达）** — altar 点击后 `createBtn.disabled=true`，若 relist 被服务端静默拒绝且 flower 仍空，苦主停在 altar 屏、`renderRoute` 因屏未变提前 return，按钮保持 disabled 不恢复。正常链路下 `validate()`（name≥1）+ 服务端 flower 非空校验一致，不可触发；仅手工构造空 flower 提交才可能。可在 relist 失败路径给按钮兜底回弹，优先级低。(possible)

</details>

<details>
<summary>Details</summary>

### reset 新语义：清空身份进入「待重新立牌」态

`resetRoom` 在原有 `hits=0 / villainStage=嚣张 / burned=false / fortune=null / lang=null / phase=altar` 基础上追加 `room.flower=''`、`room.crimes=[]`，保留 `code/target/members/_cleanupTimer`（不踢人、不换房间码）。函数注释与 design.md §3「重开一坛转移」「状态机 altar 子态」「§4.1 reset 行」同步更新，口径一致。单测 `resetRoom: 进度归零 + 清空花名/罪状进入待重新立牌态` 把旧的「保留花名/罪状」断言改为 `flower===''`、`crimes===[]`，并保留 `code==='AAAAAA'`、`members.size===2`，覆盖到位。

### relist：受控的身份重写

`handleRelist` 经 `requireRoom` 取房后依次校验三道闸：`meta.role !== 'victim'` → 静默回快照；`room.phase !== altar || room.flower !== ''` → 静默回快照；`data.flower` trim 后 `length < 1` → 静默回快照。三者都 `console.debug` 并 `singleSend(ws,'room_state',...)`，不下发 error，与 design §4.5 的 `PHASE_REJECTED` 口径一致。通过后写 `room.flower`/`room.crimes`（crimes 非数组兜底 `[]`），`phase` 维持 `altar`，`broadcastSnapshot(room,'room_state')` 同步神婆。`switch` 中 `case 'relist'` 紧邻 `reset` 注册，未误用 create_room，`makeSnapshot` 无需改（flower/crimes 本就在快照内）。

```
fortune(hits=18) --reset--> altar(flower='')  待重新立牌
                                   │ victim relist{flower,crimes}
                                   ▼
                            altar(flower≠'')   已立牌（同首次 create_room 后）
                                   │ set_lang
                                   ▼
                            chanting → beating → ...
```

集成用例覆盖了：双人 reset→relist 后两端快照 `flower==='新花名'`、`crimes===['摸鱼']`、`phase==='altar'`、`members.length===2`、`roomCode` 不变，且随后 `set_lang` 能把两端推进 `chanting`（证明后续流程续得上）；非待立牌态（刚建房 flower 非空）发 relist 只回一帧、flower 不变、`waitFor('error',300)` reject；神婆越权发 relist flower 保持空、同样不下发 error。三组分别锁住了同步、阶段闸、权限闸。

### 前端路由三态分流

`screenForState` 的 `case 'altar'`：`!flower` 时 `role==='shaman'→invite`、否则 `altar`；`flower` 非空统一 `invite`。最前置的「神婆待进房（pendingJoinRoom && !roomCode）→invite」判断保留。`inviteSubview` 把 invite 屏细分 `shaman-pending / shaman-waiting / in-room`，`renderRoute` 的 `subviewChanged` 在子视图语义切换时打破挂载守卫。

reset→relist 过程中神婆停在 `invite` 屏且子视图恒为 `shaman-waiting`（flower 空非空都归 shaman-waiting），`subviewChanged` 为 false 会提前 return，单靠路由不会重绘等待页。作者在 `room_state` handler 里对 `app.current==='invite' && role==='shaman'` 调 `refreshShamanWaiting(app)` 就地重绘，补上这个缺口——这是本次改动里最容易漏掉的一处，处理正确。`refreshShamanWaiting` 内再校验 `role==='shaman'` 与非 pending 态后才 `renderShamanWaiting`，避免误绘。

### store reset 分支显式清空 flower/crimes

reset 绕过分支（`phase==='altar' && hits===0 && s.hits>0`）内追加 `s.flower = snapshot.flower ?? ''`、`s.crimes = Array.isArray(snapshot.crimes) ? snapshot.crimes : []`。此分支本就绕过下方 `Math.max` 单调防回退并显式清 burned/fortune，现在一并清身份，使本地镜像真正进入待重新立牌态，不被常规分支的 `?? s.flower`（对空串放行但此分支根本不走常规赋值）或未赋值残留卡住旧花名。hits 归零逻辑未动，reset 后 hits=0 成立。`store.test.js` 新断言先置旧 flower/crimes 再喂 reset 快照，验证清空。

### altar 双路径开坛

`initAltar` 读 `app.store.state.roomCode`：有值发 `relist{roomCode,flower,crimes}`、无值发 `create_room`，按钮文案据此在「🔥 重新开坛/🔥 开坛」间切换。两路径的点击处理都先 `checkFlower(flower)`，命中真名则提示 return 不发送——重新立牌路径的合规红线仍在。

### 单人 vs 双人

单人：reset→苦主回 altar（flower 空、role 非 shaman）→relist（victim 校验过）→回 invite 邀请屏→set_lang 推进。双人：reset→苦主回 altar、神婆 invite 屏经 refreshShamanWaiting 显示「苦主正在重新立牌，稍候…」→relist→双端收 room_state、神婆 refreshShamanWaiting 重绘出新花名+罪状→续念咒/开打，房间码与成员不变。集成测试覆盖双人链路；单人链路由 relist victim 校验与前端路由覆盖，逻辑成立。

### 验证证据

commit message 与 plan「实现验证记录」均记录：后端 `npm test` 21 pass 0 fail（含改后 reset 单测/集成 + relist 三组）、前端 `node --test store/invite/compliance` 17 pass 0 fail、`node --check` 五个改动文件通过。按评审约定未重跑套件；窄范围抽查复核：`node --check` 五文件全过，diff 中确实存在所述的 reset 单测改写与 relist 三组集成用例，证据可信。手测（步骤 9）为运行期人工冒烟，作者明确标注未在自动化环境执行，由集成用例覆盖等价逻辑链路，可接受。

### 夹带的复制降级改动

commit 顺带引入 `invite.js` 的 `copyText`（clipboard→execCommand 两级降级）、`selectTextIn`、复制失败时的「手动复制链接框」，以及未提交的 `theme.css` `.copy-fallback` 样式。这些对应 original request 里「复制邀请链接没作用」那桩缺陷，与「重新开始」需求同一坛内但属不同关注点。功能本身无害：`escapeHtml` 对注入链接做了转义，样式仅用 `var(--liu-jin-gold)`、`rgba(20,10,31,*)`（ink）、`rgba(244,196,48,*)`（gold），落在锁定四色 + ink 内，合规。仅从评审洁净度角度建议确认是否应单独成提交。

</details>

<details>
<summary>File map</summary>

- `server/room-server.js` — `resetRoom` 追加清空 flower/crimes；新增 `handleRelist` + switch 注册 `relist`。
- `app/js/main.js` — `screenForState` altar 分支按 role+flower 分流；`room_state` 到达时对神婆 invite 屏调 `refreshShamanWaiting`。
- `app/js/store.js` — reset 绕过分支显式清空 flower/crimes。
- `app/js/screens/altar.js` — 双路径开坛（relist/create_room，均过 checkFlower）+ 按钮文案切换。
- `app/js/screens/invite.js` — `renderShamanWaiting` 支持「待重新立牌」态；新增 `refreshShamanWaiting`；顺带复制多级降级（copyText/selectTextIn/手动复制框）。
- `app/js/store.test.js` — reset 清空 flower/crimes 新断言。
- `server/room-server.test.js` — resetRoom 单测改为断言清空身份、保留成员/房间码。
- `server/room-server.integration.test.js` — relist 三组集成用例（同步+续局、非待立牌态拒绝、越权拒绝）。
- `.kiro/specs/kick-bad-guy/design.md` — §3 状态机 + §4.1/§4.5 协议同步 reset 新语义与 relist。
- `app/css/theme.css`（未提交）— 新增 `.copy-fallback` 样式，四色合规。

完整 diff：`git -C 1-kickbadguy show 49be18b`

</details>
