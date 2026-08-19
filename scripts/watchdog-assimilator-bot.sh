#!/usr/bin/env bash
# Watchdog loop for ASSIMILATOR Telegram bot
# Keeps the bot alive — restarts on any exit

set -euo pipefail

export HOME="/Users/musichen"
export APP_DIR="$HOME/apps/assimilator"
export LOG="$HOME/.hermes/logs/assimilator-watchdog.log"
export PID_FILE="$HOME/.hermes/run/assimilator-bot.pid"
export PATH="/Users/musichen/.hermes/node/bin:/Users/musichen/.local/bin:/Users/musichen/.nvm/versions/node/v24.14.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Load env
source "$APP_DIR/.env" 2>/dev/null || true
source "$APP_DIR/.env.local" 2>/dev/null || true

# Force IPv4: this network's IPv6 is broken and node's IPv6-first DNS
# resolution causes EFATAL read ETIMEDOUT in the Telegram long-poll.
# Note: avoid a leading space when NODE_OPTIONS was previously unset —
# an empty token breaks node's option parsing.
if [[ -n "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --dns-result-order=ipv4first"
else
  export NODE_OPTIONS="--dns-result-order=ipv4first"
fi

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

  # Liveness watchdog: if the bot process is alive but its Telegram polling
  # loop is dead (EFATAL crash leaves the process running), restart it.
  # Check every 120s that the bot still responds to Telegram getMe. If not,
  # kill the zombie so the restart loop kicks in.
  LIVENESS_INTERVAL=120
  while kill -0 "$BOT_PID" 2>/dev/null; do
    sleep "$LIVENESS_INTERVAL"
    # Bot process gone? Loop exits and wait below reaps the exit code.
    kill -0 "$BOT_PID" 2>/dev/null || break
    # Check if bot is alive via Telegram getMe API
    if ! curl -s --connect-timeout 10 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" | grep -q '"ok":true'; then
      sleep 10
      kill -0 "$BOT_PID" 2>/dev/null || break
      if ! curl -s --connect-timeout 10 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" | grep -q '"ok":true'; then
        echo "[watchdog][$(date +%H:%M:%S)] Liveness check FAILED — bot not responding, killing zombie"
        kill -9 "$BOT_PID" 2>/dev/null || true
        break
      fi
    fi
  done

  wait "$BOT_PID" 2>/dev/null
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
