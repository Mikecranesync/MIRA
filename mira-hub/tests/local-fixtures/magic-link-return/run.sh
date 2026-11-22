#!/bin/bash
# Browser proof that email sign-in returns a technician to the cited manual
# page (#5753, follow-up to #5751). TEST ONLY, local only: a disposable
# PostgreSQL 16, one synthetic user, tenant and PDF, a local production Hub,
# and a Node preload that captures the sign-in email instead of sending it.
#
#   cd mira-hub && bash tests/local-fixtures/magic-link-return/run.sh
#
# Options (environment):
#   MLR_SKIP_BUILD=1   reuse .next (it must be built with the flags below)
#   MLR_PGBIN=<dir>    PostgreSQL 16 bin directory (searched for otherwise)
#   MLR_PORT           Hub port (3953)
#
# Isolation (#5795 review):
#   - The database listens on no TCP port at all, only on a Unix socket inside
#     a private (0700) temp directory, and every role needs a per-run
#     scram-sha-256 password. The Hub connects as a non-superuser role.
#   - Refuses to start if the Hub directory holds a dotenv file, because Next
#     would load it in build and start (checked before every build and start).
#   - The server starts with an allowlisted environment (env -i) and a fresh
#     random AUTH_SECRET. Its Resend key is a dummy, and the preload allows only
#     its own port and the one database socket.
#   - Passwords are passed by environment or file, never on a command line,
#     and never printed.
set -euo pipefail

HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$HUB_DIR/tests/local-fixtures/magic-link-return"
cd "$HUB_DIR"

PORT="${MLR_PORT:-3953}"
PG_PORT=55753          # only names the socket file; nothing listens on TCP
EXPECTED_TESTS=4
umask 077
TMP_ROOT="${TMPDIR:-/tmp}"
WORK="$(mktemp -d "${TMP_ROOT%/}/mlr.XXXXXX")"
chmod 700 "$WORK"
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

# Next loads these from the project directory in both build and start.
refuse_dotenv() {
  # shellcheck disable=SC2016  # the single-quoted text is JavaScript, not shell
  node -e '
    const found = require(process.argv[1]).findDotenv(process.argv[2]);
    if (found.length) {
      console.error(`refusing to run: ${process.argv[2]} contains dotenv file(s) ${found.join(", ")} that Next would load. Move them aside; this test never reads real settings.`);
      process.exit(3);
    }
  ' "$HUB_DIR/tests/local-fixtures/harness/fixture-harness.cjs" "$HUB_DIR"
}

random_hex() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

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

refuse_dotenv
PGBIN="$(find_pgbin)" || { echo "PostgreSQL 16 not found; set MLR_PGBIN" >&2; exit 1; }
random_hex > "$WORK/su.pw"
HUB_DB_PASSWORD="$(random_hex)"
"$PGBIN/initdb" -D "$WORK/pg" -U mlr --auth=scram-sha-256 --pwfile="$WORK/su.pw" -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/pg" -l "$WORK/pg.log" -w \
  -o "-p $PG_PORT -c listen_addresses= -c unix_socket_directories=$WORK -c unix_socket_permissions=0700" start >/dev/null
DB_SOCKET="$WORK/.s.PGSQL.$PG_PORT"
[ -S "$DB_SOCKET" ] || { echo "database socket missing: $DB_SOCKET" >&2; exit 1; }
# Self-checks, so a regression in the isolation fails the run instead of passing silently:
# nothing listens on TCP, and the socket refuses a connection without a password.
if (exec 3<>"/dev/tcp/127.0.0.1/$PG_PORT") 2>/dev/null; then
  echo "isolation check failed: the database accepts TCP on 127.0.0.1:$PG_PORT" >&2; exit 1
fi
if env -u PGPASSWORD -u PGPASSFILE PGPASSFILE=/dev/null "$PGBIN/psql" -h "$WORK" -p "$PG_PORT" -U mlr -d postgres -w -Atc "select 1" >/dev/null 2>&1; then
  echo "isolation check failed: the database accepts a connection without a password" >&2; exit 1
fi
echo "database isolation: Unix socket only (dir mode $(stat -c %a "$WORK" 2>/dev/null || stat -f %Lp "$WORK")), no TCP listener, password required"
SOCK_Q="$(node -p 'encodeURIComponent(process.argv[1])' "$WORK")"
ADMIN_URL="postgresql://mlr:$(cat "$WORK/su.pw")@localhost:$PG_PORT/postgres?host=$SOCK_Q&sslmode=disable"
DB_URL="postgresql://mlr_hub:$HUB_DB_PASSWORD@localhost:$PG_PORT/mlr_e2e?host=$SOCK_Q&sslmode=disable"

MIRA_TEST_DB_CONFIRM=DISPOSABLE MLR_ADMIN_DATABASE_URL="$ADMIN_URL" MLR_DATABASE_URL="$DB_URL" \
  MLR_HUB_DB_PASSWORD="$HUB_DB_PASSWORD" node "$HERE/seed.mjs"
unset ADMIN_URL

AUTH_SECRET_VALUE="$(random_hex)"
BUILD_ENV=(
  "NEXT_PUBLIC_BASE_PATH="
  "NEXT_PUBLIC_API_BASE="
  "AUTH_SECRET=$AUTH_SECRET_VALUE"
  "NODE_ENV=production"
  "NEXT_TELEMETRY_DISABLED=1"
)
if [ "${MLR_SKIP_BUILD:-0}" != "1" ]; then
  refuse_dotenv
  env -i PATH="$PATH" HOME="$HOME" "${BUILD_ENV[@]}" ./node_modules/.bin/next build
fi

MAIL="$WORK/mail.jsonl"
: > "$MAIL"
refuse_dotenv
env -i PATH="$PATH" HOME="$HOME" "${BUILD_ENV[@]}" \
  NEXTAUTH_URL="http://127.0.0.1:$PORT" \
  NEON_DATABASE_URL="$DB_URL" \
  RESEND_API_KEY="re_e2e_capture_only_not_a_key" \
  MLR_MAIL_CAPTURE="$MAIL" \
  MLR_ALLOW_HUB_PORT="$PORT" \
  MLR_ALLOW_DB_SOCKET="$DB_SOCKET" \
  NODE_OPTIONS="--require $HERE/mail-capture.cjs" \
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
  npx playwright test --config tests/local-fixtures/magic-link-return/playwright.config.ts --reporter=list,json || status=$?

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
