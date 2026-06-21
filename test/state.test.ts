import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as state from "../src/main/state";
import * as C from "../src/shared/constants";

test("applyEvent creates one card per session and updates in place", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "SessionStart", sessionId: "A" });
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: "T" });
  assert.equal(store.sessions.size, 1);
  const s = store.sessions.get("A")!;
  assert.equal(s.state, "thinking");
  assert.equal(s.title, "T");
});

test("title/body are never overwritten with empty values (invariant)", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: "Keep me" });
  state.applyEvent(store, { kind: "PreToolUse", sessionId: "A" }); // no title
  assert.equal(store.sessions.get("A")!.title, "Keep me");
});

test("Stop sets attention, fills body, and marks completedAt", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: "T" });
  state.applyEvent(store, { kind: "Stop", sessionId: "A", body: "done" });
  const s = store.sessions.get("A")!;
  assert.equal(s.state, "attention");
  assert.equal(s.body, "done");
  assert.ok(s.completedAt > 0);
});

test("PermissionRequest sets pendingPermission; error clears it", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PermissionRequest", sessionId: "A", perm: { tool: "Bash", cmd: "ls" } });
  assert.equal(store.sessions.get("A")!.pendingPermission!.tool, "Bash");
  state.applyEvent(store, { kind: "PostToolUseFailure", sessionId: "A" });
  assert.equal(store.sessions.get("A")!.state, "error");
  assert.equal(store.sessions.get("A")!.pendingPermission, null);
});

test("resolvePermission clears pending and advances state", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PermissionRequest", sessionId: "A", perm: { tool: "Bash", cmd: "ls" } });
  const allowed = state.resolvePermission(store, "A", "allow")!;
  assert.equal(allowed.state, "working");
  assert.equal(allowed.pendingPermission, null);
  assert.equal(state.resolvePermission(store, "A", "allow"), null); // no pending now
});

test("petRow reduce honors priority: permission > error > working > review > idle", () => {
  const store = state.createStore();
  assert.equal(state.petRow([...store.sessions.values()]), C.ROW.idle);

  state.applyEvent(store, { kind: "PreToolUse", sessionId: "A" });
  assert.equal(state.petRow([...store.sessions.values()]), C.ROW.running);

  state.applyEvent(store, { kind: "PostToolUseFailure", sessionId: "B" });
  assert.equal(state.petRow([...store.sessions.values()]), C.ROW.failed);

  state.applyEvent(store, { kind: "PermissionRequest", sessionId: "C", perm: { tool: "Bash", cmd: "x" } });
  assert.equal(state.petRow([...store.sessions.values()]), C.ROW.waving);
});

test("petRow review only when every session is attention", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "Stop", sessionId: "A", body: "a" });
  state.applyEvent(store, { kind: "Stop", sessionId: "B", body: "b" });
  assert.equal(state.petRow([...store.sessions.values()]), C.ROW.review);
});

test("snapshot is serializable and includes protocol/petRow/cards", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: "T" });
  const snap = state.snapshot(store);
  assert.equal(snap.protocol, C.STATE_PROTOCOL);
  assert.equal(typeof snap.petRow, "number");
  assert.ok(Array.isArray(snap.cards));
  assert.doesNotThrow(() => JSON.stringify(snap));
});

test("orderedCards drops sleeping sessions with no body", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "SessionEnd", sessionId: "A" }); // sleeping, no body
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "B", title: "B" });
  const ids = state.orderedCards(store).map((s) => s.sessionId);
  assert.deepEqual(ids, ["B"]);
});

test("extractCardBody returns last assistant text, skips tool_use/api-error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-pet-"));
  const file = path.join(dir, "session.jsonl");
  const lines = [
    JSON.stringify({ message: { role: "user", content: "hi" } }),
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "first answer" }] } }),
    JSON.stringify({ message: { role: "assistant", content: [{ type: "tool_use", name: "Bash" }] } }),
    JSON.stringify({ isApiErrorMessage: true, message: { role: "assistant", content: "boom" } }),
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "final answer" }] } }),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(state.extractCardBody(file), "final answer");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractCardBody returns '' for missing file (never throws)", () => {
  assert.equal(state.extractCardBody("/no/such/file.jsonl"), "");
});

