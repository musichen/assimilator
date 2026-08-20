#!/usr/bin/env bash
# Pin a current yt-dlp next to the bot. YouTube extractors rot in weeks.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/bin/yt-dlp"
TAG="${1:-latest}"
mkdir -p "$ROOT/bin"
if [[ "$TAG" == "latest" ]]; then
  TAG="$(curl -fsSL https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest | python3 -c 'import sys,json; print(json.load(sys.stdin)["tag_name"])')"
fi
echo "Downloading yt-dlp $TAG -> $DEST"
curl -fsSL -o "$DEST" "https://github.com/yt-dlp/yt-dlp/releases/download/${TAG}/yt-dlp"
chmod +x "$DEST"
"$ROOT/.venv/bin/python" "$DEST" --version
