# 0001. Adopt Electron as the Shell (Not Tauri)

- Status: Accepted
- Date: 2026-06-13
- Related: [01-architecture/overview.md](../01-architecture/overview.md), [ADR-0002](0002-backend-clean-room.md)

## Context

We need to choose the shell for the desktop pet app. The requirements are: (1) a transparent, always-on-top, click-through floating window; (2) web rendering, since the Codex card UI is clearly **HTML/CSS**; (3) **cross-platform** support with macOS first; and (4) a simple way to implement the Claude Code hook/server/permission bridge in Node.

Early on we leaned toward **Tauri** (Rust + system webview) for its lightweight footprint. But once you look at the core requirements — **(a) pixel-perfect reproduction of a web-based card UI** and **(b) a hook/server/permission backend written in Node** — **Electron** fits better: it puts the web UI and the Node backend in a single runtime, and its support for transparent windows, always-on-top, and auto-update is already mature. The backend is implemented clean-room against the official Claude Code documentation ([ADR-0002](0002-backend-clean-room.md)).

## Decision

We adopt **Electron** as the shell. The pet window and card UI are rendered in a BrowserWindow (`type:'panel'` so it shows over inactive and full-screen apps; transparent, frameless, always-on-top; click-through via `setIgnoreMouseEvents(true,{forward:true})` plus a cursor toggle) — all verified with built-in APIs ([07 build-plan](../07-implementation/build-plan.md)). The backend (the local hook-receiving server, the permission bridge, and the transcript tail) is implemented in Node, with the details implemented directly from official primary documentation ([ADR-0002](0002-backend-clean-room.md)).

## Consequences

**Upsides**
- The **Node/Electron stack** is mature, so there is low design risk around hooks, the server, permissions, and auto-update.
- Since the card UI is web-based anyway, pixel-perfect reproduction of Codex is natural.
- The Electron ecosystem is mature, so the paths for auto-update (`electron-updater`), building, and signing are already paved.
- A single codebase extends from macOS to Windows/Linux (transparency and click-through need per-OS adjustments, but it is not a rewrite).

**Downsides and tradeoffs (stated honestly)**
- **The binary and memory footprint are heavy.** Bundling all of Chromium is overkill for a "lightweight pet" (tens to 100MB+). → Mitigated by throttling animation when idle and reusing a single BrowserWindow. If an absolutely small footprint is the goal, Tauri is the better choice.
- **Transparency and click-through behave subtly differently per OS.** Even Electron is finicky on Linux (especially Wayland) → v1 focuses on macOS; Windows/Linux get separate validation in Phase 1.1 (a non-goal per [goals-nongoals.md](../00-overview/goals-nongoals.md)).
- **No copying of third-party source.** The backend is implemented clean-room directly from the official documentation ([ADR-0002](0002-backend-clean-room.md)).

## Alternatives considered

- **Tauri (Rust + system webview)**: Smaller binary, lower memory. But (1) the hook/server/permission bridge would have to move to the Rust side, (2) transparency, click-through, and always-on-top still require per-OS work in Tauri, and (3) Rust adds a burden on the team. The footprint advantage does not outweigh the simplicity of reproducing the web UI and implementing the Node hooks.
- **Native Swift/AppKit**: Best macOS polish and smallest footprint. But it would require reimplementing the entire card UI in AppKit (i.e. grinding out a Codex clone) and **cross-platform = a full rewrite** → a head-on collision with our goals.
- **Flutter / other desktop frameworks**: A loss on both fronts — pixel-perfect web UI reproduction and Node hook implementation.

We judged that the development velocity from **proven Electron patterns + the naturalness of a web UI** decisively outweighs the advantages of being lightweight (Tauri) or polished (Swift). If a small footprint becomes critical, our design keeps the backend behind an adapter, so swapping the shell can be revisited in a new ADR.
