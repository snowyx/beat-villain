# Implementation Plan — 开打阶段循环 BGM + 同步滚动字幕（纯前端）

## Context & decisions (grounded in the code I read)

- **Scope**: FRONTEND ONLY. No backend/protocol/state-machine change. Touch exactly three files: `app/js/audio.js`, `app/js/screens/beat.js`, `app/css/theme.css`. Do NOT change `playSpell`, `compliance.js`, villain physics, or any `server/` file.
- **Lifecycle guarantee (verified in `app/js/main.js`)**: `renderRoute()` → `teardownCurrent()` → `case 'beat': teardownBeat(app)` runs on EVERY leave of the beat screen — beating→burning (`ash`), fortune, and any re-route/disconnect. So putting all BGM + subtitle cleanup inside `teardownBeat(app)` is sufficient to guarantee no leak/overlap. Mirror the existing handle convention: beat stores `app._beatHitUnsub` / `app._beatStageUnsub` / `app._beatStoreUnsub` and nulls them in teardown; add `app._beatBgm` and `app._beatSubtitleTimer` the same way.
- **Audio decision — use a dedicated HTMLAudioElement, NOT WebAudio**: `audio.js`'s `unlockAudio()`/`audioCtx` is a WebAudio context used only to synthesize `playSmack`. BGM is a long MP3 file best played via `new Audio(...)` with `loop=true`; this is fully independent from the WebAudio SFX graph, so BGM and `playSmack` never share nodes and cannot cut each other off. Rationale: separate element = separate volume + independent lifecycle, and matches how `playSpell` already loads MP3s via `new Audio(MP3_PATH(lang))`.
- **BGM path**: runtime-relative to app root, consistent with `MP3_PATH = (lang) => \`assets/audio/spell-${lang}.mp3\``. BGM file is at `app/assets/audio/beat-bgm.mp3` (already staged by the asset-prep step) → runtime path string `assets/audio/beat-bgm.mp3`.
- **Volume**: `0.6` (moderate) so it does not drown out the synthesized `playSmack` hit SFX.
- **Autoplay policy**: entering beat is normally triggered by the user clicking 开打 (gesture chain carries). Still call `app.audioUnlock()` on mount and `.catch()` the `play()` promise so a blocked autoplay never throws an uncaught error; the subtitle highlight loop runs regardless of whether audio actually started (it is a fixed-beat timer, not bound to audio events).
- **Subtitle sync decision — fixed-beat timer, not per-char audio alignment**: there are no per-line timestamps. BGM is ~19.5s; four lines. Use a `setInterval` at a fixed cadence to advance the highlighted line, looping `(i+1) % 4`. Chosen cadence: **2800ms per line** (4 × 2800 = 11.2s highlight cycle; keeps a lively karaoke rotation and loops seamlessly under the looping BGM). Define as a single `const LINE_MS = 2800;` so it is trivial to retune. The timer is independent of audio load success (ritual feel still works if autoplay is blocked).
- **Subtitle text — CHARACTER-FOR-CHARACTER UNCHANGED** (do not alter any character). Store as a frozen array:
  ```
  打你个小人头 等你成世 冇出头
  打你个小人手 等你成日 做小偷
  打你个小人脚 等你成世 冇得走
  打你个小人身 等你成世 冇运番
  ```
- **Placement decision**: a subtitle bar **below the progress bar, inside `.beat-card`, above/around the `.bottom-bar`** — it must NOT overlap `#villain-stage` (the canvas + click interaction) nor the 开打 button. The `.villain-stage` is `46dvh`/min 300px and the bottom bar is absolutely positioned at `bottom:16px`; the card already has `min-height:60dvh`. Insert the subtitle block in normal flow between `.progress` and `.bottom-bar` so it occupies the gap and never sits on the canvas. (If vertical space is tight on 375px, the bar uses small line-height and only the four short lines; acceptable.)
- **Palette lock (steering 视觉风格.md)**: use ONLY the four CSS variables already in `:root` — `--zhu-sha-red #E23A3A`, `--liu-jin-gold #F4C430`, `--neon-purple #A24BFF`, `--ink #140A1F`. Reference variables, never hardcode new hex. Reuse the existing neon multi-layer `text-shadow` idiom (see `.neon-title` / `.rite-status`). Highlighted line glows gilt-gold/cinnabar neon; dim lines use low-alpha of the existing `#f3e6c8` body text or a dimmed palette var via `rgba()` of an existing channel — do NOT introduce a 5th named color.
- **Compliance (民俗合规.md) — all three red lines untouched**: (1) 花名拦截 logic in `compliance.js` is not touched; (2) no blood/gore — subtitles are folk-incantation text and `--zhu-sha-red` is used only for neon glow/UI, never as blood; (3) folk-positioning footer stays intact (we edit inside `#screen-beat`, not the footer). The incantation is folk-culture presentation = compliant.
- **Testing reality**: there is NO DOM/browser test runner in this repo (no root `package.json`/vitest). Automated tests are backend (`cd server && npm test`) and the frontend compliance pure-function unit test (`node --test app/js/compliance.test.js`) — neither exercises `beat.js`/`theme.css`. So verification for this change = (a) `node --check` syntax gate on the two changed JS files, (b) confirm the two existing test suites still pass (regression guard, must not break iter3 work), and (c) a manual browser smoke run. Grep is only used for the palette/red-line audit, not as functional verification.

