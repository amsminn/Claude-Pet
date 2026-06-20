/**
 * Pure state engine — NO electron, NO DOM. Unit-testable with `node --test`.
 *
 * Implements the three transforms from docs/03-state-engine/state-machine.md:
 *   ① event -> PetState        (EVENT_TO_STATE, + Stop->error promotion, §2.1)
 *   ② PetState[] -> petRow      (global priority reduce, §2.2)
 *   ③ session = card            (one session_id = one card record, §0.1)
 * plus the Stop-time card-body extraction from a transcript JSONL tail (§3.3).
 *
 * The store is a plain object; applyEvent mutates it and is deterministic for a
 * given (store, payload). Side effects (animation, IPC, HTTP) live elsewhere.
 *
 * ── DEFENSIVE PAYLOAD PARSING (build-plan §0.1-1) ────────────────────────────
 * The exact per-event hook payload field set is NOT confirmed by first-party
 * docs — the "common session_id/transcript_path/cwd" claim was rebutted (0-3).
 * So every field read here is optional-chained against several plausible aliases
 * (snake_case = raw Claude Code hook, camelCase = our /state envelope in
 * docs/05 §3.2, short keys = mock-scenarios). Unknown shapes degrade to the
 * session's prior value rather than throwing. See `notes` in the task output for
 * the exact assumed fields.
 */
import * as fs from "node:fs";
import * as C from "../shared/constants";
import type {
  PetState,
  PendingPermission,
  SessionState,
  StatePayload,
  Store,
  WirePayload,
} from "../shared/types";

const { ROW, EVENT_TO_STATE, WORKING_STATES } = C;
const WORKING = new Set<PetState>(WORKING_STATES);

// Card-body / title hard limits (docs/03 §0.1, §3.3; docs/05 §3.3).
const TITLE_MAX = 40; // §0.1: prompt 첫 줄 ≤40자
const BODY_CLAMP_DEFAULT = 2200; // §3.3: 본문 2200자 clamp
const TAIL_BYTES_DEFAULT = 256 * 1024; // §3.3: tail 256KB

/**
 * Create an empty session store.
 */
function createStore(): Store {
  return { sessions: new Map(), seq: 0 };
}

function makeSession(id: string, seq: number): SessionState {
  return {
    sessionId: id,
    state: "idle",
    title: "",
    body: "",
    pendingPermission: null,
    createdAt: seq,
    updatedAt: seq,
    completedAt: 0,
  };
}

// ── defensive field pickers ──────────────────────────────────────────────────
// Each accepts a payload and returns the first non-empty alias, else undefined.

/** sessionId | s | session_id | sessionID */
function pickSessionId(p: WirePayload): string | undefined {
  return firstStr(p && (p.sessionId ?? p.s ?? p.session_id ?? p.sessionID));
}

/** event | kind | hook_event_name | hookEventName | eventName */
function pickEvent(p: WirePayload): string | undefined {
  return firstStr(
    p &&
      (p.event ??
        p.kind ??
        p.hook_event_name ??
        p.hookEventName ??
        p.eventName)
  );
}

/** title | session_title | sessionTitle | customTitle | agentName */
function pickTitle(p: WirePayload): string | undefined {
  return firstStr(
    p &&
      (p.title ??
        p.session_title ??
        p.sessionTitle ??
        p.customTitle ??
        p.custom_title ??
        p.agentName ??
        p.agent_name)
  );
}

/** body | summary | text */
function pickBody(p: WirePayload): string | undefined {
  return firstStr(p && (p.body ?? p.summary ?? p.text));
}

/** transcriptPath | transcript_path | transcript */
function pickTranscriptPath(p: WirePayload): string | undefined {
  return firstStr(p && (p.transcriptPath ?? p.transcript_path ?? p.transcript));
}

