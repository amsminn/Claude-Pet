# Roadmap

> 관련: [strategy](06-product/strategy.md), [goals-nongoals](00-overview/goals-nongoals.md), [claude integration](05-claude-integration/claude-code-hooks.md), [ADR-0004](adr/0004-reply-via-blocking-hook.md)

이 roadmap은 구현 순서와 exit criteria를 고정한다. 날짜 약속이 아니라 의존성 순서다.

## Phase 0 — 증거와 뼈대 고정

| 항목 | 산출물 | Exit |
|---|---|---|
| Docs-as-code 완성 | 05, 06, roadmap, ADR 0002~0004 | 모든 내부 링크 통과 |
| 공식 hook smoke plan | `PermissionRequest` allow/deny/no-decision test case | 구현 전 테스트 절차가 문서화됨 |
| Visual evidence 정리 | `refs/screens/` + open questions | 확인/추정 라벨 분리 |

남은 캡처 gap:

| Gap | 현재 상태 | 필요 액션 |
|---|---|---|
| error card/icon | 현재 영상에서 미관찰 | Claude/Codex에서 의도적으로 오류 1회 발생 후 캡처 |
| clock/waiting icon | 현재 영상에서 미관찰 | 권한/대기 상태를 길게 유지해 캡처 |
| pet drag | 현재 영상에서 미관찰 | 펫을 직접 드래그하는 짧은 녹화 |
| 4+ stack 동시 노출 | `+1` overflow는 확인, 4장 동시 노출은 미관찰 | 4개 이상 세션을 동시에 만들어 stack/overflow 녹화 |

## Phase 1 — macOS MVP

| Stream | 작업 | Exit |
|---|---|---|
| Shell | Electron transparent/frameless/always-on-top window | 우하단 pet overlay가 click-through/interactive mode 전환 |
| Asset loader | `pet.json` + `spritesheet.webp` native load | `refs/sample-pet/nezu`가 변환 없이 렌더 |
| State server | `/healthz`, `/state`, session store | mock hook events로 card 상태 갱신 |
| Claude hooks | settings installer/uninstaller | 실제 Claude Code에서 `UserPromptSubmit`, `PreToolUse`, `Stop` 수신 |
| Transcript tail | Stop body extraction | card body가 마지막 assistant text로 채워짐 |
| Card UI | Codex-style stack, spinner/check, `+N`, hover, expand, close | `refs/screens/` 기준 시각 QA 통과 |
| Reply | `/permission` hold/resolve | allow/deny/message가 실제 Claude Code permission을 처리 |

Phase 1 exit:

- 앱 off 상태에서 Claude Code 동작에 영향이 없다.
- `nezu` pet과 card stack이 Codex 녹화 기준으로 충분히 유사하다.
- 한 세션과 다세션 모두 `session_id`별 card가 안정적으로 갱신된다.
- 권한 prompt에 card reply로 답하면 Claude Code가 진행한다.

## Phase 1.1 — 안정화와 플랫폼 검증

| 작업 | Exit |
|---|---|
| macOS packaging/signing/notarization 검토 | 설치/업데이트 절차 초안 |
| Windows transparent/click-through spike | BrowserWindow + native 보정 필요 여부 확인 |
| Linux X11/Wayland spike | 지원 가능 범위 문서화 |
| Hook migration tests | 기존 `settings.json` 보존/중복 방지 |
| Crash recovery | server restart 시 stale permission/card 정리 |

## Phase 2 — 생태계 기능

| 작업 | 판단 기준 |
|---|---|
| Pet picker | `~/.codex/pets/`에 여러 pet이 있을 때 필요 |
| Petdex/gallery integration | 사용자가 설치 경로를 모를 때 필요 |
| Optional pet events | `pet.json animation.events` 제안이 안정화되면 적용 |
| Additional agents | Claude Code MVP가 안정된 뒤만 검토 |
| Hatch/generation | OpenAI Codex `$hatch-pet`와 충돌하지 않게 별도 논의 |

## Release gates

| Gate | 반드시 통과 |
|---|---|
| Official docs check | Anthropic/OpenAI 문서 변경 여부 재확인 |
| No-decision behavior | 앱 부재/DND/timeout에서 native fallback 확인 |
| Visual QA | desktop + narrow viewport에서 text overlap 없음 |
| 출처 audit | 서드파티 소스 파일 단위 copy가 없는지 확인 |
| Link check | docs 내부 상대 링크 모두 존재 |
