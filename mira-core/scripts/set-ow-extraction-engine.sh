#!/usr/bin/env bash
# set-ow-extraction-engine.sh — flip an EXISTING Open WebUI instance's
# content-extraction engine to Apache Tika.
#
# WHY THIS SCRIPT EXISTS
# ----------------------
# CONTENT_EXTRACTION_ENGINE is an Open WebUI *PersistentConfig* variable. With
# ENABLE_PERSISTENT_CONFIG=True (the default), the value stored in OW's DB takes
# precedence over the compose env. So on an OW instance that already has
# "docling" persisted (e.g. prod, 2026-06-06), adding CONTENT_EXTRACTION_ENGINE=tika
# to docker-compose does NOTHING until the DB value is flipped. Fresh OW DBs seed
# from env, so this script is only needed for already-running instances.
#
# WHAT IT DOES
# ------------
# Calls OW's authenticated retrieval-config update endpoint to set
# CONTENT_EXTRACTION_ENGINE=tika and TIKA_SERVER_URL, then verifies via GET.
#
# IMPORTANT BEHAVIOUR (verified on OW v0.8.10, 2026-06-06): the POST /update
# request *persists the value immediately* but then HANGS the HTTP response while
# OW re-initialises the extraction pipeline. We therefore POST with a short
# timeout, ignore a timeout, and confirm success with a follow-up GET. Run this
# only AFTER the Tika container is healthy.
#
# USAGE
#   OPENWEBUI_URL=http://localhost:3010 \
#   OPENWEBUI_API_KEY=sk-... \
#   TIKA_URL=http://mira-tika-saas:9998 \
#   bash mira-core/scripts/set-ow-extraction-engine.sh
#
# Defaults target the SaaS stack (mira-tika-saas). For local dev:
#   OPENWEBUI_URL=http://localhost:3000 TIKA_URL=http://mira-tika:9998 bash ...
set -euo pipefail

OW_URL="${OPENWEBUI_URL:-http://localhost:3010}"
TIKA_URL="${TIKA_URL:-http://mira-tika-saas:9998}"
KEY="${OPENWEBUI_API_KEY:?OPENWEBUI_API_KEY must be set (an OW admin API key)}"

cfg_engine() {
  curl -fsS -m 10 -H "Authorization: Bearer ${KEY}" "${OW_URL}/api/v1/retrieval/config" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('CONTENT_EXTRACTION_ENGINE',''))"
}

current="$(cfg_engine || echo '?')"
echo "[set-ow-extraction-engine] current engine = '${current}'  (target = 'tika', tika = ${TIKA_URL})"

if [ "${current}" = "tika" ]; then
  echo "[set-ow-extraction-engine] already on tika — nothing to do."
  exit 0
fi

echo "[set-ow-extraction-engine] POSTing update (response is expected to hang ~20s while OW re-inits; that is normal)..."
# -m 25: the write lands well before this; the hang is post-write re-init. We
# deliberately do not fail on a timeout (curl exit 28) — we verify with GET below.
curl -s -m 25 -X POST \
  -H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json" \
  -d "{\"CONTENT_EXTRACTION_ENGINE\":\"tika\",\"TIKA_SERVER_URL\":\"${TIKA_URL}\"}" \
  "${OW_URL}/api/v1/retrieval/config/update" >/dev/null 2>&1 || true

# Give OW a moment to settle, then verify the persisted value.
sleep 3
final="$(cfg_engine || echo '?')"
if [ "${final}" = "tika" ]; then
  echo "[set-ow-extraction-engine] OK — engine is now 'tika'."
  exit 0
fi

echo "[set-ow-extraction-engine] FAILED — engine is '${final}', expected 'tika'." >&2
echo "  Check: OW reachable at ${OW_URL}, key is an admin key, Tika healthy at ${TIKA_URL}." >&2
exit 1
