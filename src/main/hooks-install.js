"use strict";
/**
 * Hook installer — registers Claude-Pet's hooks into a Claude Code
 * settings.json. NO electron. Idempotent, preserves the user's existing hooks,
 * and removes only what we added on uninstall (docs/05 §2).
 *
 * Verified shape (build-plan §0 "훅 등록"): settings.hooks is keyed by event
 * name; each event holds matcher groups with a `hooks` array. Handler types
 * include `command` and `http`. We tag every group we own with
 * `_owner:'claude-pet'` so uninstall can find them again without touching
 * foreign hooks.
 *
 * The state events register an `http` hook -> POST /state (fire-and-forget,
 * 100ms target, docs/05 §2). The permission reply registers an `http` hook ->
 * POST /permission (blocking, generous timeout). Re-install strips our prior
 * entries first, so the file converges to a single, current registration and
 * `changed` reflects whether anything actually moved.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const MARK = "claude-pet"; // tag on every hook group we own (idempotency / uninstall)

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
 * @param {Object} opts
 * @param {number} opts.port                    local server port
 * @param {string} [opts.host="127.0.0.1"]
 * @param {string} [opts.settingsPath]          defaults to ~/.claude/settings.json
 * @returns {{settingsPath:string, changed:boolean, settings:Object}}
 */
function installHooks(opts = {}) {
  const settingsPath = opts.settingsPath || DEFAULT_SETTINGS_PATH;
  const host = opts.host || "127.0.0.1";
  const port = opts.port;
  const base = `http://${host}:${port}`;
  const stateUrl = `${base}/state`;
  const permissionUrl = `${base}/permission`;

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

  // Drop an empty hooks object so we don't gratuitously add a key.
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const after = stableStringify(settings);
  const changed = before !== after;
  if (changed) writeSettings(settingsPath, settings);
  return { settingsPath, changed, settings };
}

/**
 * Remove only Claude-Pet hooks; leave foreign hooks untouched (docs/05 §2).
 * @param {Object} opts
 * @param {string} [opts.settingsPath]
 * @returns {{settingsPath:string, changed:boolean, settings:Object}}
 */
function uninstallHooks(opts = {}) {
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
 * @param {Object} hooks
 * @param {string} event
 * @param {Object} group
 */
function appendGroup(hooks, event, group) {
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  hooks[event].push(group);
}

/**
 * Remove every group tagged with our MARK, dropping now-empty event arrays.
 * Foreign groups (no `_owner`, or a different owner) are preserved verbatim.
 * @param {Object} settings
 * @returns {boolean} true if anything was removed
 */
function stripOurHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
    return false;
  }
  let changed = false;
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((g) => !(g && g._owner === MARK));
    if (kept.length !== arr.length) changed = true;
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }
  return changed;
}

/**
 * @param {string} p
 * @returns {Object} parsed settings, or {} if absent/invalid
 */
function readSettings(p) {
  let raw;
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

/**
 * @param {string} p
 * @param {Object} settings
 */
function writeSettings(p, settings) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/**
 * Order-insensitive serialization used only to detect a real change (so
 * `changed` is honest and idempotent re-installs don't rewrite the file).
 * @param {*} value
 * @returns {string}
 */
function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

module.exports = {
  DEFAULT_SETTINGS_PATH,
  STATE_EVENTS,
  installHooks,
  uninstallHooks,
};
