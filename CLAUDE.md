# CLAUDE.md — Claude-Pet

OpenAI **Codex의 데스크탑 펫 경험을 Claude Code(CLI)로 그대로 복제**하는 프로젝트. 화면에 떠 있는
플로팅 펫이 Claude Code의 작업 상태(생각중·도구실행·권한대기·완료)를 카드(말풍선) 스택으로 보여주고,
카드에서 바로 답장까지 보낸다. 펫 에셋은 Codex 생태계(`~/.codex/pets/`)와 **네이티브 호환**한다.

상태: **설계 확정 단계(Pre-Phase 0)**. UI 디자인은 `prototype/`(목)으로 확정(locked)했고, 실제
백엔드 구현 코드는 아직 없다. 이 레포는 "무엇을·왜·어떻게 만들지"를 문서·디자인 목으로 고정한 뒤
구현에 착수하기 위한 것이다.

## 디렉토리 구성

- **`docs/`** — 기술 명세(docs-as-code). 번호 매긴 섹션 + `adr/`. 시작점은 [`docs/README.md`](docs/README.md).
- **`prototype/`** — **디자인 검증용 정적 목(mock)**. 백엔드 없이 카드/펫 UI 외형·인터랙션을 픽셀 단위로
  재현한다. 디자인 확정의 source of truth(토큰·크기는 [`docs/04-pet-ui`](docs/04-pet-ui/pet-and-cards.md)와 동기화).
  빌드 없음 — 정적 서버로 `prototype/index.html` 열기. 시작점은 [`prototype/README.md`](prototype/README.md).
- **`refs/`** — 클론 대상(Codex 펫)의 1차 자료(스크린샷·화면녹화·실제 펫 에셋 `nezu`). 명세의
  **근거(source of truth)**. 로컬 전용 — **`.gitignore`** 대상이라 레포에 커밋되지 않는다.
- **`src/`** — (예정) 실제 구현 코드. 아직 없음.

## 문서 작성 규약 (techspec 스타일 차용)

- **언어: 한국어 산문.** 기술 용어는 원어 유지(hook, statusline, spritesheet, atlas, Durable… ).
- **파일명: 소문자-하이픈**(`codex-pet-assets.md`). ADR은 `NNNN-title.md`. 문서 간 링크는 **상대경로**.
- **다이어그램 = Mermaid 코드블록**(이미지 첨부 X — diff·리뷰 용이). `flowchart`(구조), `sequenceDiagram`(흐름),
  `stateDiagram-v2`(상태머신).
- **신뢰도 라벨**: 외부 사실에 `` `확인` ``(출처 검증) / `` `추정` ``(공개정보 추론) 표기. 설계 결정은
  의견이므로 라벨 없음.
- **ADR(MADR 포맷)**: Context → Decision → Consequences → Alternatives considered. **트레이드오프를
  정직하게** — 단점·리스크·완화책은 필수.

## 클론 대상 한 줄 요약

> Codex 펫 = 화면 우하단에 떠 있는 픽셀 펫 + 그 위로 쌓이는 흰색 작업 카드(제목·본문·상태아이콘·
> 답장·펼치기·×). 렌더러는 **비공개**(에셋 포맷만 MIT) → 관찰로 재구현한다. 근거: [`refs/`](refs/README.md).
