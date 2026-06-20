/* Claude-Pet 렌더러 — prototype/app.js의 렌더/애니/reorder/페이드/autoDetectFrames
   로직을 유지하되, mock 시나리오 엔진을 IPC 구동(window.claudePet.onState)으로 교체.
   세션 스토어는 메인이 소유하고, 렌더러는 스냅샷을 받아 카드/펫을 그린다. */
(() => {
  "use strict";

  // ── 공유 상수 (preload 우선, <script> 글로벌 폴백) ──
  const bridge = window.claudePet || null;
  const C = (bridge && bridge.constants) || window.CLAUDE_PET_CONSTANTS || {};
  const ROW = C.ROW || {
    idle: 0, "running-right": 1, "running-left": 2, waving: 3, jumping: 4,
    failed: 5, waiting: 6, running: 7, review: 8,
  };
  const FRAME_W = C.FRAME_W || 192;
  const FRAME_H = C.FRAME_H || 208;
  const STATE_LABEL = C.STATE_LABEL || {
    thinking: "생각 중", working: "생각 중", juggling: "서브에이전트 가동 중",
    sweeping: "정리 중", carrying: "worktree 생성",
  };
  const WORKING = new Set(["working", "thinking", "juggling", "sweeping", "carrying"]);

  // ── 행별 프레임 케이던스 (상수에서, 폴백 포함) ──
  const ROW_ANIM = C.ROW_ANIM || {
    [ROW.idle]: { frames: 2, ms: 700, mode: "pingpong" },
    [ROW.running]: { frames: 8, ms: 112, mode: "loop" },
    [ROW["running-right"]]: { frames: 8, ms: 112, mode: "loop" },
    [ROW["running-left"]]: { frames: 8, ms: 112, mode: "loop" },
    [ROW.waving]: { frames: 6, ms: 95, mode: "once" },
    [ROW.waiting]: { frames: 8, ms: 150, mode: "loop" },
    [ROW.failed]: { frames: 8, ms: 105, mode: "hold" },
    [ROW.jumping]: { frames: 8, ms: 95, mode: "once" },
    [ROW.review]: { frames: 8, ms: 160, mode: "loop" },
  };
  const isPingpong = (r) => (ROW_ANIM[r] || {}).mode === "pingpong";

  // ── DOM ──
  const $ = (id) => document.getElementById(id);
  const cardsEl = $("cards"), petSprite = $("petSprite"), widget = $("widget"), petCount = $("petCount");

  // ── 상태(렌더러 로컬 미러) ──
  let cards = [];          // 메인 스냅샷의 cards (SessionState[])
  let curPetRow = ROW.idle;
  let widgetHovered = false; // 위젯 위에 커서가 있는지(접힘 결정에 사용)
  let dragging = false;      // 펫을 드래그 중인지(드래그 중엔 접힘/click-through 끄지 않음)
  const frameCounts = {};  // atlas 행 -> autoDetectFrames 결과
  const cardLocal = new Map(); // sessionId -> { expanded, replying, truncatable }

  function iconFor(s) {
    if (s.pendingPermission) return "clock";
    if (s.state === "error") return "error";
    if (s.state === "attention") return "check";
    if (WORKING.has(s.state)) return "spinner";
    return "none";
  }
  function bodyFor(s) {
    if (s.pendingPermission) return { text: `\`${s.pendingPermission.tool}\` 실행 허가: ${s.pendingPermission.cmd}`, label: false };
    if (s.state === "error") return { text: s.body || "오류가 발생했습니다.", label: false };
    if (s.body) return { text: s.body, label: false };
    return { text: STATE_LABEL[s.state] || "…", label: true };
  }

  const ICON_SVG = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  // ── 키드 렌더 + FLIP 재정렬 ──
  const els = new Map();
  function render() {
    const all = cards.slice(-12);
    const visibleLimit = 3;
    const overflowCount = Math.max(0, all.length - visibleLimit);
    const list = all.slice(-visibleLimit);
    // 접힘(rest) 상태 펫 카운트 배지 = 스택 카드 수
    petCount.textContent = String(all.length);
    petCount.hidden = all.length === 0;
    // 권한 대기/답장 중이면 펼친 채 유지(자동 펼침). 둘 다 아니고 hover도 아니면 접음
    // — 권한이 해소되면 hover 없이도 다시 rest로 접히게(stuck-open 방지).
    if (pinnedOpen()) widget.classList.remove("is-collapsed");
    else if (!widgetHovered) widget.classList.add("is-collapsed");
    const done = all.filter((s) => s.state === "attention");
    const latestId = done.length ? done.reduce((a, b) => (a.completedAt > b.completedAt ? a : b)).sessionId : null;

    const first = new Map();
    els.forEach((el, id) => first.set(id, el.getBoundingClientRect().top));

    const keep = new Set(list.map((s) => s.sessionId));
    els.forEach((el, id) => {
      if (!keep.has(id)) {
        el.classList.add("is-leaving"); el.style.order = "-1";
        setTimeout(() => el.remove(), 220); els.delete(id);
      }
    });

    list.forEach((s, i) => {
      let el = els.get(s.sessionId);
      if (!el) {
        el = buildCard(s.sessionId); els.set(s.sessionId, el);
        el.classList.add("is-new");
        el.addEventListener("animationend", () => el.classList.remove("is-new"), { once: true });
        cardsEl.appendChild(el);
      }
      el.style.order = String(i);
      const plusN = overflowCount && i === list.length - 1 ? overflowCount : 0;
      paintCard(el, s, { latest: s.sessionId === latestId, plusN });
    });

    requestAnimationFrame(() => {
      els.forEach((el, id) => {
        const prev = first.get(id); if (prev == null) return;
        const dy = prev - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          el.style.transition = "none"; el.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => { el.style.transition = ""; el.style.transform = ""; });
        }
      });
      cardsEl.scrollTop = cardsEl.scrollHeight;
      updateFades();
    });
  }

  function updateFades() {
    cardsEl.classList.toggle("fade-top", cardsEl.scrollTop > 2);
  }
  cardsEl.addEventListener("scroll", updateFades);

  function local(id) {
    let l = cardLocal.get(id);
    if (!l) { l = { expanded: false, replying: false, truncatable: false }; cardLocal.set(id, l); }
    return l;
  }

  function buildCard(id) {
    const el = document.createElement("div");
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
    el.querySelector(".card__close").onclick = () => {
      els.delete(id); cardLocal.delete(id);
      el.classList.add("is-leaving"); setTimeout(() => el.remove(), 200);
    };
    const toggleExpand = () => { const l = local(id); l.expanded = !l.expanded; render(); };
    el.querySelector(".card__expand").onclick = toggleExpand;
    el.querySelector(".slot-chev").onclick = toggleExpand;
    el.querySelector(".card__replyBtn").onclick = () => {
      local(id).replying = true; render();
      if (bridge && bridge.setReplyFocus) bridge.setReplyFocus(true); // 창을 key로 승격(타이핑 가능)
      el.querySelector(".reply input").focus();
    };
    const send = () => {
      const s = cards.find((c) => c.sessionId === id);
      const msg = el.querySelector(".reply input").value;
      local(id).replying = false;
      if (bridge && bridge.setReplyFocus) bridge.setReplyFocus(false);
      if (s && s.pendingPermission) {
        if (bridge) bridge.resolvePermission(s.pendingPermission.id || id, "allow", msg);
      } else if (s && bridge) {
        bridge.sendReply({ sessionId: id, message: msg });
      }
      render();
    };
    el.querySelector(".reply__send").onclick = send;
    const replyInput = el.querySelector(".reply input");
    replyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    replyInput.addEventListener("blur", () => { if (bridge && bridge.setReplyFocus) bridge.setReplyFocus(false); });
    return el;
  }

  function paintCard(el, s, { latest, plusN = 0 }) {
    const l = local(s.sessionId);
    el.querySelector(".card__title").textContent = s.title || "(제목 없음)";
    const b = bodyFor(s);
    const body = el.querySelector(".card__body");
    body.textContent = b.text; body.classList.toggle("is-label", b.label);

    const slot = el.querySelector(".slot");
    const icon = iconFor(s);
    if (el._icon !== icon) {
      el._icon = icon;
      slot.innerHTML = icon === "none" ? "" :
        icon === "spinner" ? '<div class="icon icon--spinner"></div>' :
        icon === "check" ? `<div class="icon icon--check">${ICON_SVG.check}</div>` :
        icon === "clock" ? `<div class="icon icon--clock">${ICON_SVG.clock}</div>` :
                           '<div class="icon icon--error">!</div>';
    }

    el.querySelector(".badge--latest").hidden = !latest;
    const plus = el.querySelector(".badge--plusn");
    plus.hidden = !plusN;
    if (plusN) plus.textContent = `+${plusN}`;

    el.querySelector(".card__replyBtn").hidden = l.replying;
    el.classList.toggle("is-replying", l.replying);
    el.classList.toggle("is-expanded", l.expanded);

    requestAnimationFrame(() => {
      if (!l.expanded) l.truncatable = (body.scrollHeight - body.clientHeight) > 2;
      el.classList.toggle("has-more", !!l.truncatable);
      const ex = el.querySelector(".card__expand");
      ex.hidden = !l.truncatable || l.replying;
      ex.textContent = l.expanded ? "접기" : "펼치기";
      el.querySelector(".slot-chev").hidden = !l.truncatable;
    });
  }

  // ── 펫 스프라이트 애니메이션 ──
  const petEl = $("pet");
  let hovering = false;
  petEl.addEventListener("mouseenter", () => (hovering = true));
  petEl.addEventListener("mouseleave", () => (hovering = false));
  const HOVER_ROW = ROW.waving;

  // ── 펫 드래그(듀얼 모니터 사이 이동) ──
  //    pointer capture로 커서가 펫을 벗어나도 move 이벤트가 유지된다. 메인이 전역
  //    커서 좌표로 창을 추적하므로 모니터 경계를 넘고 HiDPI 차이도 견딘다.
  let dragRAF = 0;
  petEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // 좌클릭만
    dragging = true;
    try { petEl.setPointerCapture(e.pointerId); } catch (_) {}
    if (bridge && bridge.dragStart) bridge.dragStart();
    e.preventDefault();
  });
  petEl.addEventListener("pointermove", () => {
    if (!dragging || dragRAF) return;
    dragRAF = requestAnimationFrame(() => {
      dragRAF = 0;
      if (bridge && bridge.dragMove) bridge.dragMove();
    });
  });
  function endPetDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (dragRAF) { cancelAnimationFrame(dragRAF); dragRAF = 0; }
    try { petEl.releasePointerCapture(e.pointerId); } catch (_) {}
    if (bridge && bridge.dragEnd) bridge.dragEnd();
    // 드롭 후 커서가 위젯 밖이면 정리(접힘 + click-through 복귀)
    if (!widget.matches(":hover")) {
      if (bridge && !pinnedOpen()) bridge.setInteractive(false);
      if (!pinnedOpen()) widget.classList.add("is-collapsed");
    }
  }
  petEl.addEventListener("pointerup", endPetDrag);
  petEl.addEventListener("pointercancel", endPetDrag);

  let frame = 0, dir = 1, acc = 0, last = 0, curRow = -1;
  function tick(now) {
    const r = hovering ? HOVER_ROW : curPetRow;
    if (r !== curRow) { curRow = r; frame = 0; dir = 1; acc = 0; }
    const a = ROW_ANIM[r] || ROW_ANIM[ROW.idle];
    const fc = isPingpong(r) ? a.frames : Math.max(1, frameCounts[r] || a.frames);
    if (last) acc += now - last;
    last = now;
    if (acc >= a.ms) {
      acc = 0;
      if (isPingpong(r)) { frame += dir; if (frame >= fc - 1 || frame <= 0) dir *= -1; }
      else { frame = (frame + 1) % fc; }
    }
    if (frame >= fc) frame = 0;
    petSprite.style.backgroundPosition = `${-frame * FRAME_W}px ${-r * FRAME_H}px`;
    requestAnimationFrame(tick);
  }

  // ── rest = 접힘(펫 + 카운트 배지). hover 시 카드 펼침, 떠나면 다시 접힘 ──
  //    권한 대기 중이거나 답장 입력 중이면 떠나도 접지 않고 click-through도 끄지 않는다
  //    (보이는데 클릭 안 되는 상태 방지). #widget hover는 click-through(setInteractive) 토글.
  function hasPending() { return cards.some((c) => c && c.pendingPermission); }
  function isReplying() { return [...cardLocal.values()].some((l) => l && l.replying); }
  function pinnedOpen() { return hasPending() || isReplying(); }
  widget.classList.add("is-collapsed"); // 기본 rest 상태
  widget.addEventListener("mouseenter", () => {
    widgetHovered = true;
    if (bridge) bridge.setInteractive(true);
    widget.classList.remove("is-collapsed");
  });
  widget.addEventListener("mouseleave", () => {
    widgetHovered = false;
    if (bridge && !pinnedOpen() && !dragging) bridge.setInteractive(false);
    if (!pinnedOpen() && !dragging) widget.classList.add("is-collapsed");
  });

  // ── 수동 접기(⌄) ──
  $("collapse").onclick = () => widget.classList.toggle("is-collapsed");

  // ── 스프라이트 로드 (메인이 준 경로) + 🐾 폴백 + autoDetectFrames ──
  function applyPetAsset(asset) {
    const url = asset && asset.spritesheetUrl;
    if (!url) { petSprite.classList.add("is-fallback"); return; }
    petSprite.classList.remove("is-fallback");
    const img = new Image();
    img.onload = () => {
      petSprite.style.setProperty("--sprite-url", `url("${url}")`);
      try { detectFrames(img); } catch (e) { /* getImageData 불가 시 행별 기본값 사용 */ }
    };
    img.onerror = () => petSprite.classList.add("is-fallback");
    img.src = url;
    petSprite.style.setProperty("--sprite-url", `url("${url}")`);
  }

  // autoDetectFrames: 캔버스에서 투명 셀을 스캔해 행별 실제 프레임 수를 구함(깜빡임 방지).
  function detectFrames(image) {
    const cols = Math.round(image.naturalWidth / FRAME_W);
    const rows = Math.round(image.naturalHeight / FRAME_H);
    const cv = document.createElement("canvas");
    cv.width = image.naturalWidth; cv.height = image.naturalHeight;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(image, 0, 0);
    for (let r = 0; r < rows; r++) {
      let lastNonEmpty = 0;
      for (let c = 0; c < cols; c++) {
        const d = cx.getImageData(c * FRAME_W, r * FRAME_H, FRAME_W, FRAME_H).data;
        let opaque = 0;
        for (let i = 3; i < d.length; i += 28) { if (d[i] > 16 && ++opaque > 12) break; }
        if (opaque > 12) lastNonEmpty = c + 1;
      }
      frameCounts[r] = Math.max(1, lastNonEmpty);
    }
  }

  // ── IPC 구동: 메인 스냅샷으로 카드/펫 갱신 ──
  let petAssetApplied = false;
  function onSnapshot(snap) {
    if (!snap) return;
    if (snap.petAsset && !petAssetApplied) { applyPetAsset(snap.petAsset); petAssetApplied = true; }
    else if (!snap.petAsset && !petAssetApplied) { petSprite.classList.add("is-fallback"); petAssetApplied = true; }
    cards = Array.isArray(snap.cards) ? snap.cards : [];
    if (typeof snap.petRow === "number") curPetRow = snap.petRow;
    render();
  }

  if (bridge && typeof bridge.onState === "function") {
    bridge.onState(onSnapshot);
  } else {
    // preload 없이 열렸을 때(정적 미리보기) 폴백 펫만 표시.
    petSprite.classList.add("is-fallback");
  }

  render();
  requestAnimationFrame(tick);
})();
