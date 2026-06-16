#!/usr/bin/env bash
set -euo pipefail

echo "=== Conveyor Pipeline Bench Test ==="
echo "This tests the full chain: Simulator → Poller → Relay → Node-RED Dashboard"
echo ""

# Step 1: Start Node-RED + mira-relay
echo "[1/4] Starting Node-RED + mira-relay..."
docker compose up -d node-red mira-relay
sleep 5

# Step 2: Health checks
echo "[2/4] Health checks..."
curl -sf http://localhost:1880/ > /dev/null && echo "  Node-RED: OK" || echo "  Node-RED: FAIL"
curl -sf http://localhost:8765/health > /dev/null && echo "  Relay: OK" || echo "  Relay: FAIL"

# Step 3: Start simulator in background
echo "[3/4] Starting PLC simulator on port 5020..."
python3 -m tools.demo_plc_simulator --port 5020 &
SIM_PID=$!
sleep 2

# Step 4: Start poller pointed at simulator
echo "[4/4] Starting poller (Ctrl+C to stop)..."
echo ""
echo "  Dashboard: http://localhost:1880/dashboard"
echo "  Relay:     http://localhost:8765/health"
echo ""
python3 -m tools.demo_plc_poller \
  --plc-ip 127.0.0.1 --plc-port 5020 \
  --relay-url http://localhost:8765 \
  --poll-interval 1.0

# Cleanup
kill $SIM_PID 2>/dev/null
echo "Simulator stopped."
