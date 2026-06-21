/**
 * Permission bridge + response builders — NO electron. Unit-testable with
 * plain `node --test` (require()-able, no Electron runtime).
 *
 * Two verified blocking-reply forms (build-plan §0, docs/05 §4):
 *   ① PreToolUse        — FLAT  `hookSpecificOutput.permissionDecision`
 *                         (allow|deny|ask|defer), works headless (`-p`).
 *   ② PermissionRequest — NESTED `hookSpecificOutput.decision.behavior`
 *                         (allow|deny), interactive only.
 *
 * Verified-recipe discipline (docs/05 §4.1, ADR-0004):
 *   - PermissionRequest `decision` carries ONLY verified fields:
 *     `behavior` (allow|deny), `updatedInput`, `updatedPermissions.setMode`.
 *     The `decision.message` field is UNVERIFIED, so we DO NOT emit it by
 *     default — a reason rides the PreToolUse `permissionDecisionReason`
 *     (documented) path instead. Drop it here rather than ship a guessed shape.
 *   - `setMode` is restricted to `acceptEdits` (bypassPermissions is dropped in
 *     2.1.110+ and forbidden).
 *
 * Safety: we NEVER synthesize allow/deny. No-response / DND / timeout / cancel
 * is a no-decision; the bridge settles with `null` so the server returns a
 * fallback and Claude Code falls back to its native prompt (docs/05 §4.2).
 */

/**
 * Build a PermissionRequest (interactive) response envelope: NESTED decision.
 * Emits only verified `decision` fields — `message` is intentionally dropped
 * (unverified per docs/05 §4.1 + ADR-0004). (docs/05 §4.1)
 *
 * @param args.behavior      allow | deny
 * @param args.updatedInput  replace tool input (verified)
 * @param args.setMode       only acceptEdits is permitted
 */
function buildPermissionResponse({
  behavior,
  updatedInput,
  setMode,
}: {
  behavior?: "allow" | "deny";
  updatedInput?: object;
  setMode?: "acceptEdits";
} = {}): { hookSpecificOutput: { hookEventName: "PermissionRequest"; decision: any } } {
  if (behavior !== "allow" && behavior !== "deny") {
    throw new Error(`buildPermissionResponse: invalid behavior "${behavior}"`);
  }
  const decision: any = { behavior };
  if (updatedInput) decision.updatedInput = updatedInput;
  if (setMode !== undefined) {
    if (setMode !== "acceptEdits") {
      throw new Error(`setMode must be "acceptEdits" (got "${setMode}")`);
    }
    decision.updatedPermissions = { setMode };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision,
    },
  };
}

/**
 * Build a PreToolUse (headless) response envelope: FLAT permissionDecision.
 * `permissionDecisionReason` is the documented reason channel for this form.
 * (build-plan §0 blocking-reply ①, docs/05 §4)
 *
 * @param args.permissionDecision        allow | deny | ask | defer
 * @param args.permissionDecisionReason  reason text
 * @param args.updatedInput              replace tool input
 */
function buildPreToolUseResponse({
  permissionDecision,
  permissionDecisionReason,
  updatedInput,
}: {
  permissionDecision?: "allow" | "deny" | "ask" | "defer";
  permissionDecisionReason?: string;
  updatedInput?: object;
} = {}): { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: string } } {
  const valid = ["allow", "deny", "ask", "defer"];
  if (!valid.includes(permissionDecision as string)) {
    throw new Error(
      `buildPreToolUseResponse: invalid permissionDecision "${permissionDecision}"`
    );
  }
  const out: any = {
    hookEventName: "PreToolUse",
    permissionDecision,
  };
  if (permissionDecisionReason) {
    out.permissionDecisionReason = permissionDecisionReason;
  }
  if (updatedInput) out.updatedInput = updatedInput;
  return { hookSpecificOutput: out };
}

/**
 * Build a Stop (or SubagentStop) reply: a TOP-LEVEL block decision whose
 * `reason` is injected back as the agent's continuation. This is the only
 * official channel for a free-text reply — the held Stop hook returns this to
 * make Claude Code continue with the user's text (docs/05 §4; Claude Code Stop
 * hook `{decision:"block", reason}`).
 */
