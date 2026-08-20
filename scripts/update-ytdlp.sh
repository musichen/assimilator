#!/usr/bin/env bash
# Pin a current yt-dlp next to the bot. YouTube extractors rot in weeks.
# Uses the NIGHTLY channel: since mid-2026 YouTube rolls out player-client
# blocks (403/PO-token) faster than the monthly stable cadence; nightly
# ships extractor fixes within hours/days. Stable is a fallback via:
#   scripts/update-ytdlp.sh stable
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/bin/yt-dlp"
CHANNEL="${1:-nightly}"
TAG="${2:-latest}"
mkdir -p "$ROOT/bin"
REPO="yt-dlp/yt-dlp"
if [[ "$CHANNEL" == "nightly" ]]; then
  REPO="yt-dlp/yt-dlp-nightly-builds"
fi
if [[ "$TAG" == "latest" ]]; then
  TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
fi
echo "Downloading yt-dlp ($CHANNEL) $TAG -> $DEST"
curl -fsSL -o "$DEST" "https://github.com/${REPO}/releases/download/${TAG}/yt-dlp"
chmod +x "$DEST"
"$ROOT/.venv/bin/python" "$DEST" --version
