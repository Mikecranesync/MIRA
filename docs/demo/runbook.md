# MIRA Demo Day Runbook

**Demo Date:** May 21, 2026 | **Last Updated:** 2026-05-13

> One-command preflight: `make demo-preflight` — all 10 checks green before entering the room.

---

## T-30 Min Checklist

```bash
# Run from BRAVO or laptop (Doppler must be unlocked first):
make demo-preflight
```

If any check fails, jump to the relevant section below.

---

## Container Quick-Restart Commands

Always restart via Doppler — bare `docker restart` loses env vars on systems where Doppler injects at runtime.

```bash
# On VPS (ssh root@165.245.138.91)
cd /opt/mira

doppler run --project factorylm --config prd -- docker compose restart mira-pipeline
doppler run --project factorylm --config prd -- docker compose restart mira-bot-telegram
doppler run --project factorylm --config prd -- docker compose restart mira-web
doppler run --project factorylm --config prd -- docker compose restart mira-ingest
doppler run --project factorylm --config prd -- docker compose restart atlas-api

# Full stack restart (last resort — ~90s downtime):
doppler run --project factorylm --config prd -- docker compose down && \
doppler run --project factorylm --config prd -- docker compose up -d
```

---

## Mid-Demo Recovery Decision Tree

### Failure: AI chat not responding

1. Check pipeline: `curl -sf https://app.factorylm.com/v1/models` → should return JSON
2. If timeout: `docker compose restart mira-pipeline` on VPS
3. If still down after 30s: **switch to backup video** (see below)

### Failure: Telegram bot not responding

1. Check bot: `curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"`
2. If ok=true but bot silent: `docker compose restart mira-bot-telegram` on VPS
3. Check for competing poller: `docker ps | grep telegram` — should show exactly 1 container
4. If 2+ containers: `docker stop <old-container-id>`, then `docker compose restart mira-bot-telegram`

### Failure: Atlas CMMS not loading

1. Check: `curl -sf https://app.factorylm.com/api/atlas/health` → 200 or 401 is OK
2. If 502/000: `docker compose restart atlas-api` on VPS
3. Give it 20s (Spring Boot startup) then retry

### Failure: Camera scan / QR ingest not working

1. Check: `curl -sf https://app.factorylm.com/scan/` → should return 200
2. If issue is just the CMMS button: navigate directly to `https://app.factorylm.com/hub/cmms`
3. If photo ingest fails: `docker compose restart mira-ingest` on VPS

### Failure: Page won't load (502 / blank screen)

1. Check nginx: `systemctl status nginx` on VPS
2. Check all containers up: `docker ps --format "table {{.Names}}\t{{.Status}}"` → all should be `Up`
3. If a container is `Exited`: `doppler run ... -- docker compose up -d <service>`
4. If nginx down: `systemctl restart nginx`

### Failure: Everything is down

1. **Switch to backup video immediately** — do not troubleshoot live
2. Run post-demo: `docker compose down && docker compose up -d` on VPS

---

## Backup Video

- **YouTube (primary):** bookmark in Chrome on demo laptop
- **Local file:** `~/Desktop/mira-demo-backup.mp4` on demo laptop
- **USB stick:** labeled "MIRA DEMO BACKUP" in laptop bag

Backup video covers: QR scan → photo ingest → Telegram query → PM schedule display.

---

## Status Page

`https://app.factorylm.com/status.html` — shows live green/red per service.
Auto-refreshes every 60s. Open this on a second screen during the demo.

---

## Stripe Live Mode Verify

```bash
# Must show sk_live_... (not sk_test_)
doppler run --project factorylm --config prd -- sh -c 'echo ${STRIPE_SECRET_KEY:0:15}...'
```

If on test keys: log into Stripe Dashboard → toggle to Live mode → copy live secret key → `doppler secrets set STRIPE_SECRET_KEY <key> --project factorylm --config prd`.

---

## On-Call / Escalation

| Who | Role | Contact |
|-----|------|---------|
| Mike | Operator / presenter | (on-site) |
| VPS access | `ssh root@165.245.138.91` | keys in Doppler `SSH_BRAVO_PRIVATE_KEY` |
| Doppler | `doppler run --project factorylm --config prd --` | |

---

## Hardware Backup

- **Backup laptop:** full Docker stack, same Doppler secrets, pre-pulled images
- **Second phone:** Telegram installed, pre-joined test channel, hotspot ready
- **Hotspot failover:** if primary wifi fails, tether to phone hotspot (Settings → Personal Hotspot)

---

## Post-Demo

```bash
# Rotate any secrets used live (Stripe webhook secret, demo API keys)
# Tag the demo build:
git tag -a demo/2026-05-21 -m "Demo day build" && git push origin --tags
```
