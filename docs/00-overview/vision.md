# Vision

> Source material: [`refs/README.md`](../../refs/README.md), [`refs/codex-pet-ux-teardown.md`](../../refs/codex-pet-ux-teardown.md)
> Related: [goals-nongoals.md](goals-nongoals.md), [06-product/strategy.md](../06-product/strategy.md)

## The problem we're solving

OpenAI Codex has a **pet** — a pixel character floating in the bottom-right corner that conveys the agent's
work status through emotion and cards (bubbles), and even lets you reply directly from a card. It's a small
but addictive experience that lets you keep tabs on an asynchronous coding agent "without ever staring at the
logs," out of the corner of your eye `Verified`.

**Claude Code (CLI) has nothing of that caliber.** Every existing attempt falls short on something — either it's
cross-platform but uses its own UI, so it isn't the Codex experience; or it's compatible with Codex assets but
**lacks the card stack and inline reply, and is macOS-centric**; or it's drowned out by a glut of similarly named
clones with minimal polish and traffic.

→ There is **no** implementation that satisfies all four beats **at once**: **"pixel-faithful Codex replication +
native asset compatibility + cross-platform + polish."** That gap is Claude-Pet's reason for existing.

## Value proposition

- **An experience indistinguishable from Codex.** The pet, cards, status icons, stack, reply, and expand/collapse
  are all replicated pixel-for-pixel by studying screen recordings. Not "yet another pet," but "the Claude Code
  edition of the Codex pet."
- **Assets as-is.** Loads `~/.codex/pets/`'s `pet.json` + `spritesheet.webp` **natively, with no conversion**.
  It absorbs the Petdex ecosystem (467+ pets `Verified`) as content on day zero — compatibility itself is the weapon.
- **Everywhere.** macOS first, then Windows/Linux. It strikes precisely at the spot where prior attempts got
  stuck on macOS and faded.

## Target users

- **Primary**: developers who use Claude Code (CLI) as an interactive TUI on macOS. People who already know the
  Codex pet or have a pet installed in `~/.codex/pets/` (e.g., this project author's `nezu`).
- **Secondary**: Windows/Linux Claude Code users (expansion phase).

## Guiding principles

- **Replication comes first.** We do not invent original UI. When in doubt, follow the Codex screens in
  [`refs/`](../../refs/README.md).
- **Build from first-party sources.** The hooks, state server, and permission bridge are clean-room implementations
  grounded solely on the **official Claude Code hooks/SDK docs** and our own Codex observations
  ([06-product/strategy.md](../06-product/strategy.md), [ADR-0002](../adr/0002-backend-clean-room.md)).
- **Compatibility is non-negotiable.** We do not "convert" to our own format. If it's a Codex pet, it must run as-is.
- **Harmless to Claude Code.** Every integration is fire-and-forget — if the pet is off or crashes, Claude Code is
  unaffected ([05](../05-claude-integration/claude-code-hooks.md)).
