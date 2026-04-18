#!/bin/bash
# oracle-bootstrap.sh — run ONCE on Oracle VM as ubuntu user
# scp this file to Oracle then: bash oracle-bootstrap.sh
set -e

echo "==> [1/8] System update"
sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

echo "==> [2/8] Install Docker"
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker "$USER"

echo "==> [3/8] Install tools (git, nginx, certbot, redis-tools, jq)"
sudo apt-get install -y git nginx certbot python3-certbot-nginx redis-tools jq curl

echo "==> [4/8] Install Tailscale"
curl -fsSL https://tailscale.com/install.sh | sudo bash
echo "  ** ACTION REQUIRED: run 'sudo tailscale up' and log in to join the tailnet **"
echo "     After joining, Bravo (100.86.236.11) will be reachable for Ollama."

echo "==> [5/8] Install Doppler CLI"
curl -Ls https://cli.doppler.com/install.sh | sudo sh

echo "==> [6/8] Clone repos"
if [ ! -d ~/MIRA ]; then
  git clone https://github.com/Mikecranesync/MIRA.git ~/MIRA
else
  git -C ~/MIRA pull
fi
if [ ! -d ~/factorylm ]; then
  git clone https://github.com/Mikecranesync/factorylm.git ~/factorylm
else
  git -C ~/factorylm pull
fi

echo "==> [7/8] Create Docker networks and directories"
docker network create core-net  2>/dev/null || true
docker network create bot-net   2>/dev/null || true
docker network create cmms-net  2>/dev/null || true

mkdir -p ~/MIRA/mira-core/data/photos
touch ~/MIRA/mira-core/mira.db
mkdir -p ~/MIRA/mira-bridge/data
touch ~/MIRA/mira-bridge/data/mira.db

echo "==> [8/8] Pre-pull heavy images"
docker pull ghcr.io/open-webui/open-webui:v0.8.10 &
docker pull postgres:16-alpine &
docker pull intelloop/atlas-cmms-backend &
docker pull intelloop/atlas-cmms-frontend &
docker pull "minio/minio:RELEASE.2025-04-22T22-12-26Z" &
docker pull apache/tika:3.1.0.0 &
docker pull nodered/node-red:4.1.7-22 &
docker pull quay.io/docling-project/docling-serve:v1.16.1 &
wait
echo "  All images pulled."

echo ""
echo "=== Bootstrap complete ==="
echo "NEXT STEPS:"
echo "  1. sudo tailscale up        — join tailnet"
echo "  2. doppler login            — authenticate"
echo "  3. doppler run --project factorylm --config prd -- bash ~/MIRA/oracle-deploy.sh"
