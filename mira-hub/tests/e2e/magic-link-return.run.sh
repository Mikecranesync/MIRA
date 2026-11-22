#!/bin/bash
# Browser proof that email sign-in returns a technician to the cited manual
# page (#5753, follow-up to #5751). Local only: a disposable PostgreSQL 16, one
# synthetic user, tenant and PDF, a local production Hub, and a Node preload
# that captures the sign-in email instead of sending it.
#
#   cd mira-hub && bash tests/e2e/magic-link-return.run.sh
#
# Options (environment):
#   MLR_SKIP_BUILD=1   reuse .next (it must be built with the flags below)
#   MLR_PGBIN=<dir>    PostgreSQL 16 bin directory (searched for otherwise)
#   MLR_PORT / MLR_PG_PORT   Hub and database ports (3953 / 55753)
#
# No secret is needed or read. The server starts with an allowlisted
# environment (env -i), so a Doppler or shell secret can never reach it; the
# Resend key it holds is a dummy, and the preload never lets a request reach
# Resend or any other non-loopback host.
set -euo pipefail

HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$HUB_DIR"

PORT="${MLR_PORT:-3953}"
PG_PORT="${MLR_PG_PORT:-55753}"
EXPECTED_TESTS=4
AUTH_SECRET_VALUE="cc-e2e-fixed-secret-do-not-use-in-prod"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/magic-link-return.XXXXXX")"
SERVER_PID=""
PGBIN=""

# shellcheck disable=SC2329  # invoked by the EXIT trap below
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$PGBIN" ] && [ -f "$WORK/pg/postmaster.pid" ]; then
    "$PGBIN/pg_ctl" -D "$WORK/pg" -m fast -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

find_pgbin() {
  local dir
  for dir in "${MLR_PGBIN:-}" /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin /usr/lib/postgresql/16/bin; do
    if [ -n "$dir" ] && [ -x "$dir/initdb" ] && "$dir/postgres" --version | grep -q ' 16\.'; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

PGBIN="$(find_pgbin)" || { echo "PostgreSQL 16 not found; set MLR_PGBIN" >&2; exit 1; }
"$PGBIN/initdb" -D "$WORK/pg" -U mlr --auth=trust -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/pg" -l "$WORK/pg.log" -w \
  -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=" start >/dev/null
"$PGBIN/createdb" -h 127.0.0.1 -p "$PG_PORT" -U mlr mlr_e2e
DB_URL="postgres://mlr@127.0.0.1:$PG_PORT/mlr_e2e"

MIRA_TEST_DB_CONFIRM=DISPOSABLE MLR_DATABASE_URL="$DB_URL" node tests/e2e/magic-link-return.seed.mjs

BUILD_ENV=(
  "NEXT_PUBLIC_BASE_PATH="
  "NEXT_PUBLIC_API_BASE="
  "AUTH_SECRET=$AUTH_SECRET_VALUE"
  "NODE_ENV=production"
  "NEXT_TELEMETRY_DISABLED=1"
)
if [ "${MLR_SKIP_BUILD:-0}" != "1" ]; then
  env -i PATH="$PATH" HOME="$HOME" "${BUILD_ENV[@]}" ./node_modules/.bin/next build
fi

MAIL="$WORK/mail.jsonl"
: > "$MAIL"
env -i PATH="$PATH" HOME="$HOME" "${BUILD_ENV[@]}" \
  NEXTAUTH_URL="http://127.0.0.1:$PORT" \
  NEON_DATABASE_URL="$DB_URL?sslmode=disable" \
  RESEND_API_KEY="re_e2e_capture_only_not_a_key" \
  MLR_MAIL_CAPTURE="$MAIL" \
  NODE_OPTIONS="--require $HUB_DIR/tests/e2e/fixtures/magic-link-mail-capture.cjs" \
  ./node_modules/.bin/next start -p "$PORT" -H 127.0.0.1 >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login/" 2>/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then cat "$WORK/server.log" >&2; exit 1; fi
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login/"

status=0
MLR_HUB_URL="http://127.0.0.1:$PORT" MLR_MAIL_CAPTURE="$MAIL" \
  PLAYWRIGHT_JSON_OUTPUT_NAME="$WORK/report.json" \
  npx playwright test tests/e2e/magic-link-return.spec.ts --reporter=list,json || status=$?

if [ "$status" -ne 0 ]; then
  echo "---- last Hub server log lines ----" >&2
  tail -n 40 "$WORK/server.log" >&2
fi

# A green run must mean every test ran and passed: no skips, no missing tests.
# shellcheck disable=SC2016  # the single-quoted text is JavaScript, not shell
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const s = r.stats, want = Number(process.argv[2]);
  console.log(`magic-link-return: expected=${s.expected} unexpected=${s.unexpected} skipped=${s.skipped} flaky=${s.flaky} (want ${want} passed)`);
  if (s.expected !== want || s.unexpected || s.skipped || s.flaky) process.exit(1);
' "$WORK/report.json" "$EXPECTED_TESTS" || status=1

exit "$status"
