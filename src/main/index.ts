/**
 * App entry — the main glue. Boots the pet window, initializes the module stubs
 * (assets / server / state / permission / hooks), wires IPC, and (Phase 0)
 * replays a mock scenario so the renderer is visible without Claude Code.
 *
 * Electron-runtime code lives ONLY here and in window.ts. Everything imported
 * below (state, permission, assets, server, hooks-install) is electron-free and
 * unit-tested with `node --test`.
 */
import { app, ipcMain, BrowserWindow } from "electron";

import * as C from "../shared/constants";
import * as win from "./window";
import * as assets from "./assets";
import * as state from "./state";
import * as permission from "./permission";
import * as server from "./server";
import * as hooksInstall from "./hooks-install";
import { SCENARIOS } from "./mock-scenarios";
import type { PetAsset, PermissionDecision, StatePayload, WirePayload } from "../shared/types";

// Hook wiring is opt-out via env so a headless/demo launch can run without
// touching ~/.claude/settings.json (Phase 0 mock playback). Default = install.
const HOOKS_DISABLED =
  /^(0|false|no)$/i.test(process.env.CLAUDE_PET_HOOKS || "") ||
  /^(1|true|yes)$/i.test(process.env.CLAUDE_PET_NO_HOOKS || "");

// ── module instances (electron-free cores) ───────────────────────────────
const store = state.createStore();
const bridge = permission.createBridge();

// permission request id -> sessionId, so a UI decision can advance the right
// session even when the wire id (perm request) differs from the session id.
const permSession = new Map<string, string>();

let petWindow: BrowserWindow | null = null;
let httpServer: Awaited<ReturnType<typeof server.startServer>> | null = null;
let hooksInstalled = false; // true once installHooks has registered our hooks
let petAsset: PetAsset | null = null; // resolved sprite descriptor or null (renderer falls back to 🐾)
let mockTimers: NodeJS.Timeout[] = [];

/**
 * Push the current snapshot (+ resolved pet asset) to the renderer.
 */
function pushState(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const snap: StatePayload = state.snapshot(store);
  snap.petAsset = petAsset; // {spritesheetUrl, frameW, frameH, atlas} | null
  petWindow.webContents.send(C.IPC.STATE, snap);
}

/**
 * Resolve a pet sprite to hand the renderer. Discovers ~/.codex/pets and loads
 * the first; null => renderer uses the 🐾 fallback (build-plan exit allows no
 * asset conversion). Never throws.
 */
function resolvePetAsset(): void {
  try {
    const pets = assets.discoverPets();
    if (pets.length) petAsset = assets.loadPet(pets[0].slug);
  } catch {
    petAsset = null;
  }
}

/**
 * Wire renderer -> main IPC.
 */
function wireIpc(): void {
  ipcMain.on(C.IPC.SET_INTERACTIVE, (_e, interactive) => {
    win.setInteractive(petWindow, !!interactive);
  });

  // Reply typing needs a key window. The pet is a non-activating panel created
  // with focusable:false (never steals focus at rest); promote it to focusable +
  // key only while a reply field is open, then drop back so it stays unobtrusive.
  ipcMain.on(C.IPC.SET_REPLY_FOCUS, (_e, on) => {
    win.setReplyFocus(petWindow, !!on);
  });

  // Drag the pet across monitors. Main repositions from the global cursor point
  // each tick so the window crosses monitor gaps and survives mixed HiDPI scales.
  ipcMain.on(C.IPC.DRAG_START, () => win.startDrag(petWindow));
  ipcMain.on(C.IPC.DRAG_MOVE, () => win.dragMove(petWindow));
  ipcMain.on(C.IPC.DRAG_END, () => win.endDrag());

  ipcMain.on(C.IPC.SEND_REPLY, (_e, payload) => {
    // Phase 0: no Claude Code to deliver to; just log + keep state coherent.
    if (payload && payload.sessionId) {
      const s = store.sessions.get(payload.sessionId);
      if (s) s.updatedAt = ++store.seq;
      pushState();
    }
  });

  ipcMain.on(C.IPC.RESOLVE_PERMISSION, (_e, { id, decision, message } = {}) => {
    const verdict: PermissionDecision = decision === "deny" ? "deny" : "allow";

    // Settle the held HTTP request via the bridge. The bridge picks the right
    // wire envelope for the request form and settles the open /permission
    // response; an unknown id (e.g. a Phase 0 mock with no real request) is a
    // harmless null. NEVER synthesizes allow/deny outside this user decision.
    bridge.resolve(id, { decision: verdict, message });

    // Advance the matching session. The renderer sends the permission id
    // (pendingPermission.id), which we mapped to a sessionId at hold time; fall
    // back to treating the id itself as the sessionId for the Phase 0 mock
    // (where id === sessionId and no HTTP request was opened).
    const sessionId = permSession.get(id) || id;
    permSession.delete(id);
    state.resolvePermission(store, sessionId, verdict);
    pushState();

    // Phase 0 demo continuation only — real flows are driven by Claude Code's
    // follow-on /state events, so skip the canned tail when hooks are live.
    if (HOOKS_DISABLED) replayContinuation(sessionId, verdict);
  });
}

/**
 * Start the loopback server.
 *   /state       -> state.applyEvent -> push snapshot to the renderer.
 *   /permission  -> held open via the bridge; the card UI decides allow/deny and
 *                   IPC.RESOLVE_PERMISSION settles it. Until then the request
 *                   blocks; on app close / disconnect the server drains it to a
 *                   no-decision (native fallback, never a synthesized verdict).
 */
