#!/usr/bin/env bash

################################################################################
# VPS fail2ban SSH Brute-Force Protection Setup
#
# PURPOSE:
#   Hardens SSH access on the production VPS by installing and configuring
#   fail2ban to ban IPs after 5 failed SSH login attempts within 10 minutes.
#   Ban duration: 1 hour.
#
# OPERATOR NOTES:
#   - Run this script as root on the VPS: sudo bash vps_fail2ban_setup.sh
#   - Do NOT run automatically; this is a manual, deliberate hardening step.
#   - This script is IDEMPOTENT — safe to re-run.
#   - Before running, set ignoreip below to include your admin IP(s) and any
#     Tailscale IPs to avoid locking yourself out of SSH.
#
# WARNING:
#   If you do not add your own IP to ignoreip before running, fail2ban may
#   ban your IP after a few failed login attempts, locking you out of SSH.
#   Test with a wrong password a few times at your own risk.
#
################################################################################

set -euo pipefail

# Color output for clarity
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== fail2ban SSH Hardening Setup ===${NC}"

# Step 1: Update package manager
echo -e "${YELLOW}[1/4] Updating package manager...${NC}"
apt-get update

# Step 2: Install fail2ban
echo -e "${YELLOW}[2/4] Installing fail2ban...${NC}"
apt-get install -y fail2ban

# Step 3: Write jail.local configuration
echo -e "${YELLOW}[3/4] Configuring fail2ban jail for SSH...${NC}"

# Detect init system to set backend appropriately
BACKEND="auto"
if systemctl --version &>/dev/null; then
    BACKEND="systemd"
fi

cat > /etc/fail2ban/jail.local << 'EOF'
################################################################################
# fail2ban jail.local — SSH brute-force protection
#
# IMPORTANT: Review and customize ignoreip before enabling fail2ban!
# Add your admin IP(s) and Tailscale subnet to prevent self-lockout.
################################################################################

[DEFAULT]
# Whitelist these IPs (localhost + CHANGE THIS: add your admin IP)
ignoreip = 127.0.0.1/8 ::1
#           ↓ ADD YOUR IP(s) HERE ↓
# ignoreip = 127.0.0.1/8 ::1 100.0.0.0/8

# Global ban time (applied to all jails)
bantime = 1h

[sshd]
# Enable SSH jail
enabled = true

# Port and protocol
port = ssh

# Backend (systemd = read from journal; auto = fallback)
backend = systemd

# Maximum retries before ban
maxretry = 5

# Time window for counting retries
findtime = 10m

# How long to ban the IP (1 hour = 3600 seconds)
bantime = 1h

# Log file to monitor (systemd journal is preferred; fallback included)
logpath = %(syslog_authpriv)s

EOF

echo -e "${GREEN}✓ jail.local written to /etc/fail2ban/jail.local${NC}"
echo -e "${YELLOW}   Review the ignoreip setting and add your admin IP before the next step!${NC}"

# Step 4: Enable and start fail2ban
echo -e "${YELLOW}[4/4] Enabling and starting fail2ban...${NC}"
systemctl enable fail2ban
systemctl restart fail2ban

# Verify status
echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo -e "${YELLOW}fail2ban status for SSH jail:${NC}"
fail2ban-client status sshd

echo ""
echo -e "${GREEN}✓ SSH brute-force protection is now active${NC}"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  fail2ban-client status sshd              # Show banned IPs"
echo "  fail2ban-client set sshd unbanip <IP>   # Unban an IP manually"
echo "  tail -f /var/log/fail2ban.log            # Watch fail2ban logs"
