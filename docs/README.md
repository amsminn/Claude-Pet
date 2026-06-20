# Claude-Pet — Technical Spec (docs)

The technical spec (docs-as-code) for a service that uses an on-screen desktop pet to **visualize the work state of Claude Code (CLI) in real time** and lets you send replies straight from the pet's cards. There is a single goal — **pixel-perfectly reproduce OpenAI Codex's pet experience** while being **natively compatible** with Codex pet assets (`~/.codex/pets/`) and **cross-platform** (macOS first).

> **Status**: Pre-Phase 0 (design locked). No code yet. This spec fixes the agreement before implementation begins.

## One-line definition

> A desktop app that shows the state of a Claude Code session with **exactly the same UX as a Codex pet** (a floating pet in the bottom-right + a stack of work cards + inline replies). Assets are compatible with the Codex/Petdex ecosystem as-is.

## Why we are building this (summary)

- **The Codex pet experience is great, but Claude Code has nothing at that level.** Existing attempts each fall short in some way — cross-platform but with their own UI so it is not the Codex experience; or Codex-asset-compatible but missing the card stack and replies and macOS-centric; or a glut of same-named clones with low polish. → **No one** satisfies all four beats at once: "faithful Codex reproduction + asset compatibility + cross-platform."
- **Differentiation strategy**: Implement the hook / state-server / permission-bridge backend clean-room from the **official Claude Code hook/SDK docs**, and focus our capacity on a **faithful Codex card UI** ([ADR-0002](adr/0002-backend-clean-room.md)).

Details: [00-overview/vision.md](00-overview/vision.md), [06-product/strategy.md](06-product/strategy.md).

## Tech stack at a glance

| Area | Choice | Notes |
|---|---|---|
| Shell / runtime | **Electron** | Web UI reproduction + Node backend in one runtime ([ADR-0001](adr/0001-electron-over-tauri.md)) |
| Native window | `type:'panel'` (over inactive / full-screen / all Spaces) · transparent · click-through | Built-in BrowserWindow options + `setIgnoreMouseEvents(true,{forward:true})` cursor toggle — verified ([07](07-implementation/build-plan.md)) |
| Pet rendering | Web `<canvas>` | atlas **8×9 · 192×208** frame sprite animation |
| Card UI | **HTML/CSS/JS** | Pixel-perfect Codex cards (rounding, shadows, spinner, badges, hover) |
| State intake | **Local HTTP server + Claude Code hooks** | Event fire-and-forget POST ([05](05-claude-integration/claude-code-hooks.md)) |
| Reply | **Blocking permission hook response** | Official channel, no key injection ([ADR-0004](adr/0004-reply-via-blocking-hook.md)) |
| Card body | Transcript JSONL tail | `~/.claude/projects/<proj>/<session>.jsonl` |
| Assets | **`~/.codex/pets/` native** | `pet.json` + `spritesheet.webp` as-is ([02](02-asset-compat/codex-pet-assets.md)) |
| Platform | **macOS first** → Windows/Linux | Single Electron codebase |

## Document index

### 00 — Overview
- [vision.md](00-overview/vision.md) — Problem (why bring the Codex pet to Claude Code), target users, value proposition, guiding principles
- [goals-nongoals.md](00-overview/goals-nongoals.md) — Goals (G1..), explicit non-goals, MVP scope and success criteria
- [glossary.md](00-overview/glossary.md) — Glossary (pet · card · atlas · hook · statusline · session…)

### 01 — Architecture
- [overview.md](01-architecture/overview.md) — Components, system/container diagrams, observe/reply data flows, NFRs

### 02 — Asset compatibility
- [codex-pet-assets.md](02-asset-compat/codex-pet-assets.md) — `pet.json` + spritesheet atlas spec, loader, `~/.codex/pets/` compatibility ✅

### 03 — State engine
- [state-machine.md](03-state-engine/state-machine.md) — Claude Code events → pet state → animation mapping, the session=card model ✅

### 04 — Pet / card UI
- [pet-and-cards.md](04-pet-ui/pet-and-cards.md) — Floating pet rendering, the Codex card stack reproduction spec (layout, states, reply, expand, ×, +N) ✅ **core**

### 05 — Claude Code integration
- [claude-code-hooks.md](05-claude-integration/claude-code-hooks.md) — Hook install, local server protocol, transcript tail, blocking reply ✅

### 06 — Product
- [strategy.md](06-product/strategy.md) — Positioning, differentiation axes, phased roadmap, risks ✅

### 07 — Implementation
- [build-plan.md](07-implementation/build-plan.md) — **research-backed build plan**. Verified implementation grounding (Electron panel window, click-through, the two hook forms, the atlas contract) + empirical spikes + Phases 0–4 (v1 = 0→2) + risk register ✅ **entry point to start**

### Cross-cutting
- [roadmap.md](roadmap.md) — Phases and milestones (high-level view; details in [07 build-plan](07-implementation/build-plan.md)) ✅

### ADR (Architecture Decision Records, MADR format)
- [0001-electron-over-tauri.md](adr/0001-electron-over-tauri.md) — Adopt Electron as the shell
- [0002-backend-clean-room.md](adr/0002-backend-clean-room.md) — Implement the backend clean-room from official primary documentation
- [0003-native-codex-asset-compat.md](adr/0003-native-codex-asset-compat.md) — Native Codex pet asset compatibility
- [0004-reply-via-blocking-hook.md](adr/0004-reply-via-blocking-hook.md) — Replies via a blocking permission hook response

## Relationship to the source material

The factual grounding for this spec lives in the internal [`refs/`](../refs/README.md) — Codex pet screen recordings, screenshots, the real pet asset (`nezu`), and primary-source research (official OpenAI/Anthropic docs). The backend is grounded in the official Claude Code hook/SDK docs.

## Credibility labels

- `Verified` — a fact verified by a source (code, official docs, direct observation)
- `Inferred` — reasoning based on public information (do not write it as if it were fact)

Design decisions are opinions, so they carry no label; but the external facts that ground them do carry one.
