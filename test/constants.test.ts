import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/shared/constants";

test("atlas geometry is the released-app contract (8x9, 192x208)", () => {
  assert.equal(C.FRAME_W, 192);
  assert.equal(C.FRAME_H, 208);
  assert.equal(C.ATLAS.cols, 8);
  assert.equal(C.ATLAS.rows, 9);
  assert.equal(C.ATLAS.cols * C.FRAME_W, C.ATLAS.width);
  assert.equal(C.ATLAS.rows * C.FRAME_H, C.ATLAS.height);
  assert.equal(C.ATLAS.width, 1536);
  assert.equal(C.ATLAS.height, 1872);
});

test("ROW maps the 9 official states in fixed order", () => {
  assert.deepEqual(C.ROW, {
    idle: 0,
    "running-right": 1,
    "running-left": 2,
    waving: 3,
    jumping: 4,
    failed: 5,
    waiting: 6,
    running: 7,
    review: 8,
  });
});

test("EVENT_TO_STATE covers the documented hook events", () => {
  assert.equal(C.EVENT_TO_STATE.SessionStart, "idle");
  assert.equal(C.EVENT_TO_STATE.UserPromptSubmit, "thinking");
  assert.equal(C.EVENT_TO_STATE.PreToolUse, "working");
  assert.equal(C.EVENT_TO_STATE.Stop, "attention");
  assert.equal(C.EVENT_TO_STATE.PostToolUseFailure, "error");
  assert.equal(C.EVENT_TO_STATE.Notification, "notification");
  assert.equal(C.EVENT_TO_STATE.WorktreeCreate, "carrying");
});

test("IPC channel names are defined and unique", () => {
  const names = Object.values(C.IPC);
  assert.ok(names.includes("pet:state"));
  assert.ok(names.includes("pet:set-interactive"));
  assert.equal(new Set(names).size, names.length);
});

test("protocol tag is claude-pet.v1", () => {
  assert.equal(C.PROTOCOL, "claude-pet.v1");
  assert.equal(C.STATE_PROTOCOL, "claude-pet.state.v1");
});

test("constants are frozen (single source of truth)", () => {
  // Named ESM exports replace the old single frozen object — assert the actual
  // constant objects are immutable (the namespace wrapper isn't a reliable proxy
  // for that under the tsx/esbuild loader).
  assert.ok(Object.isFrozen(C.ATLAS));
  assert.ok(Object.isFrozen(C.ROW));
  assert.ok(Object.isFrozen(C.ROW_ANIM));
  assert.ok(Object.isFrozen(C.EVENT_TO_STATE));
  assert.ok(Object.isFrozen(C.IPC));
});
