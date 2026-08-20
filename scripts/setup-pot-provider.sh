#!/usr/bin/env bash
# Set up the YouTube PO-token provider (bgutil) for Assimilator.
#
# Since Aug 2026 YouTube intermittently returns 403 to yt-dlp clients that
# lack a Proof-of-Origin (PO) token. This installs and runs a local Botguard
# token server (deno, port 4416) that yt-dlp queries automatically via the
# bgutil-ytdlp-pot-provider plugin installed in .venv.
#
# Requirements: deno (brew install deno), .venv with yt-dlp + plugins.
#   Run scripts/setup-python-tools.sh first if .venv is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOME="${BGUTIL_HOME:-$HOME/bgutil-ytdlp-pot-provider}"
REPO_URL="https://github.com/Brainicism/bgutil-ytdlp-pot-provider"
PLIST="$HOME/Library/LaunchAgents/com.webboxes.bgutil-pot-provider.plist"

echo "==> Ensuring python plugins in .venv"
"$ROOT/.venv/bin/pip" install -q -U bgutil-ytdlp-pot-provider yt-dlp 2>/dev/null || true
"$ROOT/.venv/bin/pip" install -q -U bgutil-ytdlp-pot-provider yt-dlp

echo "==> Verifying yt-dlp sees the bgutil PO provider"
"$ROOT/.venv/bin/yt-dlp" --verbose 2>&1 | grep -iE "PO Token Providers: bgutil" | head -2 || {
  echo "⚠️  bgutil provider not visible. Check: $ROOT/.venv/bin/pip list | grep bgutil"
}

echo "==> Ensuring provider server at $SERVER_HOME"
if [[ ! -f "$SERVER_HOME/server/src/main.ts" ]]; then
  git clone --depth 1 "$REPO_URL" "$SERVER_HOME"
fi
(cd "$SERVER_HOME/server" && npm install --no-audit --no-fund >/dev/null 2>&1 || true)

echo "==> Installing launchd agent (port 4416)"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.webboxes.bgutil-pot-provider</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/deno</string>
    <string>run</string>
    <string>--allow-env</string>
    <string>--allow-net</string>
    <string>--allow-ffi=.</string>
    <string>--allow-read=.</string>
    <string>--allow-write=.</string>
    <string>${SERVER_HOME}/server/src/main.ts</string>
    <string>--port</string>
    <string>4416</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SERVER_HOME}/server</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/Users/musichen/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${HOME}/.hermes/logs/bgutil-provider.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.hermes/logs/bgutil-provider.err</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
PLISTEOF

launchctl bootout gui/$(id -u)/com.webboxes.bgutil-pot-provider 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$PLIST" 2>/dev/null || launchctl load "$PLIST"

echo "==> Waiting for token server on :4416"
for i in $(seq 1 12); do
  if curl -s --max-time 3 http://127.0.0.1:4416/ping >/dev/null 2>&1; then
    echo "✅ bgutil PO-token server is up on http://127.0.0.1:4416"
    exit 0
  fi
  sleep 5
done

echo "⚠️  Token server not responding. Check: cat ~/.hermes/logs/bgutil-provider.err"
exit 1
