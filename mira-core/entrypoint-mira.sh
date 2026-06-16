#!/bin/bash
set -e

# Private-label: remove "(Open WebUI)" suffix from WEBUI_NAME
sed -i 's/WEBUI_NAME += " (Open WebUI)"/pass  # private-label: no suffix/' \
    /app/backend/open_webui/env.py

# Private-label: replace OI logo with MIRA branding
BRAND_DIR="/branding"
STATIC="/app/backend/open_webui/static"
BUILD_STATIC="/app/build/static"
if [ -d "$BRAND_DIR" ]; then
    for f in favicon.png favicon-dark.png favicon-96x96.png logo.png favicon.ico favicon.svg; do
        if [ -f "$BRAND_DIR/$f" ]; then
            cp "$BRAND_DIR/$f" "$STATIC/$f" 2>/dev/null || true
            cp "$BRAND_DIR/$f" "$BUILD_STATIC/$f" 2>/dev/null || true
        fi
    done
    # Also copy to build root for SvelteKit
    [ -f "$BRAND_DIR/favicon.png" ] && cp "$BRAND_DIR/favicon.png" /app/build/favicon.png 2>/dev/null || true
    echo "MIRA branding applied"
fi

# --- Self-heal content-extraction engine to Tika (2026-06-06) -----------------
# CONTENT_EXTRACTION_ENGINE is an Open WebUI PersistentConfig var: the DB value
# wins over the compose env. After the Docling->Tika migration the DB may still
# say "docling" — pointing at a container that no longer exists — until it is
# flipped. We can't flip before OW's API is up, so background a wait-then-flip.
# Idempotent (no-ops once it's tika); guarded so it can NEVER block or fail boot
# (note: `set -e` is on — every risky call is `|| true`/`|| continue`). Runs on
# every restart, so future redeploys self-correct too. The standalone
# scripts/set-ow-extraction-engine.sh remains for manual/local use.
if [ "${CONTENT_EXTRACTION_ENGINE:-}" = "tika" ] && [ -n "${OPENWEBUI_API_KEY:-}" ]; then
  (
    tika_url="${TIKA_SERVER_URL:-http://mira-tika:9998}"
    for _ in $(seq 1 60); do
      sleep 3
      cur=$(curl -fsS -m5 -H "Authorization: Bearer ${OPENWEBUI_API_KEY}" \
            http://localhost:8080/api/v1/retrieval/config 2>/dev/null \
            | python3 -c "import sys,json;print(json.load(sys.stdin).get('CONTENT_EXTRACTION_ENGINE',''))" 2>/dev/null) || continue
      if [ "$cur" = "tika" ]; then
        echo "[mira] content-extraction engine already tika"
        break
      fi
      # The update POST persists the value but then hangs ~20s on re-init; the
      # short timeout + `|| true` is expected — we re-check on the next loop.
      curl -s -m25 -X POST \
        -H "Authorization: Bearer ${OPENWEBUI_API_KEY}" -H "Content-Type: application/json" \
        -d "{\"CONTENT_EXTRACTION_ENGINE\":\"tika\",\"TIKA_SERVER_URL\":\"${tika_url}\"}" \
        http://localhost:8080/api/v1/retrieval/config/update >/dev/null 2>&1 || true
      echo "[mira] flipped content-extraction engine to tika (${tika_url})"
    done
  ) &
fi

# Run the original entrypoint
exec bash /app/backend/start.sh
