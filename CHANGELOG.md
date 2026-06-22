# Changelog

All notable changes to Claude-Pet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Released macOS builds live on the [GitHub Releases](https://github.com/amsminn/Claude-Pet/releases)
page — install or upgrade in place with the `curl | bash` one-liner in the
[README](README.md).

## [Unreleased]

_Nothing yet._

## [0.3.15] — 2026-06-22

### Fixed
- Cards no longer stretch vertically on hover. The status-icon slot now reserves its
  20×20 box even when empty, so swapping it for the same-sized expand chevron is
  height-neutral — previously an icon-less card grew ~3.5px (most visible on longer
  titles/bodies that wrap to two lines).

## [0.3.14] — 2026-06-22

### Fixed
- The card's right drop-shadow no longer clips at a hard vertical edge. `.cards` uses
  `overflow-y: auto`, which also clips horizontally; it now reserves shadow room on the
  right while keeping the card flush with the pet.

### Docs
- Re-rendered the README preview media at 2× (retina) so it stays crisp on HiDPI displays.
- The demo GIF now animates the waiting-card spinner (12-frame loop), not just the pet.

## [0.3.13] — 2026-06-22

### Changed
- The app icon is now the nezuko pet sprite on a rounded-square tile (was the default
  Electron icon).

### Docs
- README previews use the real nezuko pet, tight-cropped, plus an animated demo GIF.

## [0.3.12] — 2026-06-22

### Changed
- The pet no longer floats over fullscreen apps — it stays off fullscreen Spaces, so it
  won't cover a video, presentation, or other fullscreen window.

## [0.3.11] — 2026-06-21

### Fixed
- Hovering a card no longer nudges the title and body apart. Hover emphasis is now a
  subtle lift (deeper shadow + brighter background) with no layout shift.

## [0.3.10] — 2026-06-21

### Changed
- A completed response keeps the card stack open until work resumes or you collapse it
  manually, instead of auto-collapsing.

## [0.3.9] — 2026-06-21

### Fixed
- More clearance above the collapse button, and the collapse chevron sits at its true
  optical center.

## [0.3.8] — 2026-06-21

### Changed
- Halved the vertical gap between cards (`--card-gap` 13 → 7px).

## [0.3.7] — 2026-06-21

### Fixed
- Restored real scrolling in the card stack — dropping `justify-content: flex-end`, which
  had made the top cards unreachable in Chromium. Cards right-align to the pet with a
  tighter gap.

## [0.3.6] — 2026-06-21

### Fixed
- Centered and raised the collapse chevron, co-located with the count badge in the pet's
  top-right slot.

## [0.3.5] — 2026-06-21

### Added
- Right-aligned card stack with real scrolling. The stack auto-opens and scrolls to the
  newest card only when a response completes; otherwise your scroll position is kept.

## [0.3.4] — 2026-06-21

### Fixed
- Anchored a short card stack to the bottom (near the pet); centered the collapse chevron.

## [0.3.3] — 2026-06-21

### Fixed
- Card shadow is no longer clipped at the scroll container edge.

## [0.3.2] — 2026-06-21

### Fixed
- When collapsed, the hover/expand hitbox is the pet's width, not the full card width —
  the empty area to the pet's left no longer triggers an expand.

## [0.3.1] — 2026-06-21

### Removed
- Hid the free-text reply field. A free-text reply can't reach a running session without
  blocking the Stop hook, so the pet is a read-only monitor. (Reverts the opt-in reply
  mode added in 0.3.0.)

### Added
- Per-pixel hover hit test, so the pet's wave only fires over its actual pixels — not the
  transparent margins of its frame.

## [0.3.0] — 2026-06-21

### Added
- Opt-in reply mode that injected a free-text reply through a blocking Stop hook.
  (Withdrawn in 0.3.1 — see above.)

## [0.2.6] — 2026-06-21

### Fixed
- The collapse chevron shares the pet's top-right slot with the count badge (mutually
  exclusive by state).

## [0.2.5] — 2026-06-21

### Added
- Card title falls back to the working-directory name when no prompt is available.
- Right-click the pet for a native "펫 닫기" (quit) menu.
- Press Esc to cancel an open reply field.

## [0.2.4] — 2026-06-21

### Fixed
- Centered the collapse button over the pet; smoother sprite downscaling.
- The installer retries transient GitHub API/CDN errors (e.g. a 504 gateway timeout).

## [0.2.3] — 2026-06-21

### Fixed
- Card title now comes from the session `prompt`, and the body from the transcript tail.

## [0.2.2] — 2026-06-21

### Changed
- Sprite playback modes follow the asset spec (idle pingpong; running/waiting loop; wave
  once → idle; failed holds the last frame), plus assorted UI tuning.

## [0.2.1] — 2026-06-21

### Fixed
- The update toast now respects its `hidden` attribute (it was always visible).

## [0.2.0] — 2026-06-21

### Added
- One-click update: an "update available" toast re-runs the installer in Terminal and
  relaunches the app.

### Fixed
- Release CI builds both architectures and uploads via `gh` — the previous multi-arch
  publish raced and dropped the large zips. Releases are now published, not left as drafts.

## [0.1.0] — 2026-06-21

### Added
- First public release. A floating desktop pet that mirrors a Claude Code (CLI) session as
  a card stack — thinking, running a tool, waiting on a permission, done — and loads
  `~/.codex/pets/` sprites natively (🐾 fallback when none is installed).
- macOS `curl | bash` install and in-place upgrade, delivered through GitHub Releases
  (ad-hoc-signed, so it launches with no Gatekeeper prompt).
- TypeScript end to end (electron-vite); electron-free, unit-tested state / server /
  permission / asset cores, and multi-monitor drag across mixed-HiDPI displays.

[Unreleased]: https://github.com/amsminn/Claude-Pet/compare/v0.3.15...HEAD
[0.3.15]: https://github.com/amsminn/Claude-Pet/compare/v0.3.14...v0.3.15
[0.3.14]: https://github.com/amsminn/Claude-Pet/compare/v0.3.13...v0.3.14
[0.3.13]: https://github.com/amsminn/Claude-Pet/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/amsminn/Claude-Pet/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/amsminn/Claude-Pet/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/amsminn/Claude-Pet/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/amsminn/Claude-Pet/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/amsminn/Claude-Pet/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/amsminn/Claude-Pet/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/amsminn/Claude-Pet/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/amsminn/Claude-Pet/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/amsminn/Claude-Pet/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/amsminn/Claude-Pet/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/amsminn/Claude-Pet/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/amsminn/Claude-Pet/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/amsminn/Claude-Pet/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/amsminn/Claude-Pet/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/amsminn/Claude-Pet/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/amsminn/Claude-Pet/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/amsminn/Claude-Pet/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/amsminn/Claude-Pet/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/amsminn/Claude-Pet/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/amsminn/Claude-Pet/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/amsminn/Claude-Pet/releases/tag/v0.1.0
