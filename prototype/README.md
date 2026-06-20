# Claude-Pet Design-Verification Prototype (mock)

> **Status: design locked.** A static mock for visually verifying that the card/pet UI design is right, without a real backend. The tokens, layout, sizes, and interaction appearance treat this prototype as the **source of truth** (kept in sync with [`../docs/04-pet-ui/pet-and-cards.md`](../docs/04-pet-ui/pet-and-cards.md)).

## What it is / is not

- ⭕ A static prototype that pixel-perfectly reproduces the **appearance and interaction design of the Codex pet's card stack + floating pet**. The sizes were matched by directly measuring frames from the actual Codex screen recordings (Retina 2x).
- ❌ There is **no** real Claude Code integration, event intake, reply sending, or persistence. Everything runs on mock scenarios.

## Running it

No build (static files). Because of loading the sprite webp, a local HTTP server is recommended over `file://`:

```sh
cd Claude-Pet
python3 -m http.server 8765
# Browser: http://127.0.0.1:8765/prototype/index.html
```

Drive it from the mock control panel on the left:
- **Scenario**: ① Single-task full cycle · ② Multi-session stack + overflow · ③ Permission → inline reply · ④ Error state
- **Speed**: Scenario playback speed multiplier
- **UI scale**: Demonstrates the system-dependent knob (the real build injects it from the OS display / accessibility text size). The entire text rescales proportionally via a single variable (`--ui-scale`).

## Structure

| File | Role |
|---|---|
| `index.html` | Mock control panel + desktop stage + pet widget (`#widget > #cards + #pet`) |
| `styles.css` | All design tokens (`:root`) and card/pet styles. Sizes are measured values (body 12px · title 13.5px · card width 252px) |
| `app.js` | The mock event engine — state → pet atlas row mapping, card render, flex `order` reorder, top scroll fade, `autoDetectFrames` (prevents blank-frame flicker) |
| `scenarios.js` | Definitions of the 4 mock scenarios |

## Pet sprite

Loads `../refs/sample-pet/spritesheet.webp` (nezu). Since **`refs/` is `.gitignore`d**, it is absent on a fresh clone, in which case the pet shows the **🐾 fallback**. **The card design renders completely even without the sprite**, so this does not hinder design verification.

## Known limitations (out of design scope — resolved in the real implementation)

Since this prototype is meant for **design-appearance verification**, runtime behavior bugs are intentionally left in:

- **Reply routing mock bug**: When you send a reply input, it sometimes lands on a different card/session than intended. This is due to a simplified card↔session mapping in the mock engine; the real behavior is handled by the [blocking hook reply path](../docs/05-claude-integration/claude-code-hooks.md) in the actual implementation.
- Backend, persistence, multi-monitor, and window drag/transparency/always-on-top — runtime OS behavior in general — are unimplemented.