/** Normalize a permission descriptor from several plausible shapes. */
function pickPerm(p: WirePayload): PendingPermission | null {
  if (!p) return null;
  const raw =
    p.perm ?? p.permission ?? p.pendingPermission ?? p.permissionRequest;
  if (raw && typeof raw === "object") {
    const tool = firstStr(raw.tool ?? raw.toolName ?? raw.tool_name) || "도구";
    const cmd =
      firstStr(
        raw.cmd ??
          raw.command ??
          raw.input ??
          (raw.toolInput && (raw.toolInput.command ?? raw.toolInput.cmd))
      ) || "…";
    const out: PendingPermission = { tool, cmd };
    const id = firstStr(raw.id ?? raw.requestId ?? raw.request_id);
    if (id) out.id = id;
    return out;
  }
  // Bare flag with no descriptor (e.g. {perm:true}) -> minimal placeholder.
  if (raw) return { tool: "도구", cmd: "…" };
  return null;
}

/** Return a trimmed string for any non-empty string-ish value, else undefined. */
function firstStr(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * Apply one event payload to the store, mutating it, and return the touched
 * session. Invariants (§0.1): same session_id updates in place; title/body are
 * never overwritten with empty values; seq is a monotonic counter.
 *
 * Accepts both our /state envelope and raw-ish hook payloads. Recognized keys
 * (any alias): sessionId, event/kind, title, body, perm, state, transcriptPath,
 * plus an explicit error marker (isApiErrorMessage / error / apiError).
 */
function applyEvent(store: Store, payload: WirePayload): SessionState {
  const p: WirePayload = payload && typeof payload === "object" ? payload : {};
  const id = pickSessionId(p) || "unknown";

  let s = store.sessions.get(id);
  if (!s) {
    s = makeSession(id, ++store.seq);
    store.sessions.set(id, s);
  }
  s.updatedAt = ++store.seq;

  const event = pickEvent(p);
  const perm = pickPerm(p);

  // ── permission request: hold + call the pet (§2.2 priority 1) ──────────────
  if (event === "PermissionRequest" || perm) {
    s.pendingPermission = perm || { tool: "도구", cmd: "…" };
  } else {
    const prevState = s.state; // captured before mutation for transition checks
    // ── ① event -> PetState ──────────────────────────────────────────────────
    // Precedence: explicit `state` from the hook script (docs/05 §3.2 lets the
    // script pre-classify) > EVENT_TO_STATE lookup. Unknown events keep prior.
    let next = firstStr(p.state) || (event ? EVENT_TO_STATE[event] : undefined);

    // ── Stop's two faces (§2.1, §3.1 edge case) ───────────────────────────────
    // Claude emits a normal Stop even on API error, leaving an isApiErrorMessage
    // assistant entry in the transcript. Promote Stop -> error when an error is
    // signalled, either via an explicit flag on the payload or by scanning the
    // transcript tail. Defensive: any scan failure leaves attention untouched.
    if (event === "Stop") {
      const errored =
        isErrorFlagged(p) || transcriptHasApiError(pickTranscriptPath(p));
      next = errored ? "error" : next || "attention";
    }

    if (next) s.state = next as PetState;

    // entering attention records the completion seq (stack promotion key, §4).
    // Guard on the transition: a repeat/late Stop on an already-attention card
    // must NOT re-stamp completedAt (would wrongly re-promote it to the top).
    if (s.state === "attention" && prevState !== "attention") {
      s.completedAt = ++store.seq;
      s.pendingPermission = null;
    }
    // error / sleeping clear any stale pending permission.
    if (s.state === "error" || s.state === "sleeping") {
      s.pendingPermission = null;
    }
  }

  // ── title/body upsert — never blank out a previously set value (§0.1) ──────
  const title = pickTitle(p);
  if (title) s.title = redactTitle(title);

  const body = pickBody(p);
  if (body) s.body = clampBody(redactSecrets(body));

  return s;
}

/** True when the payload carries any API-error / Stop-failure marker. */
function isErrorFlagged(p: WirePayload): boolean {
  return Boolean(
    p.isApiErrorMessage ??
      p.is_api_error_message ??
      p.apiError ??
      p.api_error ??
      (typeof p.error === "boolean" ? p.error : undefined)
  );
}

/**
 * Resolve a pending permission on a session (UI decided allow/deny). Clears
 * pendingPermission and advances the session (§5: allow -> working, deny ->
 * attention). Returns null when there is nothing pending (idempotent).
 */
function resolvePermission(
  store: Store,
  sessionId: string,
  decision: "allow" | "deny"
): SessionState | null {
  const s = store.sessions.get(sessionId);
  if (!s || !s.pendingPermission) return null;
  s.pendingPermission = null;
  s.updatedAt = ++store.seq;
  if (decision === "deny") {
    s.state = "attention";
    s.completedAt = ++store.seq;
  } else {
    s.state = "working";
  }
  return s;
}

/**
 * ② Global pet-row reduce: one pet summarizes N sessions by priority (§2.2).
 * Pure function of a session list. Priority:
 *   permission/notification (waving) > error (failed) > any working (running)
 *   > all-attention (review) > idle.
 * @returns atlas row index
 */
function petRow(list: SessionState[]): number {
  const sessions = Array.isArray(list) ? list : [];
  if (sessions.some((s) => s && (s.pendingPermission || s.state === "notification")))
    return ROW.waving;
  if (sessions.some((s) => s && s.state === "error")) return ROW.failed;
  if (sessions.some((s) => s && WORKING.has(s.state))) return ROW.running;
  // all-done (review): ignore sleeping/ended sessions; require ≥1 awake attention
  // (§2.2 groups idle/sleeping together — a finished+ended card must not block review).
  const awake = sessions.filter((s) => s && s.state !== "sleeping");
  if (awake.length && awake.every((s) => s.state === "attention")) return ROW.review;
  return ROW.idle;
}

/**
 * Ordered visible card list: chat-like creation order (oldest top -> newest
 * bottom). A session that has gone to sleep with nothing to show (no body) is
 * dropped (docs/04 §4). Pending-permission sessions are always kept.
 */
function orderedCards(store: Store): SessionState[] {
  return [...store.sessions.values()]
    .filter((s) => s.state !== "sleeping" || s.body || s.pendingPermission)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Build the serializable snapshot pushed to the renderer over IPC.STATE
 * (without petAsset — the glue attaches that). petRow is computed over ALL
 * sessions (including hidden sleeping ones) so the pet still reflects activity.
 */
function snapshot(store: Store): StatePayload {
  const all = [...store.sessions.values()];
  return {
    protocol: C.STATE_PROTOCOL,
    petRow: petRow(all),
    cards: orderedCards(store),
  };
}

/**
 * Extract the card body from a transcript JSONL file: the last assistant text
 * message near the tail (§3.3). Reads the tail window safely, never throws,
 * returns "" on any failure. tool_use / subagent / api-error entries are
 * skipped; the result is redacted then clamped.
 *
 * @param transcriptPath  absolute path to <session>.jsonl
 * @param opts.tailBytes  read window from EOF (256KB)
 * @param opts.clamp      max chars of returned body
 * @returns last assistant text, or "" if none / unreadable
 */
function extractCardBody(
  transcriptPath: string,
  opts: { tailBytes?: number; clamp?: number } = {}
): string {
  const tailBytes = positiveInt(opts.tailBytes, TAIL_BYTES_DEFAULT);
  const clamp = positiveInt(opts.clamp, BODY_CLAMP_DEFAULT);
  const rows = readTailRows(transcriptPath, tailBytes);
  if (!rows) return "";
  for (let i = rows.length - 1; i >= 0; i--) {
    const candidate = pickAssistantText(rows[i]);
    if (candidate) {
      const cleaned = redactSecrets(candidate);
      return cleaned.length > clamp ? cleaned.slice(0, clamp) : cleaned;
    }
  }
  return "";
}

/**
 * Read the tail window of a JSONL file and parse each complete line. Drops the
 * first line of the window (likely a partial record cut by the byte offset).
 * Returns parsed objects, or null on any I/O failure (never throws).
 */
function readTailRows(
  transcriptPath: string,
  tailBytes: number
): WirePayload[] | null {
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;
  let fd: number | undefined;
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile() || stat.size === 0) return [];
    const start = Math.max(0, stat.size - tailBytes);
    const len = stat.size - start;
    const buf = Buffer.alloc(len);
    fd = fs.openSync(transcriptPath, "r");
    fs.readSync(fd, buf, 0, len, start);
    const lines = buf.toString("utf8").split("\n");
    // When start>0 the first line MAY be a partial record cut by the byte offset.
    // We do NOT blindly drop it — that loses a whole valid record when the cut
    // lands on a line boundary (common for small/single-message transcripts).
    // The per-line JSON.parse below skips a genuine partial line naturally.
    const rows: WirePayload[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rows.push(JSON.parse(trimmed));
      } catch {
        // non-JSON / partial line -> skip, keep scanning.
      }
    }
    return rows;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Scan a transcript tail for an API-error assistant entry, used to promote
 * Stop -> error (§2.1). Returns false on any failure or missing path so a normal
 * Stop stays `attention` (never falsely escalates).
 */
function transcriptHasApiError(transcriptPath: string | undefined): boolean {
  if (!transcriptPath) return false;
  const rows = readTailRows(transcriptPath, TAIL_BYTES_DEFAULT);
  if (!rows) return false;
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const msg = row.message && typeof row.message === "object" ? row.message : row;
    return Boolean(row.isApiErrorMessage || msg.isApiErrorMessage);
  });
}

