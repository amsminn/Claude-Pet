# 0001. 셸로 Electron 채택 (Tauri 아님)

- 상태: 채택됨
- 날짜: 2026-06-13
- 관련: [01-architecture/overview.md](../01-architecture/overview.md), [ADR-0002](0002-backend-clean-room.md)

## Context

데스크탑 펫 앱의 셸을 정해야 한다. 요구는 (1) **투명·always-on-top·click-through** 플로팅 창,
(2) Codex 카드 UI가 명백히 **HTML/CSS**라 웹 렌더링, (3) macOS 우선 **크로스플랫폼**, (4)
Claude Code hook/server/permission bridge를 Node로 단순하게 구현하는 것이다.

초기 논의에서는 경량성을 이유로 **Tauri**(Rust + 시스템 웹뷰)를 우선 검토했다. 그러나 핵심 요구가
**(a) 웹 기반 카드 UI 픽셀 복제**와 **(b) Node로 작성하는 훅/서버/권한 백엔드**임을 보면, 웹 UI와
Node 백엔드를 한 런타임에 두고 투명 창·always-on-top·자동 업데이트가 이미 성숙한 **Electron**이
더 들어맞는다. 백엔드는 공식 Claude Code 문서 기준 clean-room으로 구현한다([ADR-0002](0002-backend-clean-room.md)).

## Decision

셸로 **Electron**을 채택한다. 펫 창과 카드 UI는 BrowserWindow(`type:'panel'`로 비활성·풀스크린 위
표시, 투명·frameless·always-on-top, `setIgnoreMouseEvents(true,{forward:true})` + 커서 토글로
click-through)로 렌더한다 — 모두 내장 API로 검증됨([07 build-plan](../07-implementation/build-plan.md)).
백엔드(훅 수신 로컬 서버·권한 브릿지·트랜스크립트 테일)는 Node로 구현하되,
세부는 공식 1차 문서를 근거로 직접 구현한다([ADR-0002](0002-backend-clean-room.md)).

## Consequences

**좋은 점**
- **Node/Electron 구조**가 성숙해 훅·서버·권한·자동 업데이트 설계 리스크가 낮다.
- 카드 UI가 어차피 웹 → Codex 픽셀 복제가 자연스럽다.
- Electron 생태계 성숙 → 자동 업데이트(`electron-updater`)·빌드·서명 경로가 닦여 있다.
- 단일 코드베이스로 macOS→Windows/Linux 확장(투명/클릭통과는 OS별 보정 필요하지만 재작성 아님).

**나쁜 점·트레이드오프 (정직하게)**
- **바이너리·메모리 무겁다.** "가벼운 펫"에 Chromium 전체는 과하다(수십~100MB+). → 유휴 시
  애니메이션 throttle, 단일 BrowserWindow 재사용으로 완화. 절대 경량이 목표면 Tauri가 낫다.
- **투명·click-through가 OS마다 미묘.** Electron도 Linux(특히 Wayland)에서 까다롭다 → v1 macOS 집중,
  Win/Linux는 Phase 1.1에서 별도 검증([goals-nongoals.md](../00-overview/goals-nongoals.md) 비목표).
- **서드파티 소스 복사 금지.** 백엔드는 공식 문서 기준 clean-room으로 직접 구현한다([ADR-0002](0002-backend-clean-room.md)).

## Alternatives considered

- **Tauri (Rust + 시스템 웹뷰)**: 바이너리 작고 메모리 적다. 그러나 (1) hook/server/permission bridge를
  Rust 쪽으로 가져가야 하고, (2) 투명·click-through·always-on-top이 Tauri에서도 OS별 손이 가며,
  (3) 팀에 Rust 부담이 있다. 경량성의 이점이 웹 UI 복제와 Node hook 구현의 단순함을 못 이긴다.
- **네이티브 Swift/AppKit**: macOS 폴리시 최상·최소 용량. 그러나 카드 UI를 전부
  AppKit으로 재구현(=Codex 복제 노가다)하고 **크로스플랫폼=완전 재작성** → 우리 목표와 정면충돌.
- **Flutter / 기타 데스크탑 프레임워크**: 픽셀 단위 웹 UI 복제와 Node hook 구현 둘 다 손해.

경량성(Tauri)·폴리시(Swift)의 이점보다 **검증된 Electron 패턴 + 웹 UI 자연스러움**이 주는
개발 속도가 압도적이라 판단했다. 경량성이 절실해지면 백엔드를 어댑터 뒤에 둔 설계 덕에 셸 교체를
새 ADR로 재검토할 수 있다.
