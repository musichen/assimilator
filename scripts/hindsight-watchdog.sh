#!/usr/bin/env bash
# Hindsight health watchdog.
#
# Watches for the two failure modes that have actually burned us:
#   1. CPU burn: a stuck async operation looping for hours (the 775% CPU
#      incident, Aug 12-20 2026).
#   2. Hung operations: retain/consolidation stuck in 'processing' or
#      'pending' longer than 30 minutes.
#
# Prints a report ONLY when something is wrong (watchdog pattern: silent
# when healthy). Designed to run from cron/launchd every 15-30 minutes.
set -uo pipefail

LOG="${HINDSIGHT_WATCHDOG_LOG:-$HOME/.hermes/logs/hindsight-watchdog.log}"
PG=/Users/musichen/.pg0/installation/18.1.0/bin/psql
API_URL="http://127.0.0.1:8888/health"
MAX_CPU=300          # percent across all hindsight-api processes (4 cores = 400)
MAX_OP_AGE_MIN=30    # operations stuck longer than this are suspicious

report=""

# --- 1. API health ---
if ! curl -s --max-time 8 "$API_URL" 2>/dev/null | grep -q '"healthy"'; then
  report="${report}❌ Hindsight API is DOWN or unhealthy\n"
fi

# --- 2. CPU burn ---
TOTAL_CPU=0
for pid in $(pgrep -f "hindsight-api --port 8888" 2>/dev/null); do
  C=$(ps -o %cpu= -p "$pid" 2>/dev/null | tr -d ' ' | cut -d. -f1)
  [ -n "$C" ] && TOTAL_CPU=$((TOTAL_CPU + C))
done
if [ "$TOTAL_CPU" -gt "$MAX_CPU" ]; then
  report="${report}⚠️  Hindsight CPU burn: ${TOTAL_CPU}% (stuck operation?)\n"
fi

# --- 3. Hung async operations ---
if [ -x "$PG" ]; then
  HUNG=$("$PG" -p 5432 -U hindsight -d hindsight -tA -c \
    "SELECT operation_type || ' ' || status || ' since ' || created_at::timestamp(0)
     FROM async_operations
     WHERE status IN ('processing','pending')
       AND created_at < now() - interval '${MAX_OP_AGE_MIN} minutes'
     ORDER BY created_at LIMIT 5;" 2>/dev/null)
  if [ -n "$HUNG" ]; then
    report="${report}⚠️  Hung operations (>${MAX_OP_AGE_MIN} min):\n${HUNG}\n"
  fi
fi

# --- Report ---
if [ -n "$report" ]; then
  printf "[%s]\n%b" "$(date '+%Y-%m-%d %H:%M:%S')" "$report" | tee -a "$LOG"
else
  # Healthy: write one line to log (timestamp only), keep it quiet on stdout
  echo "$(date '+%Y-%m-%d %H:%M:%S') OK cpu=${TOTAL_CPU}% ops=clean" >> "$LOG"
fi
