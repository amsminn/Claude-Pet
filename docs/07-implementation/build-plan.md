# 07. Implementation Build Plan (research-backed)

> Basis: primary-source deep research (2026-06-14). 24 sources → 113 claims extracted → top 25 adversarially verified across 3 votes → **21 confirmed / 4 killed**. Each fact is labeled `Verified` (verified) / `Inferred` (unverified).
> Related: [roadmap](../roadmap.md) · [01 Architecture](../01-architecture/overview.md) · [03 State Engine](../03-state-engine/state-machine.md) · [04 Pet/Card UI](../04-pet-ui/pet-and-cards.md) · [05 Claude Integration](../05-claude-integration/claude-code-hooks.md) · [ADR-0001](../adr/0001-electron-over-tauri.md) · [ADR-0004](../adr/0004-reply-via-blocking-hook.md)
>
> **v1 scope = Phase 0 → Phase 2** (floating pet + status cards + inline reply/permission response). Phases 3–4 are v2+.
> The design is **locked** in [`prototype/`](../../prototype/README.md) — this plan ports that look into Electron and wires it to real Claude Code/Codex assets.

---

## 0. Implementation grounds confirmed by research `Verified`

The facts in this table guarantee that no blocking unknowns remain (verification passed).

| Area | Confirmed fact | Primary source |
|---|---|---|
| **Pet window (non-activating panel)** | Electron `BrowserWindow({type:'panel'})` (shipping) applies `NSWindowStyleMaskNonactivatingPanel` → **does not steal app focus**, **floats over fullscreen apps**, and **shows on all Spaces**. The Sonoma 14 focus bug is fixed in Electron 28+ | [electron#34388](https://github.com/electron/electron/pull/34388), [base-window-options](https://www.electronjs.org/docs/latest/api/structures/base-window-options), [electron#40307](https://github.com/electron/electron/pull/40307) |
| **Click-through (partial interaction)** | `setIgnoreMouseEvents` **applies globally to the whole window** → to make only the pet hit area clickable, **toggle dynamically** by cursor position: default `(true,{forward:true})`, and `(false)` over the pet. Renderer `mouseenter/leave` → IPC. `forward` **works on macOS too** (refutes 0-3) | [electron#23042](https://github.com/electron/electron/issues/23042), [window-customization](https://www.electronjs.org/docs/latest/tutorial/window-customization) |
| **(pitfall)** | A purely transparent window **no longer passes clicks through automatically** (regressed in v7.0.0b5, broken 6.1.9→8.x+). The toggle recipe above is **mandatory** | [electron#23042](https://github.com/electron/electron/issues/23042), [loomhq/ElectronMacOSClickThrough](https://github.com/loomhq/ElectronMacOSClickThrough) |
| **(fallback)** | If richer non-activating focus is needed, the native addon `electron-panel-window` (`makePanel`/`makeKeyWindow` = focus without activating the app). However, the original package is unmaintained past Electron ~21.x → a maintenance fork would be needed. **The default is the built-in `type:'panel'`** | [qazbnm456/electron-panel-window](https://github.com/qazbnm456/electron-panel-window) |
| **Hook registration** | The `hooks` object in `settings.json` is keyed by event name, with matcher groups (`"Edit\|Write"` or regex `mcp__.*`) + a `hooks` array. Five handler types: `command`/`http`/`mcp_tool`/`prompt`/`agent`. Scope is by file location (`~/.claude/settings.json`=global) | [code.claude.com/docs/hooks](https://code.claude.com/docs/en/hooks), [anthropic hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide) |
| **Hook receive (http)** | The native `http` handler POSTs the event JSON to a URL (e.g. `http://localhost:8080/hooks/pre-tool-use`). **To block, return 2xx + a JSON body** (a status code alone cannot block). **non-2xx/timeout/connection failure = non-blocking error → execution allowed**. fire-and-forget = return 2xx and ignore the body | [hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide) |
| **Blocking reply ① PreToolUse** | **Flat** `hookSpecificOutput.permissionDecision: allow\|deny\|ask\|defer` (+`updatedInput`). **Works even under headless `-p`**. A deterministic gate | [hooks](https://code.claude.com/docs/en/hooks), [cc#39344](https://github.com/anthropics/claude-code/issues/39344) |
| **Blocking reply ② PermissionRequest** | **Nested** `decision.behavior: allow\|deny` (+`updatedInput`, plus `setMode` in `updatedPermissions`). Emitted right before the permission dialog appears. **Interactive only — not emitted under `-p`** | [hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide), [hexdocs PermissionRequest](https://hexdocs.pm/claude_code/ClaudeCode.Hook.Output.PermissionRequest.html) |
| **command hook exit codes** | exit 0 = process stdout JSON, exit 2 = block (for PreToolUse, blocks the tool call and passes stderr to Claude), other = non-blocking (including exit 1) | [hooks](https://code.claude.com/docs/en/hooks) |
| **Asset atlas contract** | **1536×1872**, **8 columns × 9 rows**, **192×208 cells**. The 9 rows map to a per-state ordering (idle, running-right, running-left, waving, jumping, failed, waiting, running, review), up to 8 frames per row, PNG/WebP · transparent, with **fully transparent empty cells** (→ the documented approach for the `autoDetectFrames` scan) | [hatch-pet SKILL.md](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md), [crafter-station/petdex](https://github.com/crafter-station/petdex) |
| **Timing** | Frame counts, timing, sequence chaining, and event triggers are **hardcoded in the Codex renderer** (not the manifest). Defaults are ~**1100ms / 6 frames per state**. Active states play once and then return to idle | [petdex](https://github.com/crafter-station/petdex), [codex#23272](https://github.com/openai/codex/issues/23272) |
| **animation field** | The `animation` field of `pet.json` (= [codex#20863](https://github.com/openai/codex/issues/20863)) is an **open and unmerged** backward-compatible proposal. The shipping `pet.json` has only `{id, displayName, description, spritesheetPath}` | [codex#20863](https://github.com/openai/codex/issues/20863), [hatch-pet SKILL.md](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md) |

**Three boundary questions resolved:** (a) blocking reply is **confirmed in two forms split by version** — PreToolUse (flat, headless) and PermissionRequest (nested, interactive). (b) the `animation` field is **confirmed unmerged** → the atlas contract is the only shipping surface. (c) click-through + non-activating pet window is a **confirmed, verified recipe**.

## 0.1 Not confirmed by docs → Phase 0 empirical spike mandatory `Inferred`

The research explicitly warns: the following are not confirmed by primary docs, so **measure them for real** before depending on them.

1. **Actual payload per event** — The claim that "every hook commonly provides `session_id/transcript_path/cwd/...`" was **refuted as over-specification (0-3)**. Capture each event's payload directly (PreToolUse/PostToolUse/Notification/Stop/SessionStart/PermissionRequest) and confirm field presence.
2. **Transcript JSONL path/line structure** (`~/.claude/projects/...`) — For card-body extraction. Unverified → confirm against actual files.
3. **Sprite 60fps technique** — rAF canvas blit vs CSS `steps()`/`background-position` (+`image-rendering:pixelated`). The low-CPU limit for multiple pets is unverified → decide by measurement.
4. **`--ui-scale` injection path** — Read and inject `screen.getDisplayNearestPoint().scaleFactor` + the macOS accessibility text size (`systemPreferences`/CSS `env(preferred-text-scale)`), reacting to live display/accessibility changes. Unverified → spike.

---

## Phase 0 — Skeleton, assets, design port (de-risk)

> Goal: **prove the two hard constraints first** — (1) does the non-activating, click-through pet window actually work, and (2) does the locked design come out pixel-faithful in Electron. Driven by fake events, before hook integration.

| Stream | Work | Basis |
|---|---|---|
| Scaffold | Electron main/renderer/preload, **Electron version pin** (≥28, including the panel focus fix), contextIsolation on | §0 Pet window |
| Pet window | `type:'panel'` + `transparent:true` + `frame:false` + `hasShadow:false` + `alwaysOnTop` (screen-saver level) + `visibleOnAllWorkspaces`. Bottom-right placement, multi-monitor (`screen` API) | §0 Pet window |
| Click-through | Default `setIgnoreMouseEvents(true,{forward:true})`; renderer `#widget` hover → toggle to `(false)` via IPC | §0 Click-through |
| Asset loader | `~/.codex/pets/<slug>/` discovery → parse `pet.json` (shipping 4 fields) → load spritesheet (webp/png) → atlas constants (8×9 · 192×208) + **`autoDetectFrames`** (transparent-cell scan) → state→9-row map. The `animation` field is **ignored if present (future-only)** | §0 Assets |
| Design port | Port [`prototype/`](../../prototype/README.md)'s HTML/CSS/JS into the renderer **as-is** (card flex `order` reorder, top scroll fade, card `flex:none` growth, `--ui-scale` token). Reproduce the 4 scenarios with a fake event engine | [04 Pet/Card UI](../04-pet-ui/pet-and-cards.md) |
| Spike | Measure §0.1 items (especially the sprite technique and `--ui-scale` reads) | §0.1 |

**Exit:** launching the app shows the nezu pet (no asset conversion) at the bottom-right + a fake-scenario card stack that **passes visual QA against `prototype/`**. Only the pet area is clickable while the rest passes through, focus isn't stolen, and it shows over fullscreen/multi-Space.

## Phase 1 — State engine (read-only)

> Goal: a pet+card that reacts to real Claude Code activity (thinking, tool execution, completion, notification, error). **No replies.**

| Stream | Work | Basis |
|---|---|---|
| Local server | Main-process loopback HTTP server (`/healthz`, `/state`). `/state` always responds fast with 204 (fire-and-forget) | [05 §5](../05-claude-integration/claude-code-hooks.md) |
| Hook installer | Register an **`http` hook** in `settings.json` (idempotent, preserves existing hooks, uninstallable). localhost POST per event | §0 Hook registration |
| **Payload spike** | **Capture each event's actual payload** before fixing the mapping (don't trust the documented schema) | §0.1-1 |
| State mapping | EVENT_TO_STATE → pet atlas row + card create/update. The authoritative document = [03 state-machine](../03-state-engine/state-machine.md). **Validate event names against the pinned version's official list** | [03](../03-state-engine/state-machine.md) |
| Transcript tail | After the **JSONL path/structure spike**, put the last assistant text into the card body at Stop (cap clamp · redaction) | §0.1-2 |
| IPC | Server (main) → renderer state push; the renderer reuses the `prototype` render logic | — |

**Exit:** with the app off, zero impact on Claude Code. Both single- and multi-session cards update stably per `session_id`. The pet row transitions according to state. The card body is populated with the real last assistant text.

## Phase 2 — Interaction (reply/permission) — **v1 finish line**

> Goal: real permission decisions from the card via allow/deny + a short message. A high-risk, version-sensitive section.

| Stream | Work | Basis |
|---|---|---|
| Reply UI | Enable the locked design's inline reply (white input + blue focus + gray send pill) | [04 §5.2](../04-pet-ui/pet-and-cards.md) |
| Permission gate (primary) | **Interactive**: hold the `PermissionRequest` http hook → decide in the card UI → return **nested** `{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"\|"deny"}}}` as 2xx | §0 Reply② / [ADR-0004](../adr/0004-reply-via-blocking-hook.md) |
| Permission gate (headless) | Under `-p`, PermissionRequest is not emitted → handle via **`PreToolUse`** flat `permissionDecision` (a separate path) | §0 Reply① |
| Safeguard | **No response/timeout/DND = no-decision** (no synthesizing allow/deny). Since http failure = non-blocking, **confirm via smoke test** whether failure means "auto-allow vs. return to native prompt." Avoid `bypassPermissions` → `acceptEdits` | §0 Hook receive, [#49525](https://github.com/anthropics/claude-code/issues/49525) |
| Bug avoidance | Test known hook bug paths: deny not applied (MCP, [#33106]), ask overriding deny ([#39344]), allow not blocking the prompt ([#52822]) | cc issues |

**v1 Exit (release gate):** on a real `PermissionRequest`, card `allow` advances and `deny` rejects. The native prompt fallback is alive under app absence/DND/timeout (zero accidental auto-approvals). The key injection API is **not used** on the reply path (code review).

## Phase 3 — System fidelity and polish (v2)

`--ui-scale` injection (scaleFactor + accessibility, live reaction) · finalized sprite perf (apply the rAF vs CSS steps measurement result) · multi-monitor/drag/edge cases · pet picker (multiple pets).

## Phase 4 — Packaging and distribution (v2)

electron-builder macOS code signing + notarization · DMG/zip · auto-update (electron-updater) · always-on-top/accessibility permission prompts · Windows/Linux click-through/transparent-window spike.

---

## Risk register (based on research caveats)

| Risk | Impact | Mitigation |
|---|---|---|
| **Rapidly changing hook API** (v2.1.x, 2026-06) — `defer` was once undocumented, `bypassPermissions` dropped in 2.1.110+ | The shape may break at build time | **Pin the Claude Code version** + re-validate the `hookSpecificOutput` shape live at build time. Ban `bypassPermissions` |
| **Over-specified documented payload** (refuted) | Depending on wrong fields | Depend only after capturing the actual per-event payload (Phase 0.1-1) |
| **Unverified transcript structure** | Broken card body | Confirm the path/line structure against real JSONL (Phase 0.1-2) |
| **Click-through regression/misinformation** | The pet window is unclickable or fully blocked | Use only the verified recipe (`type:'panel'` + `setIgnoreMouseEvents(true,{forward:true})` + toggle). The claims "native auto pass-through" and "forward is Windows-only" are **refuted — do not depend on them** |
| **panel addon maintenance** | Broken build | Prefer the built-in `type:'panel'`. Use the addon only as a maintenance fork when non-activating focus is strictly required |
| **Asset timing depends on a secondary source** (1100ms/6fps) | Subtle animation differences | Diff against the real `~/.codex/pets/<slug>/` assets and then fix it in the renderer |
| **animation field may merge in the future** | Future compatibility | Design the atlas layer to be additive → adopt it as an option if merged |

## Sources (verification-passing core)

Electron: [#34388](https://github.com/electron/electron/pull/34388) · [#23042](https://github.com/electron/electron/issues/23042) · [#40307](https://github.com/electron/electron/pull/40307) · [window-customization](https://www.electronjs.org/docs/latest/tutorial/window-customization) · [electron-panel-window](https://github.com/qazbnm456/electron-panel-window) · [loomhq click-through](https://github.com/loomhq/ElectronMacOSClickThrough)
Claude Code: [hooks](https://code.claude.com/docs/en/hooks) · [hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide) · [cc#39344](https://github.com/anthropics/claude-code/issues/39344) · [cc#41791](https://github.com/anthropics/claude-code/issues/41791)
Codex assets: [codex#20863](https://github.com/openai/codex/issues/20863) · [hatch-pet SKILL.md](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md) · [petdex](https://github.com/crafter-station/petdex) · [codex#23272](https://github.com/openai/codex/issues/23272)
