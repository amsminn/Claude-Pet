/*
 * Claude-Pet renderer — keeps the prototype's render / animation / reorder /
 * fade / autoDetectFrames logic, but the mock scenario engine is replaced by an
 * IPC-driven feed (window.claudePet.onState). The session store is owned by the
 * main process; the renderer just receives snapshots and paints cards + the pet.
 */
import { FRAME_H, FRAME_W, ROW, ROW_ANIM, STATE_LABEL } from "../shared/constants";
import type { ClaudePetBridge, PetAsset, SessionState, StatePayload } from "../shared/types";

// ── shared constants (bundled directly; IPC still comes through the bridge) ──
const bridge: ClaudePetBridge | null = window.claudePet ?? null;
const WORKING = new Set(["working", "thinking", "juggling", "sweeping", "carrying"]);
const isPingpong = (r: number): boolean => ROW_ANIM[r]?.mode === "pingpong";

// ── DOM ──
const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const cardsEl = $("cards");
const petSprite = $("petSprite");
const widget = $("widget");
const petCount = $("petCount");

// ── local card UI state + element bookkeeping ──
interface CardLocal {
  expanded: boolean;
  replying: boolean;
  truncatable: boolean;
}
type CardEl = HTMLDivElement & { _icon?: string };

// ── state (renderer-local mirror) ──
let cards: SessionState[] = []; // the main snapshot's cards (SessionState[])
let curPetRow: number = ROW.idle;
let widgetHovered = false; // whether the cursor is over the widget (drives collapse)
let dragging = false; // whether the pet is being dragged (don't collapse / disable click-through mid-drag)
const frameCounts: Record<number, number> = {}; // atlas row -> autoDetectFrames result
let idleAlpha: Uint8ClampedArray | null = null; // idle frame RGBA, for the per-pixel hover hit test
const cardLocal = new Map<string, CardLocal>(); // sessionId -> { expanded, replying, truncatable }

function iconFor(s: SessionState): string {
  if (s.pendingPermission) return "clock";
  if (s.state === "error") return "error";
  if (s.state === "attention") return "check";
  if (WORKING.has(s.state)) return "spinner";
  return "none";
}
function bodyFor(s: SessionState): { text: string; label: boolean } {
  if (s.pendingPermission)
    return { text: `\`${s.pendingPermission.tool}\` 실행 허가: ${s.pendingPermission.cmd}`, label: false };
  if (s.state === "error") return { text: s.body || "오류가 발생했습니다.", label: false };
  if (s.body) return { text: s.body, label: false };
  return { text: STATE_LABEL[s.state] || "…", label: true };
}

const ICON_SVG: Record<string, string> = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

