/* 목 이벤트 시나리오 — 실제 Claude Code 훅 페이로드를 흉내낸다.
   각 이벤트: { t: ms, kind: <hook event>, s: sessionId, title?, body?, perm? }
   kind 는 docs/03-state-engine 의 EVENT_TO_STATE 와 1:1 대응. */

window.SCENARIOS = {
  // ① 단일 작업 풀 사이클: thinking → working(spinner) → 완료(green-check + 최신)
  single: {
    label: "① 단일 작업 풀 사이클",
    events: [
      { t: 0,    kind: "SessionStart",   s: "A" },
      { t: 250,  kind: "UserPromptSubmit", s: "A", title: "Longmemeval-s 점수 보고" },
      { t: 800,  kind: "PreToolUse",     s: "A" },
      { t: 1700, kind: "PostToolUse",    s: "A" },
      { t: 2500, kind: "PreToolUse",     s: "A" },
      { t: 3400, kind: "PostToolUse",    s: "A" },
      { t: 4300, kind: "Stop",           s: "A", body: "좋습니다. 점수 집계 경로 두 개를 확인했어요 — 오래된 answer/judge 하니스와 신규 경로. 둘의 차이를 표로 정리했고, 필요하면 바로 이어서 더 깊게 파고들 수 있습니다. 자세한 비교나 다른 메트릭이 필요하면 답장 주시면 이어서 진행하겠습니다." },
    ],
  },

  // ② 멀티세션 스택: 최대 3장 + 4번째는 +N 오버플로, 완료 시 최상단 승격·재정렬
  multi: {
    label: "② 멀티세션 스택 + 오버플로",
    events: [
      { t: 0,    kind: "SessionStart",   s: "A" },
      { t: 150,  kind: "UserPromptSubmit", s: "A", title: "docs: promote techspec int…" },
      { t: 400,  kind: "PreToolUse",     s: "A" },
      { t: 700,  kind: "SessionStart",   s: "B" },
      { t: 850,  kind: "UserPromptSubmit", s: "B", title: "Longmemeval-s 점수 보고" },
      { t: 1100, kind: "PreToolUse",     s: "B" },
      { t: 1500, kind: "Stop",           s: "A", body: "반갑습니다. 작업 이어갈 것 있으면 바로 처리하겠습니다." },
      { t: 2000, kind: "SessionStart",   s: "C" },
      { t: 2150, kind: "UserPromptSubmit", s: "C", title: "근데 conductive network 이거…" },
      { t: 2400, kind: "PreToolUse",     s: "C" },
      { t: 2900, kind: "SessionStart",   s: "D" },
      { t: 3050, kind: "UserPromptSubmit", s: "D", title: "프로토타입 시나리오 띄우기" },
      { t: 3300, kind: "PreToolUse",     s: "D" },
      { t: 4000, kind: "Stop",           s: "B", body: "좋습니다. 필요한 거 있으면 바로 이어서 보겠습니다." },
      { t: 4900, kind: "Stop",           s: "C", body: "내가 이해한 요청: 설명만 원하는 거라 코드 작업은 안 하고 개념만 짧게 정리할게요. 필요하면 더 자세히 파고들 수 있는데 우선 핵심만 잡아서 전달하고, 다음 단계는 답장 주시면 이어서 진행하겠습니다." },
      { t: 5800, kind: "Stop",           s: "D", body: "시나리오 4개를 띄웠습니다." },
      { t: 2200, kind: "SessionStart",   s: "E" },
      { t: 2350, kind: "UserPromptSubmit", s: "E", title: "스크롤 페이드 마스크 구현" },
      { t: 2600, kind: "PreToolUse",     s: "E" },
      { t: 2900, kind: "SessionStart",   s: "F" },
      { t: 3050, kind: "UserPromptSubmit", s: "F", title: "폰트 크기 native로 축소" },
      { t: 3300, kind: "PreToolUse",     s: "F" },
      { t: 6400, kind: "Stop",           s: "E", body: "끝에서 페이드되며 잘리게 했습니다." },
      { t: 7000, kind: "Stop",           s: "F", body: "시스템 폰트 패밀리 + 고정 px로." },
    ],
  },

  // ③ 권한 → 인라인 답장: pendingPermission 동안 카드에 답장 UI. allow/deny 후 계속.
  permission: {
    label: "③ 권한 → 인라인 답장",
    events: [
      { t: 0,    kind: "SessionStart",   s: "A" },
      { t: 250,  kind: "UserPromptSubmit", s: "A", title: "빌드 캐시 정리 후 재빌드" },
      { t: 700,  kind: "PreToolUse",     s: "A" },
      { t: 1600, kind: "PermissionRequest", s: "A", perm: { tool: "Bash", cmd: "rm -rf build/ && npm run build" } },
      // 이후(PostToolUse·Stop)는 사용자가 allow/deny 하면 엔진이 이어서 스케줄한다.
    ],
    // 사용자가 답장(allow)했을 때 이어지는 이벤트
    onAllow: [
      { t: 200,  kind: "PostToolUse",    s: "A" },
      { t: 1100, kind: "Stop",           s: "A", body: "정리 후 재빌드 완료. 이어서 진행할게요." },
    ],
    onDeny: [
      { t: 200,  kind: "Stop",           s: "A", body: "알겠습니다. 그 명령은 건너뛰고 다른 방법을 찾을게요." },
    ],
  },

  // ④ 에러 상태: 도구 실패 → failed 행 + 에러 아이콘(붉은 톤)
  error: {
    label: "④ 에러 상태",
    events: [
      { t: 0,    kind: "SessionStart",   s: "A" },
      { t: 250,  kind: "UserPromptSubmit", s: "A", title: "flaky 테스트 재현" },
      { t: 700,  kind: "PreToolUse",     s: "A" },
      { t: 1500, kind: "PostToolUse",    s: "A" },
      { t: 2300, kind: "PreToolUse",     s: "A" },
      { t: 3100, kind: "PostToolUseFailure", s: "A", body: "테스트 러너가 exit 1로 종료됨 — 스택트레이스 확인 필요." },
    ],
  },
};
