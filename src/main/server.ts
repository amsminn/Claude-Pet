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
import * as http from "node:http";
import * as C from "../shared/constants";
import type { WirePayload } from "../shared/types";

// Body guard: hook payloads are small; reject anything pathological.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
// How many ephemeral ports to try when a fixed port is taken (docs/05 §5
// "포트는 충돌 시 탐색"). 0 means "OS picks", so collision discovery only kicks
// in for an explicitly requested busy port.
const PORT_PROBE_TRIES = 64;

/**
 * Start the local server.
 * @param opts.port          0 = OS-assigned ephemeral port
 * @param opts.host          defaults to "127.0.0.1"
 * @param opts.onEvent       called with each /state payload
 * @param opts.onPermission  called with (payload, settle); settle(envelope|null)
 *        writes the reply. settle(envelope) -> 200 JSON (blocking decision);
 *        settle(null) -> 204 no-decision (native fallback). settle is idempotent.
 */
function startServer(
  opts: {
    port?: number;
    host?: string;
    onEvent?: (payload: WirePayload) => void;
    onPermission?: (payload: WirePayload, settle: (env: object | null) => void) => void;
    onReply?: (payload: WirePayload, settle: (env: object | null) => void) => void;
  } = {}
): Promise<{
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}> {
  const host = opts.host || "127.0.0.1";
  const onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};
  const onPermission =
    typeof opts.onPermission === "function" ? opts.onPermission : null;
  const onReply = typeof opts.onReply === "function" ? opts.onReply : null;

  // Held blocking requests keyed by id, so POST /permission/:id/resolve can
  // settle the still-open hook request from the UI side (docs/05 §5).
  const held = new Map<string, { settle: (env: object | null) => void; payload: WirePayload }>(); // id -> { settle(envelope|null), payload }
  let seq = 0;

  // Shared blocking transport for /permission and /reply: hold the HTTP response
  // until `handler` settles it with an envelope (200 JSON = decision/reply) or
  // null (204 = no-decision / let the agent continue). Idempotent settle.
  function handleBlocking(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    handler: ((payload: WirePayload, settle: (env: object | null) => void) => void) | null
  ): Promise<void> {
    return readBody(req)
      .then((body) => {
        let payload: WirePayload;
        try {
          payload = JSON.parse(body);
        } catch {
          return sendJson(res, 204, null);
        }
        if (!handler) return sendJson(res, 204, null);
        const id = pickId(payload, ++seq);
        let settled = false;
        const settle = (envelope: object | null) => {
          if (settled) return;
          settled = true;
          held.delete(id);
          if (envelope) sendJson(res, 200, envelope);
          else sendJson(res, 204, null);
        };
        res.on("close", () => {
          if (!settled) {
            settled = true;
            held.delete(id);
          }
        });
        held.set(id, { settle, payload });
        try {
          handler(payload, settle);
        } catch {
          settle(null);
        }
      })
      .catch(() => {
        sendJson(res, 204, null);
      });
  }

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
          let payload: WirePayload;
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

    // Interactive permission decision (allow/deny) — held until the UI resolves.
    if (method === "POST" && url === "/permission") {
      return handleBlocking(req, res, onPermission);
    }

    // Free-text reply on Stop — held (only when "대화 모드" is on; otherwise the
    // glue settles null immediately so the agent stops normally).
    if (method === "POST" && url === "/reply") {
      return handleBlocking(req, res, onReply);
    }

    const resolveMatch = url.match(/^\/permission\/([^/]+)\/resolve$/);
    if (method === "POST" && resolveMatch) {
      const id = decodeURIComponent(resolveMatch[1]);
      // The UI tells the server how to settle the still-open /permission
      // request. Ack the UI immediately with 204; the held hook request gets
      // the actual decision body.
      return readBody(req).then((body) => {
        let decision: any = null;
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
      new Promise<void>((resolve) => {
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
 * @returns the actually-bound port
 */
function listenWithProbe(
  server: http.Server,
  port: number,
  host: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const start = port;

    const onError = (err: NodeJS.ErrnoException) => {
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

    function tryListen(p: number) {
      server.listen(p, host);
    }

    server.on("error", onError);
    server.on("listening", onListening);
    tryListen(start);
  });
}

/**
 * Derive a stable id for a held permission request.
 */
function pickId(payload: WirePayload, fallbackSeq: number): string {
  if (payload && typeof payload === "object") {
    if (typeof payload.id === "string" && payload.id) return payload.id;
    if (typeof payload.sessionId === "string" && payload.sessionId) {
      return payload.sessionId; // Phase 0 fallback: one in-flight per session
    }
  }
  return `perm-${fallbackSeq}`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
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

function sendJson(
  res: http.ServerResponse,
  status: number,
  obj: object | null
): void {
  if (res.writableEnded || res.headersSent) return;
  res.statusCode = status;
  if (obj == null || status === 204) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

export { startServer };
