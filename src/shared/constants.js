/**
 * Shared constants — single source of truth for atlas geometry, IPC channel
 * names, the event->state vocabulary, and the wire protocol tag.
 *
 * Loadable from BOTH sides of the Electron boundary:
 *   - main / preload / node tests: `const C = require('../shared/constants')`
 *   - renderer (no bundler):       `<script src="../shared/constants.js">` then
 *                                  read `window.CLAUDE_PET_CONSTANTS`
 *
 * Facts here come only from the project docs + verified build-plan recipe:
 *   - atlas 8 cols x 9 rows, 192x208 per frame (1536x1872 total)
 *     (docs/02-asset-compat, docs/03-state-engine §1.2)
 *   - 9 official rows in fixed order
 *     (idle, running-right, running-left, waving, jumping, failed,
 *      waiting, running, review)
 *   - EVENT_TO_STATE (docs/03-state-engine §2.1, docs/05-claude-integration §3.1)
 *   - protocol "claude-pet.v1" (docs/05-claude-integration §5 /healthz)
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // CommonJS (main / preload / node --test)
  }
  if (root) {
    root.CLAUDE_PET_CONSTANTS = api; // renderer global (plain <script>)
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ── atlas geometry (docs/02 §3.1, docs/03 §1.2) ──────────────────────────
  const FRAME_W = 192;
  const FRAME_H = 208;
  const ATLAS = Object.freeze({ cols: 8, rows: 9, width: 1536, height: 1872 });

  // ── row index per official state name (row = state, col = frame) ─────────
  // Fixed order is the released-app contract. Do not reorder.
  const ROW = Object.freeze({
    idle: 0,
    "running-right": 1,
    "running-left": 2,
    waving: 3,
    jumping: 4,
    failed: 5,
    waiting: 6,
    running: 7,
    review: 8,
  });

  // Per-row playback cadence (frames / ms / mode). Frame counts are the
  // conservative observed values; the renderer refines them at runtime via
  // autoDetectFrames (transparent-cell scan) so it never blits an empty cell.
  // (docs/02 §4.3, docs/04 §7)
  const ROW_ANIM = Object.freeze({
    [ROW.idle]: { frames: 2, ms: 700, mode: "pingpong" },
    [ROW["running-right"]]: { frames: 8, ms: 112, mode: "loop" },
    [ROW["running-left"]]: { frames: 8, ms: 112, mode: "loop" },
    [ROW.waving]: { frames: 6, ms: 95, mode: "once" },
    [ROW.jumping]: { frames: 8, ms: 95, mode: "once" },
    [ROW.failed]: { frames: 8, ms: 105, mode: "hold" },
    [ROW.waiting]: { frames: 8, ms: 150, mode: "loop" },
    [ROW.running]: { frames: 8, ms: 112, mode: "loop" },
    [ROW.review]: { frames: 8, ms: 160, mode: "loop" },
  });

  // ── Claude Code hook event -> normalized PetState (docs/03 §2.1) ──────────
  // NOTE (build-plan §0.1): exact hook event NAMES are doc-uncertain. Capture
  // real payloads at integration and prune any that never fire. Unmatched events
  // are harmless (state.js falls through to "keep prior state"). The only RELIABLE
  // error route is Stop + transcript `isApiErrorMessage` (handled in state.js).
  const EVENT_TO_STATE = Object.freeze({
    // confirmed-real Claude Code hook events
    SessionStart: "idle",
    SessionEnd: "sleeping",
    UserPromptSubmit: "thinking",
    PreToolUse: "working",
    PostToolUse: "working",
    Stop: "attention",
    SubagentStop: "working",
    PreCompact: "sweeping",
    PostCompact: "thinking",
    Notification: "notification",
    // `추정` — speculative/unverified event names; verify empirically, may never fire
    PostToolUseFailure: "error",
    StopFailure: "error",
    ApiError: "error",
    SubagentStart: "juggling",
    Elicitation: "notification",
    WorktreeCreate: "carrying",
  });

  // States that count as "actively working" for the global pet-row reduce
  // (docs/03 §2.2 priority 3).
  const WORKING_STATES = Object.freeze([
    "working",
    "thinking",
    "juggling",
    "sweeping",
    "carrying",
  ]);

  // Progress label shown in the body slot before `body` is filled (docs/03 §3.2).
  const STATE_LABEL = Object.freeze({
    thinking: "생각 중",
    working: "생각 중",
    juggling: "서브에이전트 가동 중",
    sweeping: "정리 중",
    carrying: "worktree 생성",
  });

  // ── IPC channel names (shared by main, preload, renderer) ────────────────
  // main -> renderer: push a state snapshot to repaint cards + pet row.
  // renderer -> main: hover hit-area toggle, reply send, permission resolve.
  const IPC = Object.freeze({
    STATE: "pet:state", // main -> renderer  (StatePayload)
    SET_INTERACTIVE: "pet:set-interactive", // renderer -> main  (boolean)
    SET_REPLY_FOCUS: "pet:set-reply-focus", // renderer -> main  (boolean): grab key window while typing a reply
    SEND_REPLY: "pet:send-reply", // renderer -> main  (ReplyPayload)
    RESOLVE_PERMISSION: "pet:resolve-permission", // renderer -> main  (PermissionDecisionPayload)
    DRAG_START: "pet:drag-start", // renderer -> main: begin dragging the pet (records cursor->window offset)
    DRAG_MOVE: "pet:drag-move", // renderer -> main: drag tick (main re-reads global cursor and repositions)
    DRAG_END: "pet:drag-end", // renderer -> main: end drag (pins position, disables auto re-anchor)
  });

  // ── wire / protocol tags (docs/05 §3.2, §5) ──────────────────────────────
  const PROTOCOL = "claude-pet.v1";
  const STATE_PROTOCOL = "claude-pet.state.v1";

  return Object.freeze({
    FRAME_W,
    FRAME_H,
    ATLAS,
    ROW,
    ROW_ANIM,
    EVENT_TO_STATE,
    WORKING_STATES,
    STATE_LABEL,
    IPC,
    PROTOCOL,
    STATE_PROTOCOL,
  });
});
