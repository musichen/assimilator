#!/usr/bin/env bash
# Start the ASSIMILATOR Telegram bot (background, nohup)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$HOME/.hermes/logs/assimilator-bot.log"
PID_FILE="$HOME/.hermes/run/assimilator-bot.pid"
ENV_FILE="$APP_DIR/.env"

# Load env if it exists
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Resolve workspace (default to knowledge-system/assimilator relative to $HOME)
ASSIMILATOR_WORKSPACE="${ASSIMILATOR_WORKSPACE:-$HOME/knowledge-system/assimilator}"

if [[ -z "${BOT_key:-}" ]] && [[ -z "${BOT_KEY:-}" ]] && [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "ERROR: No bot token found. Set BOT_key, BOT_KEY, or TELEGRAM_BOT_TOKEN in $ENV_FILE"
  exit 1
fi

mkdir -p "$(dirname "$LOG")" "$(dirname "$PID_FILE")"

LAUNCHD_LABEL="com.webboxes.assimilator-bot"
LAUNCHD_SERVICE="gui/$(id -u)/$LAUNCHD_LABEL"
if launchctl print "$LAUNCHD_SERVICE" >/dev/null 2>&1; then
  echo "LaunchAgent $LAUNCHD_LABEL is loaded; restarting via launchctl instead of starting a second poller..."
  pkill -f "@assimilator/telegram" 2>/dev/null || true
  pkill -f "tsx.*telegram/bot" 2>/dev/null || true
  pkill -f "tsx apps/telegram" 2>/dev/null || true
  launchctl kickstart -k "$LAUNCHD_SERVICE"
  sleep 2
  echo "Restarted $LAUNCHD_LABEL."
  exit 0
fi

# Stop existing instance first
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing bot (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

echo "Starting ASSIMILATOR Telegram bot..."
echo "  Workspace : $ASSIMILATOR_WORKSPACE"
echo "  Log      : $LOG"
echo "  Bot dir  : $APP_DIR"

cd "$APP_DIR"

# Kill any stale direct-tsx or pnpm-wrapper instances before restarting
pkill -f "@assimilator/telegram" 2>/dev/null || true
pkill -f "tsx.*telegram/bot" 2>/dev/null || true
pkill -f "tsx apps/telegram" 2>/dev/null || true
sleep 1

# Run direct tsx entrypoint with explicit env so the child always gets the token
nohup env \
  BOT_key="${BOT_key:-${BOT_KEY:-${TELEGRAM_BOT_TOKEN:-}}}" \
  ASSIMILATOR_WORKSPACE="$ASSIMILATOR_WORKSPACE" \
  "$APP_DIR/node_modules/.bin/tsx" "$APP_DIR/apps/telegram/bot.ts" \
  >> "$LOG" 2>&1 &
BOT_PID=$!

echo $BOT_PID > "$PID_FILE"
echo "Bot started with PID $BOT_PID"
echo "Log: $LOG"
