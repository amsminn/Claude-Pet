# 07. 구현 빌드 플랜 (research-backed)

> 근거: 1차 출처 deep-research(2026-06-14). 24개 소스 → 113개 주장 추출 → 상위 25개를 3표 적대적 검증 → **21 confirmed / 4 killed**. 각 사실에 `확인`(검증)/`추정`(미검증) 라벨.
> 관련: [roadmap](../roadmap.md) · [01 아키텍처](../01-architecture/overview.md) · [03 상태엔진](../03-state-engine/state-machine.md) · [04 펫·카드 UI](../04-pet-ui/pet-and-cards.md) · [05 Claude 연동](../05-claude-integration/claude-code-hooks.md) · [ADR-0001](../adr/0001-electron-over-tauri.md) · [ADR-0004](../adr/0004-reply-via-blocking-hook.md)
>
> **v1 범위 = Phase 0 → Phase 2** (떠 있는 펫 + 상태 카드 + 인라인 답장·권한 응답). Phase 3~4는 v2+.
> 디자인은 [`prototype/`](../../prototype/README.md)에서 **확정(locked)** — 본 플랜은 그 외형을 Electron으로 옮기고 실제 Claude Code·Codex 에셋에 연결하는 작업이다.

---

## 0. 연구로 확정된 구현 근거 `확인`

이 표의 사실들이 막는 미지수가 없음을 보증한다(검증 통과).