// ── keyed render + FLIP reorder ──
const els = new Map<string, CardEl>();
const lastCardState = new Map<string, string>(); // sessionId -> prev state, to detect completion
let pinnedUntil = 0; // auto-open window (ms timestamp) opened on a response completion
let autoOpenTimer = 0; // timer to re-collapse after the auto-open window
const AUTO_OPEN_MS = 4500;
function render(): void {
  const all = cards.slice(-12);
  const list = all; // render ALL (the stack scrolls); no hard cap / +N badge
  // rest-state pet count badge = number of cards in the stack
  petCount.textContent = String(all.length);
  petCount.hidden = all.length === 0;

  // Only a RESPONSE COMPLETION (a session entering `attention`) auto-opens the
  // stack + scrolls — work-time updates (thinking/working/tool use) leave the
  // collapse state and scroll position alone, so the pet stays calm while busy.
  let justCompleted = false;
  for (const s of all) {
    if (s.state === "attention" && lastCardState.get(s.sessionId) !== "attention") justCompleted = true;
    lastCardState.set(s.sessionId, s.state);
  }
  if (justCompleted) {
    pinnedUntil = Date.now() + AUTO_OPEN_MS;
    if (autoOpenTimer) clearTimeout(autoOpenTimer);
    autoOpenTimer = window.setTimeout(() => { autoOpenTimer = 0; render(); }, AUTO_OPEN_MS + 60);
  }

  // Keep open while a permission is pending / replying / click-pinned / inside the
  // post-completion window; otherwise collapse to rest when the cursor isn't on it.
  if (pinnedOpen()) widget.classList.remove("is-collapsed");
  else if (!widgetHovered) widget.classList.add("is-collapsed");
  const done = all.filter((s) => s.state === "attention");
  const latestId = done.length
    ? done.reduce((a, b) => (a.completedAt > b.completedAt ? a : b)).sessionId
    : null;

  const first = new Map<string, number>();
  els.forEach((el, id) => first.set(id, el.getBoundingClientRect().top));

  const keep = new Set(list.map((s) => s.sessionId));
  els.forEach((el, id) => {
    if (!keep.has(id)) {
      el.classList.add("is-leaving");
      el.style.order = "-1";
      setTimeout(() => el.remove(), 220);
      els.delete(id);
    }
  });

  let newCard = false;
  list.forEach((s, i) => {
    let el = els.get(s.sessionId);
    if (!el) {
      el = buildCard(s.sessionId);
      els.set(s.sessionId, el);
      el.classList.add("is-new");
      el.addEventListener("animationend", () => el!.classList.remove("is-new"), { once: true });
      cardsEl.appendChild(el);
      newCard = true;
    }
    el.style.order = String(i);
    // First (oldest/top) card absorbs free space above → short stacks sit at the
    // bottom near the pet, while overflow still scrolls (unlike justify-content).
    el.style.marginTop = i === 0 ? "auto" : "";
    paintCard(el, s, { latest: s.sessionId === latestId });
  });

  requestAnimationFrame(() => {
    els.forEach((el, id) => {
      const prev = first.get(id);
      if (prev == null) return;
      const dy = prev - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        el.style.transition = "none";
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "";
          el.style.transform = "";
        });
      }
    });
    // Jump to the newest only when a card arrived or a response completed —
    // otherwise keep the user's scroll position so they can read older cards.
    if (justCompleted || newCard) cardsEl.scrollTop = cardsEl.scrollHeight;
    updateFades();
  });
}

function updateFades(): void {
  cardsEl.classList.toggle("fade-top", cardsEl.scrollTop > 2);
}
cardsEl.addEventListener("scroll", updateFades);

function local(id: string): CardLocal {
  let l = cardLocal.get(id);
  if (!l) {
    l = { expanded: false, replying: false, truncatable: false };
    cardLocal.set(id, l);
  }
  return l;
}

function buildCard(id: string): CardEl {
  const el = document.createElement("div") as CardEl;
  el.className = "card";
  el.innerHTML = `
      <button class="card__close" title="닫기">×</button>
      <span class="badge badge--latest" hidden>최신</span>
      <span class="badge badge--plusn" hidden></span>
      <div class="card__top"><div class="card__title"></div><div class="slot"></div><button class="slot-chev" hidden aria-label="펼치기"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
      <div class="card__body"></div>
      <div class="reply"><input type="text" placeholder="답장" /><button class="reply__send">답장</button></div>
      <div class="card__actions">
        <button class="card__expand" hidden>펼치기</button>
        <button class="card__replyBtn" hidden>답장</button>
      </div>`;
  el.querySelector<HTMLButtonElement>(".card__close")!.onclick = () => {
    els.delete(id);
    cardLocal.delete(id);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 200);
  };
  const toggleExpand = (): void => {
    const l = local(id);
    l.expanded = !l.expanded;
    render();
  };
  el.querySelector<HTMLButtonElement>(".card__expand")!.onclick = toggleExpand;
  el.querySelector<HTMLButtonElement>(".slot-chev")!.onclick = toggleExpand;
  el.querySelector<HTMLButtonElement>(".card__replyBtn")!.onclick = () => {
    local(id).replying = true;
    render();
    bridge?.setReplyFocus(true); // promote the window to key (so typing works)
    el.querySelector<HTMLInputElement>(".reply input")!.focus();
  };
  const send = (): void => {
    const s = cards.find((c) => c.sessionId === id);
    const msg = el.querySelector<HTMLInputElement>(".reply input")!.value;
    local(id).replying = false;
    bridge?.setReplyFocus(false);
    if (s && s.pendingPermission) {
      bridge?.resolvePermission(s.pendingPermission.id || id, "allow", msg);
    } else if (s && bridge) {
      bridge.sendReply({ sessionId: id, message: msg });
    }
    render();
  };
  el.querySelector<HTMLButtonElement>(".reply__send")!.onclick = send;
  const replyInput = el.querySelector<HTMLInputElement>(".reply input")!;
  const cancelReply = (): void => {
    local(id).replying = false;
    bridge?.setReplyFocus(false);
    // Dismiss a held Stop reply so the agent stops normally (no-op on a card
    // with nothing held). An empty message is treated as "dismiss" by main.
    bridge?.sendReply({ sessionId: id, message: "" });
    render();
  };
  replyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
    else if (e.key === "Escape") cancelReply(); // intuitive close without sending
  });
  replyInput.addEventListener("blur", () => bridge?.setReplyFocus(false));
  return el;
}

