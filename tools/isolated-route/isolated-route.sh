#!/usr/bin/env bash
# Isolated safety-build route (#4372, Mike decision 4).
#
# Runs ONE non-main integration commit (a `stg-combined/<date>` branch tip) as a
# hub on its own loopback port with its own disposable Postgres, next to — never
# inside — the co-hosted staging (factorylm-staging) and production stacks.
#
#   isolated-route.sh up --sha <40-hex> [--floors enforce|shadow] [--schema]
#   isolated-route.sh down
#   isolated-route.sh status
#
# Refusals are enforced HERE (the workflow is a thin wrapper); each is a STOP:
#   - --sha must be 40 lowercase hex, and MIRA_ISO_APPROVED_SHA must equal it
#   - the SHA must NOT be reachable from main (main builds go through
#     deploy-staging.yml) and MUST be the tip of a stg-combined/* branch
#   - MIRA_ISO_ROOT may never resolve into /opt/mira, /opt/mira-staging or
#     /opt/mira-preview, and its last component must start with `mira-iso`
#   - MIRA_ISO_PORT must sit in the reserved 4600-4699 band and be free
#   - iso-* names must be unowned by any other compose project
#   - every non-iso container (production AND staging) must have the identical
#     id/name/project/created/started set before and after
# It never reads Doppler, never touches another compose project, never runs a
# host-wide docker prune, and emits no staging-receipt (deploy-vps.yml cannot
# consume anything this route produces).
#
# Env: MIRA_ISO_APPROVED_SHA (up), MIRA_ISO_REMOTE (git URL, default GitHub),
#      MIRA_ISO_ROOT (default /opt/mira-iso), MIRA_ISO_PORT (default 4601),
#      MIRA_ISO_LLM_ENV_FILE (optional; allowlisted ISO_* LLM keys only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.isolated-route.yml"
PROJECT=mira-iso
REMOTE="${MIRA_ISO_REMOTE:-https://github.com/Mikecranesync/MIRA.git}"
ROOT="${MIRA_ISO_ROOT:-/opt/mira-iso}"
PORT="${MIRA_ISO_PORT:-4601}"
HUB_IMAGE_REPO=mira-iso-hub
# Images `up` may pull; `down` removes one only if `up` recorded it as absent.
PULLED_IMAGES="pgvector/pgvector:pg16 node:22-alpine"

die() { echo "ISO-REFUSE: $*" >&2; exit 1; }
log() { echo "iso: $*"; }

realpath_py() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }

