# 0004. Send Replies Only via a Blocking `PermissionRequest` Hook Response

- Status: Accepted
- Date: 2026-06-14
- Related: [05-claude-integration](../05-claude-integration/claude-code-hooks.md), [03-state-engine](../03-state-engine/state-machine.md), [04-pet-ui](../04-pet-ui/pet-and-cards.md)

## Context

Claude-Pet's card has a `Reply` affordance. From a card, the user wants to allow/deny, redirect the work, or send a short message. But pushing arbitrary text into the Claude Code TUI is unsafe.

There are three possible paths.

| Path | Problem |
|---|---|
| Terminal key injection (`tmux send-keys`, AppleScript keystroke, etc.) | Focus errors, security risk, can land input in the wrong session |
| Manipulating the transcript/statusline | Not an official input channel and is not reflected in session progress |
| Blocking HTTP `PermissionRequest` hook response | The official decision channel that Claude Code actually waits on |

The Anthropic Claude Code hooks docs offer the HTTP hook and event-specific JSON output as official surfaces, and define the pattern of handling `PermissionRequest` as a blocking HTTP hook and responding with `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } }` `Verified` (official hooks docs, [research-verified](../07-implementation/build-plan.md#0-implementation-grounds-confirmed-by-research-verified)).

Supplementary facts confirmed by primary-source deep research (2026-06-14) `Verified`:

- The blocking reply path comes in **two forms with different shapes.**
  - **`PermissionRequest`** — fires just before the permission dialog, with a **nested** `decision.behavior: allow|deny` (plus `updatedInput` and `setMode` under `updatedPermissions`). **Interactive only — it does not fire in headless `-p` mode.** This is the **primary path** for normal (interactive) sessions where the pet is floating.
  - **`PreToolUse`** — a **flat** `hookSpecificOutput.permissionDecision: allow|deny|ask|defer` (plus `updatedInput`). A deterministic gate that **also works in headless `-p` mode**. This is the pet's headless/automation path.
- An HTTP hook only blocks on a **2xx response with a JSON body** (a status code alone is not enough). Since **non-2xx / timeout / connection failure is non-blocking → execution is allowed**, whether a non-response means a return to the native prompt or an automatic allow must be pinned down by a smoke test.

## Decision

Claude-Pet sends an inline reply to Claude Code **only while a blocking `PermissionRequest` hook is open**.

The response format follows this envelope.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "message": "optional message"
    }
  }
}
```

> `decision.behavior: allow|deny` is verified `Verified`. The `decision.message` field is **unverified** `Inferred` — the PermissionRequest decision side-fields that research confirmed are `updatedInput` and `updatedPermissions(setMode)`; `message` is not confirmed by a source. Verify it against an actual response at build time; if it is absent, convey the reason as a `deny` plus a separate surface.

Rules:

- Send only `allow` and `deny` as explicit decisions.
- For `setMode`, use only `acceptEdits` — `bypassPermissions` is silently dropped in 2.1.110+ ([#49525](https://github.com/anthropics/claude-code/issues/49525)) `Verified`.
- The headless (`-p`) path does not fire PermissionRequest, so handle it via `PreToolUse` (flat `permissionDecision`).
- If the user does not respond, do not synthesize an allow/deny; send a no-decision fallback.
- Do not auto-inject free-form input from the idle state into Claude Code. Provide only focus on the relevant terminal.
- The card reply UI shows "a reply forwarded to the agent" only when there is a `pendingPermission`.

## Consequences

**Upsides**

- Replies are handled within Claude Code's official lifecycle.
- Avoids the accident of injecting text into the wrong terminal/session.
- Even with the pet off, you can fall back to the Claude Code native prompt.

**Downsides and tradeoffs**

- A UX where the user sends a new prompt from a card at any time is out of v1 scope.
- For a normal conversation turn with no `PermissionRequest`, reply input has to be downgraded to a terminal-focus UX.
- The exact HTTP representation of the no-decision fallback needs a per-version smoke test against Claude Code.

## Alternatives considered

- **Handle all replies via key injection**: Easy to demo, but dangerous as a product. It can land in the wrong shell and is not an official Claude Code path.
- **Forward replies via an MCP tool**: This only has meaning if Claude calls that tool, so it does not become an arbitrary user reply path.
- **Append a message to the Claude Code transcript**: This is merely record tampering, not input to the running TUI.

## Validation

In Phase 1 we set the following as release gates.

- Confirm that `allow` on a real Claude Code `PermissionRequest` advances the request.
- Confirm that `deny + message` is reflected in the session as a reason.
- Confirm that the native prompt fallback survives when the app is not running, under DND, and on timeout.
- Confirm via code review that no key-injection API is used in the reply path.
