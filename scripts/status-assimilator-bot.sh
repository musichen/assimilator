#!/usr/bin/env bash
# Check ASSIMILATOR Telegram bot status

set -euo pipefail

APP_DIR="$HOME/apps/assimilator"
PID_FILE="$HOME/.hermes/run/assimilator-bot.pid"
LOG="$HOME/.hermes/logs/assimilator-watchdog.log"

echo "═══════════════════════════════"
echo "  ASSIMILATOR Bot — Status"
echo "═══════════════════════════════"

# PID check
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  PID    : $PID (running)"
  else
    echo "  PID    : $PID (stale)"
  fi
else
  echo "  PID    : no PID file"
fi

# Process check
PIDS=$(pgrep -f "tsx.*telegram/bot|tsx apps/telegram/bot|@assimilator/telegram" 2>/dev/null | tr '\n' ' ' || true)
if [[ -n "$PIDS" ]]; then
  echo "  Found  : pids $PIDS"
else
  echo "  Found  : none"
fi

# Log tail
if [[ -f "$LOG" ]]; then
  echo ""
  echo "  Last 8 log lines:"
  echo "  ───────────────────────────"
  tail -8 "$LOG" | sed 's/^/  /'
else
  echo "  Log   : $LOG (not found)"
fi

echo ""
