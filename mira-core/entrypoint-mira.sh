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

# Run the original entrypoint
exec bash /app/backend/start.sh
