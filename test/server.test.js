"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { startServer } = require("../src/main/server");

function request(base, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      base + path,
      { method, headers: data ? { "Content-Type": "application/json" } : {} },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Send a raw (possibly malformed) body without forcing JSON content-type.
function requestRaw(base, method, path, raw) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    if (raw != null) req.write(raw);
    req.end();
  });
}

test("/healthz returns ok + protocol", async () => {
  const srv = await startServer({ port: 0 });
  const res = await request(srv.url, "GET", "/healthz");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, protocol: "claude-pet.v1" });
  await srv.close();
});

test("/state acks 204 and forwards parsed payload to onEvent", async () => {
  let got = null;
  const srv = await startServer({ port: 0, onEvent: (p) => (got = p) });
  const res = await request(srv.url, "POST", "/state", { event: "Stop", sessionId: "A" });
  assert.equal(res.status, 204);
  await new Promise((r) => setTimeout(r, 20)); // onEvent runs after ack
  assert.equal(got.sessionId, "A");
  await srv.close();
});

test("/state stays 204 and never calls onEvent on malformed JSON", async () => {
  let called = false;
  const srv = await startServer({ port: 0, onEvent: () => (called = true) });
  const res = await requestRaw(srv.url, "POST", "/state", "{ not json");
  assert.equal(res.status, 204);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(called, false, "malformed payload must not reach onEvent");
  await srv.close();
});

test("/state 204 is unaffected by a throwing onEvent", async () => {
  const srv = await startServer({
    port: 0,
    onEvent: () => {
      throw new Error("boom");
    },
  });
  const res = await request(srv.url, "POST", "/state", { event: "Stop", sessionId: "A" });
  assert.equal(res.status, 204);
  await new Promise((r) => setTimeout(r, 20));
  // server is still alive after a throwing handler
  const health = await request(srv.url, "GET", "/healthz");
  assert.equal(health.status, 200);
  await srv.close();
});

test("/permission with no bridge returns 204 no-decision", async () => {
  const srv = await startServer({ port: 0 });
  const res = await request(srv.url, "POST", "/permission", { sessionId: "A" });
  assert.equal(res.status, 204);
  assert.equal(res.body, "");
  await srv.close();
});

test("/permission settles 200 JSON when onPermission resolves", async () => {
  const srv = await startServer({
    port: 0,
    onPermission: (_payload, settle) => {
      settle({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    },
  });
  const res = await request(srv.url, "POST", "/permission", { sessionId: "A" });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).hookSpecificOutput.decision.behavior, "allow");
  await srv.close();
});

test("/permission settle(null) returns 204 no-decision (no synthesized allow/deny)", async () => {
  const srv = await startServer({
    port: 0,
    onPermission: (_payload, settle) => settle(null),
  });
  const res = await request(srv.url, "POST", "/permission", { sessionId: "A" });
  assert.equal(res.status, 204);
  assert.equal(res.body, "");
  await srv.close();
});

test("/permission settle is idempotent (second settle is ignored)", async () => {
  const srv = await startServer({
    port: 0,
    onPermission: (_payload, settle) => {
      settle({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } });
      settle(null); // must not overwrite the already-sent 200 body
    },
  });
  const res = await request(srv.url, "POST", "/permission", { sessionId: "A" });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).hookSpecificOutput.decision.behavior, "deny");
  await srv.close();
});

test("malformed /permission body returns 204 without invoking onPermission", async () => {
  let called = false;
  const srv = await startServer({ port: 0, onPermission: () => (called = true) });
  const res = await requestRaw(srv.url, "POST", "/permission", "{ bad");
  assert.equal(res.status, 204);
  assert.equal(called, false);
  await srv.close();
});

test("/permission/:id/resolve settles the held hook request with a decision", async () => {
  let settleRef = null;
  let heldId = null;
  const srv = await startServer({
    port: 0,
    onPermission: (payload, settle) => {
      heldId = payload.id;
      settleRef = settle; // hold it; resolve via the internal endpoint
    },
  });

  // Open the blocking /permission request (do not await yet).
  const pending = request(srv.url, "POST", "/permission", { id: "req-1", sessionId: "A" });
  // Wait until the server has the request held.
  await waitFor(() => settleRef !== null);
  assert.equal(heldId, "req-1");

  // UI resolves it through the internal endpoint.
  const resolveRes = await request(srv.url, "POST", "/permission/req-1/resolve", {
    envelope: { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } },
  });
  assert.equal(resolveRes.status, 204);

  const permRes = await pending;
  assert.equal(permRes.status, 200);
  assert.equal(JSON.parse(permRes.body).hookSpecificOutput.decision.behavior, "allow");
  await srv.close();
});

test("/permission/:id/resolve with no body settles the held request as no-decision", async () => {
  let settleRef = null;
  const srv = await startServer({
    port: 0,
    onPermission: (_payload, settle) => (settleRef = settle),
  });
  const pending = request(srv.url, "POST", "/permission", { id: "req-2", sessionId: "A" });
  await waitFor(() => settleRef !== null);

  const resolveRes = await request(srv.url, "POST", "/permission/req-2/resolve");
  assert.equal(resolveRes.status, 204);

  const permRes = await pending;
  assert.equal(permRes.status, 204, "no body -> no-decision fallback");
  await srv.close();
});

test("/permission/:id/resolve for an unknown id is a harmless 204", async () => {
  const srv = await startServer({ port: 0, onPermission: () => {} });
  const res = await request(srv.url, "POST", "/permission/ghost/resolve", { envelope: null });
  assert.equal(res.status, 204);
  await srv.close();
});

test("unknown route is 404", async () => {
  const srv = await startServer({ port: 0 });
  const res = await request(srv.url, "GET", "/nope");
  assert.equal(res.status, 404);
  await srv.close();
});

test("binds loopback only", async () => {
  const srv = await startServer({ port: 0 });
  assert.equal(srv.host, "127.0.0.1");
  await srv.close();
});

test("a fixed busy port is discovered around the collision", async () => {
  // Occupy a fixed loopback port, then ask the server for the same one.
  const blocker = net.createServer(() => {});
  const busyPort = await new Promise((resolve) => {
    blocker.listen(0, "127.0.0.1", () => resolve(blocker.address().port));
  });

  const srv = await startServer({ port: busyPort, host: "127.0.0.1" });
  assert.notEqual(srv.port, busyPort, "should walk past the busy port");
  assert.ok(srv.port > busyPort, "discovers a nearby free port");

  // Sanity: the discovered server actually serves.
  const res = await request(srv.url, "GET", "/healthz");
  assert.equal(res.status, 200);

  await srv.close();
  await new Promise((r) => blocker.close(r));
});

test("close() drains a still-held permission request as no-decision", async () => {
  let settleRef = null;
  const srv = await startServer({
    port: 0,
    onPermission: (_payload, settle) => (settleRef = settle),
  });
  const pending = request(srv.url, "POST", "/permission", { id: "req-3", sessionId: "A" });
  await waitFor(() => settleRef !== null);

  await srv.close(); // should settle the open request, not hang
  const res = await pending;
  assert.equal(res.status, 204, "drained held request -> no-decision");
});

function waitFor(pred, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 5);
    };
    tick();
  });
}
