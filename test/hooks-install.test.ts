import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as hooks from "../src/main/hooks-install";

function tmpSettings(initial?: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-pet-hooks-"));
  const p = path.join(dir, "settings.json");
  if (initial !== undefined) fs.writeFileSync(p, JSON.stringify(initial, null, 2));
  return { p, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("installHooks writes our hooks and is idempotent", () => {
  const { p, cleanup } = tmpSettings();
  hooks.installHooks({ port: 8080, settingsPath: p });
  const first = readJson(p);
  const countFirst = first.hooks.PreToolUse.length;
  assert.ok(countFirst >= 1);

  hooks.installHooks({ port: 8080, settingsPath: p }); // re-install
  const second = readJson(p);
  assert.equal(second.hooks.PreToolUse.length, countFirst, "no duplicate entries");
  cleanup();
});

test("re-install with identical args reports changed:false and does not rewrite", () => {
  const { p, cleanup } = tmpSettings();
  const r1 = hooks.installHooks({ port: 8080, settingsPath: p });
  assert.equal(r1.changed, true, "first install changes the file");

  const mtime1 = fs.statSync(p).mtimeMs;
  const r2 = hooks.installHooks({ port: 8080, settingsPath: p });
  assert.equal(r2.changed, false, "identical re-install is a no-op");
  const mtime2 = fs.statSync(p).mtimeMs;
  assert.equal(mtime2, mtime1, "no-op install must not rewrite the file");
  cleanup();
});

test("changing the port re-registers with the new url and reports changed", () => {
  const { p, cleanup } = tmpSettings();
  hooks.installHooks({ port: 8080, settingsPath: p });
  const r = hooks.installHooks({ port: 9999, settingsPath: p });
  assert.equal(r.changed, true);
  const s = readJson(p);
  const ours = s.hooks.PreToolUse.filter((g: any) => g._owner === "claude-pet");
  assert.equal(ours.length, 1, "still exactly one of our PreToolUse groups");
  assert.match(ours[0].hooks[0].url, /:9999\/state$/);
  assert.ok(!JSON.stringify(s).includes(":8080/"), "stale port fully removed");
  cleanup();
});

test("installs a state http hook for every STATE_EVENTS entry with 100ms timeout", () => {
  const { p, cleanup } = tmpSettings();
  hooks.installHooks({ port: 8080, settingsPath: p });
  const s = readJson(p);
  for (const event of hooks.STATE_EVENTS) {
    const ours = (s.hooks[event] || []).filter((g: any) => g._owner === "claude-pet");
    assert.equal(ours.length, 1, `exactly one group for ${event}`);
    const h = ours[0].hooks[0];
    assert.equal(h.type, "http");
    assert.match(h.url, /:8080\/state$/);
    assert.equal(h.timeout, 100);
  }
  cleanup();
});

test("installHooks preserves the user's existing foreign hooks", () => {
  const { p, cleanup } = tmpSettings({
    hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo hi" }] }] },
  });
  hooks.installHooks({ port: 8080, settingsPath: p });
  const after = readJson(p);
  const foreign = after.hooks.PreToolUse.filter((g: any) => g._owner !== "claude-pet");
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].hooks[0].command, "echo hi");
  cleanup();
});

test("installHooks preserves unrelated top-level settings keys", () => {
  const { p, cleanup } = tmpSettings({
    model: "claude-opus",
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo hi" }] }] },
  });
  hooks.installHooks({ port: 8080, settingsPath: p });
  const after = readJson(p);
  assert.equal(after.model, "claude-opus");
  assert.deepEqual(after.permissions, { allow: ["Bash(ls:*)"] });
  cleanup();
});

test("uninstallHooks removes only our hooks, keeps foreign ones", () => {
  const { p, cleanup } = tmpSettings({
    hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo hi" }] }] },
  });
  hooks.installHooks({ port: 8080, settingsPath: p });
  const res = hooks.uninstallHooks({ settingsPath: p });
  assert.equal(res.changed, true);
  const after = readJson(p);
  const ours = after.hooks.PreToolUse.filter((g: any) => g._owner === "claude-pet");
  assert.equal(ours.length, 0);
  assert.equal(after.hooks.PreToolUse.length, 1); // foreign preserved
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "echo hi");
  cleanup();
});