---

# Implementation Plan

- [ ] 1. Add a BGM helper pair to `app/js/audio.js`.
      Add module-scoped `let bgmEl = null;` and export two functions:
      `export function startBeatBgm({ volume = 0.6 } = {})` — if `bgmEl` already exists, return it (idempotent, avoids overlap on a double-mount); otherwise `bgmEl = new Audio('assets/audio/beat-bgm.mp3'); bgmEl.loop = true; bgmEl.volume = volume;` then `bgmEl.play().catch(() => {})` (swallow autoplay rejection, no uncaught error); return `bgmEl`.
      `export function stopBeatBgm()` — if `bgmEl`: `bgmEl.pause(); bgmEl.currentTime = 0; bgmEl.src = ''; bgmEl = null;` (pause + reset + drop reference so no leak/overlap). Do NOT touch `playSpell`, `playSmack`, `unlockAudio`, or `audioCtx`.
      Files: `app/js/audio.js`
      Verify: `node --check app/js/audio.js` exits 0 (no syntax error).

- [ ] 2. Add the subtitle DOM + CSS classes in `app/css/theme.css`, under the `── 开打屏 ──` section, using ONLY the four palette CSS variables.
      Add: `.beat-subtitles` (the scripture/karaoke bar — flow element, centered, small top/bottom margin, dashed gilt border like `.spell-box`/`.rite-altar`, dark `rgba` of `--ink` background, `line-height` compact so four lines fit); `.beat-sub-line` (dim resting state — color `rgba(243, 230, 200, 0.4)` i.e. low-alpha of the existing body text, subtle; `transition` for smooth highlight; `font-family: var(--kai)`); `.beat-sub-line.on` (the highlighted line — white text with the existing multi-layer neon `text-shadow` idiom glowing `--liu-jin-gold` + `--zhu-sha-red`, optional faint `--neon-purple` outer layer; slightly larger/scale). Reuse the existing `@keyframes glow`/`riteGlow` style of shadow; you MAY add one small `@keyframes` for the highlighted line but keep it to this one element only (steering: breathing animation on few key elements only). No new hex colors.
      Files: `app/css/theme.css`
      Verify: `grep -nE '#[0-9A-Fa-f]{3,6}' app/css/theme.css` shows NO hex other than the four locked values in `:root` (`#E23A3A`/`#F4C430`/`#A24BFF`/`#140A1F`) plus the pre-existing `#fff` / `#f3e6c8` / `#7CFF9E` / `#c01f1f` / `#d99e10` / `#d9c7ff`/`#e9d9ff` that already existed before this change — i.e. your diff adds no new hex literal. Confirm the four `var(--…)` names are the only colors your new rules reference.

