# 비전 (Vision)

> 근거 자료: [`refs/README.md`](../../refs/README.md), [`refs/codex-pet-ux-teardown.md`](../../refs/codex-pet-ux-teardown.md)
> 관련: [goals-nongoals.md](goals-nongoals.md), [06-product/strategy.md](../06-product/strategy.md)

## 풀려는 문제

OpenAI Codex에는 **펫(pet)** 이 있다 — 화면 우하단에 떠 있는 픽셀 캐릭터가 에이전트의 작업 상태를
감정과 카드(말풍선)로 보여주고, 카드에서 바로 답장까지 보낸다. 비동기로 도는 코딩 에이전트를
"로그를 들여다보지 않고도" 곁눈으로 파악하게 해 주는, 작지만 중독성 있는 경험이다 `확인`.

**Claude Code(CLI)에는 그 급의 경험이 없다.** 기존 시도들은 하나씩 빈다 — 크로스플랫폼이지만
자체 UI라 Codex 경험이 아니거나, Codex 에셋은 호환하지만 **카드 스택·인라인 답장이 없고 macOS
중심**이거나, 동명 클론이 난립해 완성도·트래픽이 미미하다.

→ **"Codex 픽셀 충실 복제 + 에셋 네이티브 호환 + 크로스플랫폼 + 폴리시"** 네 박자를 **동시에**
만족하는 구현은 없다. 이 빈자리가 Claude-Pet의 존재 이유다.

## 가치 제안

- **Codex와 구분 안 되는 경험.** 펫·카드·상태아이콘·스택·답장·펼치기/접기까지 화면녹화를 보고
  픽셀 단위로 복제한다. "또 다른 펫"이 아니라 "Codex 펫의 Claude Code판".
- **에셋 그대로.** `~/.codex/pets/`의 `pet.json`+`spritesheet.webp`를 **변환 없이 네이티브 로드**.
  Petdex 생태계(467+ 펫 `확인`)를 0일차에 콘텐츠로 흡수한다 — 호환이 곧 무기.
- **어디서나.** macOS 우선, 이후 Windows/Linux. 기존 시도가 macOS에 묶여 묻힌 자리를 정확히 친다.

## 타겟 사용자

- **1차**: macOS에서 Claude Code(CLI)를 인터랙티브 TUI로 쓰는 개발자. 이미 Codex 펫을 알거나
  `~/.codex/pets/`에 펫을 깔아 둔 사람(예: 이 프로젝트 작성자의 `nezu`).
- **2차**: Windows/Linux의 Claude Code 사용자(확장 단계).

## 가이딩 원칙

- **복제가 1순위.** 독창적 UI를 발명하지 않는다. 의심스러우면 [`refs/`](../../refs/README.md)의 Codex
  화면을 따른다.
- **1차 출처로 짓는다.** 훅·상태서버·권한브릿지는 **공식 Claude Code 훅/SDK 문서**와 자체 Codex
  관찰만을 근거로 clean-room 구현한다([06-product/strategy.md](../06-product/strategy.md), [ADR-0002](../adr/0002-backend-clean-room.md)).
- **호환은 협상 불가.** 자체 포맷으로 "변환"하지 않는다. Codex 펫이면 그대로 돌아가야 한다.
- **Claude Code에 무해.** 모든 연동은 fire-and-forget — 펫이 꺼져 있거나 죽어도 Claude Code는
  영향받지 않는다([05](../05-claude-integration/claude-code-hooks.md)).
