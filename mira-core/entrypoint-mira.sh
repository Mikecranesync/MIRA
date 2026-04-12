#!/bin/bash
set -e

# Private-label: remove "(Open WebUI)" suffix from WEBUI_NAME
sed -i 's/WEBUI_NAME += " (Open WebUI)"/pass  # private-label: no suffix/' \
    /app/backend/open_webui/env.py

# Run the original entrypoint
exec bash /app/backend/start.sh
