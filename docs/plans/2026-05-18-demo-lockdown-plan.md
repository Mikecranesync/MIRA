# Demo Lockdown Plan — Florida Automation Expo, May 21, 2026

**Status:** ACTIVE  
**Freeze window:** May 18–22, 2026  
**Demo date:** Thursday, May 21, 2026  
**Owner:** Mike Harper  
**Linear:** CRA-127 | **GH:** #1042  
**Spec refs:** `docs/specs/demo-readiness-may21-spec.md` — items X6, X7

---

## X6 — Change Freeze

### What's frozen
From **May 18 00:00 ET** through **May 22 23:59 ET**, no non-P0 changes merge to `main`.

| Rule | Detail |
|------|--------|
| Branch protection | `main` requires Mike's explicit approval for any merge during the freeze window |
| P0 exception path | Bug blocks the demo → Mike approves → single targeted fix + hotfix tag → immediate smoke test before continuing |
| Work-in-progress | All open demo-readiness branches must be merged or abandoned before May 18 EOD |
| Post-expo | Freeze lifts May 23 — normal PR flow resumes |

### Image snapshot (run on May 18)
```bash
# On VPS — capture all running container image digests
docker compose ps --format json | python3 -c "
import sys, json
for line in sys.stdin:
    s = json.loads(line)
    print(s.get('Image',''), s.get('Name',''))
" > docs/plans/snapshots/2026-05-18-image-manifest.txt

# Pull and tag each image as demo-freeze-may21
docker compose images --format json | jq -r '.[].Image' | while read img; do
  docker tag "$img" "${img%%:*}:demo-freeze-may21"
done
```
Save the manifest file to this directory. If rollback is needed, `docker tag ... :demo-freeze-may21` restores.

### Rollback procedure (5-minute path)
1. SSH to VPS: `ssh charlie` (or Tailscale: `ssh 100.70.49.126`)
2. Stop current containers: `docker compose down`
3. Restore frozen images:
   ```bash
   # Re-tag demo-freeze images back to :latest / production tags
   while IFS= read -r line; do
     img=$(echo "$line" | awk '{print $1}')
     docker tag "${img%%:*}:demo-freeze-may21" "$img"
   done < docs/plans/snapshots/2026-05-18-image-manifest.txt
   ```
4. Restart: `doppler run --project factorylm --config prd -- docker compose up -d`
5. Smoke test: `bash install/smoke_test.sh` — all green in <2 min

### Announcements
- [ ] Update `wiki/hot.md` header with freeze notice on May 18
- [ ] Post to Discord `#alpha-status`: "Demo freeze in effect May 18–22. P0 hotfixes require @Mike approval."

---

## X7 — Demo-Day Kill Switch

### Demo surface priority (in failure order)

| If this fails | Fall back to | Action |
|---------------|-------------|--------|
| Hub (app.factorylm.com) | Telegram bot | Open `@FactoryLMDiagnose_bot` — same diagnostic capability, no login required |
| Atlas CMMS (cmms.factorylm.com) | Telegram bot | Describe WO/asset out loud, show bot creating it |
| MIRA Scan (camera path) | Telegram bot + stored image | Send the pre-saved sample nameplate image from camera roll |
| Telegram bot | Paper script + demo video | Read from printed script; show recorded screen capture |
| Everything | Paper one-pager | Hand to prospect: MIRA's capability summary with QR code to video |

### Mike's demo-day checklist (morning of May 21)

**Before leaving for expo:**
- [ ] Primary tablet charged to 100%, Telegram bot pre-opened and tested
- [ ] Backup phone charged, `@FactoryLMDiagnose_bot` saved, last test message confirmed
- [ ] Paper one-pager printed (2 copies) — `docs/promo-screenshots/demo-one-pager.pdf`
- [ ] Paper demo script printed (1 copy) — Section "Demo Script" below
- [ ] Cellular hotspot confirmed working (don't rely on expo Wi-Fi)
- [ ] Send one test fault-code query on Telegram from expo venue before booth opens

**Stored fallback assets (saved to tablet camera roll):**
- Sample nameplate photo: `docs/promo-screenshots/sample-nameplate-vfd.jpg`
- Demo video (60s): `docs/promo-screenshots/mira-demo-60s.mp4`

### Demo script (3-minute walk-through)

```
"We built MIRA for maintenance teams that don't have time to search through manuals."

1. [Open Hub] "This is our dashboard — real work orders, real assets, live from your plant floor."

2. [Tap Assets → tap one asset] "Every machine tracked. Click through to Atlas CMMS."

3. [Open CMMS] "This is Atlas — your PM schedule, work orders, parts history."

4. [Back to Hub → tap Scan] "Here's the wow: point the camera at any nameplate..."
   [Take photo or send sample image]
   "...and MIRA reads the fault code and tells you exactly what to check."

5. [Show Telegram bot] "Same engine on Telegram — your techs don't need to install anything.
   They text the bot from the floor."

6. [Close] "We're onboarding 10 pilot plants this summer. Want to be one of them?"
```

### P0 hotfix protocol (during freeze)

1. Identify: demo-blocking regression confirmed on VPS
2. Branch from `main`: `git checkout -b hotfix/demo-may21-<slug>`
3. Minimal targeted fix only — no scope creep
4. Mike reviews diff personally before merge
5. Merge → immediate smoke test: `bash install/smoke_test.sh`
6. Tag: `git tag hotfix-may21-<slug>` so it's findable in post-mortem

---

## Acceptance Checklist (verify by May 17)

### X6
- [ ] `main` branch protection rule updated in GitHub (Settings → Branches → Add rule, require 1 approval, `main`, dates noted in description)
- [ ] Image snapshots taken and committed to `docs/plans/snapshots/`
- [ ] Rollback tested end-to-end at least once on staging
- [ ] `wiki/hot.md` freeze notice added
- [ ] Discord `#alpha-status` announcement posted

### X7
- [ ] Kill-switch table reviewed with Mike and confirmed accurate
- [ ] Sample nameplate photo saved to tablet
- [ ] Demo video exported and saved to tablet
- [ ] Paper one-pager printed
- [ ] Backup phone tested with Telegram bot
- [ ] Demo script rehearsed at least once (solo run-through)

---

## Post-Expo (May 22)

- Unfreeze `main` branch protection
- Post debrief notes to `wiki/hot.md`
- Archive this doc to `docs/plans/archive/`
- File any demo-day bugs as Linear issues with `post-expo` label