function paintCard(el: CardEl, s: SessionState, { latest, plusN = 0 }: { latest: boolean; plusN?: number }): void {
  const l = local(s.sessionId);
  el.querySelector<HTMLElement>(".card__title")!.textContent = s.title || "(제목 없음)";
  const b = bodyFor(s);
  const body = el.querySelector<HTMLElement>(".card__body")!;
  body.textContent = b.text;
  body.classList.toggle("is-label", b.label);

  const slot = el.querySelector<HTMLElement>(".slot")!;
  const icon = iconFor(s);
  if (el._icon !== icon) {
    el._icon = icon;
    slot.innerHTML =
      icon === "none"
        ? ""
        : icon === "spinner"
          ? '<div class="icon icon--spinner"></div>'
          : icon === "check"
            ? `<div class="icon icon--check">${ICON_SVG.check}</div>`
            : icon === "clock"
              ? `<div class="icon icon--clock">${ICON_SVG.clock}</div>`
              : '<div class="icon icon--error">!</div>';
  }

  el.querySelector<HTMLElement>(".badge--latest")!.hidden = !latest;
  const plus = el.querySelector<HTMLElement>(".badge--plusn")!;
  plus.hidden = !plusN;
  if (plusN) plus.textContent = `+${plusN}`;

  el.querySelector<HTMLButtonElement>(".card__replyBtn")!.hidden = l.replying;
  el.classList.toggle("is-replying", l.replying);
  el.classList.toggle("is-expanded", l.expanded);

  requestAnimationFrame(() => {
    if (!l.expanded) l.truncatable = body.scrollHeight - body.clientHeight > 2;
    el.classList.toggle("has-more", !!l.truncatable);
    const ex = el.querySelector<HTMLButtonElement>(".card__expand")!;
    ex.hidden = !l.truncatable || l.replying;
    ex.textContent = l.expanded ? "접기" : "펼치기";
    el.querySelector<HTMLButtonElement>(".slot-chev")!.hidden = !l.truncatable;
  });
}

// ── pet sprite animation ──
// Playback modes follow the asset spec (docs/02 §4.3): idle=pingpong,
// running/waiting/review=loop, waving/jumping=once→idle, failed=hold(last frame).
// Hover plays a one-shot wave (greeting once, then settles back to idle), not an
// endless loop.
const petEl = $("pet");
const HOVER_ROW = ROW.waving;
let hoverShot = false; // cursor is over the pet's VISIBLE pixels -> one-shot wave

// Per-pixel hit test: sample the idle sprite's alpha so the wave only fires over
// the pet's actual pixels, not the transparent margins of its bounding box.
function isOverPet(clientX: number, clientY: number): boolean {
  if (!idleAlpha) return true; // before the sprite decodes: fall back to the box
  const rect = petEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return true;
  const fx = Math.floor(((clientX - rect.left) / rect.width) * FRAME_W);
  const fy = Math.floor(((clientY - rect.top) / rect.height) * FRAME_H);
  if (fx < 0 || fx >= FRAME_W || fy < 0 || fy >= FRAME_H) return false;
  return idleAlpha[(fy * FRAME_W + fx) * 4 + 3] > 16;
}
petEl.addEventListener("pointermove", (e) => {
  if (!dragging) hoverShot = isOverPet(e.clientX, e.clientY);
});
petEl.addEventListener("pointerleave", () => (hoverShot = false));
// Right-click the pet -> native "펫 닫기" menu (Codex parity).
petEl.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  bridge?.showPetMenu();
});

