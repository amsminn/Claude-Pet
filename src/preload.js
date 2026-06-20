"use strict";
/**
 * Preload — the minimal, audited bridge between the sandboxed renderer and the
 * main process. contextIsolation is ON; only this small API is exposed on
 * `window.claudePet`. IPC channel names are shared via src/shared/constants.js
 * so both ends never drift.
 */
const { contextBridge, ipcRenderer } = require("electron");
const C = require("./shared/constants");

contextBridge.exposeInMainWorld("claudePet", {
  /** Wire protocol tag, so the renderer can assert compatibility. */
  protocol: C.PROTOCOL,

  /** Atlas / row constants the renderer needs to blit sprites. */
  constants: {
    FRAME_W: C.FRAME_W,
    FRAME_H: C.FRAME_H,
    ATLAS: C.ATLAS,
    ROW: C.ROW,
    ROW_ANIM: C.ROW_ANIM,
    STATE_LABEL: C.STATE_LABEL,
  },

  /**
   * Subscribe to state snapshots pushed from main (cards + petRow + petAsset).
   * @param {function(Object):void} cb
   * @returns {function():void} unsubscribe
   */
  onState(cb) {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on(C.IPC.STATE, handler);
    return () => ipcRenderer.removeListener(C.IPC.STATE, handler);
  },

  /**
   * Toggle window click-through. Call with true on #widget mouseenter, false
   * on mouseleave (docs/04 §5.1).
   * @param {boolean} interactive
   */
  setInteractive(interactive) {
    ipcRenderer.send(C.IPC.SET_INTERACTIVE, !!interactive);
  },

  /**
   * Temporarily make the non-activating pet window focusable + key so the inline
   * reply <input> can receive keyboard text (macOS panels with focusable:false
   * never become key). Call true when a reply field opens, false on blur/close.
   * @param {boolean} on
   */
  setReplyFocus(on) {
    ipcRenderer.send(C.IPC.SET_REPLY_FOCUS, !!on);
  },

  /**
   * Send a free-text reply for a card (non-permission path).
   * @param {{sessionId:string, message:string}} payload
   */
  sendReply(payload) {
    ipcRenderer.send(C.IPC.SEND_REPLY, payload);
  },

  /**
   * Resolve a pending permission from the card UI.
   * @param {string} id           permission request id
   * @param {"allow"|"deny"} decision
   * @param {string} [message]    optional reason / redirect
   */
  resolvePermission(id, decision, message) {
    ipcRenderer.send(C.IPC.RESOLVE_PERMISSION, { id, decision, message });
  },

  /** Begin dragging the pet (pointerdown on the pet sprite). */
  dragStart() {
    ipcRenderer.send(C.IPC.DRAG_START);
  },
  /** Drag tick (rAF-throttled pointermove); main re-reads the cursor. */
  dragMove() {
    ipcRenderer.send(C.IPC.DRAG_MOVE);
  },
  /** End the drag (pointerup / cancel). */
  dragEnd() {
    ipcRenderer.send(C.IPC.DRAG_END);
  },
});
