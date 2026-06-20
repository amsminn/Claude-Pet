# Glossary

> Related: [vision.md](vision.md), [state-machine.md](../03-state-engine/state-machine.md), [claude-code-hooks.md](../05-claude-integration/claude-code-hooks.md)

This pins down the recurring terms used throughout the project docs in one place.

| Term | Definition |
|---|---|
| pet | The pixel character floating in the bottom-right corner of the screen. Only one is rendered per app. |
| card | A task bubble representing a single Claude Code session. Maps 1:1 to a `session_id`. |
| stack | The UI formed by several stacked cards. Based on observation of Codex, up to 3 cards are shown and any beyond that collapse into `+N`. |
| atlas | The frame grid of `spritesheet.webp`. Currently 8 columns x 9 rows, with 192x208px frames `Verified`. |
| row | One animation row of the atlas. Used as a per-state loop/one-shot clip. |
| hook | A command or HTTP callback that Claude Code runs on a specific event. |
| command hook | A hook used for state observation. Runs briefly, sends a fire-and-forget POST to the local server, and exits. |
| HTTP hook | A hook through which Claude Code POSTs a JSON payload to an HTTP endpoint. Used for the `PermissionRequest` reply path. |
| PermissionRequest | The hook event raised when Claude Code asks for a tool-use or permission decision. Claude-Pet's inline reply responds to this open request. |
| transcript | The Claude Code session JSONL log. On Stop, the last assistant text is located and used as the card body. |
| statusline | Claude Code's in-terminal status bar. Claude-Pet does not replace the statusline; it operates as a separate desktop overlay. |
| session store | The `session_id -> SessionState` map. The single runtime source of truth shared by the state engine and the UI. |
| native fallback | The safety path that falls back to Claude Code's default in-terminal permission prompt when Claude-Pet cannot respond. |
| no-decision | A state in which Claude-Pet does not synthesize an allow/deny. The fallback mechanism (HTTP 204, connection close, timeout, etc.) is determined per hook type through testing. |
