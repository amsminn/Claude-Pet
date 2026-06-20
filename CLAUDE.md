# CLAUDE.md — Claude-Pet

A project that **recreates OpenAI Codex's desktop-pet experience for Claude Code (CLI)**. A floating
pet shows Claude Code's activity (thinking, running tools, waiting on a permission, done) as a stack
of cards (speech bubbles), and you reply to the agent right from a card. Pet assets are **natively
compatible** with the Codex ecosystem (`~/.codex/pets/`).

Status: **v1 Electron implementation in progress (Phase 0 → 2)**. The UI design is locked against the
static mock in `prototype/`. The app is written in **TypeScript** and bundled with **electron-vite**
(`src/main`, `src/preload`, `src/renderer`, shared code in `src/shared`); the electron-free cores
(state engine, asset loader, permission bridge, server) are unit-tested with `node --test` via `tsx`.

## Directory layout

- **`src/`** — the implementation. TypeScript, electron-vite. `main/` (Electron main + loopback
  server + state engine + asset loader), `preload/` (the audited `window.claudePet` bridge),
  `renderer/` (the pet widget + card stack), `shared/` (constants + types used on both sides).
- **`test/`** — `node --test` suites for the electron-free cores. Run with `npm test`.
- **`docs/`** — technical spec (docs-as-code). Numbered sections + `adr/`. Start at [`docs/README.md`](docs/README.md).
- **`prototype/`** — **static design mock**. Reproduces the card/pet UI look and interactions pixel
  for pixel with no backend. Source of truth for the locked design (tokens/sizes kept in sync with
  [`docs/04-pet-ui`](docs/04-pet-ui/pet-and-cards.md)). No build — open `prototype/index.html` via a
  static server. Start at [`prototype/README.md`](prototype/README.md).
- **`refs/`** — primary material for the clone target (Codex pet): screenshots, screen recordings, a
  real pet asset (`nezu`). The **source of truth** for the spec. Local-only — **`.gitignore`**'d, so
  it is never committed.

## Documentation conventions (techspec-style)

- **Language: English prose.** Keep technical terms as-is (hook, statusline, spritesheet, atlas,
  Durable, …).
- **Filenames: lower-case-hyphenated** (`codex-pet-assets.md`). ADRs are `NNNN-title.md`. Cross-doc
  links are **relative paths**.
- **Diagrams = Mermaid code blocks** (no image attachments — easy to diff and review). `flowchart`
  (structure), `sequenceDiagram` (flow), `stateDiagram-v2` (state machines).
- **Credibility labels**: mark external facts with `` `Verified` `` (source-checked) or `` `Inferred` ``
  (reasoned from public information). Design decisions are opinions, so they carry no label.
- **ADRs (MADR format)**: Context → Decision → Consequences → Alternatives considered. **Be honest
  about tradeoffs** — downsides, risks, and mitigations are mandatory.

## Clone target, in one line

> Codex pet = a pixel pet floating at the bottom-right of the screen + a stack of white task cards on
> top of it (title, body, status icon, reply, expand, ×). The renderer is **closed-source** (only the
> asset format is MIT) → reimplemented from observation. Evidence: [`refs/`](refs/README.md).
