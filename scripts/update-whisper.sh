#!/usr/bin/env bash
# Set up whisper.cpp (Metal-accelerated STT) for Assimilator on macOS.
# Replaces the slow Python openai-whisper: ~10x faster on Apple Silicon.
#
# Usage: scripts/update-whisper.sh [model]
#   model: base (default) | small | medium | large-v3
set -euo pipefail

MODEL="${1:-base}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS_DIR="${ASSIMILATOR_WHISPER_MODELS_DIR:-/opt/homebrew/share/whisper-cpp/models}"

echo "==> Installing whisper-cpp (brew)"
if ! command -v whisper-cli >/dev/null 2>&1; then
  brew install whisper-cpp
else
  echo "    whisper-cli already installed: $(command -v whisper-cli)"
fi

echo "==> Ensuring model dir: $MODELS_DIR"
mkdir -p "$MODELS_DIR"

GGML="ggml-${MODEL}.bin"
if [[ ! -f "$MODELS_DIR/$GGML" ]]; then
  echo "==> Downloading $GGML (~150-300MB) from HuggingFace"
  curl -fL --retry 3 -o "$MODELS_DIR/$GGML" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${GGML}"
else
  echo "    $GGML already present"
fi

echo "==> Verifying"
"$(command -v whisper-cli)" -m "$MODELS_DIR/$GGML" --help >/dev/null 2>&1 || true
ls -lh "$MODELS_DIR/$GGML"

cat <<EOF

✅ whisper.cpp ready.
Model: $MODELS_DIR/$GGML

Point the bot at it via .env:
  ASSIMILATOR_WHISPER_BIN="$(command -v whisper-cli)"
  ASSIMILATOR_WHISPER_MODEL="$MODELS_DIR/$GGML"
  ASSIMILATOR_WHISPER_LANG="auto"   # or "ru", "en", ...
EOF
