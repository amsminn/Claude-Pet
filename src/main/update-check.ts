/**
 * Update check — pure core. NO electron, no DOM, no network: a deterministic
 * function over `app.getVersion()` + the GitHub Releases API JSON, so `npm test`
 * exercises it under plain `node --test` (mirrors state.ts / assets.ts).
 *
 * The electron-runtime caller (src/main/index.ts) does the `fetch` and pushes
 * the result to the renderer; this module only decides "is there a newer
 * release, and where is it". Every read is defensively guarded — malformed
 * input resolves to "no update", never a throw (same posture as the hook
 * payload readers). Design: single stable channel, drafts/prereleases ignored.
 * See docs/superpowers/specs/2026-06-21-curl-install-and-update-design.md.
 */

/** Parse the numeric `major.minor.patch` core of a version/tag, tolerating a
 *  leading `v`, missing trailing components, and a pre-release suffix. Returns
 *  null when no numeric core is present. */
function parseCore(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Compare two versions numerically, component-wise. Negative if a < b, 0 if
 *  equal, positive if a > b. Unparseable inputs sort as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const pa = parseCore(a) ?? [0, 0, 0];
  const pb = parseCore(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export interface UpdateResult {
  available: boolean;
  version?: string;
  url?: string;
  notes?: string;
}

/** A GitHub Releases API entry (only the fields we read). */
interface Release {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/**
 * Decide whether any stable release is strictly newer than `currentVersion`.
 * Returns the newest qualifying release as `{available, version, url, notes}`,
 * or `{available:false}`. Drafts/prereleases and off-shape entries are skipped.
 */
export function pickUpdate(opts: { currentVersion: string; releases: unknown }): UpdateResult {
  const { currentVersion, releases } = opts;
  if (!Array.isArray(releases)) return { available: false };

  let best: { version: string; url: string; notes: string } | null = null;
  for (const entry of releases as Release[]) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.draft === true || entry.prerelease === true) continue;
    if (parseCore(entry.tag_name) === null) continue;

    const version = String(entry.tag_name).trim().replace(/^v/, "");
    if (compareVersions(version, currentVersion) <= 0) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;

    best = {
      version,
      url: typeof entry.html_url === "string" ? entry.html_url : "",
      notes: typeof entry.body === "string" ? entry.body : "",
    };
  }

  return best ? { available: true, ...best } : { available: false };
}
