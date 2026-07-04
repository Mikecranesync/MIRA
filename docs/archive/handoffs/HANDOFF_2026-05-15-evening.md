# Session Handoff — May 15, 2026 (Evening: PR rebases + Phase 8 tablet page)

**Session window:** 2026-05-15 ~13:00 → 2026-05-15 evening
**Previous handoff:** `HANDOFF_2026-05-15.md` (overnight: demo backend + migrations + KB seed)
**Demo target:** **May 21, 2026** — physical conveyor tablet demo. **T-6 days.**
**Branch (this session):** `feat/demo-may21-finish` (PR #1317) off `origin/main` `1c0c2413`

---

## 🚨 LEAD: P0 prod outage discovered — `factorylm.com` and `app.factorylm.com` hanging

While running CI smoke against the rebased PRs, I noticed two PRs failing E2E
smoke with `net::ERR_TIMED_OUT at https://factorylm.com/`. I verified
independently from CHARLIE:

| Check | Result |
|---|---|
| DNS `factorylm.com` (system + Cloudflare 1.1.1.1) | both return `165.245.138.91` (consistent) |
| Tailscale to Alpha (sanity) | pong via LAN, ~6 ms — CHARLIE's network is fine |
| TCP `165.245.138.91:443` / `:80` / `:22` | all OPEN (`nc -z` succeeded) |
| TLS handshake on 443 | **stalls after Client Hello**, 12 s timeout |
| Plain HTTP on 80 | **request sent, 0 bytes received**, 8 s timeout |
| `app.factorylm.com` | same TLS handshake stall |

**Diagnosis:** the VPS at `165.245.138.91` accepts TCP but the web layer
(nginx and/or its upstreams) isn't responding to requests. This is
independent of GitHub Actions and CHARLIE DNS — it's a real prod hang.

**Likely causes** (operator to investigate):
- nginx upstream timeout — app containers behind it not responding
- Disk full on the DO droplet (eval-fixer + photo pipeline can fill disk)
- OOM killed nginx or a service it proxies to
- A container crashed (mira-mcp was already known missing from VPS — #1304)
- iptables / UFW reload blocked traffic

**Operator action:**
```bash
# from a machine with SSH access to the prod VPS (Mike's normal workstation)
ssh root@165.245.138.91   # or however prod SSH is configured
docker ps                  # which containers are up?
docker logs --tail=200 nginx
df -h                      # disk?
docker compose -f docker-compose.saas.yml ps
systemctl status nginx
```

**Demo-day impact:** if not resolved before May 21, the iPad won't reach
the hub. P0 to investigate ASAP.

---

## ✅ What this session did (row-by-row vs PLAN.md)

| # | Item | Status | Note |
|---|---|---|---|
| 1 | Worktree + sync setup | ✅ | `feat/demo-may21-finish` off `origin/main 1c0c2413` |
| 2 | PR #1297 (psycopg v3 `add_notice_handler`) — verify supersession | ✅ rebased + pushed | NOT superseded by #1311/#1312; touches `tools/seeds/run_demo_seed.py` only. **MERGEABLE**; one FAILURE (E2E smoke) is the prod outage, not PR-caused. |
| 3 | PR #1314 (UNS pair-coverage Stage 1) — fix Lint & Format | ✅ ran `ruff format`, pushed | Lint failure was 2 files needing format: `mira-bots/shared/{neon_recall,uns_resolver}.py`. Now SUCCESS. **MERGEABLE**; FAILURE is prod-outage smoke. |
| 4 | PR #1313 (OEM-manual seed) — rebase | ✅ rebased onto `origin/main` (dropped 3 local-only commits), pushed | Closes part of #1308 once merged. **MERGEABLE**; smoke pending. |
| 5 | PR #1315 (conv-suite harness) — rebase | ✅ rebased, pushed | 36 conversation cases land once merged. **MERGEABLE**; smoke pending. |
| 6 | **Phase 7 — MQTT adapter** | ❌ DROPPED per spec | `docs/plans/2026-05-14-demo-backend-plan.md` line 94: *"What this plan deliberately does NOT do: Real-time MQTT subscription (deferred — mock feed for demo)."* The previous handoff's "Phase 7 = MQTT" was misaligned with the plan. Mock feed already shipped in #1298. |
| 7 | **Phase 8 — tablet page `/demo/conveyor/[tag]`** | ✅ shipped in PR #1317 | 3 panels (live signals, components, Ask MIRA), Playwright smoke + gated screenshot test, full build green |
| 8 | Open PR + write HANDOFF | ✅ this file | PR #1317, this handoff |

---

## 📌 PRs in MERGEABLE state — waiting on operator + prod restore

Mike: once prod is restored, the E2E smoke check on each PR will auto-retry
on the next push or you can re-run it manually. None of these PRs need a
code change to merge.

| PR | Branch | Title | Why merge |
|---|---|---|---|
| **#1297** | `fix/seed-runner-psycopg-v3-notices` | `fix(seeds): use psycopg v3 add_notice_handler` | psycopg v3 broke `conn.notices`; the seed runner crashes without this |
| **#1313** | `claude/romantic-wescoff-290da1` | `feat(kb): OEM-manual seed for garage RS-485` | Closes part of #1308 (GS10/Micro820 KB gap) |
| **#1314** | `fix/uns-pair-coverage-multi-vendor` | `feat(uns): pair-coverage probe + multi-vendor resolution` | UNS Stage 1 foundations |
| **#1315** | `claude/crazy-ardinghelli-acc976` | `test(conv-suite): adapter-agnostic conversation testing harness` | 36-case conv test harness |
| **#1317** | `feat/demo-may21-finish` | `feat(hub): demo Phase 8 — tablet page /demo/conveyor/[tag]` | This session's work |

**Suggested merge order:** #1297 → #1313 → #1314 → #1315 → #1317. Squash-merge
each; re-run smoke after `factorylm.com` is back up.

---

## 🧪 Phase 8 (PR #1317) — what's deployable + what's not

**Deployable:**
- `mira-hub/src/app/demo/conveyor/[tag]/page.tsx` (~330 lines)
- `mira-hub/tests/e2e/demo-conveyor.spec.ts` (smoke + mocked-render gated by `MIRA_DEMO_SCREENSHOTS=1`)
- `bun run build` exits 0 — route appears as `/demo/conveyor/[tag]`
- `tsc --noEmit -p .` clean

**NOT deployable yet — needs the demo seed on prod:**
- Screenshots in `docs/promo-screenshots/2026-05-15_demo-conveyor-001_ipad-{landscape,portrait}.png`
- The mocked Playwright path works but needs a local dev server with stubbed next-auth JWE cookies at the middleware layer (the `jose`-based middleware in `mira-hub/src/middleware.ts` decrypts cookies in the edge runtime — `page.route()` can't intercept that). I judged spinning up that infrastructure as exceeding the autonomous session's value.
- **Operator path to screenshots:** once prod is restored + demo seed is loaded, hit `https://app.factorylm.com/demo/conveyor/CV-001` on the actual iPad and screenshot from there. That's the better proof anyway.

---

## ⚠️ Local-main hygiene note (worth knowing before you `git pull`)

The local `main` checkout at `/Users/charlienode/MIRA` is **3 commits ahead of `origin/main`**:
- `a27423a3 docs(wiki): eval-fixer run 2026-05-15 — same stale scorecard, suppressed dup issue`
- `66e22ce8 fix(cmms): atlas carousel logo — replace hardcoded 'JSON Web Token' alt`
- `22e9a30d docs(wiki): eval-fixer run 2026-05-13`

These appear to be from auto-routines that committed but never pushed. They're not in any session's PR. Decide whether to push, squash, or drop — but `git pull --rebase` should handle them cleanly because origin doesn't have conflicting changes.

---

## 🛑 Out-of-scope items still pending — operator-only

These were carried forward from the morning handoff and were NOT touched this session (autonomous-run skill's scope discipline):

| Item | Why operator | Source |
|---|---|---|
| **VPS investigate prod-hang (this lead)** | SSH to VPS; debug stuck nginx/upstreams | New this session |
| VPS deploy of #1306 (edge-safe middleware) | Same | morning handoff #1303 |
| VPS bring-up of `mira-mcp` (port 8001 dead) | Same | morning handoff #1304 |
| Verify migrations 014–018 on prod NeonDB | VPS-side bot DB check | morning handoff #1305 |
| Bot restart for GS10/Micro820 KB rows | Same | morning handoff #1308 |
| Stripe test → live keys in Doppler `factorylm/prd` | Live billing; needs explicit auth | morning handoff |
| Slack Messages Tab enable | Manual Slack admin UI click | morning handoff |
| Physical conveyor + Micro820 boot procedure on-site | Hardware, on-site only | morning handoff |
| Bravo Mac Docker daemon down (#1284) | Different node | morning handoff |

---

## 🔁 Resume command (next session)

```bash
cd ~/MIRA
git fetch origin
# Inspect the 3 local-ahead commits on main, then either push or drop
git log origin/main..main --oneline
# Continue from this worktree if work stays open
cd ~/MIRA/.claude/worktrees/demo-may21-finish
git pull --rebase
# OR fresh worktree off updated main:
# git worktree add ~/MIRA/.claude/worktrees/<name> -b <branch> origin/main

# Check prod health first
curl -sS https://app.factorylm.com/api/health --max-time 10

# Then PR review/merge
gh pr list --state open --search "is:open base:main author:@me"
gh pr checks 1297 1313 1314 1315 1317
```

---

## Files of note (this session)

- `mira-hub/src/app/demo/conveyor/[tag]/page.tsx` (NEW, 330 lines)
- `mira-hub/tests/e2e/demo-conveyor.spec.ts` (NEW, smoke + gated mocked-render)
- `.claude/worktrees/demo-may21-finish/PLAN.md` (session scope + spec corrections)
- The 4 rebased branches above

## What did NOT make it to disk

- Real `docs/promo-screenshots/2026-05-15_demo-conveyor-001_*` PNGs (requires either prod-deployed seed or mocked next-auth at middleware level)
- Any VPS-side change (out of scope; `prod-guard.sh` denies; prod itself is hung so even read-only checks would fail)