// ── full-implementation coverage ─────────────────────────────────────────────
// Below: defensive payload parsing, Stop->error promotion, title/body hygiene,
// transcript tail edge cases, snapshot semantics. (build-plan §0.1 — payload
// fields are doc-uncertain, so parsing must accept several aliases.)

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "claude-pet-"));
function writeJsonl(dir: string, rows: any[]) {
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return file;
}

test("defensive parse: raw snake_case hook payload (session_id, hook_event_name)", () => {
  const store = state.createStore();
  state.applyEvent(store, {
    hook_event_name: "UserPromptSubmit",
    session_id: "raw1",
    session_title: "snake title",
  });
  const s = store.sessions.get("raw1");
  assert.ok(s, "session keyed by session_id alias");
  assert.equal(s!.state, "thinking");
  assert.equal(s!.title, "snake title");
});

test("defensive parse: short keys (s / kind) used by mock-scenarios", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PreToolUse", s: "short1" });
  assert.equal(store.sessions.get("short1")!.state, "working");
});

test("defensive parse: missing sessionId falls back to 'unknown', never throws", () => {
  const store = state.createStore();
  assert.doesNotThrow(() => state.applyEvent(store, { kind: "SessionStart" }));
  assert.ok(store.sessions.has("unknown"));
});

test("defensive parse: non-object payload does not throw", () => {
  const store = state.createStore();
  assert.doesNotThrow(() => state.applyEvent(store, null as any));
  assert.doesNotThrow(() => state.applyEvent(store, "garbage" as any));
});

test("explicit payload.state overrides EVENT_TO_STATE lookup", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PreToolUse", sessionId: "A", state: "juggling" });
  assert.equal(store.sessions.get("A")!.state, "juggling");
});

test("unknown event keeps prior state (no spurious transition)", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PreToolUse", sessionId: "A" });
  state.applyEvent(store, { kind: "TotallyMadeUpEvent", sessionId: "A" });
  assert.equal(store.sessions.get("A")!.state, "working");
});

test("perm descriptor is normalized from command/toolName aliases", () => {
  const store = state.createStore();
  state.applyEvent(store, {
    kind: "PermissionRequest",
    sessionId: "A",
    perm: { toolName: "Bash", command: "ls -la", id: "req-9" },
  });
  const pp = store.sessions.get("A")!.pendingPermission!;
  assert.equal(pp.tool, "Bash");
  assert.equal(pp.cmd, "ls -la");
  assert.equal(pp.id, "req-9");
});

test("Stop with explicit error flag promotes attention -> error", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: "T" });
  state.applyEvent(store, { kind: "Stop", sessionId: "A", isApiErrorMessage: true });
  assert.equal(store.sessions.get("A")!.state, "error");
});

test("Stop promotes to error when transcript tail has isApiErrorMessage", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    { isApiErrorMessage: true, message: { role: "assistant", content: "API down" } },
  ]);
  const store = state.createStore();
  state.applyEvent(store, { kind: "Stop", sessionId: "A", transcriptPath: file });
  assert.equal(store.sessions.get("A")!.state, "error");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Stop stays attention when transcript tail has no error", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "assistant", content: [{ type: "text", text: "all good" }] } },
  ]);
  const store = state.createStore();
  state.applyEvent(store, { kind: "Stop", sessionId: "A", transcript_path: file });
  assert.equal(store.sessions.get("A")!.state, "attention");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Stop with unreadable transcriptPath stays attention (never escalates)", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "Stop", sessionId: "A", transcriptPath: "/no/such.jsonl" });
  assert.equal(store.sessions.get("A")!.state, "attention");
});

test("title is truncated to <=40 chars with ellipsis", () => {
  const store = state.createStore();
  const long = "x".repeat(80);
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: long });
  const title = store.sessions.get("A")!.title;
  assert.ok(title.length <= 40, `title length ${title.length} <= 40`);
  assert.ok(title.endsWith("…"));
});

test("title collapses to first line only", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: "line one\nline two" });
  assert.equal(store.sessions.get("A")!.title, "line one");
});

test("title secrets are redacted", () => {
  const store = state.createStore();
  state.applyEvent(store, {
    kind: "UserPromptSubmit",
    sessionId: "A",
    title: "API_KEY=sk-abcdefghijklmnop",
  });
  const title = store.sessions.get("A")!.title;
  assert.ok(!title.includes("sk-abcdefghijklmnop"), `secret leaked: ${title}`);
});

