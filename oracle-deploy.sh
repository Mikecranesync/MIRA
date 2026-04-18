#!/bin/bash
# oracle-deploy.sh — start all FactoryLM services
# Run with: doppler run --project factorylm --config prd -- bash oracle-deploy.sh
set -e

ORACLE_IP=$(curl -s ifconfig.me)
echo "Oracle IP: $ORACLE_IP"

# Networks
docker network create core-net  2>/dev/null || true
docker network create bot-net   2>/dev/null || true
docker network create cmms-net  2>/dev/null || true

# Check Bravo Ollama
echo "==> Checking Bravo Ollama (Tailscale required)"
curl -s --max-time 5 http://100.86.236.11:11434/api/tags > /dev/null \
  && echo "    Bravo Ollama: OK" \
  || echo "    WARNING: Bravo unreachable — run 'sudo tailscale up' first"

# Ensure SQLite DB files exist so Docker doesn't create them as directories
mkdir -p ~/MIRA/mira-core/data/photos
[ -f ~/MIRA/mira-core/mira.db ] || touch ~/MIRA/mira-core/mira.db
mkdir -p ~/MIRA/mira-bridge/data
[ -f ~/MIRA/mira-bridge/data/mira.db ] || touch ~/MIRA/mira-bridge/data/mira.db

# MIRA core
echo "==> MIRA core"
cd ~/MIRA/mira-core
docker compose -f docker-compose.yml -f docker-compose.oracle.yml build --no-cache mira-mcpo
docker compose -f docker-compose.yml -f docker-compose.oracle.yml build mira-ingest mira-pipeline
docker compose -f docker-compose.yml -f docker-compose.oracle.yml up -d
sleep 30

# MIRA bots
echo "==> MIRA bots"
cd ~/MIRA/mira-bots
docker compose up -d telegram-bot slack-bot

# Atlas CMMS
echo "==> Atlas CMMS"
cd ~/MIRA/mira-cmms
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
sleep 15

# Node-RED bridge
echo "==> Node-RED bridge"
cd ~/MIRA/mira-bridge
docker compose up -d

# nginx + landing page
echo "==> nginx"
sudo cp ~/MIRA/nginx-oracle.conf /etc/nginx/sites-available/factorylm
sudo ln -sf /etc/nginx/sites-available/factorylm /etc/nginx/sites-enabled/factorylm
sudo rm -f /etc/nginx/sites-enabled/default

if [ ! -d /var/www/factorylm ]; then
  sudo mkdir -p /var/www/factorylm
  sudo git clone https://github.com/Mikecranesync/factorylm-landing.git /var/www/factorylm \
    || echo "  Could not clone landing page — add manually"
fi

sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "============================================"
echo "  MIRA:  http://$ORACLE_IP:3000"
echo "  CMMS:  http://$ORACLE_IP:3100"
echo "  nginx: http://$ORACLE_IP"
echo ""
echo "  After DNS points here, get TLS:"
echo "  sudo certbot --nginx \\"
echo "    -d factorylm.com -d www.factorylm.com \\"
echo "    -d app.factorylm.com -d cmms.factorylm.com"
echo "============================================"

docker ps --format "table {{.Names}}\t{{.Status}}"
