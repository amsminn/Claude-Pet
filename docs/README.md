# Claude-Pet — 기술 명세 (docs)

화면에 떠 있는 데스크탑 펫으로 **Claude Code(CLI)의 작업 상태를 실시간 가시화**하고, 펫 카드에서
바로 답장까지 보내는 서비스의 기술 명세(docs-as-code)다. 목표는 단 하나 — **OpenAI Codex의 펫
경험을 픽셀 단위로 복제**하되, Codex 펫 에셋(`~/.codex/pets/`)과 **네이티브 호환**하고
**크로스플랫폼**(macOS 우선)으로 만든다.

> **상태**: Pre-Phase 0 (설계 확정). 코드는 아직 없다. 이 명세는 구현 착수 전 합의를 고정한다.

## 한 줄 정의

> Claude Code 세션의 상태를 **Codex 펫과 똑같은 UX**(우하단 플로팅 펫 + 작업 카드 스택 + 인라인
> 답장)로 보여주는 데스크탑 앱. 에셋은 Codex/Petdex 생태계와 그대로 호환된다.

## 왜 만드는가 (요약)

- **Codex 펫 경험이 좋은데 Claude Code엔 그 급이 없다.** 기존 시도들은 하나씩 빈다 — 크로스플랫폼이지만
  자체 UI라 Codex 경험이 아니거나, Codex 에셋은 호환하지만 카드 스택·답장이 없고 macOS 중심이거나,
  동명 클론이 난립해 완성도가 낮다. → "Codex 충실 복제 + 에셋 호환 + 크로스플랫폼" 네 박자를 동시에
  만족하는 건 **아무도 없다**.
- **차별화 전략**: 훅·상태서버·권한브릿지 백엔드는 **공식 Claude Code 훅/SDK 문서**를 근거로
  clean-room 구현하고, 역량은 **Codex 충실 카드 UI**에 집중한다([ADR-0002](adr/0002-backend-clean-room.md)).

상세: [00-overview/vision.md](00-overview/vision.md), [06-product/strategy.md](06-product/strategy.md).

## 기술 스택 한눈에

| 영역 | 선택 | 비고 |
|---|---|---|
| 셸·런타임 | **Electron** | 웹 UI 복제 + Node 백엔드를 한 런타임에([ADR-0001](adr/0001-electron-over-tauri.md)) |
| 네이티브 창 | `type:'panel'`(비활성·풀스크린/전 Space 위) · 투명 · 클릭스루 | 내장 BrowserWindow 옵션 + `setIgnoreMouseEvents(true,{forward:true})` 커서 토글 — 검증됨([07](07-implementation/build-plan.md)) |
| 펫 렌더링 | 웹뷰 `<canvas>` | atlas **8×9 · 192×208** 프레임 스프라이트 애니메이션 |
| 카드 UI | **HTML/CSS/JS** | Codex 카드 픽셀 복제(라운드·그림자·스피너·배지·hover) |
| 상태 수신 | **로컬 HTTP 서버 + Claude Code 훅** | 이벤트 fire-and-forget POST([05](05-claude-integration/claude-code-hooks.md)) |
| 답장 | **블로킹 권한 훅 응답** | 키 주입 없이 공식 채널([ADR-0004](adr/0004-reply-via-blocking-hook.md)) |
| 카드 본문 | 트랜스크립트 JSONL 테일 | `~/.claude/projects/<proj>/<session>.jsonl` |
| 에셋 | **`~/.codex/pets/` 네이티브** | `pet.json` + `spritesheet.webp` 그대로([02](02-asset-compat/codex-pet-assets.md)) |
| 플랫폼 | **macOS 우선** → Windows/Linux | Electron 단일 코드베이스 |

## 문서 색인

### 00 — 개요
- [vision.md](00-overview/vision.md) — 문제(왜 Codex 펫을 Claude Code로), 타겟 사용자, 가치 제안, 가이딩 원칙
- [goals-nongoals.md](00-overview/goals-nongoals.md) — 목표(G1..), 명시적 비목표, MVP 범위·성공 기준
- [glossary.md](00-overview/glossary.md) — 용어집(pet·card·atlas·hook·statusline·session…)

### 01 — 아키텍처
- [overview.md](01-architecture/overview.md) — 컴포넌트, 시스템/컨테이너 다이어그램, 관찰·답장 데이터 흐름, NFR

### 02 — 에셋 호환
- [codex-pet-assets.md](02-asset-compat/codex-pet-assets.md) — `pet.json`+spritesheet atlas 규격, 로더, `~/.codex/pets/` 호환 ✅

### 03 — 상태 엔진
- [state-machine.md](03-state-engine/state-machine.md) — Claude Code 이벤트 → 펫 상태 → 애니메이션 매핑, 세션=카드 모델 ✅

### 04 — 펫·카드 UI
- [pet-and-cards.md](04-pet-ui/pet-and-cards.md) — 플로팅 펫 렌더링, Codex 카드 스택 복제 명세(레이아웃·상태·답장·펼치기·×·+N) ✅ **핵심**

### 05 — Claude Code 연동
- [claude-code-hooks.md](05-claude-integration/claude-code-hooks.md) — 훅 설치·로컬 서버 프로토콜·트랜스크립트 테일·블로킹 답장 ✅

### 06 — 제품
- [strategy.md](06-product/strategy.md) — 포지셔닝, 차별화 축, 단계별 로드맵, 리스크 ✅

### 07 — 구현
- [build-plan.md](07-implementation/build-plan.md) — **research-backed 빌드 플랜**. 검증된 구현 근거(Electron panel 창·클릭스루·훅 두 폼·atlas 계약) + 경험적 스파이크 + Phase 0~4(v1=0→2) + 리스크 레지스터 ✅ **착수 진입점**

### 횡단
- [roadmap.md](roadmap.md) — 단계·마일스톤(상위 뷰; 상세는 [07 build-plan](07-implementation/build-plan.md)) ✅

### ADR (Architecture Decision Records, MADR 포맷)
- [0001-electron-over-tauri.md](adr/0001-electron-over-tauri.md) — 셸로 Electron 채택
- [0002-backend-clean-room.md](adr/0002-backend-clean-room.md) — 백엔드는 공식 1차 문서 기준 clean-room 구현
- [0003-native-codex-asset-compat.md](adr/0003-native-codex-asset-compat.md) — Codex 펫 에셋 네이티브 호환
- [0004-reply-via-blocking-hook.md](adr/0004-reply-via-blocking-hook.md) — 답장은 블로킹 권한 훅 응답으로

## 근거 자료와의 관계

이 명세의 사실 근거는 내부 [`refs/`](../refs/README.md)에 둔다 — Codex 펫 화면녹화·스크린샷, 실제 펫
에셋(`nezu`), 1차 출처 리서치(공식 OpenAI/Anthropic 문서). 백엔드는 공식 Claude Code 훅/SDK 문서를
근거로 한다.

## 신뢰도 라벨

- `확인` — 출처(코드·공식문서·직접 관찰)로 검증된 사실
- `추정` — 공개정보 기반 추론 (사실처럼 쓰지 않는다)

설계 결정은 의견이므로 라벨을 붙이지 않되, 그 근거가 되는 외부 사실에는 라벨을 붙인다.