function buildStopResponse({ reason }: { reason?: string } = {}): {
  decision: "block";
  reason: string;
} {
  return { decision: "block", reason: reason || "" };
}

/**
 * A held permission request awaiting a UI decision.
 */
interface PendingRequest {
  /** caller-supplied id; auto-generated if absent */
  id?: string;
  sessionId: string;
  form: "PermissionRequest" | "PreToolUse" | "Stop";
  /** settles the held HTTP response with an envelope, or `null` for no-decision */
  settle: (env: object | null) => void;
  /** {tool, cmd} for the card UI */
  meta?: object;
  /** auto no-decision after this many ms (optional) */
  timeoutMs?: number;
}

/**
 * Create the permission bridge: holds open blocking HTTP requests until the UI
 * resolves them, then settles with the correctly-shaped envelope. Timeout /
 * cancel / unknown-id never synthesize a decision — they settle `null`.
 *
 * In-memory map only (no electron); the HTTP wiring lives in server.js.
 */
function createBridge() {
  const pending = new Map<string, PendingRequest & { timer?: NodeJS.Timeout }>();

  /** Generate a collision-resistant request id. */
  function genId(): string {
    return `perm_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  /** Remove an entry and clear its timeout timer (if any). */
  function take(id: string): (PendingRequest & { timer?: NodeJS.Timeout }) | null {
    const req = pending.get(id);
    if (!req) return null;
    pending.delete(id);
    if (req.timer) {
      clearTimeout(req.timer);
      req.timer = undefined;
    }
    return req;
  }

  /** Settle a request with no-decision (null). Shared by cancel + timeout. */
  function noDecision(id: string): boolean {
    const req = take(id);
    if (!req) return false;
    if (typeof req.settle === "function") req.settle(null);
    return true;
  }

  return {
    /**
     * Register a held request; returns its id. `req.settle` is invoked later
     * with the response envelope (resolve) or `null` (cancel / timeout).
     * If `req.timeoutMs` is a positive number, the request auto-settles as
     * no-decision after that delay.
     * @returns id
     */
    hold(req: PendingRequest): string {
      const id = req.id || genId();
      const entry: PendingRequest & { timer?: NodeJS.Timeout } = { ...req, id };
      if (typeof req.timeoutMs === "number" && req.timeoutMs > 0) {
        entry.timer = setTimeout(() => noDecision(id), req.timeoutMs);
        // Don't keep the event loop alive solely for a pending permission.
        if (typeof entry.timer.unref === "function") entry.timer.unref();
      }
      pending.set(id, entry);
      return id;
    },

    /**
     * Resolve a held request with a user decision. Builds the right envelope
     * for the request's form and settles it. Returns the envelope, or `null`
     * if the id is unknown.
     *
     * Reason routing: a `message` only reaches the wire via the verified
     * PreToolUse `permissionDecisionReason`. For PermissionRequest it is NOT
     * forwarded (the nested `decision.message` field is unverified).
     */
    resolve(
      id: string,
      d: { decision?: "allow" | "deny"; message?: string; setMode?: "acceptEdits" } = {}
    ): object | null {
      const req = take(id);
      if (!req) return null;
      const envelope =
        req.form === "Stop"
          ? buildStopResponse({ reason: d.message })
          : req.form === "PreToolUse"
            ? buildPreToolUseResponse({
                permissionDecision: d.decision,
                permissionDecisionReason: d.message,
              })
            : buildPermissionResponse({
                behavior: d.decision,
                setMode: d.setMode,
              });
      if (typeof req.settle === "function") req.settle(envelope);
      return envelope;
    },

    /**
     * Cancel a held request as no-decision (timeout / DND / app closing).
     * NEVER synthesizes allow/deny — settles with `null`.
     * @returns true if a request was cancelled
     */
    cancel(id: string): boolean {
      return noDecision(id);
    },

    /** @returns a snapshot of currently-held requests */
    pending(): PendingRequest[] {
      return [...pending.values()].map(({ timer, ...req }) => req);
    },
  };
}

export { createBridge, buildPermissionResponse, buildPreToolUseResponse, buildStopResponse };
