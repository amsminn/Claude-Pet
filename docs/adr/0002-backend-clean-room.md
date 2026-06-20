# 0002. Implement the Backend Clean-Room from Official Primary Documentation

- Status: Accepted
- Date: 2026-06-14
- Related: [01-architecture/overview.md](../01-architecture/overview.md), [05-claude-integration](../05-claude-integration/claude-code-hooks.md), [ADR-0004](0004-reply-via-blocking-hook.md)

## Context

The Claude-Pet backend is four pieces — (1) a `settings.json` hook installer, (2) a local server that receives state events, (3) a blocking HTTP hook bridge that handles permissions and replies, and (4) a reader that fills card bodies by tailing the transcript JSONL.

These four pieces **can be derived completely from official primary documentation alone.** The Anthropic Claude Code [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) and [settings](https://docs.anthropic.com/en/docs/claude-code/settings) docs define hook events, payloads, HTTP hooks, and the permission `decision` response shape; the session transcript path (`~/.claude/projects/<proj>/<session>.jsonl`) and its schema are public as well. Therefore the backend can be implemented completely from primary documentation alone.

## Decision

We implement the backend **directly (clean-room), based only on official Claude Code/OpenAI documentation and our own observations.**

- The hook-event → state mapping, the permission response shape, and the transcript extraction rules are all cited and derived from primary documentation ([05-claude-integration](../05-claude-integration/claude-code-hooks.md), [03-state-engine](../03-state-engine/state-machine.md)).
- We do not copy or fork any third-party implementation code; everything is **implemented from scratch**. This is for originality and design freedom.
- The protocol and UI boundaries (components ①–⑥, [overview](../01-architecture/overview.md)) are designed fresh to fit our requirements.

## Consequences

**Upsides**
- We design the protocol and UI boundaries freely.
- We respond independently to changes in the official hook schema via adapter tests.
- Code provenance is clear, so there is no licensing or originality risk.

**Downsides and tradeoffs (stated honestly)**
- We have to implement the hook installer, local server, and permission bridge ourselves, so the initial pace is slow.
- We have to validate OS/terminal edge cases (transparency, always-on-top, permission fallback, etc.) ourselves.
- We keep smoke tests strict so we do not lose behavior parity ([roadmap](../roadmap.md)).

## Alternatives considered

- **Fork/copy a third-party implementation**: Might be the fastest, but it muddies code provenance and originality. Since the official docs are sufficient to derive everything, it is unnecessary.
- **Negotiate a separate license**: Becomes a blocking dependency on the schedule. To be revisited only in a later phase.

## Validation

- In the implementation PR, confirm there is no file-level copy of third-party source.