async function startLocalServer(): Promise<void> {
  httpServer = await server.startServer({
    onEvent: (payload: WirePayload) => {
      state.applyEvent(store, payload);
      pushState();
    },
    onPermission: (payload: WirePayload, settle: (envelope: object | null) => void) => {
      const p = payload && typeof payload === "object" ? payload : {};
      const sessionId = p.sessionId || p.session_id || p.s || "unknown";

      // Coordinate ONE id across the three views of this request:
      //   - the bridge (settles the held HTTP response),
      //   - state.pendingPermission.id (what the renderer echoes back),
      //   - permSession (so RESOLVE_PERMISSION advances the right session).
      // Prefer a wire-supplied request id; otherwise the bridge mints one.
      const wireId = pickPermId(p);
      const id = bridge.hold({
        id: wireId,
        sessionId,
        form: "PermissionRequest", // interactive PermissionRequest hook (build-plan §0)
        settle,
        meta: p.perm && typeof p.perm === "object" ? p.perm : {},
      });
      permSession.set(id, sessionId);

      // Stamp the negotiated id onto the perm descriptor so state.pickPerm
      // surfaces it as pendingPermission.id and the renderer resolves THIS id.
      const perm = withPermId(p, id);
      state.applyEvent(store, perm);
      pushState();
    },
  });
}

/**
 * Extract a wire-supplied permission request id, if any, from a hook payload.
 */
function pickPermId(p: WirePayload): string | undefined {
  const raw = p.perm || p.permission || p.permissionRequest || {};
  const cand =
    p.id ||
    p.requestId ||
    p.request_id ||
    (raw && (raw.id || raw.requestId || raw.request_id));
  return typeof cand === "string" && cand ? cand : undefined;
}

/**
 * Return a shallow copy of the permission payload with `id` stamped onto its
 * perm descriptor, so state.applyEvent records pendingPermission.id === id.
 */
function withPermId(p: WirePayload, id: string): WirePayload {
  const rawPerm = p.perm && typeof p.perm === "object" ? p.perm : {};
  return { ...p, kind: "PermissionRequest", perm: { ...rawPerm, id } };
}

// ── Phase 0 mock playback ─────────────────────────────────────────────────
function clearMock(): void {
  mockTimers.forEach(clearTimeout);
  mockTimers = [];
}

/**
 * Replay a named mock scenario through the real store so the renderer paints.
 */
function replayScenario(key = "single"): void {
  clearMock();
  store.sessions.clear();
  store.seq = 0;
  const events = SCENARIOS[key] || SCENARIOS.single;
  for (const ev of events) {
    mockTimers.push(
      setTimeout(() => {
        state.applyEvent(store, ev);
        pushState();
      }, ev.t)
    );
  }
}

/**
 * After a mock permission decision, schedule a short continuation so the demo
 * resolves visibly (Phase 0 only).
 */
function replayContinuation(sessionId: string, decision: PermissionDecision): void {
  const tail: WirePayload[] =
    decision === "allow"
      ? [
          { t: 200, kind: "PostToolUse", sessionId },
          { t: 1100, kind: "Stop", sessionId, body: "정리 후 재빌드 완료. 이어서 진행할게요." },
        ]
      : [{ t: 200, kind: "Stop", sessionId, body: "알겠습니다. 그 명령은 건너뛰고 다른 방법을 찾을게요." }];
  for (const ev of tail) {
    mockTimers.push(
      setTimeout(() => {
        state.applyEvent(store, ev);
        pushState();
      }, ev.t)
    );
  }
}

// ── hook lifecycle ─────────────────────────────────────────────────────────
/**
 * Register our http hooks in ~/.claude/settings.json so Claude Code POSTs
 * events to the just-bound loopback port. Idempotent (the installer strips its
 * prior entries and re-adds the current port), so running on every launch keeps
 * the registration converged to the live port. Opt out with CLAUDE_PET_HOOKS=0
 * / CLAUDE_PET_NO_HOOKS=1 (Phase 0 demo). Never throws.
 */
function setupHooks(): void {
  if (HOOKS_DISABLED || !httpServer) return;
  try {
    hooksInstall.installHooks({ port: httpServer.port, host: httpServer.host });
    hooksInstalled = true;
  } catch {
    hooksInstalled = false; // a broken settings.json must not block startup
  }
}

/**
 * Remove only our hooks on quit so an absent app never leaves Claude Code
 * POSTing to a dead port (build-plan Phase 1 "언인스톨"). Never throws.
 */
function teardownHooks(): void {
  if (!hooksInstalled) return;
  try {
    hooksInstall.uninstallHooks();
  } catch {
    /* best-effort cleanup */
  }
  hooksInstalled = false;
}

// ── lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  resolvePetAsset();
  wireIpc();
  await startLocalServer();
  setupHooks(); // register http hooks for the bound port (first run + every run)

  petWindow = win.createPetWindow();
  petWindow.webContents.once("did-finish-load", () => {
    pushState();
    // Phase 0: replay a mock so the renderer is visible WITHOUT Claude Code.
    // When hooks are live, real /state events drive the store instead.
    if (HOOKS_DISABLED) replayScenario("single");
  });
  petWindow.on("closed", () => {
    petWindow = null;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      petWindow = win.createPetWindow();
    }
  });
});

// Pet is a background overlay: keep running with no windows on macOS, but exit
// elsewhere per platform convention.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  clearMock();
  teardownHooks(); // uninstall our hooks so Claude Code stops POSTing
  if (httpServer) await httpServer.close();
});

// Exported for potential test harnesses / future scenario switcher.
export { replayScenario };
