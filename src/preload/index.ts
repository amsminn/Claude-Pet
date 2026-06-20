/**
 * Preload — the minimal, audited bridge between the sandboxed renderer and the
 * main process. contextIsolation is ON; only this small API is exposed on
 * `window.claudePet`. IPC channel names are shared via src/shared/constants.ts
 * so both ends never drift.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import * as C from "../shared/constants";
import type {
  ClaudePetBridge,
  PermissionDecision,
  ReplyPayload,
  StatePayload,
} from "../shared/types";

const api: ClaudePetBridge = {
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

  onState(cb: (payload: StatePayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: StatePayload): void => cb(payload);
    ipcRenderer.on(C.IPC.STATE, handler);
    return () => ipcRenderer.removeListener(C.IPC.STATE, handler);
  },

  setInteractive(interactive: boolean): void {
    ipcRenderer.send(C.IPC.SET_INTERACTIVE, !!interactive);
  },

  setReplyFocus(on: boolean): void {
    ipcRenderer.send(C.IPC.SET_REPLY_FOCUS, !!on);
  },

  sendReply(payload: ReplyPayload): void {
    ipcRenderer.send(C.IPC.SEND_REPLY, payload);
  },

  resolvePermission(id: string, decision: PermissionDecision, message?: string): void {
    ipcRenderer.send(C.IPC.RESOLVE_PERMISSION, { id, decision, message });
  },

  dragStart(): void {
    ipcRenderer.send(C.IPC.DRAG_START);
  },
  dragMove(): void {
    ipcRenderer.send(C.IPC.DRAG_MOVE);
  },
  dragEnd(): void {
    ipcRenderer.send(C.IPC.DRAG_END);
  },
};

contextBridge.exposeInMainWorld("claudePet", api);
