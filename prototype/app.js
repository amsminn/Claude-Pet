/* Claude-Pet 디자인 검증 엔진 (mock)
   docs/03-state-engine · 04-pet-ui 의 로직을 그대로 구현해, 비주얼뿐 아니라
   세션=카드 · 전역 펫 reduce · 스택/오버플로 · 답장 설계까지 검증한다. */
(() => {
  "use strict";

  // ── 공식 9행 atlas (docs/02-asset-compat §4.1) ──
  const ROW = { idle:0, "running-right":1, "running-left":2, waving:3, jumping:4, failed:5, waiting:6, running:7, review:8 };
  const FRAME_W = 192, FRAME_H = 208;

  // ── EVENT_TO_STATE (docs/03-state-engine) ──
  const EVENT_TO_STATE = {
    SessionStart:"idle", SessionEnd:"sleeping", UserPromptSubmit:"thinking",
    PreToolUse:"working", PostToolUse:"working", PostToolUseFailure:"error",
    StopFailure:"error", ApiError:"error", Stop:"attention",
    SubagentStart:"juggling", SubagentStop:"working", PreCompact:"sweeping",
    PostCompact:"thinking", Notification:"notification", Elicitation:"notification",
    WorktreeCreate:"carrying",
  };
  const WORKING = new Set(["working","thinking","juggling","sweeping","carrying"]);

  // ── 전역 펫 행 reduce (docs/03-state-engine §2.2) ──
  function petRow(list) {
    if (list.some(s => s.pendingPermission || s.state === "notification")) return ROW.waving;
    if (list.some(s => s.state === "error"))    return ROW.failed;
    if (list.some(s => WORKING.has(s.state)))   return ROW.running;
    if (list.length && list.every(s => s.state === "attention")) return ROW.review;
    return ROW.idle;
  }

  // ── 행별 프레임 케이던스 ──
  const ROW_ANIM = {
    [ROW.idle]:        { frames:2, ms:700, pingpong:true },
    [ROW.running]:     { frames:8, ms:112 },
    [ROW["running-right"]]: { frames:8, ms:112 },
    [ROW["running-left"]]:  { frames:8, ms:112 },
    [ROW.waving]:      { frames:8, ms:95 },
    [ROW.waiting]:     { frames:8, ms:150 },
    [ROW.failed]:      { frames:8, ms:105 },
    [ROW.jumping]:     { frames:8, ms:95 },
    [ROW.review]:      { frames:8, ms:160 },
  };

  // ── 상태 라벨 (진행 중 본문 자리) ──
  const STATE_LABEL = { thinking:"생각 중", working:"생각 중", juggling:"서브에이전트 가동 중", sweeping:"정리 중" };

  // ── DOM ──
  const $ = id => document.getElementById(id);
  const cardsEl = $("cards"), petSprite = $("petSprite"), widget = $("widget");
  const statusEl = $("status");

  // ── 상태 ──
  const sessions = new Map();   // sessionId -> session
  const frameCounts = {};       // atlas 행 -> 실제 채워진 프레임 수(autoDetectFrames)
  let seq = 0;                  // 단조 시퀀스(생성/갱신 순서)
  let timers = [];             // 예약된 setTimeout
  let curScenario = null;
  let speed = 1;

  function makeSession(id) {
    return { id, state:"idle", title:"", body:"", completedAt:0,
             createdAt:++seq, updatedAt:seq, pendingPermission:null,
             expanded:false, replying:false };
  }

  function apply(ev) {
    const s = sessions.get(ev.s) || (sessions.set(ev.s, makeSession(ev.s)), sessions.get(ev.s));
    s.updatedAt = ++seq;

    if (ev.kind === "PermissionRequest") {
      s.pendingPermission = ev.perm || { tool:"Bash", cmd:"…" };
    } else {
      const st = EVENT_TO_STATE[ev.kind];
      if (st) s.state = st;
      if (ev.kind === "Stop") { s.completedAt = ++seq; s.pendingPermission = null; }
      if (st === "error") s.pendingPermission = null;
    }
    if (ev.title) s.title = ev.title;
    if (ev.body) s.body = ev.body;        // 빈 값으로 덮어쓰지 않음(불변식)
    render();
  }

  // ── 카드 정렬: chat-like 생성순(오래된 위 → 최신 아래). 아래로 쌓이고 위로 스크롤되며 페이드 ──
  function ordered() {
    return [...sessions.values()]
      .filter(s => s.state !== "sleeping" || s.body)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  function iconFor(s) {
    if (s.pendingPermission) return "clock";
    if (s.state === "error") return "error";
    if (s.state === "attention") return "check";
    if (WORKING.has(s.state)) return "spinner";
    return "none";
  }
  function bodyFor(s) {
    if (s.pendingPermission) return { text:`\`${s.pendingPermission.tool}\` 실행 허가: ${s.pendingPermission.cmd}`, label:false };
    if (s.state === "error")  return { text: s.body || "오류가 발생했습니다.", label:false };
    if (s.body)               return { text: s.body, label:false };
    return { text: STATE_LABEL[s.state] || "…", label:true };
  }

  const ICON_SVG = { check:'<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                     clock:'<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' };

  // ── 키드 렌더 + FLIP 재정렬 ──
  const els = new Map();
  function render() {
    const list = ordered().slice(-12);              // 모든 카드(최근 12장) — 스크롤 영역
    const done = list.filter(s => s.state === "attention");
    const latestId = done.length ? done.reduce((a, b) => a.completedAt > b.completedAt ? a : b).id : null;

    // FLIP: 이전 위치 기록
    const first = new Map();
    els.forEach((el, id) => first.set(id, el.getBoundingClientRect().top));

    const keep = new Set(list.map(s => s.id));
    els.forEach((el, id) => {
      if (!keep.has(id)) {
        el.classList.add("is-leaving"); el.style.order = "-1";
        setTimeout(() => el.remove(), 220); els.delete(id);
      }
    });

    list.forEach((s, i) => {
      let el = els.get(s.id);
      if (!el) {                                    // 신규 카드만 DOM 삽입 + 진입 애니메이션 1회
        el = buildCard(s.id); els.set(s.id, el);
        el.classList.add("is-new");
        el.addEventListener("animationend", () => el.classList.remove("is-new"), { once: true });
        cardsEl.appendChild(el);
      }
      el.style.order = String(i);                   // 순서는 flex order로만 — DOM 재삽입 없음(애니 재시작 방지)
      paintCard(el, s, { latest: s.id === latestId, plusN: 0 });
    });

    // FLIP: 새 위치와 차이를 transform 으로 잡았다가 해제
    requestAnimationFrame(() => {
      els.forEach((el, id) => {
        const prev = first.get(id); if (prev == null) return;
        const dy = prev - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          el.style.transition = "none"; el.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => { el.style.transition = ""; el.style.transform = ""; });
        }
      });
      cardsEl.scrollTop = cardsEl.scrollHeight;      // 새 카드가 보이게 맨 아래로
      updateFades();
    });

    statusEl.textContent = `세션 ${sessions.size} · 카드 ${list.length} · 펫행 ${rowName(petRow([...sessions.values()]))}`;
  }

  // 스크롤 위치에 따라 위/아래 페이드 마스크 토글(스크롤 가능할 때만 나타남)
  function updateFades() {
    // 위쪽(오래된 카드 스크롤 아웃)만 페이드. 아래(최신 카드·펫 옆)는 항상 또렷 — Codex 실측(s_103s)
    cardsEl.classList.toggle("fade-top", cardsEl.scrollTop > 2);
  }
  cardsEl.addEventListener("scroll", updateFades);

  function rowName(r){ return Object.keys(ROW).find(k=>ROW[k]===r); }

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
    el.querySelector(".card__close").onclick = () => { sessions.delete(id); els.delete(id); el.classList.add("is-leaving"); setTimeout(()=>el.remove(),200); render(); };
    const toggleExpand = () => { const s=sessions.get(id); if(s){ s.expanded=!s.expanded; render(); } };
    el.querySelector(".card__expand").onclick = toggleExpand;
    el.querySelector(".slot-chev").onclick = toggleExpand;
    el.querySelector(".card__replyBtn").onclick = () => { const s=sessions.get(id); if(s){ s.replying=true; render(); el.querySelector(".reply input").focus(); } };
    const send = () => {
      const s = sessions.get(id), msg = el.querySelector(".reply input").value;
      if (s && s.pendingPermission) resolvePermission(id, "allow", msg);
      else if (s) { s.replying = false; statusEl.textContent = `답장 전송(mock): "${msg}"`; render(); }
    };
    el.querySelector(".reply__send").onclick = send;
    el.querySelector(".reply input").addEventListener("keydown", e => { if (e.key==="Enter") send(); });
    return el;
  }

  function paintCard(el, s, { latest, plusN }) {
    el.querySelector(".card__title").textContent = s.title || "(제목 없음)";
    const b = bodyFor(s);
    const body = el.querySelector(".card__body");
    body.textContent = b.text; body.classList.toggle("is-label", b.label);

    const slot = el.querySelector(".slot");
    const icon = iconFor(s);
    if (el._icon !== icon) {                          // 아이콘 종류가 바뀔 때만 재생성(스피너 재시작 방지)
      el._icon = icon;
      slot.innerHTML = icon === "none" ? "" :
        icon === "spinner" ? '<div class="icon icon--spinner"></div>' :
        icon === "check"   ? `<div class="icon icon--check">${ICON_SVG.check}</div>` :
        icon === "clock"   ? `<div class="icon icon--clock">${ICON_SVG.clock}</div>` :
                             '<div class="icon icon--error">!</div>';
    }

    const latestBadge = el.querySelector(".badge--latest");
    latestBadge.hidden = !latest;
    const plus = el.querySelector(".badge--plusn");
    plus.hidden = !plusN; if (plusN) plus.textContent = `+${plusN}`;

    // 답장: 모든 카드 hover 시 노출(Codex 동일 — image #10). 권한 카드는 인라인 입력이 에이전트로 전달
    el.querySelector(".card__replyBtn").hidden = s.replying;
    el.classList.toggle("is-replying", s.replying);
    el.classList.toggle("is-expanded", s.expanded);

    // 펼치기/접기: 본문이 잘리면(또는 이미 펼친 상태면) hover 시 노출
    requestAnimationFrame(() => {
      if (!s.expanded) s.truncatable = (body.scrollHeight - body.clientHeight) > 2;
      el.classList.toggle("has-more", !!s.truncatable);
      const ex = el.querySelector(".card__expand");
      ex.hidden = !s.truncatable || s.replying;           // bottom-right '펼치기'/'접기' 텍스트 pill
      ex.textContent = s.expanded ? "접기" : "펼치기";
      el.querySelector(".slot-chev").hidden = !s.truncatable; // top-right '›' (hover 시 상태아이콘 대체)
    });
  }

  // ── 권한 응답 → 시나리오 이어가기 (blocking hook 응답 흉내) ──
  function resolvePermission(id, decision, message) {
    const s = sessions.get(id); if (!s || !s.pendingPermission) return;
    s.pendingPermission = null; s.replying = false;
    s.state = decision === "allow" ? "working" : "attention";
    s.updatedAt = ++seq;
    statusEl.textContent = `답장 전송: ${decision}${message?` — "${message}"`:""}`;
    const cont = decision === "allow" ? curScenario?.onAllow : curScenario?.onDeny;
    render();
    if (cont) schedule(cont);
  }

  // ── 펫 스프라이트 애니메이션 ──
  const petEl = $("pet");
  let hovering = false;
  petEl.addEventListener("mouseenter", () => hovering = true);
  petEl.addEventListener("mouseleave", () => hovering = false);
  const HOVER_ROW = ROW.waving;   // 제안 events.hover(loop) — 커서 위에선 계속 인사

  let frame = 0, dir = 1, acc = 0, last = 0, curRow = -1;
  function tick(now) {
    const list = [...sessions.values()];
    const r = hovering ? HOVER_ROW : (list.length ? petRow(list) : ROW.idle);
    if (r !== curRow) { curRow = r; frame = 0; dir = 1; acc = 0; }
    const a = ROW_ANIM[r] || ROW_ANIM[ROW.idle];
    // autoDetectFrames: 빈 프레임으로 넘어가 사라지는 깜빡임 방지
    const fc = a.pingpong ? a.frames : Math.max(1, frameCounts[r] || a.frames);
    if (last) acc += now - last;
    last = now;
    if (acc >= a.ms) {
      acc = 0;
      if (a.pingpong) { frame += dir; if (frame >= fc-1 || frame <= 0) dir *= -1; }
      else { frame = (frame + 1) % fc; }
    }
    if (frame >= fc) frame = 0;
    petSprite.style.backgroundPosition = `${-frame*FRAME_W}px ${-r*FRAME_H}px`;
    requestAnimationFrame(tick);
  }

  // ── 시나리오 러너 ──
  function clearTimers(){ timers.forEach(clearTimeout); timers = []; }
  function schedule(events, baseStatus) {
    events.forEach(ev => timers.push(setTimeout(() => {
      apply(ev);
      if (baseStatus) statusEl.textContent = `${baseStatus} · ${ev.kind} → ${ev.s}`;
    }, ev.t / speed)));
  }
  function reset() {
    clearTimers(); sessions.clear(); els.forEach(el=>el.remove()); els.clear();
    seq = 0; render(); statusEl.textContent = "초기화됨";
  }
  function run(key) {
    reset();
    curScenario = SCENARIOS[key];
    document.querySelectorAll("[data-scenario]").forEach(b => b.classList.toggle("is-active", b.dataset.scenario===key));
    schedule(curScenario.events, curScenario.label);
    statusEl.textContent = `${curScenario.label} 재생 중…`;
  }

  // ── 컨트롤 ──
  document.querySelectorAll("[data-scenario]").forEach(b => b.onclick = () => run(b.dataset.scenario));
  $("replay").onclick = () => { const a = document.querySelector("[data-scenario].is-active"); if (a) run(a.dataset.scenario); };
  $("reset").onclick = reset;
  $("collapse").onclick = () => widget.classList.toggle("is-collapsed");
  const speedIn = $("speed"), speedOut = $("speedOut");
  speedIn.oninput = () => { speed = parseFloat(speedIn.value); speedOut.textContent = `${speed}×`; };
  // UI 배율 = 시스템 종속 노브. 실제 Electron 빌드는 OS 디스플레이/접근성 텍스트 크기에서 주입.
  const uiIn = $("uiscale"), uiOut = $("uiscaleOut");
  uiIn.oninput = () => {
    document.documentElement.style.setProperty("--ui-scale", uiIn.value);
    uiOut.textContent = `${parseFloat(uiIn.value).toFixed(2)}×`;
  };

  // ── 범례 ──
  const LEGEND = [["idle","유휴",ROW.idle],["running","작업(생각/도구)",ROW.running],["waving","알림/권한",ROW.waving],["waiting","입력 대기",ROW.waiting],["failed","에러",ROW.failed],["review","완료",ROW.review]];
  $("legend").innerHTML = LEGEND.map(([n,d,r]) => `<li><span class="swatch" style="background:hsl(${r*40} 60% 55%)"></span><code>${n}</code> · ${d} <small style="opacity:.5">행 ${r}</small></li>`).join("");

  // ── 스프라이트 로드 + 빈 프레임 자동 감지(autoDetectFrames) ──
  const SPRITE = "../refs/sample-pet/spritesheet.webp";
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    petSprite.style.setProperty("--sprite-url", `url("${SPRITE}")`);
    try { detectFrames(img); } catch (e) { /* getImageData 불가 시 8프레임 가정 */ }
  };
  img.onerror = () => { petSprite.classList.add("is-fallback"); statusEl.textContent = "⚠ 스프라이트 로드 실패 — refs/sample-pet 경로 확인(폴백 표시)"; };
  img.src = SPRITE;
  petSprite.style.setProperty("--sprite-url", `url("${SPRITE}")`);

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
        const d = cx.getImageData(c*FRAME_W, r*FRAME_H, FRAME_W, FRAME_H).data;
        let opaque = 0;
        for (let i = 3; i < d.length; i += 28) { if (d[i] > 16 && ++opaque > 12) break; }
        if (opaque > 12) lastNonEmpty = c + 1;     // 왼→오 마지막 비어있지 않은 프레임
      }
      frameCounts[r] = Math.max(1, lastNonEmpty);
    }
  }

  render();
  requestAnimationFrame(tick);
})();
