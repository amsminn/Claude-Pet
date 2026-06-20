# 0003. Load Codex Pet Assets Natively

- Status: Accepted
- Date: 2026-06-14
- Related: [02-asset-compat/codex-pet-assets.md](../02-asset-compat/codex-pet-assets.md), [04-pet-ui/pet-and-cards.md](../04-pet-ui/pet-and-cards.md), [06-product/strategy.md](../06-product/strategy.md)

## Context

Claude-Pet's differentiator is not "a new pet app" but **Codex pets for Claude Code**. Users must be able to use the `pet.json` and `spritesheet.webp` they have already installed under `~/.codex/pets/<slug>/`, as-is.

The real `nezu` asset in `refs/sample-pet/` confirms the following.

- `pet.json` metadata and `spritesheet.webp` live in the same directory.
- The spritesheet is 1536x1872, an 8-column x 9-row atlas, with 192x208px frames `Verified`.
- The Codex renderer is closed-source; what is publicly confirmable is the asset format and the app-level pet functionality.

## Decision

Claude-Pet loads Codex pet assets **natively, without conversion**.

Specifically:

- The default search path is `~/.codex/pets/<slug>/`.
- The required files are `pet.json` and `spritesheet.webp`.
- The loader parses/validates `pet.json` and verifies the atlas frame size against the actual image.
- We do not copy, convert, or package into our own format.
- Optional fields are preserved forward-compatibly, and unknown fields are ignored.

## Consequences

**Upsides**

- We absorb the Petdex/Codex pet ecosystem as content.
- Users get the strong value of "the pet I already bought/installed shows up as-is."
- No need to build a new asset pipeline.

**Downsides and tradeoffs**

- Because the Codex renderer is closed-source, animation semantics must be reimplemented from observation.
- A tolerant parser is needed to guard against future `pet.json` schema changes.
- There is no guarantee that every community asset keeps the same quality/dimensions, so a validator and a fallback UI are needed.

## Alternatives considered

- **Import/convert into our own pet format**: High implementation freedom, but undermines the core value of Codex compatibility.
- **Adopt a generic multi-agent pet format**: Good for a multi-agent ecosystem, but weakens Codex pet fidelity.
- **Integrate with the Codex renderer protocol**: Currently impossible, since there is no public schema.

## Validation

- Build loader tests using `refs/sample-pet/` as a fixture.
- Provide a sample fallback when the actual `~/.codex/pets/` path does not exist.
- Surface atlas dimension mismatch, missing files, and invalid JSON as settings/loader errors rather than as error cards.