/**
 * Pull plain assistant text out of one transcript JSONL row, or "" if the row is
 * not an eligible assistant text message. Defensive: the real schema is
 * spike-verified in Phase 1 (§3.3) — this handles the common shapes. Filters:
 * non-assistant roles, api-error markers, tool_use blocks, subagent/system rows.
 */
function pickAssistantText(row: WirePayload): string {
  if (!row || typeof row !== "object") return "";
  // subagent / system-only sidecar rows are excluded (§3.3).
  if (row.isSidechain || row.subtype === "subagent") return "";

  const msg = row.message && typeof row.message === "object" ? row.message : row;

  const role = msg.role ?? row.role ?? row.type;
  if (role && role !== "assistant") return "";
  if (row.isApiErrorMessage || msg.isApiErrorMessage) return ""; // -> error path

  const content = msg.content ?? row.content;

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .filter(
        (b) =>
          b &&
          typeof b === "object" &&
          b.type === "text" &&
          typeof b.text === "string"
      )
      .map((b) => b.text)
      .join("")
      .trim();
    return text; // empty if the block was tool_use-only
  }

  return "";
}

// ── title / secret hygiene (§0.1, §3.3: secret redaction required) ───────────

/** Collapse to the first line, redact secrets, truncate to TITLE_MAX chars. */
function redactTitle(raw: string): string {
  const firstLine = String(raw).split(/\r?\n/, 1)[0];
  const cleaned = redactSecrets(firstLine).trim();
  if (cleaned.length <= TITLE_MAX) return cleaned;
  return cleaned.slice(0, TITLE_MAX - 1).trimEnd() + "…";
}

