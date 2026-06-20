# Architecture Overview

> Basis: official [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) and [settings](https://docs.anthropic.com/en/docs/claude-code/settings) docs, [`refs/codex-pet-ux-teardown.md`](../../refs/codex-pet-ux-teardown.md)
> Related: [ADR-0001](../adr/0001-electron-over-tauri.md), [ADR-0002](../adr/0002-backend-clean-room.md), [05-claude-integration](../05-claude-integration/claude-code-hooks.md)

This is a **single-process Electron** app. Claude Code is an external process we don't control, so all
integration arrives as **loose, harmless** one-way signals (hook → local server), and replies are sent
back only through the official back-channel of a **blocking hook response**. The backend (hooks, server,
permissions) is a clean-room implementation grounded in the **official Claude Code hooks/SDK docs**, while
our differentiating effort goes into a **Codex-faithful UI** (pet + cards).

## System Context (Level 1)

```mermaid
flowchart TB
    user["Developer"]
    subgraph cc["Claude Code sessions (N terminals)"]
        s1["claude #1"]
        s2["claude #2"]
    end
    pets[("~/.codex/pets/<br/>pet.json + spritesheet.webp")]
    app["<b>Claude-Pet</b><br/>Electron desktop app"]

    user -->|"prompt input"| cc
    cc -->|"hook event (state)"| app
    app -->|"blocking hook response (reply/permission)"| cc
    pets -->|"native load"| app
    app -->|"floating pet + card stack"| user
```

## Containers (Level 2)

The deployment unit is a single Electron app. Internally it is split into 6 components, each with a single responsibility.

```mermaid
flowchart TB
    subgraph ccx["Claude Code (external)"]
        hookCmd["command hook<br/>(state events)"]
        hookHttp["blocking HTTP hook<br/>(permission/reply)"]
        jsonl[("transcript JSONL<br/>~/.claude/projects/…")]
    end

    subgraph app["Claude-Pet (Electron)"]
        server["<b>① Local server</b><br/>receives state POSTs<br/>holds/resolves permission requests"]
        store["<b>② Session store</b><br/>session_id → {title,body,state,terminalID}"]
        tailer["<b>③ Transcript tailer</b><br/>last assistant text → card body"]
        loader["<b>④ Asset loader</b><br/>parses pet.json + atlas"]
        petwin["<b>⑤ Pet window</b><br/>transparent · always-on-top · click-through<br/>canvas sprites"]
        cards["<b>⑥ Card stack UI</b><br/>Codex pixel replica<br/>title·body·icon·reply·expand·×·+N"]
    end

    hookCmd -->|"POST state (fire-and-forget)"| server
    hookHttp -->|"POST permission (blocking)"| server
    jsonl -.->|"tail read"| tailer
    server --> store
    tailer --> store
    loader --> petwin
    store --> petwin
    store --> cards
    cards -->|"user reply"| server
    server -->|"decision/feedback response"| hookHttp
```

**Component responsibilities**

| # | Component | Responsibility | Source |
|---|---|---|---|
| ① | Local server | Receives state POSTs; holds permission hooks and responds with the user's decision | New (per official hook docs) |
| ② | Session store | `session_id` = one card. Multiple sessions → stack. Holds state, title, body, terminal ID | New |
| ③ | Transcript tailer | On Stop, extracts the last assistant text from the tail of the JSONL (card body) | New (official transcript schema) |
| ④ | Asset loader | Parses and validates `~/.codex/pets/<slug>/{pet.json,spritesheet.webp}` | New ([02](../02-asset-compat/codex-pet-assets.md)) |
| ⑤ | Pet window | Transparent / click-through / always-on-top window + atlas 8×9 frame animation | New |
| ⑥ | Card stack UI | Pixel replica of Codex cards — the core differentiator | New ([04](../04-pet-ui/pet-and-cards.md)) |

## Key data flows

### Flow 1 — Observe (state → pet/cards)

The most frequent path. When Claude Code emits an event, the pet/cards update immediately.

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as command hook
    participant Srv as local server ①
    participant Store as session store ②
    participant Tail as tailer ③
    participant UI as pet/cards ⑤⑥

    CC->>Hook: event (UserPromptSubmit/PreToolUse/Stop…)
    Hook->>Srv: POST state JSON (100ms timeout, fire-and-forget)
    Note over Hook,CC: if the pet is off → timeout → exit 0, zero impact on CC
    Srv->>Store: update state·session_title (session_id)
    opt event == Stop
        Hook->>Tail: transcript_path
        Tail->>Store: last assistant text → card body
    end
    Store->>UI: pet animation + card state update
```

### Flow 2 — Reply (blocking hook back-channel)

A synchronous path that opens only when Claude Code asks for a permission/decision. The answer returns
through the official channel without any key injection.

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as blocking HTTP hook
    participant Srv as local server ①
    participant UI as card UI ⑥
    participant User as User

    CC->>Hook: PermissionRequest (blocking)
    Hook->>Srv: POST permission request (await response)
    Srv->>UI: show reply/approve affordance on the relevant card
    User->>UI: allow/deny + (optional) message input
    UI->>Srv: user decision
    Srv->>Hook: { hookSpecificOutput: { hookEventName:"PermissionRequest", decision } }
    Hook->>CC: deliver decision → session proceeds
    Note over Srv,Hook: no response/DND/pet absent → no-decision fallback → must confirm via CC native prompt
```

## Non-functional requirements (NFR)

| Category | Requirement | Target (Inferred) | Basis |
|---|---|---|---|
| **Harmlessness** | Impact on CC when pet is absent/delayed | 0 | State hook is fire-and-forget with 100ms timeout `Verified` ([05](../05-claude-integration/claude-code-hooks.md)) |
| **Responsiveness** | event → pet reflection | perceptibly instant (<200ms target) | local server receives directly |
| **Reply safety** | when pet does not respond | falls back to CC native prompt | blocking-hook no-decision smoke test required ([05](../05-claude-integration/claude-code-hooks.md)) |
| **Fidelity** | visual difference vs. Codex | aims for pixel-level match | per the screens in [`refs/`](../../refs/README.md) |
| **Compatibility** | Codex pet assets | zero conversion · native | loads `~/.codex/pets/` directly ([02](../02-asset-compat/codex-pet-assets.md)) |
| **Portability** | macOS → Win/Linux | without rewrite | single Electron codebase ([ADR-0001](../adr/0001-electron-over-tauri.md)) |
| **Performance** | resources when idle | lightweight | throttle animation frames when idle |

## Implementation boundary (clean-room)

The backend is **derived from official first-party docs**, and the differentiating value is concentrated in **new UI/loader** ([ADR-0002](../adr/0002-backend-clean-room.md)).

| Implemented per official docs (backend) | New (differentiating value) |
|---|---|
| Hook event → state mapping/POST, local server, permission bridge, transcript tail and session identification (all from official hooks/settings docs) | **Codex-faithful pet window + card stack UI**, Codex-atlas-faithful rendering in the asset loader |