test("install then uninstall on a previously-empty file fully reverts (no empty hooks)", () => {
  const { p, cleanup } = tmpSettings({ model: "claude-opus" });
  hooks.installHooks({ port: 8080, settingsPath: p });
  hooks.uninstallHooks({ settingsPath: p });
  const after = readJson(p);
  assert.equal(after.model, "claude-opus");
  assert.ok(!("hooks" in after), "empty hooks object dropped after full uninstall");
  cleanup();
});

test("uninstall on a file with no claude-pet hooks reports changed:false", () => {
  const { p, cleanup } = tmpSettings({
    hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo hi" }] }] },
  });
  const res = hooks.uninstallHooks({ settingsPath: p });
  assert.equal(res.changed, false);
  const after = readJson(p);
  assert.equal(after.hooks.PreToolUse.length, 1);
  cleanup();
});

test("uninstall drops only emptied event arrays, keeps shared events", () => {
  const { p, cleanup } = tmpSettings({
    hooks: {
      // foreign + ours share PreToolUse; only ours should be stripped
      PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo hi" }] }],
    },
  });
  hooks.installHooks({ port: 8080, settingsPath: p });
  hooks.uninstallHooks({ settingsPath: p });
  const after = readJson(p);
  // PreToolUse survives (foreign), SessionStart (ours-only) is gone.
  assert.ok(Array.isArray(after.hooks.PreToolUse));
  assert.equal(after.hooks.PreToolUse.length, 1);
  assert.ok(!("SessionStart" in after.hooks), "ours-only event array removed");
  cleanup();
});

test("installHooks registers a PermissionRequest http hook", () => {
  const { p, cleanup } = tmpSettings();
  hooks.installHooks({ port: 9090, settingsPath: p });
  const s = readJson(p);
  const pr = s.hooks.PermissionRequest;
  assert.ok(Array.isArray(pr) && pr.length === 1);
  assert.equal(pr[0].hooks[0].type, "http");
  assert.match(pr[0].hooks[0].url, /:9090\/permission$/);
  cleanup();
});

test("installHooks creates a missing settings file and parent dir", () => {
  const { dir, cleanup } = tmpSettings(); // dir exists, file does not
  const nested = path.join(dir, "deep", "settings.json");
  const res = hooks.installHooks({ port: 8080, settingsPath: nested });
  assert.equal(res.changed, true);
  assert.ok(fs.existsSync(nested));
  const s = readJson(nested);
  assert.ok(s.hooks.PermissionRequest);
  cleanup();
});

test("DEFAULT_SETTINGS_PATH points at ~/.claude/settings.json", () => {
  assert.equal(hooks.DEFAULT_SETTINGS_PATH, path.join(os.homedir(), ".claude", "settings.json"));
});

test("custom host is honored in registered urls", () => {
  const { p, cleanup } = tmpSettings();
  hooks.installHooks({ port: 8080, host: "127.0.0.1", settingsPath: p });
  const s = readJson(p);
  assert.match(s.hooks.PermissionRequest[0].hooks[0].url, /^http:\/\/127\.0\.0\.1:8080\/permission$/);
  cleanup();
});

// ── opt-in reply hook: Stop -> /reply only when reply:true ──
test("reply:true registers a blocking Stop -> /reply hook; default does not", () => {
  const { p, cleanup } = tmpSettings();
  hooks.installHooks({ port: 8080, settingsPath: p, reply: true });
  const s = readJson(p);
  const stopUrls = (s.hooks.Stop || []).flatMap((g: any) => (g.hooks || []).map((h: any) => h.url));
  assert.ok(stopUrls.includes("http://127.0.0.1:8080/reply"), "Stop should POST to /reply");
  assert.ok(stopUrls.includes("http://127.0.0.1:8080/state"), "Stop keeps its fire-and-forget /state hook");
  cleanup();
});

test("without reply, Stop has no /reply hook (default, zero blocking risk)", () => {
  const { p, cleanup } = tmpSettings();
  hooks.installHooks({ port: 8080, settingsPath: p });
  const s = readJson(p);
  const stopUrls = (s.hooks.Stop || []).flatMap((g: any) => (g.hooks || []).map((h: any) => h.url));
  assert.ok(!stopUrls.some((u: string) => u.endsWith("/reply")), "no /reply hook by default");
  cleanup();
});
