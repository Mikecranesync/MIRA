#!/usr/bin/env bash
# Evidence run for the #3800 minimum recovery stack. Pure HTTP against a
# running Hub + `docker` for restart/measurement. Prints a sanitized report
# (no cookies, no secrets) suitable for pasting into the PR/issue.
#
# Inputs (from two `scripts/provision-beta-gate.ts` runs, stranger A and B):
#   HUB                 base URL, default http://127.0.0.1:3101
#   GATE_ENV_A          file with the ENV: lines for stranger A (required)
#   GATE_ENV_B          file with the ENV: lines for stranger B (tenant isolation)
#   HUB_CONTAINER       docker container name, default mira-hub (restart test)
#   SKIP_RESTART=1      skip the restart-persistence step
#
# Each check prints PASS/FAIL and the script exits non-zero if any FAIL.
# shellcheck disable=SC2015,SC2153  # pass/fail never fail; COOKIE_A is set via printf -v
set -uo pipefail

HUB="${HUB:-http://127.0.0.1:3101}"
CONTAINER="${HUB_CONTAINER:-mira-hub}"
FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
need() { command -v "$1" >/dev/null || { echo "missing tool: $1" >&2; exit 2; }; }
need curl; need python3; need docker

load_env() { # $1 file, $2 suffix -> sets COOKIE_<suffix>, NODE_<suffix>, UPLOAD_<suffix>, CHAT_<suffix>, TENANT_<suffix>
  local f="$1" s="$2" line k v
  [ -f "$f" ] || { echo "gate env file not found: $f" >&2; exit 2; }
  while IFS= read -r line; do
    case "$line" in ENV:*) ;; *) continue ;; esac
    k="${line#ENV:}"; v="${k#*=}"; k="${k%%=*}"
    case "$k" in
      BETA_GATE_COOKIE) printf -v "COOKIE_$s" '%s' "$v" ;;
      BETA_GATE_NODE) printf -v "NODE_$s" '%s' "$v" ;;
      BETA_GATE_UPLOAD_URL) printf -v "UPLOAD_$s" '%s' "$v" ;;
      BETA_GATE_CHAT_URL) printf -v "CHAT_$s" '%s' "$v" ;;
      BETA_GATE_TENANT) printf -v "TENANT_$s" '%s' "$v" ;;
    esac
  done < "$f"
}
load_env "${GATE_ENV_A:?GATE_ENV_A required}" A
[ -n "${GATE_ENV_B:-}" ] && load_env "$GATE_ENV_B" B

j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "== recovery verify @ $(date -u +%FT%TZ) hub=$HUB"

# 1. health + build identity
H="$(curl -s "$HUB/api/health/")"
SHA="$(printf '%s' "$H" | j "d.get('gitSha')")"
[ -n "$SHA" ] && pass "health 200, gitSha=$SHA, version=$(printf '%s' "$H" | j "d.get('version')")" || fail "health: $H"

# 2. login: the provisioned session cookie authenticates /api/me
ME="$(code -H "Cookie: $COOKIE_A" "$HUB/api/me/")"
[ "$ME" = 200 ] && pass "login: /api/me 200 with stranger-A session" || fail "login: /api/me $ME"
[ "$(code "$HUB/api/me/")" = 401 ] && pass "unauthenticated /api/me is 401" || fail "unauthenticated /api/me not 401"

# 3. project/thread: create a notebook, send a streamed general turn, reload history
NB="$(curl -s -H "Cookie: $COOKIE_A" -H 'Content-Type: application/json' \
      -d '{"displayName":"Recovery verify notebook"}' "$HUB/api/equipment-notebooks/")"
NB_ID="$(printf '%s' "$NB" | j "d.get('notebook',d).get('id')")"
[ -n "$NB_ID" ] && pass "project created: notebook $NB_ID" || fail "notebook create: $NB"

STREAM_HDR="$(mktemp)"; STREAM_BODY="$(mktemp)"
curl -s -N -D "$STREAM_HDR" -o "$STREAM_BODY" -m 120 -H "Cookie: $COOKIE_A" -H 'Content-Type: application/json' \
  -d '{"message":"In one sentence, what is a VFD overcurrent fault?","mode":"general","history":[]}' \
  "$HUB/api/equipment-notebooks/$NB_ID/chat/"
