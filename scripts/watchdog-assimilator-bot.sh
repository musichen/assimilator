#!/usr/bin/env bash
# Watchdog loop for ASSIMILATOR Telegram bot
# Keeps the bot alive — restarts on any exit

set -euo pipefail

export HOME="/Users/musichen"
export APP_DIR="$HOME/apps/assimilator"
export LOG="$HOME/.hermes/logs/assimilator-watchdog.log"
export PID_FILE="$HOME/.hermes/run/assimilator-bot.pid"
export PATH="/usr/local/bin:/Users/musichen/.nvm/versions/node/v24.14.0/bin:/opt/homebrew/bin:$PATH"

# Load env
source "$APP_DIR/.env" 2>/dev/null || true
source "$APP_DIR/.env.local" 2>/dev/null || true

ASSIMILATOR_WORKSPACE="${ASSIMILATOR_WORKSPACE:-$HOME/knowledge-system/assimilator}"

BOT_TOKEN="${BOT_key:-${BOT_KEY:-${TELEGRAM_BOT_TOKEN:-}}}"

mkdir -p "$(dirname "$LOG")" "$(dirname "$PID_FILE")"
cd "$APP_DIR"

echo "[watchdog] ASSIMILATOR bot watchdog started at $(date)"

RESTART_DELAY=5

cleanup() {
  if [[ -n "${BOT_PID:-}" ]] && kill -0 "$BOT_PID" 2>/dev/null; then
    kill "$BOT_PID" 2>/dev/null || true
    wait "$BOT_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

while true; do
  if [[ -z "${BOT_TOKEN:-}" ]]; then
    echo "[watchdog] Missing bot token — not starting"
    exit 1
  fi

  # Prevent Telegram 409 conflicts from stale local bot instances before starting one canonical child.
  pkill -f "@assimilator/telegram" 2>/dev/null || true
  pkill -f "tsx.*apps/telegram/bot\.ts" 2>/dev/null || true
  pkill -f "tsx bot\.ts" 2>/dev/null || true
  sleep 1

  echo "[watchdog][$(date +%H:%M:%S)] Starting ASSIMILATOR bot via direct tsx..."
  BOT_key="$BOT_TOKEN" \
  ASSIMILATOR_WORKSPACE="$ASSIMILATOR_WORKSPACE" \
  "$APP_DIR/node_modules/.bin/tsx" "$APP_DIR/apps/telegram/bot.ts" \
    >> "$LOG" 2>&1 &
  BOT_PID=$!
  echo "$BOT_PID" > "$PID_FILE"

  wait "$BOT_PID"
  exit_code=$?
  rm -f "$PID_FILE"
  echo "[watchdog][$(date +%H:%M:%S)] Bot exited with code $exit_code"

  if [[ $exit_code -eq 0 ]]; then
    echo "[watchdog] Clean exit — stopping."
    break
  fi

  echo "[watchdog] Restarting in ${RESTART_DELAY}s..."
  sleep "$RESTART_DELAY"
done
