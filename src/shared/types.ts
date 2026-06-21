/**
 * Shared types across the Electron boundary (main / preload / renderer).
 *
 * Pure type declarations — no runtime code, safe to import from any side.
 */

/**
 * Normalized PetState (docs/03-state-engine §1.1). Superset of every value the
 * EVENT_TO_STATE table can produce, plus the UI-only `sleeping`/`notification`.
 */
export type PetState =
  | "idle"
  | "sleeping"
  | "thinking"
  | "working"
  | "attention"
  | "juggling"
  | "sweeping"
  | "carrying"
  | "notification"
  | "error";

/** Allow/deny outcome of a permission request. */
export type PermissionDecision = "allow" | "deny";

/** Per-row sprite playback cadence (docs/02 §4.3, docs/04 §7). */
export interface RowAnim {
  frames: number;
  ms: number;
  mode: "loop" | "once" | "pingpong" | "hold";
}

/** Released-app atlas geometry (8x9, 192x208 per frame). */
export interface AtlasGeometry {
  cols: number;
  rows: number;
  width: number;
  height: number;
}

/** A pending permission descriptor surfaced on a card. */
export interface PendingPermission {
  tool: string;
  cmd: string;
  id?: string;
}

/** One session = one card record (docs/03 §0.1). */
export interface SessionState {
  /** map key / card id (§0.1) */
  sessionId: string;
  /** normalized PetState (§1.1) */
  state: PetState;
  /** card title (UserPromptSubmit/Stop) */
  title: string;
  /** card body (Stop: last assistant text) */
  body: string;
  pendingPermission: PendingPermission | null;
  /** monotonic seq of first event */
  createdAt: number;
  /** monotonic seq of latest event */
  updatedAt: number;
  /** monotonic seq when last entered `attention` */
  completedAt: number;
}

/** In-memory session store; `seq` is a monotonic counter (ordering, not time). */
export interface Store {
  sessions: Map<string, SessionState>;
  seq: number;
}

/** Public pet metadata — the released manifest shape (no internal fields). */
export interface PetMeta {
  id: string;
  displayName: string;
  description: string;
  /** grouping meta only — never affects render */
  kind?: string;
  /** discovery folder name */
  slug: string;
}

/** Normalized pet asset descriptor handed to the renderer (paths + geometry). */
export interface PetAsset {
  meta: PetMeta;
  spritesheetPath: string;
  spritesheetUrl: string;
  frameW: number;
  frameH: number;
  atlas: AtlasGeometry;
}

/** Serializable snapshot pushed to the renderer over IPC.STATE. */
export interface StatePayload {
  protocol: string;
  petRow: number;
  cards: SessionState[];
  /** attached by the main glue, not by the pure state engine */
  petAsset?: PetAsset | null;
}

/** Free-text reply for a card (renderer -> main). */
export interface ReplyPayload {
  sessionId: string;
  message: string;
}

/** A newer GitHub release, surfaced to the renderer's update toast (main -> renderer). */
export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

/** Permission decision from the card UI (renderer -> main). */
export interface PermissionDecisionPayload {
  id: string;
  decision: PermissionDecision;
  message?: string;
}

/** Subset of constants the renderer reads through the preload bridge. */
export interface BridgeConstants {
  FRAME_W: number;
  FRAME_H: number;
  ATLAS: AtlasGeometry;
  ROW: Readonly<Record<string, number>>;
  ROW_ANIM: Readonly<Record<number, RowAnim>>;
  STATE_LABEL: Partial<Record<PetState, string>>;
}

/** The API exposed on `window.claudePet` by the preload bridge. */
export interface ClaudePetBridge {
  /** Wire protocol tag, so the renderer can assert compatibility. */
  protocol: string;
  /** Atlas / row constants the renderer needs to blit sprites. */
  constants: BridgeConstants;
  /** Subscribe to state snapshots pushed from main; returns an unsubscribe fn. */
  onState(cb: (payload: StatePayload) => void): () => void;
  /** Subscribe to "a newer release is available"; returns an unsubscribe fn. */
  onUpdateAvailable(cb: (info: UpdateInfo) => void): () => void;
  /** Run the install one-liner in Terminal and relaunch (the toast's Update button). */
  runUpdate(): void;
  /** Pop the native right-click menu over the pet (펫 닫기). */
  showPetMenu(): void;
  /** Toggle window click-through on #widget enter/leave. */
  setInteractive(interactive: boolean): void;
  /** Promote/demote the panel's key focus while a reply field is open. */
  setReplyFocus(on: boolean): void;
  /** Send a free-text reply for a card (non-permission path). */
  sendReply(payload: ReplyPayload): void;
  /** Resolve a pending permission from the card UI. */
  resolvePermission(id: string, decision: PermissionDecision, message?: string): void;
  /** Begin dragging the pet (pointerdown on the pet sprite). */
  dragStart(): void;
  /** Drag tick (rAF-throttled pointermove); main re-reads the cursor. */
  dragMove(): void;
  /** End the drag (pointerup / cancel). */
  dragEnd(): void;
}

/**
 * Untyped wire payload from a hook event / mock scenario. The exact per-event
 * field set is doc-uncertain (build-plan §0.1), so every read is defensively
 * optional-chained against several aliases — hence the permissive index type.
 */
export type WirePayload = Record<string, any>;