check_root() {
  case "$ROOT" in /*) ;; *) die "MIRA_ISO_ROOT must be an absolute path" ;; esac
  local resolved
  resolved="$(realpath_py "$ROOT")"
  case "$resolved" in
    /opt/mira|/opt/mira/*|/opt/mira-staging|/opt/mira-staging/*|/opt/mira-preview|/opt/mira-preview/*)
      die "MIRA_ISO_ROOT resolves into a production/staging/preview path: $resolved" ;;
  esac
  case "$(basename "$resolved")" in
    mira-iso*) ;;
    *) die "MIRA_ISO_ROOT must end in a mira-iso* directory (got $resolved)" ;;
  esac
  ROOT="$resolved"
}

check_port() {
  [[ "$PORT" =~ ^46[0-9][0-9]$ ]] || die "MIRA_ISO_PORT must be in the reserved 4600-4699 band (got $PORT)"
}

dc() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ROOT/run.env" "$@"; }

# Every container that is NOT this project: production and factorylm-staging alike.
others_snapshot() {
  docker ps -aq | xargs -r docker inspect --format \
    '{{.Id}} {{.Name}} {{index .Config.Labels "com.docker.compose.project"}} {{.Created}} {{.State.StartedAt}}' \
    | grep -vE " ${PROJECT} " | sort || true
}

authorize() {
  local sha="$1"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "--sha must be exactly 40 lowercase hex characters"
  [ "${MIRA_ISO_APPROVED_SHA:-}" = "$sha" ] || \
    die "MIRA_ISO_APPROVED_SHA must equal --sha: approval is bound to this exact commit"
  local repo="$ROOT/repo.git"
  mkdir -p "$ROOT"
  [ -d "$repo" ] || git init -q --bare "$repo"
  git -C "$repo" fetch -q --no-tags --force "$REMOTE" \
    "+refs/heads/main:refs/heads/main" "+refs/heads/stg-combined/*:refs/heads/stg-combined/*" \
    || die "could not fetch main + stg-combined/* from $REMOTE (fail closed)"
  git -C "$repo" rev-parse -q --verify "refs/heads/main^{commit}" >/dev/null || die "remote has no main branch (fail closed)"
  git -C "$repo" cat-file -e "${sha}^{commit}" 2>/dev/null || die "SHA $sha is not a fetched commit"
  local rc=0
  git -C "$repo" merge-base --is-ancestor "$sha" refs/heads/main || rc=$?
  case "$rc" in
    0) die "SHA $sha is on main: main builds go through deploy-staging.yml, never this route" ;;
    1) ;;
    *) die "ancestry check failed (rc=$rc) — fail closed" ;;
  esac
  BRANCH="$(git -C "$repo" for-each-ref --format='%(objectname) %(refname:strip=2)' 'refs/heads/stg-combined/' \
    | awk -v s="$sha" '$1 == s { print $2; exit }')"
  [ -n "$BRANCH" ] || die "SHA $sha is not the tip of any stg-combined/* branch (provenance)"
  log "authorized $sha = tip of $BRANCH, not on main"
}

preflight_docker() {
  local name owner holder
  for name in iso-db iso-mira-hub; do
    owner="$(docker container inspect "$name" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
    owner="$(printf '%s' "$owner" | tr -d '[:space:]')"
    [ -z "$owner" ] || [ "$owner" = "$PROJECT" ] || die "container $name belongs to compose project '$owner'"
  done
  owner="$(docker network inspect iso-net --format '{{index .Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
  owner="$(printf '%s' "$owner" | tr -d '[:space:]')"
  [ -z "$owner" ] || [ "$owner" = "$PROJECT" ] || die "network iso-net belongs to compose project '$owner'"
  holder="$(docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}} {{.Ports}}' \
    | grep -E ":${PORT}->" | grep -vE " ${PROJECT} " | awk '{print $1}' || true)"
  [ -z "$holder" ] || die "port $PORT is published by '$holder'"
  if [ -z "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")" ] \
    && (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    die "port $PORT already has a listener on 127.0.0.1"
  fi
}

write_env() {
  local sha="$1" floors="$2" line
  ( umask 077
    {
      printf 'ISO_SRC=%s\nISO_SHA=%s\nISO_VERSION=%s\n' "$ROOT/src" "$sha" "${BRANCH//\//-}"
      printf 'ISO_BUILD_TIME=%s\nISO_PORT=%s\nISO_FLOORS_MODE=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PORT" "$floors"
      printf 'ISO_DB_PASSWORD=%s\nISO_AUTH_SECRET=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 32)"
      printf 'ISO_TENANT_ID=%s\n' "$(python3 -c 'import uuid; print(uuid.uuid4())')"
    } > "$ROOT/run.env" )
  if [ -n "${MIRA_ISO_LLM_ENV_FILE:-}" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in ''|'#'*) continue ;; esac
      [[ "$line" =~ ^ISO_(GROQ|CEREBRAS|TOGETHERAI|OPENAI)_API_KEY=.+$|^ISO_SEMANTIC_CHECK=[01]$|^ISO_OPENAI_RUN_BUDGET_USD=[0-9.]+$ ]] \
        || die "MIRA_ISO_LLM_ENV_FILE has a non-allowlisted line (${line%%=*})"
      printf '%s\n' "$line" >> "$ROOT/run.env"
    done < "$MIRA_ISO_LLM_ENV_FILE"
  fi
}

run_schema() {
  local pw
  pw="$(sed -n 's/^ISO_DB_PASSWORD=//p' "$ROOT/run.env")"
  # The candidate tree's own disposable-DB bootstrap (MIRA_TEST_DB_CONFIRM guard
  # included), against iso-db only — the one database this route owns. Files go
  # in over stdin (no host bind mount), so nothing else on the host is visible.
  tar -C "$ROOT/src/mira-hub" -cf - scripts/setup-integration-db.mjs db \
    | docker run --rm -i --network iso-net --label factorylm.isolated-route=1 \
      -e "TEST_DATABASE_URL=postgres://iso:${pw}@iso-db:5432/iso?sslmode=no-verify" \
      -e MIRA_TEST_DB_CONFIRM=DISPOSABLE node:22-alpine sh -c \
      'mkdir -p /w && tar -x -C /w && cd /w && npm init -y >/dev/null && npm i --no-audit --no-fund pg@8.20.0 >/dev/null && node scripts/setup-integration-db.mjs' \
    || die "schema bootstrap on iso-db failed (run: $0 down)"
}

cmd_up() {
  local sha="" floors=enforce schema=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --sha) sha="${2:-}"; shift 2 ;;
      --floors) floors="${2:-}"; shift 2 ;;
      --schema) schema=1; shift ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  case "$floors" in enforce|shadow) ;; *) die "--floors must be enforce or shadow" ;; esac
  check_root; check_port
  authorize "$sha"
  preflight_docker
  local before after img
  before="$(others_snapshot)"
  : > "$ROOT/pulled-images"
  for img in $PULLED_IMAGES; do
    docker image inspect "$img" >/dev/null 2>&1 || echo "$img" >> "$ROOT/pulled-images"
  done
  rm -rf "$ROOT/src"; mkdir -p "$ROOT/src"
  git -C "$ROOT/repo.git" archive "$sha" | tar -x -C "$ROOT/src"
  write_env "$sha" "$floors"
  ( unset OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_HEADERS; DOCKER_BUILDKIT=1 dc build --pull iso-mira-hub )
  dc up -d --remove-orphans
  [ "$schema" = 1 ] && run_schema
  local _ got=""
  for _ in $(seq 1 40); do
    got="$(curl -sfL "http://127.0.0.1:$PORT/api/version" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("gitSha",""))' 2>/dev/null || true)"
    [ -n "$got" ] && break
    sleep 3
  done
  [ "$got" = "$sha" ] || die "iso-mira-hub /api/version gitSha '$got' != $sha (run: $0 down)"
  local built running
  built="$(docker image inspect --format '{{.Id}}' "$HUB_IMAGE_REPO:$sha")"
  running="$(docker inspect --format '{{.Image}}' iso-mira-hub)"
  [ "$built" = "$running" ] || die "running image $running != built $built"
  after="$(others_snapshot)"
  [ "$before" = "$after" ] || { diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") || true; die "non-iso containers changed during up"; }
  log "non-iso containers untouched: $(printf '%s\n' "$before" | grep -c . || true) snapshotted"
  log "/api/version gitSha=$got (== approved) floors=$floors port=127.0.0.1:$PORT"
  printf 'ISOLATED_ROUTE_RECEIPT_JSON={"schema":"factorylm.isolated-route-receipt/1","environment":"isolated-route","not_a_staging_receipt":true,"sha":"%s","branch":"%s","floors_mode":"%s","image":"%s","port":%s}\n' \
    "$sha" "$BRANCH" "$floors" "$running" "$PORT"
}

cmd_down() {
  check_root
  local before after img leftover=""
  before="$(others_snapshot)"
  if [ -f "$ROOT/run.env" ]; then
    dc down -v --remove-orphans --timeout 10
  else
    docker rm -f iso-mira-hub iso-db >/dev/null 2>&1 || true
    docker network rm iso-net >/dev/null 2>&1 || true
  fi
  docker image ls -q --filter "reference=$HUB_IMAGE_REPO" | sort -u | xargs -r docker image rm -f >/dev/null
  if [ -f "$ROOT/pulled-images" ]; then
    while IFS= read -r img; do
      [ -n "$img" ] && { docker image rm "$img" >/dev/null 2>&1 || log "kept $img (in use elsewhere)"; }
    done < "$ROOT/pulled-images"
  fi
  rm -rf "$ROOT"
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ] || leftover="$leftover containers"
  [ -z "$(docker ps -aq --filter name='^iso-')" ] || leftover="$leftover iso-containers"
  [ -z "$(docker network ls -q --filter name='^iso-net$')" ] || leftover="$leftover network"
  [ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")" ] || leftover="$leftover volumes"
  [ -z "$(docker image ls -q --filter "reference=$HUB_IMAGE_REPO")" ] || leftover="$leftover images"
  [ ! -e "$ROOT" ] || leftover="$leftover root-dir"
  [ -z "$leftover" ] || die "residue after down:$leftover"
  after="$(others_snapshot)"
  [ "$before" = "$after" ] || die "non-iso containers changed during down"
  log "down complete: no iso containers, network, volumes, hub images or $ROOT; non-iso containers untouched"
}

cmd_status() {
  check_root
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  curl -sfL "http://127.0.0.1:$PORT/api/version" || echo "iso: no hub answering on 127.0.0.1:$PORT"
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) shift; cmd_down ;;
  status) shift; cmd_status ;;
  *) die "usage: $0 up --sha <40-hex> [--floors enforce|shadow] [--schema] | down | status" ;;
esac
