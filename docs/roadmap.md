# Roadmap

> Related: [strategy](06-product/strategy.md), [goals-nongoals](00-overview/goals-nongoals.md), [claude integration](05-claude-integration/claude-code-hooks.md), [ADR-0004](adr/0004-reply-via-blocking-hook.md)

This roadmap fixes the implementation order and exit criteria. It is a dependency order, not a date commitment.

## Phase 0 — Lock down evidence and skeleton

| Item | Deliverable | Exit |
|---|---|---|
| Docs-as-code complete | 05, 06, roadmap, ADR 0002–0004 | All internal links pass |
| Official hook smoke plan | `PermissionRequest` allow/deny/no-decision test cases | The test procedure is documented before implementation |
| Visual evidence organized | `refs/screens/` + open questions | Verified/Inferred labels separated |

Remaining capture gaps:

| Gap | Current state | Action needed |
|---|---|---|
| error card/icon | Not observed in current footage | Deliberately trigger one error in Claude/Codex, then capture |
| clock/waiting icon | Not observed in current footage | Hold the permission/waiting state long enough to capture |
| pet drag | Not observed in current footage | A short recording of dragging the pet directly |
| 4+ stack shown at once | `+1` overflow is confirmed; 4 shown at once is not observed | Create 4+ sessions at once and record the stack/overflow |

## Phase 1 — macOS MVP

| Stream | Work | Exit |
|---|---|---|
| Shell | Electron transparent/frameless/always-on-top window | The bottom-right pet overlay toggles between click-through/interactive mode |
| Asset loader | `pet.json` + `spritesheet.webp` native load | `refs/sample-pet/nezu` renders without conversion |
| State server | `/healthz`, `/state`, session store | Card state updates from mock hook events |
| Claude hooks | settings installer/uninstaller | Real Claude Code emits `UserPromptSubmit`, `PreToolUse`, `Stop` |
| Transcript tail | Stop body extraction | Card body fills with the last assistant text |
| Card UI | Codex-style stack, spinner/check, `+N`, hover, expand, close | Passes visual QA against `refs/screens/` |
| Reply | `/permission` hold/resolve | allow/deny/message handles a real Claude Code permission |

Phase 1 exit:

- With the app off, there is no effect on Claude Code's behavior.
- The `nezu` pet and the card stack are sufficiently similar to the Codex recordings.
- For both single-session and multi-session, cards update stably per `session_id`.
- Answering a permission prompt with a card reply makes Claude Code proceed.

## Phase 1.1 — Stabilization and platform validation

| Work | Exit |
|---|---|
| Review macOS packaging/signing/notarization | A draft install/update procedure |
| Windows transparent/click-through spike | Determine whether BrowserWindow + native adjustment is needed |
| Linux X11/Wayland spike | Document the supportable scope |
| Hook migration tests | Preserve existing `settings.json`, prevent duplication |
| Crash recovery | Clean up stale permissions/cards on server restart |

## Phase 2 — Ecosystem features

| Work | Decision criterion |
|---|---|
| Pet picker | Needed when there are multiple pets under `~/.codex/pets/` |
| Petdex/gallery integration | Needed when the user does not know the install path |
| Optional pet events | Apply once the `pet.json animation.events` proposal stabilizes |
| Additional agents | Considered only after the Claude Code MVP is stable |
| Hatch/generation | Discussed separately so as not to clash with OpenAI Codex's `$hatch-pet` |

## Release gates

| Gate | Must pass |
|---|---|
| Official docs check | Re-confirm whether the Anthropic/OpenAI docs changed |
| No-decision behavior | Confirm native fallback when the app is absent / under DND / on timeout |
| Visual QA | No text overlap on desktop + narrow viewport |
| Provenance audit | Confirm there is no file-level copy of third-party source |
| Link check | All internal relative links in docs exist |
