"use strict";
/**
 * Loopback HTTP server (component ①) — receives Claude Code hook events and
 * holds blocking permission requests. NO electron (plain node:http), so it can
 * be smoke-tested without a GUI.
 *
 * Endpoints (docs/05 §5):
 *   GET  /healthz                  -> 200 {ok:true, protocol}
 *   POST /state                    -> always fast 204 (fire-and-forget)
 *   POST /permission               -> held until UI resolves (onPermission)
 *   POST /permission/:id/resolve   -> 204 (internal UI -> server)
 *
 * Binds 127.0.0.1 only. Blocking semantics follow build-plan §0 "hook 수신(http)":
 * a request is only blocked by a 2xx + JSON body; non-2xx / no-body is treated
 * by Claude Code as a non-blocking error, so the no-decision fallback writes a
 * bare 204 and NEVER synthesizes an allow/deny (docs/05 §4.2).
 */
const http = require("node:http");
const C = require("../shared/constants");

// Body guard: hook payloads are small; reject anything pathological.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
// How many ephemeral ports to try when a fixed port is taken (docs/05 §5
// "포트는 충돌 시 탐색"). 0 means "OS picks", so collision discovery only kicks
// in for an explicitly requested busy port.
const PORT_PROBE_TRIES = 64;

/**
 * Start the local server.
 * @param {Object} opts
 * @param {number} [opts.port=0]   0 = OS-assigned ephemeral port
 * @param {string} [opts.host="127.0.0.1"]
 * @param {function(Object):void} [opts.onEvent]       called with each /state payload
 * @param {function(Object, function(?Object):void):void} [opts.onPermission]
 *        called with (payload, settle); settle(envelope|null) writes the reply.
 *        settle(envelope) -> 200 JSON (blocking decision); settle(null) -> 204
 *        no-decision (native fallback). settle is idempotent.
 * @returns {Promise<{port:number, host:string, url:string, close:function():Promise<void>}>}
 */
function startServer(opts = {}) {
  const host = opts.host || "127.0.0.1";
  const onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};
  const onPermission =
    typeof opts.onPermission === "function" ? opts.onPermission : null;

  // Held permission requests keyed by id, so POST /permission/:id/resolve can
  // settle the still-open hook request from the UI side (docs/05 §5).
  const held = new Map(); // id -> { settle(envelope|null), payload }
  let seq = 0;

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    const method = req.method || "GET";

    if (method === "GET" && url === "/healthz") {
      return sendJson(res, 200, { ok: true, protocol: C.PROTOCOL });
    }

    if (method === "POST" && url === "/state") {
      // fire-and-forget: ack immediately, parse best-effort so a malformed
      // payload can never make the hook block (build-plan §0).
      res.statusCode = 204;
      res.end();
      readBody(req)
        .then((body) => {
          let payload;
          try {
            payload = JSON.parse(body);
          } catch {
            return; // malformed -> drop, hook already got its 204
          }
          try {
            onEvent(payload);
          } catch {
            /* onEvent must never affect the (already-sent) hook response */
          }
        })
        .catch(() => {});
      return;
    }

    if (method === "POST" && url === "/permission") {
      return readBody(req)
        .then((body) => {
          let payload;
          try {
            payload = JSON.parse(body);
          } catch {
            return sendJson(res, 204, null); // malformed -> no-decision
          }
          if (!onPermission) {
            // No UI bridge wired -> no-decision fallback (native prompt).
            return sendJson(res, 204, null);
          }

          const id = pickId(payload, ++seq);
          let settled = false;
          const settle = (envelope) => {
            if (settled) return;
            settled = true;
            held.delete(id);
            if (envelope) sendJson(res, 200, envelope);
            else sendJson(res, 204, null); // no-decision -> native fallback
          };
          // If Claude Code (or the test client) hangs up before we settle,
          // forget the held request so it cannot leak.
          res.on("close", () => {
            if (!settled) {
              settled = true;
              held.delete(id);
            }
          });

          held.set(id, { settle, payload });
          try {
            onPermission(payload, settle);
          } catch {
            // a throwing bridge must not block the agent
            settle(null);
          }
        })
        .catch(() => {
          sendJson(res, 204, null);
        });
    }

    const resolveMatch = url.match(/^\/permission\/([^/]+)\/resolve$/);
    if (method === "POST" && resolveMatch) {
      const id = decodeURIComponent(resolveMatch[1]);
      // The UI tells the server how to settle the still-open /permission
      // request. Ack the UI immediately with 204; the held hook request gets
      // the actual decision body.
      return readBody(req).then((body) => {
        let decision = null;
        try {
          decision = body ? JSON.parse(body) : null;
        } catch {
          decision = null;
        }
        const entry = held.get(id);
        if (entry) {
          // decision === null (or missing) => no-decision settle.
          entry.settle(decision && decision.envelope ? decision.envelope : decision);
        }
        res.statusCode = 204;
        res.end();
      }).catch(() => {
        if (!res.writableEnded) {
          res.statusCode = 204;
          res.end();
        }
      });
    }

    sendJson(res, 404, { ok: false });
  });

  // Settle every still-open permission request as no-decision on shutdown so
  // closing the app never hangs the agent (docs/05 §4.2).
  const drainHeld = () => {
    for (const [, entry] of held) {
      try {
        entry.settle(null);
      } catch {
        /* ignore */
      }
    }
    held.clear();
  };

  return listenWithProbe(server, opts.port || 0, host).then((port) => ({
    port,
    host,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve) => {
        drainHeld();
        // Drop idle keep-alive sockets so close() resolves promptly and never
        // leaves a lingering handle (Node 18.2+).
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        server.close(() => resolve());
      }),
  }));
}

/**
 * Listen on `port`; if a *fixed* port is in use, probe a window of nearby
 * ports (docs/05 §5 collision discovery). Port 0 lets the OS choose and never
 * collides, so it returns on the first listen.
 * @param {import('node:http').Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<number>} the actually-bound port
 */
function listenWithProbe(server, port, host) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const start = port;

    const onError = (err) => {
      // Only walk forward for a busy *fixed* port; everything else is fatal.
      if (err && err.code === "EADDRINUSE" && start !== 0 && attempt < PORT_PROBE_TRIES) {
        attempt += 1;
        tryListen(start + attempt);
        return;
      }
      cleanup();
      reject(err);
    };

    const onListening = () => {
      const addr = server.address();
      const bound = typeof addr === "object" && addr ? addr.port : start;
      cleanup();
      resolve(bound);
    };

    function cleanup() {
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
    }

    function tryListen(p) {
      server.listen(p, host);
    }

    server.on("error", onError);
    server.on("listening", onListening);
    tryListen(start);
  });
}

/**
 * Derive a stable id for a held permission request.
 * @param {Object} payload
 * @param {number} fallbackSeq
 * @returns {string}
 */
function pickId(payload, fallbackSeq) {
  if (payload && typeof payload === "object") {
    if (typeof payload.id === "string" && payload.id) return payload.id;
    if (typeof payload.sessionId === "string" && payload.sessionId) {
      return payload.sessionId; // Phase 0 fallback: one in-flight per session
    }
  }
  return `perm-${fallbackSeq}`;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      if (tooBig) return;
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        tooBig = true;
        data = "";
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(data));
    req.on("aborted", () => resolve(data));
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {?Object} obj
 */
function sendJson(res, status, obj) {
  if (res.writableEnded || res.headersSent) return;
  res.statusCode = status;
  if (obj == null || status === 204) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

module.exports = { startServer };
