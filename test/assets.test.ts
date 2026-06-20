import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as assets from "../src/main/assets";
import * as C from "../src/shared/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Synthetic fixture root checked into the repo. Contains FAKE meta + non-art
// placeholder bytes only — no copyrighted spritesheet is ever copied here.
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "pets-root");
const EMPTY_ROOT = path.join(__dirname, "fixtures", "empty-root");

// Build a throwaway pets root for the dynamic edge cases. Returns the root path
// and a cleanup fn. Each pet is `{ slug, json (object|string|undefined),
// sheetRel? }`; when `sheetRel` is given a placeholder file is written there.
function makeRoot(pets: any[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-pet-assets-"));
  for (const pet of pets) {
    const dir = path.join(root, pet.slug);
    fs.mkdirSync(dir, { recursive: true });
    if (pet.json !== undefined) {
      const body =
        typeof pet.json === "string" ? pet.json : JSON.stringify(pet.json, null, 2);
      fs.writeFileSync(path.join(dir, "pet.json"), body);
    }
    if (pet.sheetRel) {
      const sheet = path.join(dir, pet.sheetRel);
      fs.mkdirSync(path.dirname(sheet), { recursive: true });
      fs.writeFileSync(sheet, "SYNTHETIC-NOT-REAL-ART");
    }
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// ── default no-arg contract (uses the real ~/.codex/pets) ─────────────────────

test("discoverPets never throws and returns an array", () => {
  const pets = assets.discoverPets();
  assert.ok(Array.isArray(pets));
});

test("loadPet returns null for an unknown slug (no throw)", () => {
  assert.equal(assets.loadPet("__definitely_not_a_pet__"), null);
});

test("loadPet returns null for non-string / empty slug (no throw)", () => {
  assert.equal(assets.loadPet(""), null);
  assert.equal(assets.loadPet(undefined), null);
  assert.equal(assets.loadPet(null), null);
  assert.equal(assets.loadPet(42), null);
});

test("PETS_ROOT points at ~/.codex/pets", () => {
  assert.match(assets.PETS_ROOT, /\.codex[/\\]pets$/);
});

test("module exposes only path/geometry helpers (no decode)", () => {
  assert.equal(typeof assets.discoverPets, "function");
  assert.equal(typeof assets.loadPet, "function");
  // geometry constants come from shared constants, not duplicated here
  assert.equal(C.FRAME_W, 192);
  assert.equal(C.FRAME_H, 208);
});

// ── discovery over the synthetic fixture root ────────────────────────────────

test("discoverPets finds valid fixture pets and returns the contract PetMeta shape", () => {
  const pets = assets.discoverPets(FIXTURE_ROOT);
  const byId = new Map(pets.map((p) => [p.id, p]));

  // mochi + pixel-fox are valid; broken-json, no-sheet, not-a-pet.txt are not.
  assert.ok(byId.has("mochi"), "valid pet discovered");
  assert.ok(byId.has("pixel-fox"), "id-only pet discovered");
  assert.ok(!byId.has("broken"), "broken json skipped (V1)");
  assert.ok(!byId.has("no-sheet"), "missing spritesheetPath skipped (V2)");

  const mochi = byId.get("mochi")!;
  // exactly the contract PetMeta keys — no internal _dir / _spritesheetPath leak
  assert.deepEqual(Object.keys(mochi).sort(), [
    "description",
    "displayName",
    "id",
    "kind",
    "slug",
  ]);
  assert.equal(mochi.displayName, "Mochi");
  assert.equal(mochi.kind, "person");
  assert.equal(mochi.slug, "mochi");
});

test("discoverPets falls back displayName->id and omits kind when absent", () => {
  const pets = assets.discoverPets(FIXTURE_ROOT);
  const fox = pets.find((p) => p.id === "pixel-fox")!;
  assert.ok(fox);
  assert.equal(fox.displayName, "pixel-fox", "displayName falls back to id");
  assert.equal(fox.description, "", "missing description defaults to empty string");
  assert.equal("kind" in fox, false, "kind omitted when not present");
});

test("discoverPets returns [] for a missing root (graceful)", () => {
  const pets = assets.discoverPets(path.join(FIXTURE_ROOT, "__nope__"));
  assert.deepEqual(pets, []);
});

test("discoverPets returns [] for an empty root", () => {
  assert.deepEqual(assets.discoverPets(EMPTY_ROOT), []);
});

test("discoverPets is first-wins on duplicate id", () => {
  // fixture has mochi/ and zz-dup-mochi/ both declaring id 'mochi'
  const pets = assets.discoverPets(FIXTURE_ROOT);
  const mochis = pets.filter((p) => p.id === "mochi");
  assert.equal(mochis.length, 1, "duplicate id collapses to one entry");
  // first in readdir order (alphabetical 'mochi' < 'zz-dup-mochi') wins
  assert.equal(mochis[0].slug, "mochi", "first-discovered slug wins");
});

test("discoverPets ignores non-directory entries in the root", () => {
  const pets = assets.discoverPets(FIXTURE_ROOT);
  // not-a-pet.txt sits in the root but is a file -> never a pet
  assert.ok(!pets.some((p) => p.slug === "not-a-pet.txt"));
});

// ── loadPet over the synthetic fixture root ──────────────────────────────────

test("loadPet returns a PetAsset with contract geometry and a file:// url", () => {
  const asset = assets.loadPet("mochi", FIXTURE_ROOT)!;
  assert.ok(asset, "asset loaded");

  // geometry is the released-app contract from shared constants (8x9, 192x208)
  assert.equal(asset.frameW, 192);
  assert.equal(asset.frameH, 208);
  assert.deepEqual(asset.atlas, { cols: 8, rows: 9, width: 1536, height: 1872 });

  // spritesheetPath is an absolute resolved path; url is its file:// form
  assert.ok(path.isAbsolute(asset.spritesheetPath));
  assert.equal(
    asset.spritesheetPath,
    path.join(FIXTURE_ROOT, "mochi", "spritesheet.webp")
  );
  assert.ok(asset.spritesheetUrl.startsWith("file://"));
  assert.equal(fileURLToPath(asset.spritesheetUrl), asset.spritesheetPath);

  // meta is the public PetMeta shape (no _dir / _spritesheetPath)
  assert.deepEqual(Object.keys(asset.meta).sort(), [
    "description",
    "displayName",
    "id",
    "kind",
    "slug",
  ]);
  assert.equal(asset.meta.id, "mochi");
});

test("loadPet resolves a spritesheetPath that has a subdirectory component", () => {
  // pixel-fox -> art/sheet.webp (still inside the pet dir)
  const asset = assets.loadPet("pixel-fox", FIXTURE_ROOT)!;
  assert.ok(asset);
  assert.equal(
    asset.spritesheetPath,
    path.join(FIXTURE_ROOT, "pixel-fox", "art", "sheet.webp")
  );
});

test("loadPet ignores the proposed animation block (no decode, no honor)", () => {
  const asset = assets.loadPet("pixel-fox", FIXTURE_ROOT)!;
  assert.ok(asset);
  // the descriptor carries paths + geometry only; nothing from `animation`.
  assert.deepEqual(Object.keys(asset).sort(), [
    "atlas",
    "frameH",
    "frameW",
    "meta",
    "spritesheetPath",
    "spritesheetUrl",
  ]);
  assert.equal("animation" in asset, false);
  assert.equal("events" in asset, false);
});

test("loadPet does NOT read or decode the spritesheet bytes", () => {
  // The fixture sheet is a tiny placeholder, not a valid WebP. If loadPet tried
  // to decode it the call would fail; instead it just checks readability.
  const asset = assets.loadPet("mochi", FIXTURE_ROOT)!;
  assert.ok(asset);
  // geometry came from constants, not from the (non-image) file contents.
  assert.equal(asset.atlas.width, 1536);
  assert.equal(asset.atlas.height, 1872);
});

test("loadPet can resolve a pet by id when the slug != folder name", () => {
  const { root, cleanup } = makeRoot([
    { slug: "folder-x", json: { id: "real-id", spritesheetPath: "s.webp" }, sheetRel: "s.webp" },
  ]);
  try {
    // folder is 'folder-x' but the pet id is 'real-id'
    assert.equal(assets.loadPet("nope", root), null);
    const asset = assets.loadPet("real-id", root)!;
    assert.ok(asset, "found via id fallback");
    assert.equal(asset.meta.id, "real-id");
    assert.equal(asset.meta.slug, "folder-x");
  } finally {
    cleanup();
  }
});

test("loadPet returns null when the image file is missing (V4)", () => {
  const { root, cleanup } = makeRoot([
    // pet.json points at a sheet that was never written
    { slug: "ghost", json: { id: "ghost", spritesheetPath: "missing.webp" } },
  ]);
  try {
    assert.equal(assets.loadPet("ghost", root), null);
  } finally {
    cleanup();
  }
});

test("loadPet rejects a path-escape spritesheetPath (V3)", () => {
  const { root, cleanup } = makeRoot([
    { slug: "evil", json: { id: "evil", spritesheetPath: "../escape.webp" } },
  ]);
  try {
    // write the escape target so the only thing stopping the load is the guard
    fs.writeFileSync(path.join(root, "escape.webp"), "SYNTHETIC");
    assert.equal(assets.loadPet("evil", root), null, "../ escape blocked");
  } finally {
    cleanup();
  }
});

test("loadPet rejects an absolute spritesheetPath that escapes the pet dir (V3)", () => {
  const { root, cleanup } = makeRoot([
    { slug: "abs", json: { id: "abs", spritesheetPath: "/etc/hosts" } },
  ]);
  try {
    assert.equal(assets.loadPet("abs", root), null, "absolute escape blocked");
  } finally {
    cleanup();
  }
});

// ── graceful failure on broken / missing input ───────────────────────────────

test("loadPet returns null for broken json (V1, no throw)", () => {
  const { root, cleanup } = makeRoot([
    { slug: "bad", json: "{ this is not json", sheetRel: "s.webp" },
  ]);
  try {
    assert.equal(assets.loadPet("bad", root), null);
  } finally {
    cleanup();
  }
});

test("loadPet returns null when pet.json is missing entirely", () => {
  const { root, cleanup } = makeRoot([{ slug: "empty" /* no json */ }]);
  try {
    assert.equal(assets.loadPet("empty", root), null);
  } finally {
    cleanup();
  }
});

test("loadPet returns null when spritesheetPath field is absent (V2)", () => {
  const { root, cleanup } = makeRoot([
    { slug: "metaonly", json: { id: "metaonly", displayName: "Meta Only" } },
  ]);
  try {
    assert.equal(assets.loadPet("metaonly", root), null);
  } finally {
    cleanup();
  }
});

test("pet.json with a non-object top-level value is skipped (no throw)", () => {
  const { root, cleanup } = makeRoot([
    { slug: "arr", json: "[1,2,3]" },
    { slug: "str", json: '"just a string"' },
  ]);
  try {
    assert.deepEqual(assets.discoverPets(root), []);
    assert.equal(assets.loadPet("arr", root), null);
    assert.equal(assets.loadPet("str", root), null);
  } finally {
    cleanup();
  }
});

test("id falls back to folder name when id is missing", () => {
  const { root, cleanup } = makeRoot([
    { slug: "from-folder", json: { spritesheetPath: "s.webp" }, sheetRel: "s.webp" },
  ]);
  try {
    const pets = assets.discoverPets(root);
    assert.equal(pets.length, 1);
    assert.equal(pets[0].id, "from-folder", "id falls back to slug");
    const asset = assets.loadPet("from-folder", root)!;
    assert.ok(asset);
    assert.equal(asset.meta.id, "from-folder");
  } finally {
    cleanup();
  }
});
