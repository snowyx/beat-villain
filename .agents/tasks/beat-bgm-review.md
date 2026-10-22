# 代码评审 — 开打阶段循环 BGM + 同步滚动字幕（纯前端）

- **评审对象提交**：`15a38df` `feat: 开打阶段循环 BGM + 同步滚动字幕（纯前端）`
- **计划**：`.agents/tasks/beat-bgm-plan.md`
- **评审结论**：APPROVED（无阻断性发现）

## 证据来源
- 已读 coder 的验证记录 `.agents/tasks/beat-bgm-verification.md` 与提交说明：后端 `npm test` 15/15、前端 `compliance.test.js` 8/8、两个 JS 文件 `node --check` 0、`curl -I /assets/audio/beat-bgm.mp3 → 200 audio/mpeg 312068B`、agent-browser 经真实 WS 协议驱动到开打阶段的 (a)(b)(c)(d) 观测、控制台 0 错误。验证证据完整，按要求未重跑测试套件。
- 我做的窄范围核对（非重跑测试）：hex 调色板集合 before/after 比对、字幕逐字 byte-diff、audio.js/main.js 生命周期源码阅读、git 跟踪状态核对。

## 逐项核对

### BGM 生命周期（audio.js）
- `startBeatBgm`：`if (bgmEl) return bgmEl` 幂等，避免双挂载叠音；`new Audio('assets/audio/beat-bgm.mp3')`、`loop=true`、`volume=0.6`；`play().catch(()=>{})` 吞掉 autoplay 拒绝，无未捕获错误路径；构造异常 `catch { bgmEl=null }`。✓
- `stopBeatBgm`：`pause()` + `currentTime=0` + `src=''` + `bgmEl=null`，暂停+归零+断源+丢引用，无泄漏、无叠音。✓
- `teardownBeat`（beat.js）调用 `stopBeatBgm(); app._beatBgm=null; clearInterval(_beatSubtitleTimer)`；经 `main.js` 核实 `renderRoute()→teardownCurrent()→case 'beat': teardownBeat` 在**每一次**离开开打屏（化灰 burning / 签文 fortune / 任何重路由/断连）都会执行，为唯一且必经的清理钩子。✓
- **BGM 与 playSmack 不互相打断**：BGM 为独立 HTMLAudioElement，`playSmack` 走 WebAudio `audioCtx` 合成，二者不共享节点。✓
- **BGM 与 playSpell 不叠音**：BGM 仅在开打屏存在；`playSpell` 仅在念咒屏（chanting）；分属不同屏，不可能并存。`playSpell` 逻辑本体未改。✓

### 字幕
- 四行粤语经文经 byte-level `diff` 与要求文本比对 → **IDENTICAL（逐字一致）**。✓
- 高亮由 `setInterval(…, LINE_MS=2800)` 逐行轮转 `(subIdx+1)%subLines.length`，`teardownBeat` 中 `clearInterval` 清理，无悬挂定时器。✓
- 字幕块位于 `.progress` 与 `.bottom-bar` 之间的正常流中，不覆盖 `#villain-stage` 画布或开打按钮（验证记录实测 subTop=437 > stageBottom=399，btnTop=565 > subBottom）。✓

### 合规与风格
- **调色板**：`theme.css` 的 hex 集合在本次改动 before(HEAD~1) 与 after 完全一致（`#140A1F #7CFF9E #A24BFF #E23A3A #F4C430 #c01f1f #d99e10 #d9c7ff #e9d9ff #f3e6c8 #fff`），未引入任何新具名 hex；新增 `.beat-subtitles/.beat-sub-line/.beat-sub-line.on` 仅引用四个锁定 `var(--…)` + 既有中性色 `#fff` 与 `rgba(243,230,200,…)`（即既有 `#f3e6c8` 正文色的低透明度）。符合四色锁定。✓
- **三红线**：`compliance.js` 花名拦截未触碰；`--zhu-sha-red` 仅作文字霓虹辉光非血腥；改动限 `#screen-beat` 内，民俗定位 footer 未动。✓
- **iter3 未破坏**：`villain.js`/`altar.js`（神婆开坛法事页、鞋拔子挥击、部位反应）未在 diff 中；后端 15/15、合规 8/8 回归绿。✓

### 部署卫生
- `app/assets/audio/beat-bgm.mp3` 已被 git 跟踪（`git ls-files` 确认，312068B）。✓
- 未提交 `.env`（仅 `.env.example`）或 `node_modules`。✓
- 本次提交仅含 4 文件（verification.md、beat-bgm.mp3、theme.css、audio.js、beat.js），无临时垃圾文件进入提交。✓

## 非阻断性观察（不要求修改）
1. **CSS 全文件重排**：`theme.css` 的 diff 远超计划的"仅开打段"，整文件做了纯空白/格式化重排。经 hex 集合比对证明**未改任何颜色、未改任何功能**，属纯样式格式化，不构成正确性/安全/数据问题。仅记录，非阻断。文件末尾无换行（`\ No newline at end of file`）为合法 CSS，无影响。
2. **`MP3_PATH` 由 `../assets/` 改为 `assets/`**：该常量被 `playSpell` 的 mp3 分支共用。改动属路径修正（模块相对 URL 实际按文档 base 即 app 根解析，`../assets/` 会解析到 app 根之上而出错；`assets/` 才正确），与新 BGM 路径一致。`playSpell` 控制流本体未变，验证记录 curl 证实 app 根下 `/assets/audio/` 可达 200。非阻断。
3. **工作区存在未提交/未跟踪文件**（`app/js/config.js` 已修改、根目录散落源 `.mp3`、未跟踪的 `spell-*.mp3` 等）：均**不属于本次被评审提交**，系前序迭代（配音任务）遗留的工作区状态，不在本任务范围内。本任务要求的 `beat-bgm.mp3` 已跟踪即满足部署要求。非阻断。

## 阻断性发现
无。
