"use strict";
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
 * @param {Object} args
 * @param {"allow"|"deny"} args.behavior
 * @param {Object} [args.updatedInput]       replace tool input (verified)
 * @param {"acceptEdits"} [args.setMode]      only acceptEdits is permitted
 * @returns {{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: Object } }}
 */
function buildPermissionResponse({ behavior, updatedInput, setMode } = {}) {
  if (behavior !== "allow" && behavior !== "deny") {
    throw new Error(`buildPermissionResponse: invalid behavior "${behavior}"`);
  }
  const decision = { behavior };
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
 * @param {Object} args
 * @param {"allow"|"deny"|"ask"|"defer"} args.permissionDecision
 * @param {string} [args.permissionDecisionReason]
 * @param {Object} [args.updatedInput]
 * @returns {{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: string } }}
 */
function buildPreToolUseResponse({
  permissionDecision,
  permissionDecisionReason,
  updatedInput,
} = {}) {
  const valid = ["allow", "deny", "ask", "defer"];
  if (!valid.includes(permissionDecision)) {
    throw new Error(
      `buildPreToolUseResponse: invalid permissionDecision "${permissionDecision}"`
    );
  }
  const out = {
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
 * @typedef {Object} PendingRequest
 * @property {string} [id]            caller-supplied id; auto-generated if absent
 * @property {string} sessionId
 * @property {"PermissionRequest"|"PreToolUse"} form
 * @property {function(?Object):void} settle  settles the held HTTP response with
 *                                             an envelope, or `null` for no-decision
 * @property {Object} [meta]          {tool, cmd} for the card UI
 * @property {number} [timeoutMs]     auto no-decision after this many ms (optional)
 */

/**
 * Create the permission bridge: holds open blocking HTTP requests until the UI
 * resolves them, then settles with the correctly-shaped envelope. Timeout /
 * cancel / unknown-id never synthesize a decision — they settle `null`.
 *
 * In-memory map only (no electron); the HTTP wiring lives in server.js.
 *
 * @returns {{
 *   hold: function(PendingRequest): string,
 *   resolve: function(string, {decision:string, message?:string, setMode?:string}): ?Object,
 *   cancel: function(string): boolean,
 *   pending: function(): PendingRequest[]
 * }}
 */
function createBridge() {
  /** @type {Map<string, PendingRequest & {timer?: NodeJS.Timeout}>} */
  const pending = new Map();

  /** Generate a collision-resistant request id. */
  function genId() {
    return `perm_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  /** Remove an entry and clear its timeout timer (if any). */
  function take(id) {
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
  function noDecision(id) {
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
     * @param {PendingRequest} req
     * @returns {string} id
     */
    hold(req) {
      const id = req.id || genId();
      const entry = { ...req, id };
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
     *
     * @param {string} id
     * @param {{decision:"allow"|"deny", message?:string, setMode?:string}} d
     * @returns {?Object}
     */
    resolve(id, d = {}) {
      const req = take(id);
      if (!req) return null;
      const envelope =
        req.form === "PreToolUse"
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
     * @param {string} id
     * @returns {boolean} true if a request was cancelled
     */
    cancel(id) {
      return noDecision(id);
    },

    /** @returns {PendingRequest[]} a snapshot of currently-held requests */
    pending() {
      return [...pending.values()].map(({ timer, ...req }) => req);
    },
  };
}

module.exports = {
  createBridge,
  buildPermissionResponse,
  buildPreToolUseResponse,
};
