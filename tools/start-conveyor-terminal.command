#!/usr/bin/env bash
# Double-click from Finder to open the Rich terminal dashboard.
# Tier 1: no Docker, no relay — just PLC + Rich UI in this window.

set -u
cd "$(dirname "$0")/.."

PLC_IP="${DEMO_PLC_IP:-192.168.1.100}"

echo "================================================"
echo "  MIRA — Garage Conveyor (Terminal)"
echo "================================================"
echo ""
echo "  PLC: $PLC_IP:502"
echo ""

if python3 -c "
import socket, sys
s = socket.socket(); s.settimeout(2)
try:
    s.connect(('$PLC_IP', 502)); s.close(); sys.exit(0)
except Exception:
    sys.exit(1)
"; then
    exec python3 plc/live_monitor.py --host "$PLC_IP" --poll 0.5
else
    echo "  PLC not reachable at $PLC_IP:502."
    echo ""
    echo "  Check:"
    echo "    - Is the Micro 820 powered?"
    echo "    - Is this Mac on the 192.168.1.x network?"
    echo "    - Can you ping $PLC_IP from Terminal?"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi
