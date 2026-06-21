import { test } from "node:test";
import assert from "node:assert/strict";
import * as u from "../src/main/update-check";

// ── compareVersions: numeric, component-wise ───────────────────────────────

test("compareVersions orders numerically, not lexically (0.10.0 > 0.2.0)", () => {
  assert.ok(u.compareVersions("0.10.0", "0.2.0") > 0);
  assert.ok(u.compareVersions("0.2.0", "0.10.0") < 0);
});

test("compareVersions returns 0 for equal versions", () => {
  assert.equal(u.compareVersions("1.2.3", "1.2.3"), 0);
});

test("compareVersions tolerates a leading 'v' and missing components", () => {
  assert.equal(u.compareVersions("v1.2.0", "1.2"), 0);
  assert.ok(u.compareVersions("v1.3", "1.2.9") > 0);
});

test("compareVersions ignores a pre-release suffix (numeric core only)", () => {
  assert.equal(u.compareVersions("1.2.0-beta.1", "1.2.0"), 0);
});

// ── pickUpdate: newest release strictly greater than current ───────────────

test("pickUpdate reports an available update with version/url/notes", () => {
  const releases = [
    {
      tag_name: "v0.2.0",
      html_url: "https://github.com/amsminn/Claude-Pet/releases/tag/v0.2.0",
      body: "what's new",
      draft: false,
      prerelease: false,
    },
  ];
  const r = u.pickUpdate({ currentVersion: "0.1.0", releases });
  assert.equal(r.available, true);
  assert.equal(r.version, "0.2.0");
  assert.equal(r.url, "https://github.com/amsminn/Claude-Pet/releases/tag/v0.2.0");
  assert.equal(r.notes, "what's new");
});

test("pickUpdate reports no update when latest equals current", () => {
  const releases = [{ tag_name: "v0.1.0", html_url: "x", draft: false, prerelease: false }];
  assert.equal(u.pickUpdate({ currentVersion: "0.1.0", releases }).available, false);
});

test("pickUpdate reports no update when latest is older than current", () => {
  const releases = [{ tag_name: "v0.1.0", html_url: "x", draft: false, prerelease: false }];
  assert.equal(u.pickUpdate({ currentVersion: "0.2.0", releases }).available, false);
});

test("pickUpdate ignores drafts and prereleases", () => {
  const releases = [
    { tag_name: "v0.9.0", html_url: "draft", draft: true, prerelease: false },
    { tag_name: "v0.8.0", html_url: "pre", draft: false, prerelease: true },
  ];
  assert.equal(u.pickUpdate({ currentVersion: "0.1.0", releases }).available, false);
});

test("pickUpdate picks the newest among several stable releases", () => {
  const releases = [
    { tag_name: "v0.2.0", html_url: "a", draft: false, prerelease: false },
    { tag_name: "v0.4.0", html_url: "b", draft: false, prerelease: false },
    { tag_name: "v0.3.0", html_url: "c", draft: false, prerelease: false },
  ];
  const r = u.pickUpdate({ currentVersion: "0.1.0", releases });
  assert.equal(r.version, "0.4.0");
  assert.equal(r.url, "b");
});

test("pickUpdate never throws on malformed input -> {available:false}", () => {
  assert.equal(u.pickUpdate({ currentVersion: "0.1.0", releases: [] }).available, false);
  assert.equal(u.pickUpdate({ currentVersion: "0.1.0", releases: null }).available, false);
  const junk = [{ no_tag: true }, { tag_name: 42 }, null, "nope"];
  assert.equal(u.pickUpdate({ currentVersion: "0.1.0", releases: junk }).available, false);
});