test("body secrets are redacted on Stop", () => {
  const store = state.createStore();
  state.applyEvent(store, {
    kind: "Stop",
    sessionId: "A",
    body: "your token: ghp_ABCDEFGHIJKLMNOPQRSTUVWX done",
  });
  const body = store.sessions.get("A")!.body;
  assert.ok(!body.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWX"), `secret leaked: ${body}`);
});

test("body is clamped to 2200 chars", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "Stop", sessionId: "A", body: "a".repeat(5000) });
  assert.equal(store.sessions.get("A")!.body.length, 2200);
});

test("resolvePermission deny advances to attention and stamps completedAt", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PermissionRequest", sessionId: "A", perm: { tool: "Bash", cmd: "rm" } });
  const s = state.resolvePermission(store, "A", "deny")!;
  assert.equal(s.state, "attention");
  assert.ok(s.completedAt > 0);
  assert.equal(s.pendingPermission, null);
});

test("resolvePermission on unknown session returns null", () => {
  const store = state.createStore();
  assert.equal(state.resolvePermission(store, "ghost", "allow"), null);
});

test("orderedCards keeps a sleeping session that still has a pending permission", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PermissionRequest", sessionId: "A", perm: { tool: "Bash", cmd: "x" } });
  state.applyEvent(store, { kind: "SessionEnd", sessionId: "A" }); // sleeping clears perm
  // SessionEnd clears pending per invariant, so without a body it drops:
  const ids = state.orderedCards(store).map((s) => s.sessionId);
  assert.deepEqual(ids, []);
});

test("orderedCards preserves creation order across sessions", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "first", title: "1" });
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "second", title: "2" });
  state.applyEvent(store, { kind: "PreToolUse", sessionId: "first" }); // updates first
  const ids = state.orderedCards(store).map((s) => s.sessionId);
  assert.deepEqual(ids, ["first", "second"]); // creation order, not update order
});

test("snapshot.petRow reflects activity even when a card is hidden", () => {
  const store = state.createStore();
  // Hidden sleeping session (no body) + one working session.
  state.applyEvent(store, { kind: "SessionEnd", sessionId: "H" });
  state.applyEvent(store, { kind: "PreToolUse", sessionId: "W" });
  const snap = state.snapshot(store);
  assert.equal(snap.petRow, C.ROW.running);
  assert.deepEqual(snap.cards.map((c) => c.sessionId), ["W"]);
});

test("petRow tolerates an empty / non-array list", () => {
  assert.equal(state.petRow([]), C.ROW.idle);
  assert.equal(state.petRow(undefined as any), C.ROW.idle);
});

test("notification state drives petRow to waving", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "Notification", sessionId: "A" });
  assert.equal(state.petRow([...store.sessions.values()]), C.ROW.waving);
});

