# 용어집 (Glossary)

> 관련: [vision.md](vision.md), [state-machine.md](../03-state-engine/state-machine.md), [claude-code-hooks.md](../05-claude-integration/claude-code-hooks.md)

프로젝트 문서에서 반복되는 말을 한 곳에 고정한다.

| 용어 | 정의 |
|---|---|
| pet | 화면 우하단에 떠 있는 픽셀 캐릭터. 한 앱에 한 마리만 렌더한다. |
| card | Claude Code 세션 하나를 나타내는 작업 말풍선. `session_id`와 1:1이다. |
| stack | 여러 card가 쌓인 UI. Codex 관찰 기준 최대 3장을 표시하고 초과분은 `+N`으로 접는다. |
| atlas | `spritesheet.webp`의 프레임 격자. 현재 기준 8열 x 9행, 프레임 192x208px `확인`. |
| row | atlas의 한 애니메이션 줄. 상태별 loop/one-shot 클립으로 쓴다. |
| hook | Claude Code가 특정 이벤트 때 실행하는 command 또는 HTTP callback. |
| command hook | 상태 관찰용 hook. 짧게 실행하고 로컬 서버에 fire-and-forget POST 후 종료한다. |
| HTTP hook | Claude Code가 HTTP endpoint로 JSON payload를 POST하는 hook. `PermissionRequest` 답장 경로에 쓴다. |
| PermissionRequest | Claude Code가 도구 사용·권한 결정을 물을 때 발생하는 hook event. Claude-Pet의 인라인 답장은 이 열린 요청에 응답한다. |
| transcript | Claude Code 세션 JSONL 로그. Stop 시 마지막 assistant 텍스트를 찾아 card body로 쓴다. |
| statusline | Claude Code 터미널 내부 표시줄. Claude-Pet은 statusline을 대체하지 않고 별도 데스크탑 overlay로 동작한다. |
| session store | `session_id -> SessionState` 맵. 상태 엔진과 UI가 공유하는 단일 런타임 truth. |
| native fallback | Claude-Pet이 응답하지 못할 때 Claude Code의 기본 터미널 권한 프롬프트로 돌아가는 안전 경로. |
| no-decision | Claude-Pet이 allow/deny를 합성하지 않는 상태. HTTP 204 또는 연결 종료/timeout 같은 폴백 방식은 hook 종류별로 테스트해 확정한다. |
