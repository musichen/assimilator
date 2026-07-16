#!/usr/bin/env bash
# Stop the ASSIMILATOR Telegram bot

set -euo pipefail

APP_DIR="$HOME/apps/assimilator"
PID_FILE="$HOME/.hermes/run/assimilator-bot.pid"
LOG="$HOME/.hermes/logs/assimilator-bot.log"

# Kill by PID file
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping bot (PID $PID)..."
    kill "$PID" 2>/dev/null
    sleep 1
    # Also kill children
    pkill -P "$PID" 2>/dev/null || true
    echo "Stopped."
  else
    echo "Bot not running (stale PID file)."
  fi
  rm -f "$PID_FILE"
else
  echo "No PID file. Looking for processes..."
fi

# Fallback: find by process name
FOUND=0
for PID in $(pgrep -f "tsx.*telegram/bot|tsx apps/telegram/bot|assimilator.*telegram|@assimilator/telegram" 2>/dev/null || true); do
  echo "Killing process $PID..."
  kill "$PID" 2>/dev/null || true
  FOUND=1
done

if [[ $FOUND -eq 0 ]]; then
  echo "No ASSIMILATOR bot processes found."
fi

# Also kill port listeners if any
for PORT in 3100; do
  lsof -i :"$PORT" -t 2>/dev/null | xargs kill 2>/dev/null || true
done

echo "Done."
