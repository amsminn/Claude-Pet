#!/usr/bin/env bash
#
# Claude-Pet installer / updater (macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/amsminn/Claude-Pet/main/scripts/install.sh | bash
#
# Re-run the same command to upgrade in place (the nvm/rustup model). The app is
# delivered over `curl` — command-line downloads are NOT quarantined by macOS, so
# the (free, ad-hoc-signed) app launches without a Gatekeeper "unidentified
# developer" prompt. We also strip the quarantine attribute defensively.
#
# Pin a specific version:  CLAUDE_PET_VERSION=v0.1.0 bash install.sh
#
set -euo pipefail

REPO="amsminn/Claude-Pet"
APP_NAME="Claude-Pet.app"

err()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }

# ── preflight ──────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || err "Claude-Pet is macOS-only (got $(uname -s))."
command -v curl >/dev/null 2>&1 || err "curl is required."
command -v ditto >/dev/null 2>&1 || err "ditto is required (ships with macOS)."

case "$(uname -m)" in
  arm64)  ARCH_TOKEN="arm64" ;;
  x86_64) ARCH_TOKEN="x64" ;;
  *)      err "unsupported architecture: $(uname -m)" ;;
esac

# ── resolve the release + matching asset ───────────────────────────────────
if [ -n "${CLAUDE_PET_VERSION:-}" ]; then
  API="https://api.github.com/repos/${REPO}/releases/tags/${CLAUDE_PET_VERSION}"
else
  API="https://api.github.com/repos/${REPO}/releases/latest"
fi

info "Looking up the release for ${ARCH_TOKEN}…"
# Retry transient GitHub API hiccups (e.g. a 504 gateway timeout).
JSON="$(curl -fsSL --retry 3 --retry-delay 1 --retry-all-errors \
  -H 'Accept: application/vnd.github+json' "$API")" \
  || err "could not reach the GitHub Releases API."

TAG="$(printf '%s' "$JSON" | grep '"tag_name"' | head -1 | cut -d '"' -f4 || true)"
URL="$(printf '%s' "$JSON" | grep 'browser_download_url' | grep -- "-${ARCH_TOKEN}.zip" | head -1 | cut -d '"' -f4 || true)"
[ -n "$URL" ] || err "no ${ARCH_TOKEN} build found in release ${TAG:-<latest>}."

# ── download (no quarantine) + unpack ──────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "Downloading ${TAG} (${ARCH_TOKEN})…"
curl -fL --retry 3 --retry-delay 1 --retry-all-errors --progress-bar \
  "$URL" -o "$TMP/app.zip" || err "download failed."

info "Unpacking…"
ditto -x -k "$TMP/app.zip" "$TMP/unpacked" || err "could not unpack the archive."
APP_SRC="$(find "$TMP/unpacked" -maxdepth 2 -name '*.app' | head -1)"
[ -n "$APP_SRC" ] || err "no .app found inside the archive."

# ── choose an install dir without prompting for sudo ───────────────────────
DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

# ── install / upgrade in place ─────────────────────────────────────────────
info "Installing to ${DEST}/${APP_NAME}…"
rm -rf "${DEST:?}/${APP_NAME}"
mv "$APP_SRC" "${DEST}/${APP_NAME}"
xattr -dr com.apple.quarantine "${DEST}/${APP_NAME}" 2>/dev/null || true

info "Launching…"
open "${DEST}/${APP_NAME}"

printf '\033[32m✓ Claude-Pet %s installed to %s\033[0m\n' "${TAG:-}" "$DEST"
echo "  To update later, re-run the same command."
