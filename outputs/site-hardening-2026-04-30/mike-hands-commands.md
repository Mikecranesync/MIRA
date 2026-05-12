# Mike-hands commands — P0.5 SSH + P0.6 nginx-bak

Two short stops on the VPS. Both reversible, both ~5 min total. **Do these only after merging PRs #890 / #891 — no dependency on the Rico PR #892**.

The commands below are **what to type** and **what to expect**. Don't merge if the verification fails — back out.

---

## P0.5a — SSH password auth → key-only on the VPS

**Why:** `sshd -T | grep passwordauth` currently shows `passwordauthentication yes` (cloud-init override is winning). Root is already key-only via `PermitRootLogin without-password`, but any non-root user can SSH with password. No `fail2ban` to throttle attempts. **Pre-flight**: confirm every user that SSHes in has a working key in `~/.ssh/authorized_keys`. If anyone is using passwords today, they'll get locked out.

```bash
# 1. From your laptop — confirm your SSH key works WITHOUT password fallback.
ssh -o PreferredAuthentications=publickey -o PubkeyAuthentication=yes vps "whoami"
# Expected: prints "root" (or whichever user). If it prompts for a password,
# STOP — your key isn't trusted yet, fix that first.

# 2. SSH in.
ssh vps

# 3. List who has authorized keys (sanity check before locking out).
for u in $(awk -F: '$3>=1000 && $1!="nobody"{print $1}' /etc/passwd) root; do
  test -s /home/$u/.ssh/authorized_keys 2>/dev/null && echo "$u: keys present" || \
    test -s /root/.ssh/authorized_keys 2>/dev/null && [ "$u" = "root" ] && echo "root: keys present" || \
    echo "$u: NO KEYS"
done
# Anyone with "NO KEYS" + a password = will be locked out. Add their key first.

# 4. Override the cloud-init setting that's currently letting password auth win.
cat <<'EOF' > /etc/ssh/sshd_config.d/99-hardening.conf
# Force key-only auth for ALL users. P0.5 — site-hardening 2026-04-30.
# Loads after 50-cloud-init.conf alphabetically and overrides it.
PasswordAuthentication no
PermitEmptyPasswords no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
EOF

# 5. Validate the config BEFORE reloading.
sshd -t
# Expected: no output. If you see an error, fix the file before continuing.

# 6. Reload sshd. Existing connections stay alive; new ones use the new config.
systemctl reload ssh

# 7. Verify the effective config.
sshd -T | grep -iE 'passwordauth|kbdinteractive|challenge'
# Expected ALL THREE:
#   passwordauthentication no
#   kbdinteractiveauthentication no
#   challengeresponseauthentication no
```

**Rollback (if you got locked out via the console):** `rm /etc/ssh/sshd_config.d/99-hardening.conf && systemctl reload ssh`.

---

## P0.5b — fail2ban for SSH brute-force protection

**Why:** Even with key-only auth, brute-force attempts hammer the SSH port. fail2ban auto-bans IPs that try too many bad logins. Cheap insurance.

```bash
# 1. Install (Ubuntu's default config has a sane [sshd] jail enabled out of the box).
apt update && apt install -y fail2ban

# 2. Confirm it's running and watching SSH.
systemctl is-active fail2ban
# Expected: active

fail2ban-client status sshd
# Expected: a status block with "Jail status" and "Currently banned: 0" (initially).

# 3. Tail the log to confirm it's seeing SSH events.
tail -20 /var/log/fail2ban.log
# Expected: lines like "Jail 'sshd' started".
```

**What it does by default:** 5 failed attempts in 10 min → 10-minute ban. Tunable in `/etc/fail2ban/jail.d/`.

---

## P0.6 — Delete nginx `.bak` files in `sites-enabled/`

**Why:** `nginx -T` confirms it currently loads `mira.bak.20260426-082325`, `mira.bak.inbox`, and `mira.bak.phase1` alongside the active config. Two `server_name factorylm.com` blocks exist; behavior with duplicate server blocks is undefined / first-wins, fragile under config reload, and could route real traffic to a stale config.

```bash
# 1. Move the .bak files out of sites-enabled (don't delete — keep for forensics).
mkdir -p /root/nginx-attic
mv /etc/nginx/sites-enabled/mira.bak.20260426-082325 \
   /etc/nginx/sites-enabled/mira.bak.inbox \
   /etc/nginx/sites-enabled/mira.bak.phase1 \
   /root/nginx-attic/

# 2. Test the new config BEFORE reloading.
nginx -t
# Expected: nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
#           nginx: configuration file /etc/nginx/nginx.conf test is successful

# 3. Reload nginx (graceful — existing connections stay alive).
systemctl reload nginx

# 4. Verify the .bak server blocks are gone from the loaded config.
nginx -T 2>&1 | grep -c 'server_name factorylm.com'
# Expected: 1 (was 2 before)

nginx -T 2>&1 | grep -iE 'bak|inbox' | head -5
# Expected: empty (no .bak files referenced anywhere in the active config)

# 5. End-to-end smoke from your laptop.
curl -sI https://factorylm.com/ | head -3
curl -sI https://factorylm.com/cmms | head -3
# Expected: HTTP 200 OK on both. Confirms apex still serves correctly.
```

**Rollback:** `mv /root/nginx-attic/mira.bak.* /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx`.

---

## After both run

```bash
# Quick hardening posture summary (paste output back to me if you want a sanity check):
echo "=== sshd ==="; sshd -T 2>/dev/null | grep -iE 'passwordauth|kbdinteractive'
echo "=== fail2ban ==="; systemctl is-active fail2ban
echo "=== nginx server_name count ==="; nginx -T 2>&1 | grep -c 'server_name factorylm.com'
echo "=== ssh config files loaded ==="; ls -la /etc/ssh/sshd_config.d/
echo "=== nginx sites-enabled ==="; ls -la /etc/nginx/sites-enabled/
```

---

## Time budget

- P0.5a (SSH config + reload + verify): **5 min**, plus 1 min if you also want to add a key for a new user
- P0.5b (fail2ban install): **2 min**
- P0.6 (nginx .bak cleanup): **2 min**

Total: **~10 min** of your hands. All three are reversible from the console without any data loss.