/**
 * Best-effort secret / token redaction for display strings (§3.3). Conservative
 * — only masks high-signal patterns so normal prose is untouched. Not a security
 * control; defense-in-depth before showing hook text in a card.
 */
function redactSecrets(raw: string): string {
  if (typeof raw !== "string" || !raw) return "";
  return (
    raw
      // bearer / authorization headers
      .replace(/\b(bearer|authorization)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 «redacted»")
      // common API key prefixes (sk-, ghp_, github_pat_, AKIA…, xoxb-, etc.)
      .replace(
        /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ps]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})\b/g,
        "«redacted»"
      )
      // key=value / KEY: value style secrets
      .replace(
        /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z0-9_]*)\s*[:=]\s*\S+/gi,
        "$1=«redacted»"
      )
  );
}

/** Clamp a (single) body string to the default body limit. */
function clampBody(raw: string): string {
  const s = typeof raw === "string" ? raw : "";
  return s.length > BODY_CLAMP_DEFAULT ? s.slice(0, BODY_CLAMP_DEFAULT) : s;
}

/** Coerce to a positive integer, else fall back. */
function positiveInt(v: number | undefined, fallback: number): number {
  return Number.isInteger(v) && (v as number) > 0 ? (v as number) : fallback;
}

export {
  createStore,
  applyEvent,
  resolvePermission,
  petRow,
  orderedCards,
  snapshot,
  extractCardBody,
};
