# Product Strategy

> Basis: official OpenAI/Anthropic docs, [`refs/codex-pet-ux-teardown.md`](../../refs/codex-pet-ux-teardown.md), [`refs/README.md`](../../refs/README.md)
> Related: [vision.md](../00-overview/vision.md), [goals-nongoals.md](../00-overview/goals-nongoals.md), [roadmap](../roadmap.md), [ADR-0002](../adr/0002-backend-clean-room.md)

Claude-Pet's market position is narrow but sharp.

> **A Codex-pet-faithful desktop companion for Claude Code users.**

The center of the strategy is not building yet another "pet that shows status," but bringing the Codex App's pet/card overlay experience to Claude Code.

## 1. The market gap

Existing attempts stop at one of three things.

- **(a) Status pet overlay** — Shows agent status cross-platform, but with low Codex card/pet UI fidelity (its own UI). *Implementation is proven, but the UX is different.*
- **(b) Codex-asset-compatible overlay** — Renders pets from `~/.codex/pets/`, but **has no card stack or inline reply, and is macOS-centric**. *The problem framing is close, but it's incomplete.*
- **(c) Pet gallery/add-on** — Merely content/ecosystem, not a runtime overlay. *Content is proven.*

→ Proven implementations (a) and proven content (c) exist in the market, but the spot that satisfies all three beats **at once** — **"Claude Code + Codex-faithful UX + native Codex asset"** — is empty. That spot is Claude-Pet.

## 2. Differentiation axes

| Axis | Choice | Reason |
|---|---|---|
| UX | Pixel-replicate the Codex card/pet overlay | Brings over an experience users already like. |
| Content | Native load of `~/.codex/pets/` | Reuses existing pet purchase/install assets as-is. |
| Integration | Claude Code official hooks | Avoids brittle TUI scraping/key injection. |
| Reply | Blocking `PermissionRequest` response | Opens an official back-channel at the approve/deny/redirect moment. |
| Platform | Electron, macOS first | Gains web-UI replication and cross-platform extensibility together. |
| Code provenance | Clean-room first-party implementation | Provenance is clear because no third-party source is copied ([ADR-0002](../adr/0002-backend-clean-room.md)). |

## 3. Positioning statements

Short description:

> Codex pets for Claude Code.

Long description:

> Claude-Pet shows Claude Code sessions as the same floating pet and stacked cards you get in the
> Codex app, using your existing `~/.codex/pets` assets and Claude Code's official hook surface.

Descriptions to avoid:

| Phrasing | Problem |
|---|---|
| "A fork of an existing pet" | Inaccurate on originality and brand (we're a clean-room implementation against official docs). |
| "universal AI pet" | Blurs the initial scope. |
| "Claude chatbot pet" | The core is a coding-agent status/reply surface, not conversation. |

## 4. Implementation provenance strategy

The backend is built directly (clean-room) **on the basis of official Claude Code/OpenAI primary docs and our own observations only**. Because no third-party implementation code is copied or forked, code provenance is clear and design freedom is high ([ADR-0002](../adr/0002-backend-clean-room.md)).

| Option | Judgment |
|---|---|
| **Implement the hook/server directly clean-room** | **Default strategy.** Write new code from official docs + observed facts. |
| Fork/copy a third-party implementation | Blurs code provenance and originality — not adopted. |

The implementation work therefore builds from scratch using **official docs + observed behavior + our own protocol**, not by copying external code ([ADR-0002](../adr/0002-backend-clean-room.md)).

## 5. MVP success criteria

| Criterion | Measure |
|---|---|
| Codex visual fidelity | Card rounding, stack, `+N`, reply input, and pet anchor match against `refs/screens/`. |
| Claude Code safety | With the app off, the command hook introduces no perceptible Claude Code latency. |
| Reply works | `PermissionRequest` allow/deny/message actually advances/rejects the session. |
| Asset compatibility | Renders `refs/sample-pet/` and a real `~/.codex/pets/<slug>` without conversion. |
| Multi-session | Cards update independently per `session_id`, with up to 3 cards + overflow working. |

## 6. Risks and responses

| Risk | Impact | Response |
|---|---|---|
| Claude Code hook schema change | Integration breaks | Track official docs, protocol adapter test, installer version check |
| `PermissionRequest` fallback differences | Reply UX at risk | Keep the ADR-0004 smoke test as a release gate. |
| Codex pet internal protocol is closed | Fidelity limits | Narrow it down with the public asset format + screen observation. |
| Third-party code coupling | Provenance risk | Clean-room by default, no direct copying of third-party source |
| Linux Wayland click-through | Platform risk | v1 macOS; Win/Linux validated in Phase 1.1 |
| Insufficient capture evidence (error/clock/drag) | Low spec confidence | Specify additional capture tasks in the roadmap |

## 7. Go-to-market order

1. Internal MVP: `nezu` render + Claude Code state card + permission reply.
2. Documentation-style launch: put "Codex pets for Claude Code" and asset compatibility front and center.
3. Target the Petdex/Codex-pet community: emphasize that existing pets can be used as-is.
4. Target multi-agent pet users: pitch it to users who need Codex UX fidelity.

For the per-phase execution plan, [roadmap.md](../roadmap.md) is the authoritative document.
