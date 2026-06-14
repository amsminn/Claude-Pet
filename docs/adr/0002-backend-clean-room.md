# 0002. 백엔드는 공식 1차 문서 기준 clean-room으로 구현한다

- 상태: 채택됨
- 날짜: 2026-06-14
- 관련: [01-architecture/overview.md](../01-architecture/overview.md), [05-claude-integration](../05-claude-integration/claude-code-hooks.md), [ADR-0004](0004-reply-via-blocking-hook.md)

## Context

Claude-Pet의 백엔드는 네 조각이다 — (1) `settings.json` 훅 인스톨러, (2) 상태 이벤트를 받는 로컬
서버, (3) 권한/답장을 처리하는 blocking HTTP 훅 브릿지, (4) 트랜스크립트 JSONL tail로 카드 본문을
채우는 리더.

이 네 조각은 **공식 1차 문서만으로 완결적으로 도출된다.** Anthropic Claude Code
[hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)·[settings](https://docs.anthropic.com/en/docs/claude-code/settings)
문서가 훅 이벤트·페이로드·HTTP 훅·권한 `decision` 응답 형태를 모두 정의하고, 세션 트랜스크립트
경로(`~/.claude/projects/<proj>/<session>.jsonl`)와 스키마도 공개돼 있다. 따라서 1차 문서만으로
백엔드를 완결적으로 구현할 수 있다.

## Decision

백엔드를 **공식 Claude Code/OpenAI 문서와 자체 관찰만을 근거로 직접(clean-room) 구현**한다.

- 훅 이벤트 → 상태 매핑, 권한 응답 형태, 트랜스크립트 추출 규칙은 모두 1차 문서에서 인용·도출한다
  ([05-claude-integration](../05-claude-integration/claude-code-hooks.md), [03-state-engine](../03-state-engine/state-machine.md)).
- 어떤 서드파티 구현 코드도 복사·fork하지 않고 **처음부터 직접 구현**한다. 독창성과 설계 자유도를 위해서다.
- protocol·UI 경계(컴포넌트 ①~⑥, [overview](../01-architecture/overview.md))는 우리 요구에 맞춰 새로 설계한다.

## Consequences

**좋은 점**
- protocol·UI 경계를 자유롭게 설계한다.
- 공식 hook schema 변경에 adapter test로 독립 대응한다.
- 코드 출처가 명확해 라이선스·독창성 리스크가 없다.

**나쁜 점·트레이드오프 (정직하게)**
- hook installer·local server·permission bridge를 직접 구현해야 해 초기 속도가 느리다.
- OS/터미널 edge case(투명·always-on-top·권한 fallback 등)를 직접 검증해야 한다.
- behavior parity를 놓치지 않도록 smoke test를 엄격히 유지한다([roadmap](../roadmap.md)).

## Alternatives considered

- **서드파티 구현을 fork/복사**: 가장 빠를 수 있으나 코드 출처·독창성이 흐려진다. 공식 문서만으로
  충분히 도출되므로 불필요하다.
- **별도 라이선스 협의**: 일정상 blocking dependency가 된다. 후속 단계에서나 재검토.

## Validation

- 구현 PR에서 서드파티 소스 파일 단위 copy가 없는지 확인한다.