| 영역 | 확정 사실 | 1차 출처 |
|---|---|---|
| **펫 창(비활성 패널)** | Electron `BrowserWindow({type:'panel'})`(출시)는 `NSWindowStyleMaskNonactivatingPanel`을 적용 → **앱 포커스를 뺏지 않고**, **풀스크린 앱 위에 뜨고**, **모든 Space에 표시**. Sonoma 14 포커스 버그는 Electron 28+에서 수정 | [electron#34388](https://github.com/electron/electron/pull/34388), [base-window-options](https://www.electronjs.org/docs/latest/api/structures/base-window-options), [electron#40307](https://github.com/electron/electron/pull/40307) |
| **클릭스루(부분 상호작용)** | `setIgnoreMouseEvents`는 **창 전체에 전역 적용** → 펫 히트영역만 클릭하려면 커서 위치로 **동적 토글**: 기본 `(true,{forward:true})`, 펫 위에서 `(false)`. 렌더러 `mouseenter/leave`→IPC. `forward`는 **macOS에서도 동작**(반박 0-3) | [electron#23042](https://github.com/electron/electron/issues/23042), [window-customization](https://www.electronjs.org/docs/latest/tutorial/window-customization) |
| **(함정)** | 순수 투명창은 **더 이상 클릭을 자동 통과시키지 않음**(v7.0.0b5 회귀, 6.1.9→8.x+ 깨짐). 위 토글 레시피가 **필수** | [electron#23042](https://github.com/electron/electron/issues/23042), [loomhq/ElectronMacOSClickThrough](https://github.com/loomhq/ElectronMacOSClickThrough) |
| **(폴백)** | 더 풍부한 비활성 포커스가 필요하면 네이티브 애드온 `electron-panel-window`(`makePanel`/`makeKeyWindow` = 앱 활성화 없이 포커스). 단 원본 패키지는 Electron ~21.x 이후 미유지 → 유지보수 포크 필요. **기본은 내장 `type:'panel'` 사용** | [qazbnm456/electron-panel-window](https://github.com/qazbnm456/electron-panel-window) |
| **훅 등록** | `settings.json`의 `hooks` 객체를 event 이름으로 키잉, matcher 그룹(`"Edit\|Write"` 또는 정규식 `mcp__.*`) + `hooks` 배열. 핸들러 타입 5종: `command`/`http`/`mcp_tool`/`prompt`/`agent`. 스코프는 파일 위치(`~/.claude/settings.json`=전역) | [code.claude.com/docs/hooks](https://code.claude.com/docs/en/hooks), [anthropic hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide) |
| **훅 수신(http)** | 네이티브 `http` 핸들러가 이벤트 JSON을 URL(예 `http://localhost:8080/hooks/pre-tool-use`)로 POST. **차단하려면 2xx + JSON 본문** 반환(상태코드만으론 차단 불가). **non-2xx/timeout/연결실패 = non-blocking 에러 → 실행 허용**. fire-and-forget = 2xx 반환 후 본문 무시 | [hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide) |
| **블로킹 답장 ① PreToolUse** | **평면** `hookSpecificOutput.permissionDecision: allow\|deny\|ask\|defer` (+`updatedInput`). **헤드리스 `-p`에서도 동작**. 결정적 게이트 | [hooks](https://code.claude.com/docs/en/hooks), [cc#39344](https://github.com/anthropics/claude-code/issues/39344) |
| **블로킹 답장 ② PermissionRequest** | **중첩** `decision.behavior: allow\|deny` (+`updatedInput`, `updatedPermissions`의 `setMode`). 권한 다이얼로그 뜨기 직전 발화. **인터랙티브 전용 — `-p`에서는 발화 안 함** | [hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide), [hexdocs PermissionRequest](https://hexdocs.pm/claude_code/ClaudeCode.Hook.Output.PermissionRequest.html) |
| **command 훅 종료코드** | exit 0 = stdout JSON 처리, exit 2 = 차단(PreToolUse면 도구 호출 차단, stderr를 Claude에 전달), 그 외 = non-blocking(exit 1 포함) | [hooks](https://code.claude.com/docs/en/hooks) |
| **에셋 atlas 계약** | **1536×1872**, **8열×9행**, **192×208 셀**. 9행이 상태별 순서 매핑(idle, running-right, running-left, waving, jumping, failed, waiting, running, review), 행당 최대 8프레임, PNG/WebP·투명, **빈 셀 완전 투명**(→ `autoDetectFrames` 스캔이 문서화된 방식) | [hatch-pet SKILL.md](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md), [crafter-station/petdex](https://github.com/crafter-station/petdex) |
| **타이밍** | 프레임 수·타이밍·시퀀스 체이닝·이벤트 트리거는 **Codex 렌더러에 하드코딩**(매니페스트 아님). 기본 ~**1100ms / 상태당 6프레임**. 활성 상태는 1회 재생 후 idle 복귀 | [petdex](https://github.com/crafter-station/petdex), [codex#23272](https://github.com/openai/codex/issues/23272) |
| **animation 필드** | `pet.json`의 `animation` 필드(=[codex#20863](https://github.com/openai/codex/issues/20863))는 **열려있고 미머지**된 후방호환 제안. 출시 `pet.json`은 `{id, displayName, description, spritesheetPath}`뿐 | [codex#20863](https://github.com/openai/codex/issues/20863), [hatch-pet SKILL.md](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md) |

**경계 질문 3개 해소:** (a) 블로킹 답장은 PreToolUse(평면, 헤드리스)와 PermissionRequest(중첩, 인터랙티브) **두 폼으로 버전 구분 확정**. (b) `animation` 필드 **미머지 확정** → atlas 계약만 출시 surface. (c) 클릭스루+비활성 펫 창 **검증된 레시피 확정**.

## 0.1 문서로 확인 안 됨 → Phase 0 경험적 스파이크 필수 `추정`

연구가 명시적으로 경고: 아래는 1차 문서로 확정되지 않으니 **실제로 찍어보고** 의존할 것.

1. **이벤트별 실제 페이로드** — "모든 훅이 `session_id/transcript_path/cwd/...`를 공통 제공"이라는 주장은 **과명세로 반박(0-3)**. 각 이벤트(PreToolUse/PostToolUse/Notification/Stop/SessionStart/PermissionRequest) 페이로드를 직접 캡처해 필드 존재를 확인.
2. **트랜스크립트 JSONL 경로/줄 구조**(`~/.claude/projects/...`) — 카드 본문 추출용. 미검증 → 실제 파일로 확정.
3. **스프라이트 60fps 기법** — rAF 캔버스 blit vs CSS `steps()`/`background-position`(+`image-rendering:pixelated`). 다중 펫 저CPU 한계점 미검증 → 측정으로 결정.
4. **`--ui-scale` 주입 경로** — `screen.getDisplayNearestPoint().scaleFactor` + macOS 접근성 텍스트 크기(`systemPreferences`/CSS `env(preferred-text-scale)`) 읽어 주입, 디스플레이/접근성 라이브 변경 반응. 미검증 → 스파이크.

---

## Phase 0 — 골격·에셋·디자인 이식 (de-risk)

> 목표: **두 하드 제약을 먼저 증명** — (1) 비활성·클릭스루 펫 창이 실제로 동작하는가, (2) 확정 디자인이 Electron에서 픽셀 충실하게 나오는가. 훅 연동 전, 가짜 이벤트로 구동.

| Stream | 작업 | 근거 |
|---|---|---|
| Scaffold | Electron 메인/렌더러/preload, **Electron 버전 핀**(≥28, panel 포커스 수정 포함), contextIsolation on | §0 펫 창 |
| 펫 창 | `type:'panel'` + `transparent:true` + `frame:false` + `hasShadow:false` + `alwaysOnTop`(screen-saver level) + `visibleOnAllWorkspaces`. 우하단 배치, 멀티모니터(`screen` API) | §0 펫 창 |
| 클릭스루 | 기본 `setIgnoreMouseEvents(true,{forward:true})`; 렌더러 `#widget` hover→IPC로 `(false)` 토글 | §0 클릭스루 |
| 에셋 로더 | `~/.codex/pets/<slug>/` 디스커버리 → `pet.json` 파싱(출시 4필드) → spritesheet(webp/png) 로드 → atlas 상수(8×9·192×208) + **`autoDetectFrames`**(투명셀 스캔) → state→9행 맵. `animation` 필드는 **있으면 무시(future-only)** | §0 에셋 |
| 디자인 이식 | [`prototype/`](../../prototype/README.md)의 HTML/CSS/JS를 **그대로** 렌더러로 이식(카드 flex `order` reorder, 상단 스크롤 페이드, 카드 `flex:none` 성장, `--ui-scale` 토큰). 가짜 이벤트 엔진으로 4 시나리오 재현 | [04 펫·카드 UI](../04-pet-ui/pet-and-cards.md) |
| 스파이크 | §0.1 항목 측정(특히 스프라이트 기법·`--ui-scale` 읽기) | §0.1 |

**Exit:** 앱을 켜면 우하단에 nezu 펫(에셋 변환 없이) + 가짜 시나리오 카드 스택이 **`prototype/` 기준 시각 QA 통과**. 펫 영역만 클릭되고 나머지는 통과, 포커스 안 뺏김, 풀스크린/멀티 Space 위에 표시.

## Phase 1 — 상태 엔진 (읽기 전용)

> 목표: 실제 Claude Code 활동(생각중·도구실행·완료·알림·에러)에 반응하는 펫+카드. **답장 없음.**

| Stream | 작업 | 근거 |
|---|---|---|
| 로컬 서버 | 메인 프로세스 loopback HTTP 서버(`/healthz`, `/state`). `/state`는 항상 빠르게 204(fire-and-forget) | [05 §5](../05-claude-integration/claude-code-hooks.md) |
| 훅 설치기 | `settings.json`에 **`http` 훅** 등록(멱등·기존 훅 보존·언인스톨). 이벤트별 localhost POST | §0 훅 등록 |
| **페이로드 스파이크** | **각 이벤트 실제 페이로드 캡처** 후 매핑 확정(문서 스키마 신뢰 금지) | §0.1-1 |
| 상태 매핑 | EVENT_TO_STATE → 펫 atlas 행 + 카드 생성/갱신. 권위 문서 = [03 state-machine](../03-state-engine/state-machine.md). **이벤트 이름은 핀 버전의 공식 목록으로 검증** | [03](../03-state-engine/state-machine.md) |
| 트랜스크립트 tail | **JSONL 경로/구조 스파이크** 후, Stop 시 마지막 assistant 텍스트를 카드 본문으로(상한 클램프·redaction) | §0.1-2 |
| IPC | 서버(메인)→렌더러 상태 push, 렌더러는 `prototype` 렌더 로직 재사용 | — |

**Exit:** 앱 off면 Claude Code에 영향 0. 단일·다세션 모두 `session_id`별 카드가 안정 갱신. 펫 행이 상태 따라 전이. 카드 본문이 실제 마지막 assistant 텍스트로 채워짐.

## Phase 2 — 인터랙션 (답장·권한) — **v1 종료선**

> 목표: 카드에서 allow/deny + 짧은 메시지로 실제 권한 결정. 고위험·버전 민감 구간.

| Stream | 작업 | 근거 |
|---|---|---|
| 답장 UI | 확정 디자인의 인라인 답장(흰 입력+파랑 포커스+회색 전송 pill) 활성화 | [04 §5.2](../04-pet-ui/pet-and-cards.md) |
| 권한 게이트(주) | **인터랙티브**: `PermissionRequest` http 훅을 hold → 카드 UI 결정 → **중첩** `{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"\|"deny"}}}` 2xx 반환 | §0 답장② / [ADR-0004](../adr/0004-reply-via-blocking-hook.md) |
| 권한 게이트(헤드리스) | `-p`에서는 PermissionRequest 미발화 → **`PreToolUse`** 평면 `permissionDecision`로 처리(별도 경로) | §0 답장① |
| 안전장치 | **미응답/timeout/DND = no-decision**(allow/deny 합성 금지). http 실패=non-blocking이므로 "실패 시 자동 허용 vs native prompt 복귀"를 **smoke test로 확정**. `bypassPermissions` 회피 → `acceptEdits` | §0 훅수신, [#49525](https://github.com/anthropics/claude-code/issues/49525) |
| 버그 회피 | 알려진 훅 버그 경로 테스트: deny 미적용(MCP, [#33106]), ask가 deny 덮음([#39344]), allow가 prompt 못 막음([#52822]) | cc issues |

**v1 Exit(릴리스 게이트):** 실제 `PermissionRequest`에서 카드 `allow`가 진행시키고 `deny`가 거절시킨다. 앱 부재/DND/timeout에서 native prompt fallback이 살아있다(자동 허용 사고 0). 키 주입 API를 reply 경로에 **쓰지 않음**(코드리뷰).

## Phase 3 — 시스템 충실도·폴리시 (v2)

`--ui-scale` 주입(scaleFactor+접근성, 라이브 반응) · 스프라이트 perf 확정(rAF vs CSS steps 측정 결과 적용) · 멀티모니터/드래그/엣지 케이스 · pet picker(여러 펫).

## Phase 4 — 패키징·배포 (v2)

electron-builder macOS 코드서명+공증(notarization)·DMG/zip · 자동 업데이트(electron-updater) · always-on-top/접근성 권한 프롬프트 · Windows/Linux 클릭스루·투명창 스파이크.

---

## 리스크 레지스터 (연구 caveat 기반)

| 리스크 | 영향 | 완화 |
|---|---|---|
| **훅 API 빠른 변동**(v2.1.x, 2026-06) — `defer` 한때 미문서화, `bypassPermissions` 2.1.110+ 드롭 | 빌드 시점에 shape 깨질 수 있음 | **Claude Code 버전 핀** + 빌드 시 `hookSpecificOutput` shape 라이브 재검증. `bypassPermissions` 금지 |
| **문서 페이로드 과명세**(반박됨) | 잘못된 필드 의존 | 이벤트별 실제 페이로드 캡처 후에만 의존(Phase 0.1-1) |
| **트랜스크립트 구조 미검증** | 카드 본문 깨짐 | 실제 JSONL로 경로/줄 구조 확정(Phase 0.1-2) |
| **클릭스루 회귀/오정보** | 펫 창 클릭 안 되거나 전부 막힘 | 검증 레시피만 사용(`type:'panel'` + `setIgnoreMouseEvents(true,{forward:true})`+토글). "native 자동통과"·"forward는 윈도우 전용" 주장은 **반박됨 — 의존 금지** |
| **panel 애드온 유지보수** | 빌드 깨짐 | 내장 `type:'panel'` 우선. 애드온은 비활성 포커스가 꼭 필요할 때만 유지보수 포크로 |
| **에셋 타이밍 2차 출처 의존**(1100ms/6fps) | 애니 미세 차이 | 실제 `~/.codex/pets/<slug>/` 에셋으로 diff 후 렌더러 고정 |
| **animation 필드 향후 머지 가능** | 미래 호환 | atlas 레이어를 additive 설계 → 머지 시 옵션으로 채택 |

## 소스 (검증 통과 핵심)

Electron: [#34388](https://github.com/electron/electron/pull/34388) · [#23042](https://github.com/electron/electron/issues/23042) · [#40307](https://github.com/electron/electron/pull/40307) · [window-customization](https://www.electronjs.org/docs/latest/tutorial/window-customization) · [electron-panel-window](https://github.com/qazbnm456/electron-panel-window) · [loomhq click-through](https://github.com/loomhq/ElectronMacOSClickThrough)
Claude Code: [hooks](https://code.claude.com/docs/en/hooks) · [hooks-guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide) · [cc#39344](https://github.com/anthropics/claude-code/issues/39344) · [cc#41791](https://github.com/anthropics/claude-code/issues/41791)
Codex 에셋: [codex#20863](https://github.com/openai/codex/issues/20863) · [hatch-pet SKILL.md](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md) · [petdex](https://github.com/crafter-station/petdex) · [codex#23272](https://github.com/openai/codex/issues/23272)