// ── pet drag (move between dual monitors) ──
//    Pointer capture keeps move events flowing even when the cursor leaves the
//    pet. The main process tracks the window by the global cursor point, so it
//    crosses monitor boundaries and survives HiDPI scale differences.
let dragRAF = 0;
let pinnedByClick = false; // a tap on the pet keeps the stack open (click affordance)
let downX = 0,
  downY = 0,
  petMoved = false; // distinguishes a tap from a drag
petEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // left button only
  dragging = true;
  downX = e.clientX;
  downY = e.clientY;
  petMoved = false;
  try {
    petEl.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  bridge?.dragStart();
  e.preventDefault();
});
petEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) petMoved = true;
  if (dragRAF) return;
  dragRAF = requestAnimationFrame(() => {
    dragRAF = 0;
    bridge?.dragMove();
  });
});
function endPetDrag(e: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  if (dragRAF) {
    cancelAnimationFrame(dragRAF);
    dragRAF = 0;
  }
  try {
    petEl.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  bridge?.dragEnd();
  // A tap (no real movement) toggles the stack open — a reliable click target
  // for the collapsed (1) badge, independent of the hover-to-expand path.
  if (!petMoved) {
    pinnedByClick = !pinnedByClick;
    if (pinnedByClick) {
      bridge?.setInteractive(true);
      widget.classList.remove("is-collapsed");
    }
    render();
    return;
  }
  // After dropping a real drag, if the cursor is outside the widget, tidy up
  // (collapse + restore click-through).
  if (!widget.matches(":hover")) {
    if (bridge && !pinnedOpen()) bridge.setInteractive(false);
    if (!pinnedOpen()) widget.classList.add("is-collapsed");
  }
}
petEl.addEventListener("pointerup", endPetDrag);
petEl.addEventListener("pointercancel", endPetDrag);

let frame = 0,
  dir = 1,
  acc = 0,
  last = 0,
  prevTarget = -1, // last state/hover row, to re-arm one-shots on entry
  renderRow = -1, // the row actually being drawn (may differ once a clip settles)
  oncePlayed = false; // a "once" clip for the current target has finished
function tick(now: number): void {
  // A hover wave overlays the state-driven row as a one-shot.
  const target = hoverShot ? HOVER_ROW : curPetRow;
  if (target !== prevTarget) {
    prevTarget = target; // entering a row re-arms its one-shot
    oncePlayed = false;
  }
  // A finished "once" clip settles back to idle (waving/jumping → idle); "hold"
  // (failed) keeps its last frame; loop/pingpong play continuously.
  const targetMode = (ROW_ANIM[target] || ROW_ANIM[ROW.idle]).mode;
  const r = targetMode === "once" && oncePlayed ? ROW.idle : target;
  if (r !== renderRow) {
    renderRow = r;
    frame = 0;
    dir = 1;
    acc = 0;
  }
  const a = ROW_ANIM[r] || ROW_ANIM[ROW.idle];
  const fc = isPingpong(r) ? a.frames : Math.max(1, frameCounts[r] || a.frames);
  if (last) acc += now - last;
  last = now;
  if (acc >= a.ms) {
    acc = 0;
    if (isPingpong(r)) {
      frame += dir;
      if (frame >= fc - 1 || frame <= 0) dir *= -1;
    } else if (a.mode === "once" || a.mode === "hold") {
      if (frame < fc - 1) frame++;
      else if (a.mode === "once") oncePlayed = true; // end reached → settle to idle next tick
      // "hold": stay on the last frame
    } else {
      frame = (frame + 1) % fc; // loop
    }
  }
  if (frame >= fc) frame = 0;
  petSprite.style.backgroundPosition = `${-frame * FRAME_W}px ${-r * FRAME_H}px`;
  requestAnimationFrame(tick);
}

// ── rest = collapsed (pet + count badge). hover expands the cards; leaving
//    collapses again. While a permission is pending or a reply is being typed,
//    leaving does NOT collapse and click-through stays on (avoid a visible but
//    un-clickable state). #widget hover toggles click-through (setInteractive).
function hasPending(): boolean {
  return cards.some((c) => c && c.pendingPermission);
}
function isReplying(): boolean {
  return [...cardLocal.values()].some((l) => l && l.replying);
}
function pinnedOpen(): boolean {
  return hasPending() || isReplying() || pinnedByClick || Date.now() < pinnedUntil;
}
widget.classList.add("is-collapsed"); // default rest state
widget.addEventListener("mouseenter", () => {
  widgetHovered = true;
  bridge?.setInteractive(true);
  widget.classList.remove("is-collapsed");
});
widget.addEventListener("mouseleave", () => {
  widgetHovered = false;
  if (bridge && !pinnedOpen() && !dragging) bridge.setInteractive(false);
  if (!pinnedOpen() && !dragging) widget.classList.add("is-collapsed");
});

// ── manual collapse (⌄) — lives inside the pet now, so stop its pointer events
//    from starting a pet drag/tap ──
const collapseBtn = $("collapse");
collapseBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
collapseBtn.onclick = (e) => {
  e.stopPropagation();
  widget.classList.toggle("is-collapsed");
};

// ── load the sprite (path from main) + 🐾 fallback + autoDetectFrames ──
function applyPetAsset(asset: PetAsset | null | undefined): void {
  const url = asset && asset.spritesheetUrl;
  if (!url) {
    petSprite.classList.add("is-fallback");
    return;
  }
  petSprite.classList.remove("is-fallback");
  const img = new Image();
  img.onload = () => {
    petSprite.style.setProperty("--sprite-url", `url("${url}")`);
    try {
      detectFrames(img);
    } catch {
      /* fall back to per-row defaults when getImageData is unavailable */
    }
  };
  img.onerror = () => petSprite.classList.add("is-fallback");
  img.src = url;
  petSprite.style.setProperty("--sprite-url", `url("${url}")`);
}

// autoDetectFrames: scan the canvas for transparent cells to derive the real
// per-row frame count (prevents flicker on empty cells).
function detectFrames(image: HTMLImageElement): void {
  const cols = Math.round(image.naturalWidth / FRAME_W);
  const rows = Math.round(image.naturalHeight / FRAME_H);
  const cv = document.createElement("canvas");
  cv.width = image.naturalWidth;
  cv.height = image.naturalHeight;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(image, 0, 0);
  // Idle frame (row 0, col 0) alpha — the silhouette used for the hover hit test.
  idleAlpha = cx.getImageData(0, 0, FRAME_W, FRAME_H).data;
  for (let r = 0; r < rows; r++) {
    let lastNonEmpty = 0;
    for (let c = 0; c < cols; c++) {
      const d = cx.getImageData(c * FRAME_W, r * FRAME_H, FRAME_W, FRAME_H).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 28) {
        if (d[i] > 16 && ++opaque > 12) break;
      }
      if (opaque > 12) lastNonEmpty = c + 1;
    }
    frameCounts[r] = Math.max(1, lastNonEmpty);
  }
}

