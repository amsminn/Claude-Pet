"use strict";
/**
 * Phase 0 mock scenarios — replayed by main so the renderer shows cards + pet
 * animation WITHOUT Claude Code wired up. Each event mirrors a Claude Code hook
 * payload shape consumed by state.applyEvent:
 *   { t:ms, kind:<hook event>, sessionId, title?, body?, perm? }
 *
 * `kind` maps 1:1 to EVENT_TO_STATE (src/shared/constants.js). This is a dev
 * harness only — removed once real hooks drive /state in Phase 1.
 */

const SCENARIOS = {
  // ① single task full cycle: thinking -> working(spinner) -> done(green-check)
  single: [
    { t: 0, kind: "SessionStart", sessionId: "A" },
    { t: 250, kind: "UserPromptSubmit", sessionId: "A", title: "Longmemeval-s 점수 보고" },
    { t: 800, kind: "PreToolUse", sessionId: "A" },
    { t: 1700, kind: "PostToolUse", sessionId: "A" },
    { t: 2500, kind: "PreToolUse", sessionId: "A" },
    { t: 3400, kind: "PostToolUse", sessionId: "A" },
    {
      t: 4300,
      kind: "Stop",
      sessionId: "A",
      body: "좋습니다. 점수 집계 경로 두 개를 확인했어요 — 오래된 answer/judge 하니스와 신규 경로. 둘의 차이를 표로 정리했고, 필요하면 바로 이어서 더 깊게 파고들 수 있습니다.",
    },
  ],

  // ② multi-session stack + overflow
  multi: [
    { t: 0, kind: "SessionStart", sessionId: "A" },
    { t: 150, kind: "UserPromptSubmit", sessionId: "A", title: "docs: promote techspec int…" },
    { t: 400, kind: "PreToolUse", sessionId: "A" },
    { t: 700, kind: "SessionStart", sessionId: "B" },
    { t: 850, kind: "UserPromptSubmit", sessionId: "B", title: "Longmemeval-s 점수 보고" },
    { t: 1100, kind: "PreToolUse", sessionId: "B" },
    { t: 1500, kind: "Stop", sessionId: "A", body: "반갑습니다. 작업 이어갈 것 있으면 바로 처리하겠습니다." },
    { t: 2000, kind: "SessionStart", sessionId: "C" },
    { t: 2150, kind: "UserPromptSubmit", sessionId: "C", title: "근데 conductive network 이거…" },
    { t: 2400, kind: "PreToolUse", sessionId: "C" },
    { t: 2900, kind: "SessionStart", sessionId: "D" },
    { t: 3050, kind: "UserPromptSubmit", sessionId: "D", title: "프로토타입 시나리오 띄우기" },
    { t: 3300, kind: "PreToolUse", sessionId: "D" },
    { t: 4000, kind: "Stop", sessionId: "B", body: "좋습니다. 필요한 거 있으면 바로 이어서 보겠습니다." },
    { t: 4900, kind: "Stop", sessionId: "C", body: "설명만 원하는 거라 코드 작업은 안 하고 개념만 짧게 정리할게요." },
    { t: 5800, kind: "Stop", sessionId: "D", body: "시나리오 4개를 띄웠습니다." },
  ],

  // ③ permission -> inline reply
  permission: [
    { t: 0, kind: "SessionStart", sessionId: "A" },
    { t: 250, kind: "UserPromptSubmit", sessionId: "A", title: "빌드 캐시 정리 후 재빌드" },
    { t: 700, kind: "PreToolUse", sessionId: "A" },
    {
      t: 1600,
      kind: "PermissionRequest",
      sessionId: "A",
      perm: { tool: "Bash", cmd: "rm -rf build/ && npm run build" },
    },
  ],

  // ④ error state
  error: [
    { t: 0, kind: "SessionStart", sessionId: "A" },
    { t: 250, kind: "UserPromptSubmit", sessionId: "A", title: "flaky 테스트 재현" },
    { t: 700, kind: "PreToolUse", sessionId: "A" },
    { t: 1500, kind: "PostToolUse", sessionId: "A" },
    { t: 2300, kind: "PreToolUse", sessionId: "A" },
    {
      t: 3100,
      kind: "PostToolUseFailure",
      sessionId: "A",
      body: "테스트 러너가 exit 1로 종료됨 — 스택트레이스 확인 필요.",
    },
  ],
};

module.exports = { SCENARIOS };
