"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const permission = require("../src/main/permission");

// ── buildPermissionResponse: NESTED decision (interactive PermissionRequest) ──

test("buildPermissionResponse: nested decision envelope (PermissionRequest)", () => {
  const out = permission.buildPermissionResponse({ behavior: "allow" });
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});

test("buildPermissionResponse drops the unverified decision.message by default", () => {
  // docs/05 §4.1 + ADR-0004: decision.message is `추정` (unverified) -> never
  // emitted. A reason rides PreToolUse.permissionDecisionReason instead.
  const out = permission.buildPermissionResponse({ behavior: "deny", message: "no" });
  assert.deepEqual(out.hookSpecificOutput.decision, { behavior: "deny" });
  assert.ok(!("message" in out.hookSpecificOutput.decision));
});

test("buildPermissionResponse keeps the verified updatedInput field", () => {
  const out = permission.buildPermissionResponse({
    behavior: "allow",
    updatedInput: { command: "ls" },
  });
  assert.deepEqual(out.hookSpecificOutput.decision, {
    behavior: "allow",
    updatedInput: { command: "ls" },
  });
});

test("buildPermissionResponse rejects invalid behavior", () => {
  assert.throws(() => permission.buildPermissionResponse({ behavior: "maybe" }));
  assert.throws(() => permission.buildPermissionResponse({}));
});

test("buildPermissionResponse setMode only allows acceptEdits", () => {
  const out = permission.buildPermissionResponse({ behavior: "allow", setMode: "acceptEdits" });
  assert.deepEqual(out.hookSpecificOutput.decision.updatedPermissions, { setMode: "acceptEdits" });
  assert.throws(() => permission.buildPermissionResponse({ behavior: "allow", setMode: "bypassPermissions" }));
});

// ── buildPreToolUseResponse: FLAT permissionDecision (headless PreToolUse) ────

test("buildPreToolUseResponse: flat permissionDecision envelope (headless)", () => {
  const out = permission.buildPreToolUseResponse({
    permissionDecision: "deny",
    permissionDecisionReason: "no",
  });
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "no",
    },
  });
});

test("buildPreToolUseResponse is flat: no nested decision object", () => {
  const out = permission.buildPreToolUseResponse({ permissionDecision: "allow" });
  assert.equal(out.hookSpecificOutput.permissionDecision, "allow");
  assert.ok(!("decision" in out.hookSpecificOutput));
});

test("buildPreToolUseResponse accepts allow|deny|ask|defer", () => {
  for (const d of ["allow", "deny", "ask", "defer"]) {
    assert.equal(
      permission.buildPreToolUseResponse({ permissionDecision: d }).hookSpecificOutput.permissionDecision,
      d
    );
  }
  assert.throws(() => permission.buildPreToolUseResponse({ permissionDecision: "yes" }));
});

// ── bridge: hold / resolve ───────────────────────────────────────────────────

test("bridge.hold returns an id and exposes the held request via pending()", () => {
  const bridge = permission.createBridge();
  const id = bridge.hold({ sessionId: "A", form: "PermissionRequest", settle: () => {}, meta: { tool: "Bash" } });
  assert.equal(typeof id, "string");
  const held = bridge.pending();
  assert.equal(held.length, 1);
  assert.equal(held[0].id, id);
  assert.equal(held[0].sessionId, "A");
  assert.deepEqual(held[0].meta, { tool: "Bash" });
  // pending() must not leak the internal timer handle.
  assert.ok(!("timer" in held[0]));
});

test("bridge.hold honors a caller-supplied id", () => {
  const bridge = permission.createBridge();
  const id = bridge.hold({ id: "fixed-1", sessionId: "A", form: "PermissionRequest", settle: () => {} });
  assert.equal(id, "fixed-1");
});

test("bridge.hold/resolve settles a PermissionRequest with the nested envelope", () => {
  const bridge = permission.createBridge();
  let settled = "unset";
  const id = bridge.hold({ sessionId: "A", form: "PermissionRequest", settle: (e) => (settled = e) });
  const env = bridge.resolve(id, { decision: "allow", message: "go" });
  assert.equal(env.hookSpecificOutput.hookEventName, "PermissionRequest");
  assert.equal(env.hookSpecificOutput.decision.behavior, "allow");
  // message is NOT forwarded onto the nested decision (unverified field).
  assert.ok(!("message" in env.hookSpecificOutput.decision));
  assert.equal(settled, env);
  assert.equal(bridge.pending().length, 0);
});

test("bridge.resolve picks the PreToolUse flat form and routes message -> reason", () => {
  const bridge = permission.createBridge();
  const id = bridge.hold({ sessionId: "A", form: "PreToolUse", settle: () => {} });
  const env = bridge.resolve(id, { decision: "allow", message: "scoped allow" });
  assert.equal(env.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(env.hookSpecificOutput.permissionDecision, "allow");
  assert.equal(env.hookSpecificOutput.permissionDecisionReason, "scoped allow");
});

test("bridge.resolve returns null for an unknown id (never synthesizes)", () => {
  const bridge = permission.createBridge();
  assert.equal(bridge.resolve("nope", { decision: "allow" }), null);
});

// ── bridge: cancel / timeout = no-decision (null, never allow/deny) ───────────

test("bridge.cancel is no-decision (settles null, never synthesizes allow/deny)", () => {
  const bridge = permission.createBridge();
  let settled = "unset";
  const id = bridge.hold({ sessionId: "A", form: "PermissionRequest", settle: (e) => (settled = e) });
  assert.equal(bridge.cancel(id), true);
  assert.equal(settled, null);
  assert.equal(bridge.pending().length, 0);
  assert.equal(bridge.cancel(id), false); // already gone
});

test("bridge timeout auto-settles as no-decision (null)", async () => {
  const bridge = permission.createBridge();
  let settled = "unset";
  bridge.hold({
    sessionId: "A",
    form: "PermissionRequest",
    settle: (e) => (settled = e),
    timeoutMs: 10,
  });
  assert.equal(bridge.pending().length, 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, null); // timed out -> no-decision, not allow/deny
  assert.equal(bridge.pending().length, 0);
});

test("bridge.resolve before timeout wins and cancels the pending timer", async () => {
  const bridge = permission.createBridge();
  let settled = "unset";
  const id = bridge.hold({
    sessionId: "A",
    form: "PermissionRequest",
    settle: (e) => (settled = e),
    timeoutMs: 30,
  });
  bridge.resolve(id, { decision: "deny" });
  assert.equal(settled.hookSpecificOutput.decision.behavior, "deny");
  // Wait past the original deadline: settle must not be called a second time.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(settled.hookSpecificOutput.decision.behavior, "deny");
});
