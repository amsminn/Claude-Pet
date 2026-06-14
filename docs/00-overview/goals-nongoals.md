# 목표 · 비목표 · MVP 범위

> 근거: [vision.md](vision.md), 공식 [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) 문서

"무엇을 만들지"만큼 **"무엇을 만들지 않을지"** 를 못박는 것이 핵심이다.

## 목표 (Goals)

### 제품 목표
- **G1.** 화면 우하단에 **플로팅 펫**(투명·always-on-top)을 띄워 Claude Code의 작업 상태를
  Codex와 동일한 시각 언어로 보여준다.
- **G2.** 펫 위로 **작업 카드 스택**을 쌓는다. 카드 = 세션/턴 1개, 구성은 **제목 + 본문 + 상태아이콘**
  (스피너=작업중 · 시계=입력대기 · 초록체크=완료)이며 Codex 카드를 픽셀 복제한다.
- **G3.** 카드에서 **인라인 답장**으로 에이전트에 회신한다(권한 승인·방향 수정 등).
- **G4.** `~/.codex/pets/`의 펫 에셋을 **네이티브로 로드**한다 — 변환 없이 Codex/Petdex 펫이 그대로
  돌아간다.
- **G5.** 동시에 여러 Claude Code 세션을 `session_id`로 구분해 **카드 스택에 1:1**로 표시한다.

### 기술 목표
- **G6.** Claude Code에 **무해**하게 연동한다 — 훅은 fire-and-forget, 펫 부재 시 영향 0([ADR-0004](../adr/0004-reply-via-blocking-hook.md)).
- **G7.** **단일 코드베이스(Electron)** 로 macOS 우선, Windows/Linux 확장까지 재작성 없이 간다([ADR-0001](../adr/0001-electron-over-tauri.md)).
- **G8.** hook/server/permission 백엔드는 **공식 Claude Code 훅/SDK 문서 기준 clean-room**으로 구현한다([ADR-0002](../adr/0002-backend-clean-room.md)).

## 비목표 (Non-Goals)

명시적으로 **하지 않는** 것. 각 항목은 "지금은 안 함"이다.

| 비목표 | 이유 | 재검토 |
|---|---|---|
| **자체 펫 포맷·테마 시스템** | Codex 포맷을 네이티브로 쓴다. 자체 포맷으로 "변환"하지 않는다. | 범위 밖 |
| **펫 해치/생성(이미지 생성)** | OpenAI 공식 문서 기준 custom pet 생성은 `hatch-pet` skill flow로 다룬다. 우린 v1에서 로드만 한다. | Phase 2+ |
| **앱 내 petdex 갤러리·설치** | 펫은 기존 Codex 도구(`npx codex-pets add`)로 깔고 우린 읽기만. | Phase 2 |
| **펫 개성 대화(@이름 채팅)** | 상태 가시화가 본질. Codex도 산만함 방지로 직접 대화 안 함 `확인`. | 범위 밖 |
| **idle 상태에서 임의 입력 주입** | 인터랙티브 TUI엔 공식 입력 통로 없음 `확인`. 답장은 훅 경계에서만([ADR-0004](../adr/0004-reply-via-blocking-hook.md)). | 터미널 포커스로 대체 |
| **Windows/Linux 폴리시(v1)** | 투명·always-on-top·click-through는 OS별 차이가 큼. v1은 macOS 집중. | Phase 1.1 |
| **Codex 외 에이전트 지원(Cursor 등)** | Claude Code 충실에 집중한다. 멀티 에이전트는 범위 밖. | 범위 밖(초기) |

## MVP 범위 (Phase 1)

목적은 **망라가 아니라 "macOS에서 Codex 펫과 구분 안 되는 경험을 내 `nezu`로 확실히 띄운다"**.

### 포함 (In)
- 플로팅 펫 창(투명·always-on-top·우하단·드래그) + atlas 스프라이트 애니메이션(상태별).
- 작업 카드 스택: 제목·본문·상태아이콘·`+N` 오버플로·`최신` 배지·**펼치기**·**×**·전역 **접기(⌄)**.
- 인라인 답장: 권한/결정 경계에서 카드 입력 → 블로킹 훅 응답으로 에이전트에 전달([ADR-0004](../adr/0004-reply-via-blocking-hook.md)).
- Claude Code 연동: `settings.json` 훅 자동 설치 → 로컬 서버로 상태 수신 → 트랜스크립트 테일로 본문 보강.
- 에셋 로더: `~/.codex/pets/<slug>/`에서 펫 선택·로드(메뉴바).

### 제외 (Out, 후속)
- 펫 해치/생성, 앱 내 갤러리, Windows/Linux, 다에이전트, 개성 대화.

### 성공 기준 (Exit Criteria)
- 실제 Claude Code 세션에서 펫이 **생각중→도구실행→완료→대기** 상태를 Codex와 동일하게 반영한다.
- `~/.codex/pets/nezu`가 **변환 없이** 그대로 렌더된다.
- 권한 프롬프트에 펫 카드로 답장하면 세션이 **실제로 진행**된다.
- 펫을 꺼도 Claude Code 동작에 영향이 없다.

상세 단계는 [roadmap.md](../roadmap.md), [06-product/strategy.md](../06-product/strategy.md).