- [ ] 3. Mount BGM + subtitles in `initBeat(app)` of `app/js/screens/beat.js`.
      (a) In the template string, insert the subtitle block in normal flow between the `<div class="progress">…</div>` and the `<div class="bottom-bar">…</div>` so it never overlaps `#villain-stage` or the 开打 button:
      `<div class="beat-subtitles" id="beat-subtitles">` containing four `<div class="beat-sub-line">`…`</div>` in order, text taken CHARACTER-FOR-CHARACTER from the four lines above (these are fixed folk text, not user input, so no `escapeHtml` needed, but they contain no HTML-special chars anyway).
      (b) Import `startBeatBgm, stopBeatBgm` from `../audio.js` (add to the existing `import { playSmack } from '../audio.js';`).
      (c) After the existing `renderCount();` wiring, call `app.audioUnlock();` then `app._beatBgm = startBeatBgm({ volume: 0.6 });`.
      (d) Grab the four line nodes (`el.querySelectorAll('.beat-sub-line')`), define `const LINE_MS = 2800;` and a local `let subIdx = 0;` plus a `highlight(i)` that toggles `.on` on line `i` and off the others; call `highlight(0)` immediately, then `app._beatSubtitleTimer = setInterval(() => { subIdx = (subIdx + 1) % 4; highlight(subIdx); }, LINE_MS);`.
      Files: `app/js/screens/beat.js`
      Verify: `node --check app/js/screens/beat.js` exits 0.

- [ ] 4. Clean up BGM + subtitle timer in `teardownBeat(app)` of `app/js/screens/beat.js` — the single guaranteed leave hook.
      Add to the existing teardown body (which already stops the villain and unsubscribes): `stopBeatBgm(); app._beatBgm = null;` and `if (app._beatSubtitleTimer) { clearInterval(app._beatSubtitleTimer); app._beatSubtitleTimer = null; }`. This guarantees on any leave (beating→burning/ash, fortune, disconnect, re-route) the audio is paused + reset + dereferenced and the timer is cleared — no leak, no overlapping playback if the screen is ever re-entered.
      Files: `app/js/screens/beat.js`
      Verify: `node --check app/js/screens/beat.js` exits 0, AND `grep -n 'stopBeatBgm\|_beatSubtitleTimer' app/js/screens/beat.js` shows both are referenced in teardown (cleanup wired).

- [ ] 5. Regression guard — confirm nothing else broke (iter3 witch-ritual page, shoehorn swing, body-part reactions live in `villain.js`/`altar.js` which are NOT touched).
      Files: none (verification only)
      Verify: `cd server && npm install && npm test` passes all 15 backend items; `node --test app/js/compliance.test.js` passes all 8 compliance items. Both are untouched suites and must stay green (these are what the save hook runs).

- [ ] 6. Manual browser smoke run (no DOM test harness exists, so this is the functional check).
      Start backend `cd server && npm start` (terminal 1) and frontend `cd app && python3 -m http.server 5173` (terminal 2); open two tabs per README demo flow, advance to the 开打 (beating) screen. Confirm: BGM starts looping on entry at a moderate volume, the four Cantonese lines render below the progress bar without covering the villain canvas or the 开打 button, the highlighted line rotates ~every 2.8s in a loop with gilt/cinnabar neon glow, hitting still plays the `playSmack` 啪 SFX audibly over the BGM, and advancing to 化灰 (burning/ash) STOPS the BGM immediately (no overlap into the ash screen) and the highlight timer stops. Check the browser console for zero uncaught errors (autoplay rejection must be silently caught).
      Files: none (verification only)
      Verify: all the above observed; browser console shows no uncaught errors.

---

## Red-line / palette audit checklist (how I verify compliance)

- **Palette (4 colors only)**: step 2's grep gate — the diff introduces no new hex literal; all new color references use `var(--zhu-sha-red|--liu-jin-gold|--neon-purple|--ink)` (plus already-present neutral `#fff`/`#f3e6c8` body text). Visual check in step 6 confirms the gilt-gold/cinnabar neon look.
- **Red line 1 (不诅咒真人 / 花名拦截)**: `compliance.js` is not in the file list — untouched. Subtitles are fixed folk-incantation text, not user花名, and are never spoken by `playSpell` (we don't touch `playSpell`).
- **Red line 2 (无血腥)**: no wounds/blood/gore added; `--zhu-sha-red` used only as neon glow on text, never as blood; villain canvas/physics untouched.
- **Red line 3 (民俗定位标注)**: edits are confined inside `#screen-beat`; the footer compliance line in `index.html` is untouched. The incantation is folk-culture presentation = compliant.

## Assumptions
- BGM duration ~19.5s and the fixed 2.8s/line cadence are intentionally decoupled (fixed-beat ritual feel, per the task — no precise per-char alignment required). If the music file differs in length it does not matter: `loop=true` on audio and the independent interval both loop on their own.
- No new test harness is introduced; this repo has no frontend DOM runner by design (零构建). `node --check` + the two existing suites + manual smoke is the project's actual verification path.
