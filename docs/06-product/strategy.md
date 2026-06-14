# 제품 전략

> 근거: 공식 OpenAI/Anthropic 문서, [`refs/codex-pet-ux-teardown.md`](../../refs/codex-pet-ux-teardown.md), [`refs/README.md`](../../refs/README.md)
> 관련: [vision.md](../00-overview/vision.md), [goals-nongoals.md](../00-overview/goals-nongoals.md), [roadmap](../roadmap.md), [ADR-0002](../adr/0002-backend-clean-room.md)

Claude-Pet의 시장 자리는 좁지만 선명하다.

> **Claude Code 사용자를 위한 Codex-pet-faithful desktop companion.**

다른 "상태를 보여주는 펫"을 또 만드는 게 아니라, Codex App의 pet/card overlay 경험을 Claude Code로
가져오는 것이 전략의 중심이다.

## 1. 시장 빈자리

기존 시도들은 셋 중 하나에 머문다.

- **(a) 상태 펫 오버레이** — 크로스플랫폼으로 에이전트 상태는 보여주지만, Codex 카드/펫 UI 충실도가
  낮다(자체 UI). *구현 증명은 있으나 UX가 다르다.*
- **(b) Codex-에셋 호환 오버레이** — `~/.codex/pets/` 펫을 띄우지만 **카드 스택·인라인 답장이 없고
  macOS 중심**이다. *문제 정의는 가깝지만 미완성이다.*
- **(c) 펫 갤러리/애드온** — 콘텐츠·생태계일 뿐 런타임 오버레이가 아니다. *콘텐츠 증명은 있다.*

→ 구현 증명(a)과 콘텐츠 증명(c)은 시장에 있지만, **"Claude Code + Codex 충실 UX + native Codex
asset"** 세 박자를 **동시에** 만족하는 자리는 비어 있다. 그 자리가 Claude-Pet이다.

## 2. 차별화 축

| 축 | 선택 | 이유 |
|---|---|---|
| UX | Codex card/pet overlay 픽셀 복제 | 사용자가 이미 좋아하는 경험을 옮긴다. |
| 콘텐츠 | `~/.codex/pets/` native load | 기존 펫 구매/설치 자산을 그대로 쓴다. |
| 연동 | Claude Code official hooks | 깨지기 쉬운 TUI scraping/키 주입을 피한다. |
| 답장 | blocking `PermissionRequest` response | approve/deny/redirect 순간에 공식 역채널이 열린다. |
| 플랫폼 | Electron, macOS 우선 | 웹 UI 복제와 cross-platform 확장성을 동시에 얻는다. |
| 코드 출처 | clean-room 직접 구현 | 서드파티 소스를 복사하지 않아 출처가 명확하다([ADR-0002](../adr/0002-backend-clean-room.md)). |

## 3. 포지셔닝 문장

짧은 설명:

> Codex pets for Claude Code.

긴 설명:

> Claude-Pet shows Claude Code sessions as the same floating pet and stacked cards you get in the
> Codex app, using your existing `~/.codex/pets` assets and Claude Code's official hook surface.

피해야 할 설명:

| 표현 | 문제 |
|---|---|
| "기존 펫의 fork" | 독창성·브랜드 면에서 부정확하다(우린 공식 문서 기준 clean-room 구현이다). |
| "universal AI pet" | 초기 범위를 흐린다. |
| "Claude chatbot pet" | 핵심은 대화가 아니라 coding-agent status/reply surface다. |

## 4. 구현 출처 전략

백엔드는 **공식 Claude Code/OpenAI 1차 문서와 자체 관찰만을 근거로 직접(clean-room) 구현**한다.
서드파티 구현 코드를 복사·fork하지 않으므로 코드 출처가 명확하고 설계 자유도가 높다([ADR-0002](../adr/0002-backend-clean-room.md)).

| 선택지 | 판단 |
|---|---|
| **clean-room으로 hook/server 직접 구현** | **기본 전략.** 공식 문서 + 관찰 사실로 새 코드를 작성한다. |
| 서드파티 구현 fork/복사 | 코드 출처·독창성이 흐려진다 — 채택하지 않는다. |

따라서 구현 작업은 외부 코드 복사가 아니라 **공식 docs + 관찰된 behavior + 자체 protocol**로
처음부터 짓는 방향이다([ADR-0002](../adr/0002-backend-clean-room.md)).

## 5. MVP 성공 기준

| 기준 | 측정 |
|---|---|
| Codex visual fidelity | `refs/screens/` 기준으로 카드 라운드, stack, `+N`, reply input, pet anchor가 맞는다. |
| Claude Code safety | 앱 off 상태에서 command hook이 Claude Code 체감 지연을 만들지 않는다. |
| Reply works | `PermissionRequest` allow/deny/message가 실제 세션을 진행/거절한다. |
| Asset compatibility | `refs/sample-pet/`와 실제 `~/.codex/pets/<slug>`를 변환 없이 렌더한다. |
| Multi-session | `session_id`별 card가 독립 갱신되고 최대 3장 + overflow가 동작한다. |

## 6. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| Claude Code hook schema 변경 | 연동 깨짐 | official docs 추적, protocol adapter test, installer version check |
| `PermissionRequest` fallback 차이 | 답장 UX 위험 | ADR-0004 smoke test를 release gate로 둔다. |
| Codex pet internal protocol 비공개 | fidelity 한계 | 공개 asset format + 화면 관찰로 좁힌다. |
| 서드파티 코드 결합 | 출처 리스크 | clean-room 기본, 서드파티 소스 직접 복사 금지 |
| Linux Wayland click-through | 플랫폼 리스크 | v1 macOS, Win/Linux는 Phase 1.1 검증 |
| 캡처 근거 부족(error/clock/drag) | spec confidence 낮음 | 추가 캡처 task를 roadmap에 명시 |

## 7. Go-to-market 순서

1. 내부용 MVP: `nezu` 렌더 + Claude Code state card + permission reply.
2. 문서형 공개: "Codex pets for Claude Code"와 asset compatibility를 전면에 둔다.
3. Petdex/Codex-pet 커뮤니티 대상: 기존 펫을 그대로 쓴다는 점을 강조한다.
4. 멀티 에이전트 펫 사용자 대상: Codex UX fidelity가 필요한 사용자에게 제안한다.

Phase별 실행 계획은 [roadmap.md](../roadmap.md)가 권위 문서다.
