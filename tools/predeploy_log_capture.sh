#!/usr/bin/env bash
# Pre-deploy container-log preservation (2026-08-04).
#
# `docker compose up --force-recreate` REMOVES the old container and, with the
# json-file logging driver, its logs die with it — the E1 production F004
# trace was unrecoverable for exactly this reason. This script runs on the CI
# runner BEFORE the recreate: it captures the bot container's logs over SSH
# (read-only — never restarts or mutates the container), redacts secrets and
# personal identifiers, and writes a small bundle for upload as a
# finite-retention CI artifact. The unredacted capture never leaves the
# runner's temp dir and is deleted before exit.
#
# Failure policy (documented, deliberate): any capture failure prints a
# ::warning:: and exits 0 — a deploy is the recovery path during an incident,
# so observability must never gate availability.
#
# Env:
#   SSH_CMD    (required) e.g. "ssh -i ~/.ssh/key root@host"
#   OUT_DIR    (required) bundle output directory
#   CONTAINER  (default mira-bot-telegram)
#   SINCE      (default 48h) docker logs --since window

set -uo pipefail

SSH_CMD="${SSH_CMD:?SSH_CMD required}"
OUT_DIR="${OUT_DIR:?OUT_DIR required}"
CONTAINER="${CONTAINER:-mira-bot-telegram}"
SINCE="${SINCE:-48h}"

mkdir -p "$OUT_DIR"
meta="$OUT_DIR/metadata.txt"
redacted="$OUT_DIR/${CONTAINER}-predeploy-redacted.log"

inspect=$($SSH_CMD "docker inspect $CONTAINER --format '{{.Id}} {{.Image}} {{.Created}} {{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}'" 2>/dev/null)
if [ -z "$inspect" ]; then
  echo "::warning::pre-deploy log capture: container $CONTAINER not found — nothing preserved"
  {
    printf 'container=%s\nstatus=not_found\ncaptured_at=%s\n' \
      "$CONTAINER" "$(date -u +%FT%TZ)"
  } > "$meta"
  exit 0
fi

raw=$(mktemp)
if ! $SSH_CMD "docker logs $CONTAINER --since $SINCE --timestamps 2>&1" > "$raw"; then
  echo "::warning::pre-deploy log capture: docker logs failed for $CONTAINER — nothing preserved"
  printf 'container=%s\nstatus=logs_failed\ncaptured_at=%s\n' \
    "$CONTAINER" "$(date -u +%FT%TZ)" > "$meta"
  rm -f "$raw"
  exit 0
fi

# Redaction: bot tokens, Telegram numeric identifiers, received-message bodies
# (names + content), tenant/other UUIDs. Applied before anything persists in
# the bundle; the raw capture is deleted below.
sed -E \
  -e 's#/bot[0-9]+:[A-Za-z0-9_-]+#/bot<redacted>#g' \
  -e 's/(chat_id=telegram:)[0-9]+/\1[REDACTED]/g' \
  -e 's/(ext=|user=|chat=)[0-9]+/\1[REDACTED]/g' \
  -e 's/(Received from )[^:]*: .*/\1[USER]: [REDACTED]/' \
  -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[UUID]/g' \
  "$raw" > "$redacted"

raw_lines=$(wc -l < "$raw" | tr -d ' ')
rm -f "$raw"
lines=$(wc -l < "$redacted" | tr -d ' ')
bytes=$(wc -c < "$redacted" | tr -d ' ')
sha=$(sha256sum "$redacted" | cut -d' ' -f1)

{
  printf 'container=%s\nstatus=captured\ncaptured_at=%s\nsince=%s\n' \
    "$CONTAINER" "$(date -u +%FT%TZ)" "$SINCE"
  printf 'inspect=%s\n' "$inspect"
  printf 'raw_lines=%s\nredacted_lines=%s\nredacted_bytes=%s\nredacted_sha256=%s\n' \
    "$raw_lines" "$lines" "$bytes" "$sha"
} > "$meta"

echo "pre-deploy logs preserved: $redacted ($lines lines, sha256 $sha)"
