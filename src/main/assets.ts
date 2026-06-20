/**
 * Asset loader (component ④) — discovers + loads Codex-compatible pets from
 * `~/.codex/pets/<slug>/`. NO electron, NO image decoding here: this module
 * deals in PATHS and GEOMETRY only. Pixel decoding + autoDetectFrames (the
 * transparent-cell scan) happen in the renderer canvas (docs/02 §5, §7).
 *
 * Pipeline (docs/02 §5.1): discover -> read pet.json -> validate known fields
 * (ignore unknown, forward-compatible) -> resolve spritesheetPath (no path
 * escape) -> emit a normalized descriptor. Geometry is the released-app
 * contract (8x9, 192x208); the renderer derives cols/rows from the decoded
 * image and refines frame counts at runtime (autoDetectFrames).
 *
 * Released manifest is exactly four fields (id, displayName, description,
 * spritesheetPath); `kind` is an ecosystem extension kept as grouping meta
 * only and the proposed `animation` block is ignored here (docs/02 §2.1-2.3).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as C from "../shared/constants";
import type { PetMeta, PetAsset } from "../shared/types";

const PETS_ROOT = path.join(os.homedir(), ".codex", "pets");

/**
 * Internal flavour carried only inside this module so loadPet can resolve the
 * image path. The `_`-prefixed fields are stripped before any value leaves the
 * module (publicMeta()).
 */
type InternalMeta = PetMeta & { _dir: string; _spritesheetPath: string };

/**
 * Discover installed pets under the pets root. Each immediate subdirectory with
 * a readable, valid pet.json yields one PetMeta. Never throws; returns [] if
 * the root is missing or unreadable. (docs/02 §1, §5.3, §6.1)
 *
 * @param root  override the scan root (tests / future multi-root). Defaults to
 *        ~/.codex/pets so the documented no-arg call keeps working.
 * @returns public metas in discovery order, first-wins on dup id
 */
function discoverPets(root: string = PETS_ROOT): PetMeta[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // root absent / unreadable -> no pets (main uses fallback pet)
  }
  const out: PetMeta[] = [];
  const seenIds = new Set<string>();
  for (const ent of entries) {
    if (!isDirEntry(ent, root)) continue;
    const slug = ent.name;
    const meta = readPetMeta(path.join(root, slug), slug);
    if (!meta) continue; // V1/V2 fail -> skip this pet
    if (seenIds.has(meta.id)) continue; // first-wins on duplicate id (§5.3)
    seenIds.add(meta.id);
    out.push(publicMeta(meta));
  }
  return out;
}

/**
 * Treat an entry as a pet directory if it is a directory, or a symlink that
 * resolves to a directory. readdir(withFileTypes) reports symlinks as
 * isSymbolicLink(), so stat through them. Never throws.
 */
function isDirEntry(ent: fs.Dirent, root: string): boolean {
  if (ent.isDirectory()) return true;
  if (ent.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(root, ent.name)).isDirectory();
    } catch {
      return false; // dangling symlink
    }
  }
  return false;
}

/**
 * Read + validate one pet.json into an InternalMeta (or null on failure).
 * Released fields only (id, displayName, description, spritesheetPath); `kind`
 * is carried as grouping meta; every other field — including a proposed
 * `animation` block — is ignored (forward-compatible). (docs/02 §2.1, §6.1)
 * @param dir   absolute pet directory
 * @param slug  folder name (discovery key)
 */
function readPetMeta(dir: string, slug: string): InternalMeta | null {
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, "pet.json"), "utf8"));
  } catch {
    return null; // V1 JSON parse / missing file -> skip pet
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  // V2: identity. id wins; folder name (slug) is the fallback (§5.3).
  const id = isNonEmptyString(raw.id) ? raw.id : isNonEmptyString(slug) ? slug : "";
  if (!id) return null; // no id and no usable slug -> skip

  // V2: a spritesheet path is required (released manifest field).
  if (!isNonEmptyString(raw.spritesheetPath)) return null;

  return {
    id,
    displayName: isNonEmptyString(raw.displayName) ? raw.displayName : id,
    description: typeof raw.description === "string" ? raw.description : "",
    kind: isNonEmptyString(raw.kind) ? raw.kind : undefined,
    slug,
    // internal — stripped by publicMeta() before leaving the module:
    _spritesheetPath: raw.spritesheetPath,
    _dir: dir,
  };
}

/**
 * Strip the internal `_`-prefixed resolution fields, leaving the contract
 * PetMeta shape ({id, displayName, description, kind?, slug}).
 */
function publicMeta(meta: InternalMeta): PetMeta {
  const out: PetMeta = {
    id: meta.id,
    displayName: meta.displayName,
    description: meta.description,
    slug: meta.slug,
  };
  if (meta.kind !== undefined) out.kind = meta.kind;
  return out;
}

/**
 * Load a pet into a PetAsset (PATHS + GEOMETRY only — no image decode).
 * Resolves spritesheetPath relative to pet.json (V3 path-escape guard) and
 * checks the image is readable (V4). Returns null when the pet cannot be
 * found / resolved / read. Atlas geometry is the released-app contract from
 * shared constants; the renderer derives the actual cols/rows from the decoded
 * pixels and runs autoDetectFrames (docs/02 §5.2, §7). Never throws.
 *
 * @param slug  discovery folder name (or pet id)
 * @param root  override the pets root (tests)
 */
function loadPet(slug: unknown, root: string = PETS_ROOT): PetAsset | null {
  if (!isNonEmptyString(slug)) return null;

  let meta = readPetMeta(path.join(root, slug), slug);
  if (!meta) {
    // not a folder name — fall back to an id-based lookup across the root.
    meta = findById(slug, root);
    if (!meta) return null;
  }

  const petDir = meta._dir;
  const resolved = path.resolve(petDir, meta._spritesheetPath);

  // V3 path safety: the image must stay inside the pet directory (block `..`
  // and absolute escapes). Compare against the real directory so a symlinked
  // pet folder is judged by where it actually lives.
  const realDir = realpathOr(petDir);
  const rel = path.relative(realDir, realpathOr(resolved, resolved));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;

  // V4: the image file must exist and be readable. NO decode here.
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    return null;
  }

  return {
    meta: publicMeta(meta),
    spritesheetPath: resolved,
    spritesheetUrl: pathToFileURL(resolved).href,
    frameW: C.FRAME_W,
    frameH: C.FRAME_H,
    atlas: { ...C.ATLAS }, // 8x9, 1536x1872 — released-app contract geometry
  };
}

/**
 * Scan the root for a pet whose id matches `id`, returning its InternalMeta
 * (with resolution fields) or null. First-wins on duplicate id. Never throws.
 */
function findById(id: string, root: string): InternalMeta | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!isDirEntry(ent, root)) continue;
    const meta = readPetMeta(path.join(root, ent.name), ent.name);
    if (meta && meta.id === id) return meta;
  }
  return null;
}

/**
 * realpathSync, but never throws — returns `fallback` (default: the input) when
 * the path does not exist yet. Keeps the path-escape guard symlink-aware while
 * still rejecting non-existent escapes.
 */
function realpathOr(p: string, fallback: string = p): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return fallback;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export { PETS_ROOT, discoverPets, loadPet };