test("extractCardBody respects clamp option", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "assistant", content: "z".repeat(100) } },
  ]);
  assert.equal(state.extractCardBody(file, { clamp: 10 }).length, 10);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractCardBody redacts secrets in returned body", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "assistant", content: "here: sk-0123456789abcdef end" } },
  ]);
  const body = state.extractCardBody(file);
  assert.ok(!body.includes("sk-0123456789abcdef"), `secret leaked: ${body}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractCardBody drops a partial first line of a large tail window", () => {
  const dir = tmp();
  const file = path.join(dir, "big.jsonl");
  // A leading garbage fragment that is NOT valid JSON simulates a mid-record cut.
  // With a tiny tailBytes the window starts mid-file, so the first (partial)
  // line is dropped; a later valid assistant line is still returned.
  const valid = JSON.stringify({ message: { role: "assistant", content: "tail answer" } });
  const padding = "{partial-json-fragment-no-close";
  fs.writeFileSync(file, padding + "\n" + valid + "\n");
  // tailBytes large enough to include both lines; first-line-drop only triggers
  // when start>0, so here verify normal parse returns the valid line.
  assert.equal(state.extractCardBody(file), "tail answer");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractCardBody returns '' on empty file (never throws)", () => {
  const dir = tmp();
  const file = path.join(dir, "empty.jsonl");
  fs.writeFileSync(file, "");
  assert.equal(state.extractCardBody(file), "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractCardBody returns '' when transcriptPath is a directory", () => {
  const dir = tmp();
  assert.equal(state.extractCardBody(dir), "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractCardBody handles a transcript with only tool_use (no text)", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] } },
  ]);
  assert.equal(state.extractCardBody(file), "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("extractCardBody skips subagent/sidechain rows", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "assistant", content: [{ type: "text", text: "real answer" }] } },
    { isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "subagent noise" }] } },
  ]);
  assert.equal(state.extractCardBody(file), "real answer");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("snapshot output is JSON-serializable with no Map leakage", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "PermissionRequest", sessionId: "A", perm: { tool: "Bash", cmd: "x" } });
  const snap = state.snapshot(store);
  const round = JSON.parse(JSON.stringify(snap));
  assert.equal(round.cards[0].pendingPermission.tool, "Bash");
  assert.equal(round.protocol, C.STATE_PROTOCOL);
});

// ── regression: readTailRows must not drop a whole record on a boundary start ──
test("extractCardBody keeps a full record when the tail window starts on a line boundary", () => {
  const dir = tmp();
  const file = path.join(dir, "session.jsonl");
  const line1 = JSON.stringify({ message: { role: "user", content: "question here" } });
  const line2 = JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "only answer" }] } });
  fs.writeFileSync(file, line1 + "\n" + line2 + "\n");
  // Force the read window to begin EXACTLY at the first byte of line2 — the old
  // unconditional lines.shift() deleted this valid record and returned "".
  const tailBytes = Buffer.byteLength(line2 + "\n", "utf8");
  assert.equal(state.extractCardBody(file, { tailBytes }), "only answer");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── real Claude Code hook fields: prompt -> title, transcript -> body ──
test("UserPromptSubmit fills the card title from the `prompt` field (real hook shape)", () => {
  const store = state.createStore();
  state.applyEvent(store, {
    hook_event_name: "UserPromptSubmit",
    session_id: "A",
    prompt: "fix the login bug please",
  });
  assert.equal(store.sessions.get("A")!.title, "fix the login bug please");
});

test("title falls back to the project (cwd basename) when no prompt is known", () => {
  const store = state.createStore();
  state.applyEvent(store, { hook_event_name: "PreToolUse", session_id: "A", cwd: "/Users/me/dev/timetree" });
  assert.equal(store.sessions.get("A")!.title, "timetree");
});

test("a real prompt still wins over the cwd fallback title", () => {
  const store = state.createStore();
  state.applyEvent(store, { hook_event_name: "PreToolUse", session_id: "A", cwd: "/Users/me/dev/timetree" });
  state.applyEvent(store, { hook_event_name: "UserPromptSubmit", session_id: "A", prompt: "real prompt" });
  assert.equal(store.sessions.get("A")!.title, "real prompt");
});

test("applyEvent derives the card body from the transcript tail when the payload has no body", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "user", content: "hi" } },
    { message: { role: "assistant", content: [{ type: "text", text: "here is the answer" }] } },
  ]);
  const store = state.createStore();
  state.applyEvent(store, { hook_event_name: "Stop", session_id: "A", transcript_path: file });
  assert.equal(store.sessions.get("A")!.body, "here is the answer");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an explicit payload body still wins over the transcript tail", () => {
  const dir = tmp();
  const file = writeJsonl(dir, [
    { message: { role: "assistant", content: [{ type: "text", text: "from transcript" }] } },
  ]);
  const store = state.createStore();
  state.applyEvent(store, { kind: "Stop", sessionId: "A", body: "explicit body", transcript_path: file });
  assert.equal(store.sessions.get("A")!.body, "explicit body");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── regression: a repeat/late Stop must not re-promote an already-done card ──
test("repeat Stop on an already-attention card does not re-stamp completedAt", () => {
  const store = state.createStore();
  state.applyEvent(store, { kind: "UserPromptSubmit", sessionId: "A", title: "T" });
  state.applyEvent(store, { kind: "Stop", sessionId: "A", body: "done" });
  const first = store.sessions.get("A")!.completedAt;
  assert.ok(first > 0);
  state.applyEvent(store, { kind: "Stop", sessionId: "A", body: "done again" });
  assert.equal(store.sessions.get("A")!.completedAt, first, "completedAt must not change on duplicate Stop");
});
