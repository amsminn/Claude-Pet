/**
 * Hook installer — registers Claude-Pet's hooks into a Claude Code
 * settings.json. NO electron. Idempotent, preserves the user's existing hooks,
 * and removes only what we added on uninstall (docs/05 §2).
 *
 * Verified shape (build-plan §0 "훅 등록"): settings.hooks is keyed by event
 * name; each event holds matcher groups with a `hooks` array. Handler types
 * include `command` and `http`. We tag every group we own with
 * `_owner:'claude-pet'` so uninstall can find them again without touching
 * foreign hooks. Untagged registrations from older builds (pre-`_owner`) are
 * still recognized by their loopback endpoint shape, so an upgrade cleans up the
 * stale port instead of stacking a new one beside it.
 *
 * The state events register an `http` hook -> POST /state (fire-and-forget,
 * 100ms target, docs/05 §2). The permission reply registers an `http` hook ->
 * POST /permission (blocking, generous timeout). Re-install strips our prior
 * entries first, so the file converges to a single, current registration and
 * `changed` reflects whether anything actually moved.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const MARK = "claude-pet"; // tag on every hook group we own (idempotency / uninstall)

// Loopback endpoint shape of every http hook we register (/state, /permission,
// /reply on 127.0.0.1). Lets us recognize even *untagged* legacy registrations
// (builds that predate the `_owner` marker), so re-install converges to a single
// current registration instead of stacking a fresh port beside a stale one.
const OUR_URL_RE =
  /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/(?:state|permission|reply)(?:[/?#]|$)/;

// Observation hooks -> POST /state (docs/05 §3.1). fast, non-blocking.
const STATE_TIMEOUT_MS = 100;

// Events we observe via an http hook -> POST /state (docs/05 §3.1).
const STATE_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Stop",
  "Notification",
];

/**
 * Install Claude-Pet hooks into settings.json (idempotent).
 * @param opts.port          local server port
 * @param opts.host          defaults to "127.0.0.1"
 * @param opts.settingsPath  defaults to ~/.claude/settings.json
 */
function installHooks(
  opts: { port?: number; host?: string; settingsPath?: string; reply?: boolean } = {}
): { settingsPath: string; changed: boolean; settings: any } {
  const settingsPath = opts.settingsPath || DEFAULT_SETTINGS_PATH;
  const host = opts.host || "127.0.0.1";
  const port = opts.port;
  const base = `http://${host}:${port}`;
  const stateUrl = `${base}/state`;
  const permissionUrl = `${base}/permission`;
  const replyUrl = `${base}/reply`;

  const settings = readSettings(settingsPath);
  const before = stableStringify(settings);

  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }

  // Strip any prior claude-pet entries first so re-install is idempotent and
  // a port/path change cleans up the stale registration.
  stripOurHooks(settings);

  for (const event of STATE_EVENTS) {
    const group = {
      matcher: "*",
      _owner: MARK,
      hooks: [{ type: "http", url: stateUrl, timeout: STATE_TIMEOUT_MS }],
    };
    appendGroup(settings.hooks, event, group);
  }

  // Blocking permission reply (interactive PermissionRequest, docs/05 §4).
  // No timeout: the user needs time to decide; a missed decision falls back to
  // no-decision at the server, not via hook timeout.
  appendGroup(settings.hooks, "PermissionRequest", {
    matcher: "*",
    _owner: MARK,
    hooks: [{ type: "http", url: permissionUrl }],
  });

  // Opt-in "대화 모드": a BLOCKING Stop hook so a free-text reply can be returned
  // as the agent's continuation. Off by default — Stop then only has its
  // fire-and-forget /state hook (zero blocking risk). No timeout here; the
  // server/bridge bounds the hold.
  if (opts.reply) {
    appendGroup(settings.hooks, "Stop", {
      matcher: "*",
      _owner: MARK,
      hooks: [{ type: "http", url: replyUrl }],
    });
  }

  // Drop an empty hooks object so we don't gratuitously add a key.
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const after = stableStringify(settings);
  const changed = before !== after;
  if (changed) writeSettings(settingsPath, settings);
  return { settingsPath, changed, settings };
}

/**
 * Remove only Claude-Pet hooks; leave foreign hooks untouched (docs/05 §2).
 * @param opts.settingsPath  defaults to ~/.claude/settings.json
 */
function uninstallHooks(
  opts: { settingsPath?: string } = {}
): { settingsPath: string; changed: boolean; settings: any } {
  const settingsPath = opts.settingsPath || DEFAULT_SETTINGS_PATH;
  const settings = readSettings(settingsPath);
  const changed = stripOurHooks(settings);
  // Drop a now-empty hooks object so uninstall fully reverts a clean install.
  if (settings.hooks && typeof settings.hooks === "object" && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  if (changed) writeSettings(settingsPath, settings);
  return { settingsPath, changed, settings };
}

/**
 * Append a group to settings.hooks[event], creating the array if needed.
 */
function appendGroup(hooks: any, event: string, group: any): void {
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  hooks[event].push(group);
}

/**
 * True for a group we own: tagged with our MARK, or — for legacy registrations
 * that predate tagging — shaped like ours (an http hook to a loopback
 * /state|/permission|/reply endpoint). Foreign groups (e.g. a `command` hook, or
 * an http hook to any other host/path) return false and are preserved verbatim.
 */
function isOurGroup(g: any): boolean {
  if (!g || typeof g !== "object") return false;
  if (g._owner === MARK) return true;
  return (
    Array.isArray(g.hooks) &&
    g.hooks.some(
      (h: any) => h && h.type === "http" && typeof h.url === "string" && OUR_URL_RE.test(h.url)
    )
  );
}

/**
 * Remove every group we own (see {@link isOurGroup}), dropping now-empty event
 * arrays. Foreign groups are preserved verbatim.
 * @returns true if anything was removed
 */
function stripOurHooks(settings: any): boolean {
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
    return false;
  }
  let changed = false;
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((g: any) => !isOurGroup(g));
    if (kept.length !== arr.length) changed = true;
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }
  return changed;
}

/**
 * @returns parsed settings, or {} if absent/invalid
 */
function readSettings(p: string): any {
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return {}; // absent file -> fresh settings
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {}; // invalid JSON -> start clean rather than throw
  }
}

function writeSettings(p: string, settings: any): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/**
 * Order-insensitive serialization used only to detect a real change (so
 * `changed` is honest and idempotent re-installs don't rewrite the file).
 */
function stableStringify(value: any): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: any = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

export {
  DEFAULT_SETTINGS_PATH,
  STATE_EVENTS,
  installHooks,
  uninstallHooks,
};
