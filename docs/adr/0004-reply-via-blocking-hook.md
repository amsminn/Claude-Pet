# 0004. 답장은 blocking `PermissionRequest` hook 응답으로만 보낸다

- 상태: 채택됨
- 날짜: 2026-06-14
- 관련: [05-claude-integration](../05-claude-integration/claude-code-hooks.md), [03-state-engine](../03-state-engine/state-machine.md), [04-pet-ui](../04-pet-ui/pet-and-cards.md)

## Context

Claude-Pet의 card에는 `답장` affordance가 있다. 사용자는 카드에서 allow/deny, 방향 수정, 짧은 메시지를 보내고 싶어 한다. 그러나 Claude Code TUI에 임의 텍스트를 밀어 넣는 것은 안전하지 않다.

가능한 경로는 세 가지다.

| 경로 | 문제 |
|---|---|
| 터미널 키 주입(`tmux send-keys`, AppleScript keystroke 등) | 포커스 오류, 보안 리스크, 잘못된 세션 입력 가능 |
| transcript/statusline 조작 | 공식 입력 채널이 아니며 세션 진행에 반영되지 않음 |
| blocking HTTP `PermissionRequest` hook 응답 | Claude Code가 실제로 기다리는 공식 결정 채널 |

Anthropic Claude Code hooks 문서는 HTTP hook과 event-specific JSON output을 공식 surface로 제공하며, `PermissionRequest`를 blocking HTTP hook으로 처리하고 `{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } }` 형태로 응답하는 패턴을 정의한다 `확인`(공식 hooks 문서, [research 검증](../07-implementation/build-plan.md#0-연구로-확정된-구현-근거-확인)).

1차 출처 deep-research(2026-06-14)로 확정된 보강 사실 `확인`:

- 블로킹 답장 경로는 **두 가지이며 형태가 다르다.**
  - **`PermissionRequest`** — 권한 다이얼로그 직전 발화, **중첩** `decision.behavior: allow|deny`(+`updatedInput`, `updatedPermissions`의 `setMode`). **인터랙티브 전용 — 헤드리스 `-p`에서는 발화하지 않는다.** 펫이 떠 있는 일반(인터랙티브) 세션의 **주 경로**.
  - **`PreToolUse`** — **평면** `hookSpecificOutput.permissionDecision: allow|deny|ask|defer`(+`updatedInput`). **헤드리스 `-p`에서도 동작**하는 결정적 게이트. 펫의 헤드리스/자동화 경로.
- http 훅은 **2xx + JSON 본문**으로만 차단된다(상태코드만으론 불가). **non-2xx/timeout/연결실패는 non-blocking → 실행 허용**되므로, 미응답이 native prompt 복귀인지 자동 허용인지 반드시 smoke test로 확정해야 한다.

## Decision

Claude-Pet의 인라인 답장은 **blocking `PermissionRequest` hook이 열려 있을 때만** Claude Code로 보낸다.

응답 형식은 다음 envelope를 기준으로 한다.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "message": "선택 메시지"
    }
  }
}
```

> `decision.behavior: allow|deny`는 검증됨 `확인`. `decision.message` 필드는 **미검증** `추정` — research가 확인한 PermissionRequest decision 부가 필드는 `updatedInput`·`updatedPermissions(setMode)`이며 `message`는 출처로 확정되지 않았다. 빌드 시 실제 응답으로 검증하고, 없으면 사유는 `deny` + 별도 표면으로 전달한다.

규칙:

- `allow`와 `deny`만 명시적 decision으로 보낸다.
- `setMode`는 `acceptEdits`만 사용한다 — `bypassPermissions`는 2.1.110+에서 무성 드롭됨([#49525](https://github.com/anthropics/claude-code/issues/49525)) `확인`.
- 헤드리스(`-p`) 경로는 PermissionRequest가 발화하지 않으므로 `PreToolUse`(평면 `permissionDecision`)로 처리한다.
- 사용자가 답하지 않으면 allow/deny를 합성하지 않고 no-decision fallback으로 보낸다.
- idle 상태의 자유 입력은 Claude Code로 자동 주입하지 않는다. 해당 터미널 focus까지만 제공한다.
- card reply UI는 `pendingPermission`이 있을 때만 "에이전트로 전달되는 답장"으로 표시한다.

## Consequences

**좋은 점**

- 답장이 Claude Code의 공식 lifecycle 안에서 처리된다.
- 잘못된 터미널/세션에 텍스트를 주입하는 사고를 피한다.
- 펫이 꺼져 있어도 Claude Code native prompt로 돌아갈 수 있다.

**나쁜 점·트레이드오프**

- 사용자가 아무 때나 card에서 새 프롬프트를 보내는 UX는 v1 범위 밖이다.
- `PermissionRequest`가 없는 일반 대화 turn에는 답장 입력을 terminal focus UX로 낮춰야 한다.
- no-decision fallback의 정확한 HTTP 표현은 Claude Code 버전별 smoke test가 필요하다.

## Alternatives considered

- **키 주입으로 모든 답장 처리**: 데모는 쉬우나 제품으로는 위험하다. 잘못된 shell에 입력될 수 있고 Claude Code 공식 경로도 아니다.
- **MCP tool로 답장 전달**: Claude가 해당 tool을 호출해야만 의미가 있어 사용자 임의 답장 경로가 되지 않는다.
- **Claude Code transcript에 메시지 추가**: 기록 조작일 뿐 실행 중인 TUI 입력이 아니다.

## Validation

Phase 1에서 다음을 release gate로 둔다.

- 실제 Claude Code `PermissionRequest`에서 `allow`가 요청을 진행시키는지 확인한다.
- `deny + message`가 세션에 사유로 반영되는지 확인한다.
- 앱 미실행, DND, timeout에서 native prompt fallback이 살아있는지 확인한다.
- 키 주입 API를 reply path에 사용하지 않는지 코드리뷰로 확인한다.