CT="$(grep -i '^content-type:' "$STREAM_HDR" | tr -d '\r' | awk '{print tolower($2)}')"
EVENTS="$(grep -c '^data:' "$STREAM_BODY")"
if [[ "$CT" == text/event-stream* ]] && [ "$EVENTS" -gt 1 ]; then
  pass "streamed chat: content-type=$CT events=$EVENTS bytes=$(wc -c < "$STREAM_BODY")"
else
  fail "streamed chat: content-type=$CT events=$EVENTS body_head=$(head -c 300 "$STREAM_BODY")"
fi

HIST="$(curl -s -H "Cookie: $COOKIE_A" "$HUB/api/equipment-notebooks/$NB_ID/")"
TURNS="$(printf '%s' "$HIST" | j "len(d.get('turns',[]))")"
[ "${TURNS:-0}" -ge 1 ] && pass "history saved+reloaded: $TURNS turn(s) on GET" || fail "history: turns=$TURNS"

# 4. uploads → the beta gate already proved upload→cited answer; here prove the
#    document is retrievable as bytes from the tenant's file door.
FILES="$(curl -s -H "Cookie: $COOKIE_A" "$UPLOAD_A")"
FILE_ID="$(printf '%s' "$FILES" | j "(d.get('files') or [{}])[0].get('id')")"
FILE_NAME="$(printf '%s' "$FILES" | j "(d.get('files') or [{}])[0].get('filename')")"
if [ -n "$FILE_ID" ]; then
  FH="$(mktemp)"; curl -s -D "$FH" -o /dev/null -H "Cookie: $COOKIE_A" "$HUB/api/namespace/files/$FILE_ID/"
  FCODE="$(head -1 "$FH" | awk '{print $2}')"; FCT="$(grep -i '^content-type:' "$FH" | tr -d '\r' | awk '{print $2}')"
  FLEN="$(grep -i '^content-length:' "$FH" | tr -d '\r' | awk '{print $2}')"
  [ "$FCODE" = 200 ] && pass "document access: $FILE_NAME -> $FCODE $FCT ${FLEN:-?} bytes (Neon BYTEA, not local disk)" || fail "document access: $FCODE"
else
  fail "no uploaded file listed at $UPLOAD_A (run the beta gate first)"
fi

# 5. tenant isolation: stranger B must not see A's node files, notebook, or bytes
if [ -n "${COOKIE_B:-}" ]; then
  C1="$(code -H "Cookie: $COOKIE_B" "$UPLOAD_A")"
  C2="$(code -H "Cookie: $COOKIE_B" "$HUB/api/equipment-notebooks/$NB_ID/")"
  C3="$([ -n "$FILE_ID" ] && code -H "Cookie: $COOKIE_B" "$HUB/api/namespace/files/$FILE_ID/" || echo skip)"
  if [[ "$C1" =~ ^(403|404)$ ]] && [[ "$C2" =~ ^(403|404)$ ]] && [[ "$C3" =~ ^(403|404|skip)$ ]]; then
    pass "tenant isolation: B sees A's files=$C1 notebook=$C2 bytes=$C3"
  else
    fail "tenant isolation: B sees A's files=$C1 notebook=$C2 bytes=$C3"
  fi
else
  echo "SKIP  tenant isolation (no GATE_ENV_B)"
fi

# 6. restart persistence
if [ "${SKIP_RESTART:-0}" != 1 ]; then
  docker restart "$CONTAINER" >/dev/null
  for _ in $(seq 1 40); do [ "$(code "$HUB/api/auth/csrf/")" = 200 ] && break; sleep 3; done
  T2="$(curl -s -H "Cookie: $COOKIE_A" "$HUB/api/equipment-notebooks/$NB_ID/" | j "len(d.get('turns',[]))")"
  F2="$([ -n "$FILE_ID" ] && code -H "Cookie: $COOKIE_A" "$HUB/api/namespace/files/$FILE_ID/" || echo skip)"
  [ "${T2:-0}" -ge 1 ] && [[ "$F2" =~ ^(200|skip)$ ]] && pass "restart persistence: turns=$T2 file=$F2 after docker restart" || fail "restart persistence: turns=$T2 file=$F2"
fi

# 7. footprint
echo "== footprint"
docker stats --no-stream --format 'container={{.Name}} mem={{.MemUsage}} cpu={{.CPUPerc}}' "$CONTAINER"
docker image ls --format 'image={{.Repository}}:{{.Tag}} size={{.Size}}' | grep -i 'mira-hub' | head -3
docker system df --format 'docker_disk: {{.Type}} {{.Size}}' | head -3

echo "== result: $FAILS failure(s)"
exit "$FAILS"