// ── IPC-driven: refresh cards / pet from the main snapshot ──
let petAssetApplied = false;
function onSnapshot(snap: StatePayload): void {
  if (!snap) return;
  if (snap.petAsset && !petAssetApplied) {
    applyPetAsset(snap.petAsset);
    petAssetApplied = true;
  } else if (!snap.petAsset && !petAssetApplied) {
    petSprite.classList.add("is-fallback");
    petAssetApplied = true;
  }
  cards = Array.isArray(snap.cards) ? snap.cards : [];
  if (typeof snap.petRow === "number") curPetRow = snap.petRow;
  render();
}

if (bridge && typeof bridge.onState === "function") {
  bridge.onState(onSnapshot);
} else {
  // Opened without a preload (static preview): show only the fallback pet.
  petSprite.classList.add("is-fallback");
}

// ── update toast: surface a newer GitHub release (install = `curl | bash`) ──
const updateToast = $("updateToast");
const updateVersion = $("updateVersion");
$("updateBtn").addEventListener("click", () => bridge?.runUpdate());
$("updateLater").addEventListener("click", () => (updateToast.hidden = true));
if (bridge && typeof bridge.onUpdateAvailable === "function") {
  bridge.onUpdateAvailable((info) => {
    updateVersion.textContent = info.version;
    updateToast.hidden = false;
  });
}

render();
requestAnimationFrame(tick);
