"use strict";
/**
 * Pet window factory (component ⑤ shell) — the ONLY electron-runtime glue for
 * the window. Uses the verified build-plan §0 recipe and nothing else.
 *
 * Recipe (build-plan §0, docs/04 §1.1):
 *   - BrowserWindow({ type:'panel', transparent, frame:false, hasShadow:false,
 *     resizable:false, alwaysOnTop:true, skipTaskbar:true, ... })
 *     `type:'panel'` => NSWindowStyleMaskNonactivatingPanel: does not steal
 *     app focus, floats over fullscreen apps, shows on all Spaces.
 *   - setAlwaysOnTop(true,'screen-saver'); setVisibleOnAllWorkspaces(true,
 *     {visibleOnFullScreen:true}).
 *   - anchor bottom-right of the PRIMARY display workArea.
 *   - click-through: default setIgnoreMouseEvents(true,{forward:true}); the
 *     renderer toggles it via IPC.SET_INTERACTIVE on #widget enter/leave.
 *     (Pure transparent windows no longer auto-pass clicks — this toggle is
 *     mandatory.)
 */
const path = require("node:path");
const { BrowserWindow, screen } = require("electron");

// Default canvas for the widget (cards stack + pet). Generous; the page is
// transparent so only painted pixels show.
const WIN_W = 360;
const WIN_H = 560;
const MARGIN_R = 14; // docs/04 --pet-margin-r
const MARGIN_B = 6; // docs/04 --pet-margin-b

/**
 * Create the floating, non-activating, click-through pet window.
 * @param {Object} [opts]
 * @param {string} [opts.preload]  absolute preload path (defaults to ../preload.js)
 * @returns {import('electron').BrowserWindow}
 */
function createPetWindow(opts = {}) {
  const preload = opts.preload || path.join(__dirname, "..", "preload.js");

  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    type: "panel", // non-activating panel (build-plan §0)
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // do not take keyboard focus from the active app
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Float above fullscreen apps, visible on every Space.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Default click-through; renderer toggles per hover via IPC. `forward:true`
  // keeps mouse-move events flowing so the renderer can detect the pet hit area.
  win.setIgnoreMouseEvents(true, { forward: true });

  positionBottomRight(win);
  // Re-anchor if the display metrics change (resolution / dock / monitors).
  const reanchor = () => positionBottomRight(win);
  screen.on("display-metrics-changed", reanchor);
  screen.on("display-added", reanchor);
  screen.on("display-removed", reanchor);
  win.on("closed", () => {
    screen.removeListener("display-metrics-changed", reanchor);
    screen.removeListener("display-added", reanchor);
    screen.removeListener("display-removed", reanchor);
  });

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.once("ready-to-show", () => win.showInactive());

  return win;
}

/**
 * Anchor the window to the bottom-right of the primary display work area.
 * @param {import('electron').BrowserWindow} win
 */
function positionBottomRight(win) {
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  const x = workArea.x + workArea.width - w - MARGIN_R;
  const y = workArea.y + workArea.height - h - MARGIN_B;
  win.setPosition(Math.round(x), Math.round(y));
}

/**
 * Apply the renderer's hover state to window click-through. interactive=true
 * while the cursor is over the pet/cards hit area, false otherwise.
 * @param {import('electron').BrowserWindow} win
 * @param {boolean} interactive
 */
function setInteractive(win, interactive) {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
}

/**
 * Promote/demote the panel's keyboard focusability for inline reply typing.
 * The window is created with focusable:false so it never steals focus at rest;
 * on macOS that also means it can never become the key window, so a reply
 * <input> cannot receive keystrokes. Flip focusable on (and make it key via
 * focus()) only while a reply field is open, then drop back to non-focusable.
 * @param {import('electron').BrowserWindow} win
 * @param {boolean} on
 */
function setReplyFocus(win, on) {
  if (!win || win.isDestroyed()) return;
  win.setFocusable(!!on);
  if (on) win.focus();
}

module.exports = { createPetWindow, setInteractive, setReplyFocus, positionBottomRight };
