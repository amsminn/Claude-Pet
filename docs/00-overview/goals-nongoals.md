# Goals · Non-Goals · MVP Scope

> Basis: [vision.md](vision.md), official [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) docs

Nailing down **"what we won't build"** is just as essential as "what we will build."

## Goals

### Product goals
- **G1.** Float a **floating pet** (transparent, always-on-top) in the bottom-right corner that shows Claude Code's
  work status in the same visual language as Codex.
- **G2.** Stack a **task card stack** above the pet. A card = one session/turn, composed of **title + body + status icon**
  (spinner = working · clock = waiting for input · green check = done), pixel-replicating the Codex card.
- **G3.** Reply to the agent from a card via **inline reply** (permission approval, course correction, etc.).
- **G4.** **Natively load** the pet assets in `~/.codex/pets/` — Codex/Petdex pets run as-is, with no conversion.
- **G5.** Distinguish multiple concurrent Claude Code sessions by `session_id` and display them **1:1 in the card stack**.

### Technical goals
- **G6.** Integrate **harmlessly** with Claude Code — hooks are fire-and-forget, with zero impact when the pet is
  absent ([ADR-0004](../adr/0004-reply-via-blocking-hook.md)).
- **G7.** Use a **single codebase (Electron)** to go from macOS-first to Windows/Linux expansion without a rewrite
  ([ADR-0001](../adr/0001-electron-over-tauri.md)).
- **G8.** Implement the hook/server/permission backend as a **clean-room based on the official Claude Code hooks/SDK docs**
  ([ADR-0002](../adr/0002-backend-clean-room.md)).

## Non-Goals

Things we explicitly **will not** do. Each item means "not right now."

| Non-Goal | Reason | Revisit |
|---|---|---|
| **Own pet format / theme system** | We use the Codex format natively. We do not "convert" to our own format. | Out of scope |
| **Pet hatching/creation (image generation)** | Per OpenAI's official docs, custom pet creation is handled by the `hatch-pet` skill flow. In v1 we only load. | Phase 2+ |
| **In-app petdex gallery / install** | Pets are installed with the existing Codex tools (`npx codex-pets add`); we only read. | Phase 2 |
| **Pet personality chat (@name chatting)** | Status visualization is the essence. Codex also avoids direct conversation to prevent distraction `Verified`. | Out of scope |
| **Injecting arbitrary input in idle state** | An interactive TUI has no official input channel `Verified`. Replies happen only at hook boundaries ([ADR-0004](../adr/0004-reply-via-blocking-hook.md)). | Replaced by terminal focus |
| **Windows/Linux polish (v1)** | Transparency, always-on-top, and click-through differ greatly by OS. v1 focuses on macOS. | Phase 1.1 |
| **Support for agents other than Codex (Cursor, etc.)** | We focus on Claude Code fidelity. Multi-agent is out of scope. | Out of scope (initially) |

## MVP Scope (Phase 1)

The aim is **not comprehensiveness, but "reliably floating an experience indistinguishable from the Codex pet on macOS,
using my own `nezu`."**

### In
- Floating pet window (transparent, always-on-top, bottom-right, draggable) + atlas sprite animation (per state).
- Task card stack: title, body, status icon, `+N` overflow, `latest` badge, **expand**, **×**, and global **collapse (⌄)**.
- Inline reply: at a permission/decision boundary, card input → delivered to the agent as a blocking-hook response
  ([ADR-0004](../adr/0004-reply-via-blocking-hook.md)).
- Claude Code integration: auto-install hooks in `settings.json` → receive state via the local server → enrich the
  body by tailing the transcript.
- Asset loader: select and load a pet from `~/.codex/pets/<slug>/` (menu bar).

### Out (follow-up)
- Pet hatching/creation, in-app gallery, Windows/Linux, multi-agent, personality chat.

### Exit Criteria
- In a real Claude Code session, the pet reflects the **thinking → tool-running → done → waiting** states identically to Codex.
- `~/.codex/pets/nezu` renders as-is, **without conversion**.
- Replying to a permission prompt via the pet card actually **advances** the session.
- Turning off the pet has no effect on Claude Code's operation.

For detailed phases, see [roadmap.md](../roadmap.md), [06-product/strategy.md](../06-product/strategy.md).
