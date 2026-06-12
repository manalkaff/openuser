#!/usr/bin/env bash
# scripts/test-pack.sh — build → pack → install → smoke-test
# Verifies the published openuser package works from a clean install.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_PORT=8799
TMP_DIR=""
DAEMON_PID=""

cleanup() {
  if [[ -n "$DAEMON_PID" ]] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "[test-pack] Stopping daemon (pid $DAEMON_PID)…"
    kill "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

# ── 1. Full release build ────────────────────────────────────────────────────
echo "[test-pack] Running pnpm build:release…"
cd "$REPO_ROOT"
pnpm build:release

# ── 2. Pack ─────────────────────────────────────────────────────────────────
echo "[test-pack] Packing openuser…"
cd "$REPO_ROOT/packages/cli"
TARBALL_NAME=$(pnpm pack --pack-destination "$REPO_ROOT/packages/cli" 2>/dev/null | tail -1)
# pnpm pack prints the full path; get just the filename
TARBALL_PATH="$TARBALL_NAME"
if [[ ! -f "$TARBALL_PATH" ]]; then
  # Try in current dir
  TARBALL_PATH="$REPO_ROOT/packages/cli/$(ls "$REPO_ROOT/packages/cli"/openuser-*.tgz 2>/dev/null | head -1 | xargs basename)"
fi
echo "[test-pack] Tarball: $TARBALL_PATH"
if [[ ! -f "$TARBALL_PATH" ]]; then
  echo "[test-pack] ERROR: tarball not found after pnpm pack"
  exit 1
fi

# ── 3. Install into isolated temp dir ───────────────────────────────────────
TMP_DIR="$(mktemp -d)"
INSTALL_DIR="$TMP_DIR/install"
mkdir -p "$INSTALL_DIR"
echo "[test-pack] Installing into $INSTALL_DIR…"
cd "$INSTALL_DIR"
# Create minimal package.json so npm install works
cat > package.json <<'JSON'
{"name":"openuser-smoke","version":"0.0.0","private":true}
JSON
npm install --save "$TARBALL_PATH" --no-fund --no-audit 2>&1

# Locate the openuser binary
OPENUSER_BIN="$INSTALL_DIR/node_modules/.bin/openuser"
if [[ ! -f "$OPENUSER_BIN" ]]; then
  echo "[test-pack] ERROR: openuser binary not found at $OPENUSER_BIN"
  ls "$INSTALL_DIR/node_modules/.bin/" || true
  exit 1
fi
echo "[test-pack] Binary: $OPENUSER_BIN"

# ── 4. Doctor (informational, don't fail on missing deps) ───────────────────
echo "[test-pack] Running openuser doctor…"
"$OPENUSER_BIN" doctor || true

# ── 5. Start daemon in foreground in background ─────────────────────────────
echo "[test-pack] Starting daemon on port $TEST_PORT…"
OPENUSER_HOME="$TMP_DIR/.openuser" "$OPENUSER_BIN" start --no-open --port "$TEST_PORT" &
DAEMON_PID=$!
echo "[test-pack] Daemon pid: $DAEMON_PID"

# ── 6. Poll /api/health ─────────────────────────────────────────────────────
echo "[test-pack] Polling http://127.0.0.1:${TEST_PORT}/api/health…"
HEALTH_OK=false
for i in $(seq 1 20); do
  sleep 0.5
  RESPONSE=$(curl -sf "http://127.0.0.1:${TEST_PORT}/api/health" 2>/dev/null || true)
  if echo "$RESPONSE" | grep -q '"ok":true'; then
    HEALTH_OK=true
    echo "[test-pack] Health check passed (attempt $i): $RESPONSE"
    break
  fi
done

if [[ "$HEALTH_OK" != "true" ]]; then
  echo "[test-pack] ERROR: /api/health did not return {\"ok\":true} within 10 seconds"
  exit 1
fi

# ── 7. Check GET / returns HTML ─────────────────────────────────────────────
echo "[test-pack] Checking GET / returns HTML…"
DASHBOARD=$(curl -sf "http://127.0.0.1:${TEST_PORT}/" 2>/dev/null || true)
if ! echo "$DASHBOARD" | grep -qi "<html"; then
  echo "[test-pack] ERROR: GET / did not return HTML"
  echo "[test-pack] Response: ${DASHBOARD:0:200}"
  exit 1
fi
echo "[test-pack] Dashboard HTML check passed."

# ── 8. All checks passed ─────────────────────────────────────────────────────
echo "[test-pack] All checks passed."
