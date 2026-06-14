# 0003. Codex 펫 에셋을 네이티브로 로드한다

- 상태: 채택됨
- 날짜: 2026-06-14
- 관련: [02-asset-compat/codex-pet-assets.md](../02-asset-compat/codex-pet-assets.md), [04-pet-ui/pet-and-cards.md](../04-pet-ui/pet-and-cards.md), [06-product/strategy.md](../06-product/strategy.md)

## Context

Claude-Pet의 차별화는 "새 펫 앱"이 아니라 **Codex pets for Claude Code**다. 사용자가 이미 `~/.codex/pets/<slug>/`에 설치한 `pet.json`과 `spritesheet.webp`를 그대로 쓸 수 있어야 한다.

`refs/sample-pet/`의 실제 `nezu` asset은 다음을 확인시켜 준다.

- `pet.json` metadata와 `spritesheet.webp`가 한 디렉터리에 있다.
- spritesheet는 1536x1872, 8열 x 9행 atlas, frame 192x208px이다 `확인`.
- Codex renderer는 비공개이며, 공개적으로 확인되는 것은 asset format과 app-level pet 기능이다.

## Decision

Claude-Pet은 Codex pet asset을 **변환 없이 네이티브 로드**한다.

구체적으로:

- 기본 검색 경로는 `~/.codex/pets/<slug>/`.
- 필수 파일은 `pet.json`과 `spritesheet.webp`.
- loader는 `pet.json`을 parsing/validation하고 atlas frame size를 실제 이미지에서 검증한다.
- 자체 format으로 복사·변환·packaging하지 않는다.
- optional field는 forward-compatible하게 보존하고, 알 수 없는 field는 무시한다.

## Consequences

**좋은 점**

- Petdex/Codex pet ecosystem을 콘텐츠로 흡수한다.
- 사용자에게 "이미 산/설치한 pet이 그대로 보인다"는 강한 가치가 생긴다.
- asset pipeline을 새로 만들 필요가 없다.

**나쁜 점·트레이드오프**

- Codex renderer가 비공개라 animation semantics는 관찰 기반으로 재구현해야 한다.
- future `pet.json` schema change에 대비한 tolerant parser가 필요하다.
- 모든 community asset이 같은 품질/치수를 지킨다는 보장이 없으므로 validator와 fallback UI가 필요하다.

## Alternatives considered

- **자체 pet format으로 import/convert**: 구현 자유도는 높지만 Codex compatibility라는 핵심 가치를 훼손한다.
- **범용 멀티-에이전트 펫 format 채택**: multi-agent ecosystem에는 좋지만 Codex pet fidelity가 약해진다.
- **Codex renderer protocol 연동**: 공개 schema가 없어 현재는 불가능하다.

## Validation

- `refs/sample-pet/`를 fixture로 loader test를 만든다.
- 실제 `~/.codex/pets/` 경로가 없을 때 sample fallback을 제공한다.
- atlas 치수 mismatch, 누락 파일, invalid JSON을 각각 error card가 아닌 settings/loader error로 표시한다.
