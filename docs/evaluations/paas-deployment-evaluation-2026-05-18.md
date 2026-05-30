---
date: 2026-05-18
author: Claude (Opus 4.7)
status: recommendation — pending Mike's review
related:
  - .github/workflows/deploy-vps.yml
  - docker-compose.saas.yml
  - install/up.sh
  - oracle-bootstrap.sh
---

# PaaS Deployment Evaluation — Factory LM / MIRA

> **TL;DR for the impatient.** You are 3 days from a demo with a working 14-service production deploy on Oracle Cloud. **Do not migrate the production deploy this week.** Add a staging environment on the same VM (different ports + Doppler `factorylm/stg`) using the same `docker compose` pattern you already have. Post-demo, adopt **Coolify** as the operator surface on a second VM (staging first, then prod). Keep `factorylm.com` marketing on a static host (Cloudflare Pages or Vercel) only if you actually split it out of `mira-web` — today both marketing and app are served by `mira-web` (Hono+Bun), so there is nothing static to lift.

---

## 1. Codebase reality check

15 service directories, of which **11 are containerized and shipped in production** (`docker-compose.saas.yml`, 624 lines, 14 services including upstream images like Open WebUI, Nango, Atlas, Docling).

| Group | Services | Runtime |
|---|---|---|
| Web/UI | `mira-web` (Hono+Bun :3200), `mira-hub` (Next.js 16 standalone :3101), `mira-core` (Open WebUI :3010) | Long-running |
| Diagnostic core | `mira-pipeline` (FastAPI :9099), `mira-mcp` (FastMCP :8765), `mira-bots/{telegram,slack}` (no inbound port), `mira-bridge` (Node-RED :1880) | Long-running |
| Ingest / KB | `mira-ingest` (FastAPI :8002→8001), `mira-docling` (:5001), `mira-crawler` (Celery + Redis) | Worker + Beat |
| CMMS | `atlas-db` (Postgres 16 :5433), `atlas-api`, atlas-frontend, MinIO | Containers + named volumes |
| SaaS infra | `mira-relay` (Starlette), `mira-cmms-sync`, `nango-server` + `nango-db` (Postgres) | Long-running |
| Legacy / deferred | `mira-sidecar` (ChromaDB, sunset pending), `mira-connect` (no container) | — |
| Out of scope | `mira-scan-monday` (own compose, separate product), `mira-ignition-exchange`, `mira-machine-logic-graph` | — |

**Databases.** NeonDB external (every Python + JS service hits it directly with the `NEON_DATABASE_URL` Doppler secret); Atlas Postgres + Nango Postgres + ChromaDB containerized with named volumes; SQLite for `mira-core` + `mira-bridge` (WAL, UID 1001 bind-mount — see `scripts/host_perm_setup.sh`).

**Background workers.** `mira-crawler` runs Celery worker + optional Beat against Redis (broker); `mira-hub` has a separate `Dockerfile.sync-worker`; `mira-cmms-sync` is a one-script-loop container in `docker-compose.sync.yml`.

**Secrets.** 100% Doppler-managed. `doppler.yaml` pins project `factorylm`, config `prd`. **No `env_file:` anywhere** in `docker-compose.saas.yml` — every secret is shell-interpolated at compose-up time via `doppler run -- docker compose ...`. This single fact filters out half the PaaS market: anything that can't accept env vars from a CLI wrapper at deploy time has to learn to.

**CI/CD.** 16 GitHub Actions workflows. `ci.yml` is the lint/test/SAST gate. `smoke-test.yml` pings `factorylm.com` + `app.factorylm.com` and gates `deploy-vps.yml`. `deploy-vps.yml` SSHes to `root@165.245.138.91` (Oracle Cloud, not DigitalOcean despite the workflow name), `git reset --hard origin/main`, `docker rm -f` stale targets, `doppler run -- docker compose -f docker-compose.saas.yml build/up`. `apply-migrations.yml` and `apply-seeds.yml` are manual-dispatch psql wrappers against NeonDB.

**Missing locally** (but referenced in the user's prompt): `docs/environments.md`, `docker-compose.staging.yml`, `.github/workflows/staging-gate.yml`. These are not in the current worktree — they are in PRs #1386 / #1415 that have not landed on this branch. Treat them as **in-flight, not done.**

**Marketing site.** There is no separate static site. `factorylm.com` is served by `mira-web` (Hono server, not Next.js, not static-exportable). The `marketing/` directory in the repo is content/assets (comic-pipeline, videos, prospects), not a deployable web property.

---

## 2. The constraints that filter the options

From CLAUDE.md, `~/factorylm/CLUSTER.md`, and the situation:

1. **License Apache 2.0 or MIT.** (PRD §4.) Filters out commercial-only PaaS daemons.
2. **No Kubernetes.** (Mike's request; also Cluster Law 3 — keep orchestrator small.)
3. **Solo founder, T-3 days to demo.** Big migrations off the table this week.
4. **Doppler is the secret source of truth.** Anything that mandates its own secret vault doubles the rotation work.
5. **14-service compose, named volumes, host networks pre-created externally, UID-1001 bind-mount.** A PaaS that "just runs your Dockerfile" is not enough — needs real `docker-compose.yml` ingestion, named volumes, and external networks.
6. **NeonDB stays external.** No PaaS managed Postgres needed for the primary store. (Atlas + Nango Postgres are containerized; named volume on VM is fine.)
7. **Cluster Law 1: Evidence-only completion.** No "trust me, it'll work" — the deploy must produce a healthcheck pass.

---

## 3. Options compared

Scored against the constraints above. Scale: ✅ good fit / 🟡 workable / ❌ bad fit.

| Criterion | **Coolify** | **Dokploy** | **CapRover** | **Railway** | **Render** | **Vercel/CF Pages** | **Stay on VM + docker compose** |
|---|---|---|---|---|---|---|---|
| License | ✅ Apache 2.0 | ✅ MIT/Apache 2.0 | ✅ Apache 2.0 | 🟡 Managed (SaaS) | 🟡 Managed (SaaS) | 🟡 Managed (SaaS) | ✅ n/a |
| Self-hostable on existing Oracle VM | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| First-class `docker-compose.yml` | ✅ Native (v4+) | ✅ Native (primary model) | 🟡 One-app-per-service (no compose import) | 🟡 Recent compose support, opinionated | ✅ via `render.yaml` blueprint | ❌ Static / Workers only | ✅ Native |
| External Docker networks (`core-net`, `bot-net`) | ✅ | ✅ | ❌ Owns its network | ❌ Owns its network | 🟡 service-discovery, but not arbitrary | ❌ | ✅ |
| Named volumes (NPM/UID 1001 quirks) | ✅ | ✅ | 🟡 | ❌ Ephemeral by default | 🟡 Disks paid | ❌ | ✅ |
| Multi-service stack (14 containers) | ✅ One project per env | ✅ One project per env | 🟡 14 separate apps to wire | 🟡 Pricey at this count | 🟡 14 services = $$$ | ❌ | ✅ |
| Staging/prod separation | ✅ Built-in environments | ✅ Built-in environments | 🟡 Manual via duplicated apps | ✅ Environments | ✅ Environments | ✅ Preview branches | 🟡 Roll your own (compose-staging.yml + Doppler `stg`) |
| Doppler secret injection | 🟡 Set vars in UI per env (or use `doppler secrets download` in build hook) | 🟡 Same | 🟡 Same | 🟡 Same | 🟡 Same | 🟡 Same | ✅ Native — already wired |
| Preview deploys per PR | ✅ Yes (per-branch URL) | ✅ Yes | ❌ | ✅ | ✅ | ✅ | ❌ Not without work |
| Rollback UI | ✅ One-click previous image | ✅ One-click | 🟡 Manual `docker tag` swap | ✅ | ✅ | ✅ | ❌ Manual `git reset` |
| SSL / domains | ✅ Traefik + Let's Encrypt auto | ✅ Traefik auto | ✅ NGINX + LE auto | ✅ | ✅ | ✅ | 🟡 Manual nginx + certbot (already done) |
| Background workers (Celery + Beat) | ✅ Native (worker service type) | ✅ Native | 🟡 Side-app per worker | ✅ But $$$ | ✅ Background worker SKU | ❌ | ✅ Already running |
| External NeonDB | ✅ Just an env var | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cost (14 services, modest traffic) | $0 (your VM) | $0 (your VM) | $0 (your VM) | $80–200+/mo | $100–250+/mo | Free for static | ~$25/mo Oracle VM |
| Lock-in | Low (it's docker compose under the hood) | Low | Low-ish | Medium-high | Medium | Low (just static files) | None |
| Maturity / community | 35k+ stars, active | ~15k stars, newer, fast-moving | 12k stars, mature but stagnant | Commercial | Commercial | Commercial | n/a |
| Operator complexity for a solo founder | 🟡 Real UI + docs to learn | ✅ Simpler than Coolify | 🟡 Older patterns | ✅ Easiest of all | ✅ | ✅ | ✅ You already know it |
| Time to migrate from current state | 1–2 days (compose import + DNS) | 1 day (compose import + DNS) | 1 week+ (must decompose) | 1 week+ (decompose + price model) | 1 week+ (decompose + render.yaml) | n/a — wouldn't move app | 0 — you're already there |
| Risk to the demo (T-3 days) | High if attempted now | High if attempted now | Very high | High + bill shock | High + bill shock | Low (only if marketing splits out) | Zero |

---

## 4. What we already have (and what's nearly there)

| Asset | State | What it gives us |
|---|---|---|
| `docker-compose.saas.yml` (624 lines, 14 services, container_name pinned, healthchecks) | ✅ Production | The "blueprint" any PaaS would import |
| `deploy-vps.yml` (SSH → git reset → doppler run → compose up) | ✅ Working, gated by smoke-test | Existing prod deploy; **don't touch until post-demo** |
| `apply-migrations.yml` + `apply-seeds.yml` | ✅ Manual dispatch, dry-run/apply modes | NeonDB schema/data control — orthogonal to PaaS choice |
| Doppler `factorylm/dev`, `factorylm/stg`, `factorylm/prd` | ✅ Configs exist | Per-env secret injection is solved |
| `docs/environments.md` (PR #1415) | 🟡 In-flight, **not in this branch** | Will document the env contract |
| `docker-compose.staging.yml` (PR #1386 — staging-gate) | 🟡 In-flight, **not in this branch** | Drop-in replacement of `-f` flag in deploy-vps.yml for a second target |
| `staging-gate.yml` workflow (PR #1386) | 🟡 In-flight | Reuses the smoke-test pattern for staging |
| Networks pre-created on host (`install/up.sh`) | ✅ | Whatever PaaS we pick must allow external networks |
| `oracle-bootstrap.sh` | ✅ Idempotent VM provisioner | Re-run on a second VM to get a clean staging host in ~15 min |

The honest read: you are **80% of the way to a Coolify-equivalent operator surface already**, hand-rolled. The remaining 20% is the UI (rollback button, per-PR preview, secrets-in-UI), and a non-zero amount of operator pain (UID-1001 chown, manual nginx config, no rollback button).

---

## 5. Opinionated recommendation

### Phase 0 — This week (T-3 days to demo). DO NOTHING NEW IN PROD.

The single highest-leverage move before the demo is **not** picking a PaaS. It is making sure prod isn't broken when you show it. Concretely:

1. **Freeze `main` for non-critical merges** until the demo lands. Cluster Law 1 — don't ship what you can't smoke-test.
2. **Merge the in-flight staging work (PRs #1386 + #1415)** so `docker-compose.staging.yml`, `staging-gate.yml`, and `docs/environments.md` actually exist on `main`. Without those there is no "staging" to point at.
3. **Stand up staging on the same Oracle VM**, different host ports (e.g. `mira-pipeline-staging` on `:9098`, `mira-hub-staging` on `:3102`), Doppler `factorylm/stg`. Same `oracle-bootstrap.sh`, same nginx, just a second server block per service. Cost: $0, time: half a day.
4. **The deploy-vps.yml split** (`-f docker-compose.saas.yml` for prod, `-f docker-compose.staging.yml` for staging) is the only code change required. Trigger: `staging-gate.yml` runs on every PR; manual deploy-vps for prod after smoke + staging green.

This **gives you the dev/staging/prod separation Mike asked for** without introducing a single new tool before the demo. Use the days you save to harden the demo path.

### Phase 1 — Post-demo (Weeks 2–4). Adopt **Coolify** for staging.

Once the demo is behind you, install Coolify on a **separate** small Oracle VM (free tier or ~$5/mo droplet — do not co-host with prod the first time). Why Coolify specifically:

- **Native `docker-compose.yml` import.** Point it at `docker-compose.staging.yml`, set env vars (or run `doppler secrets download --no-file --format env` in a pre-deploy hook to inject the whole `factorylm/stg` config as native Coolify env), let it manage Traefik + Let's Encrypt for `*.staging.factorylm.com`.
- **Per-PR preview deploys.** This alone is worth the install — staging a PR without re-bouncing the shared staging stack is the single biggest solo-founder velocity win on this list.
- **Apache 2.0**, satisfies PRD §4.
- **Rollback button.** No more `ssh root@oracle && git reset --hard <sha> && docker compose up` at 11pm.
- **Larger community than Dokploy** (35k+ vs 15k stars) — when you hit the inevitable UID-1001-style host quirk, the answer exists on Discord.
- **External Docker networks supported** — your `core-net` / `bot-net` topology survives.
- **Doppler stays the source of truth** — Coolify just renders the env block; you keep a single Doppler config per env and re-sync when secrets rotate.

The week-1 spike is: install Coolify on staging VM → import `docker-compose.staging.yml` → run one PR through preview → compare against `staging-gate.yml` output. If it matches, you have a parallel deploy path you trust.

### Phase 2 — Post-staging-is-proven (Month 2+). Cut prod over to Coolify, **same machine**.

Once Coolify has run staging for ~2 weeks with no surprises:

1. Install Coolify on the prod Oracle VM (it co-exists with running containers).
2. Import `docker-compose.saas.yml` into Coolify as a second project.
3. Cut DNS over service-by-service, lowest-risk first (`mira-bot-telegram`, `mira-bot-slack`, `mira-relay`), then web UIs (`mira-web`, `mira-hub`), then the chat path (`mira-pipeline`, `mira-mcp`, `mira-ingest`) last.
4. Decommission `deploy-vps.yml` only after every service is running under Coolify and you've rolled back at least once.

### Why not the others

| Option | Why not |
|---|---|
| **Dokploy** | Strong second choice and genuinely simpler than Coolify. If the Coolify UI ever feels like ceremony, switch — both import the same `docker-compose.yml`. The deciding factor for now is community size / answer-availability when you hit a problem at 11pm. |
| **CapRover** | App-centric model. Your 14-service compose decomposes into 14 separately-wired apps; you lose `depends_on`, named-network topology, and the single `docker compose up`. Wrong shape for your codebase. |
| **Railway / Render** | Both work, both will bill you $100–250/mo for 14 services and background workers. You'd also be migrating off a working Oracle VM that costs you $0/mo (Always Free tier) or ~$25/mo. Cost/value is bad and lock-in is real. Re-evaluate only if you outgrow self-hosting. |
| **Vercel / Cloudflare Pages for marketing** | There is no separate marketing site to lift. `factorylm.com` is `mira-web` (Hono server). Revisit only if you extract a static landing into its own subtree — at which point Cloudflare Pages is the obvious choice (free, fast, branch previews). Until then this is a non-decision. |
| **Kubernetes** | Filtered out per Mike's instruction. (Also: 14 services + 1 operator is the exact midpoint where K8s costs more than it gives.) |

---

## 6. Concrete next-action checklist

**Before demo (this week):**
- [ ] Cherry-pick / merge PR #1386 (`docker-compose.staging.yml` + `staging-gate.yml`) onto `main`.
- [ ] Cherry-pick / merge PR #1415 (`docs/environments.md`) onto `main`.
- [ ] Confirm Doppler `factorylm/stg` config has every key in `factorylm/prd` (no missing secrets at compose-up time).
- [ ] On the Oracle VM, dry-run `doppler run --project factorylm --config stg -- docker compose -f docker-compose.staging.yml config` and fix any unresolved env refs.
- [ ] Add staging hostnames to `nginx-oracle-v2.conf` (`staging.factorylm.com`, `staging-app.factorylm.com`) and reload nginx.
- [ ] Smoke-test staging end-to-end once (Slack message → pipeline → hub).

**Post-demo (Week 2):**
- [ ] Provision second Oracle VM via `oracle-bootstrap.sh`.
- [ ] Install Coolify on it (one-line installer per Coolify docs).
- [ ] Import `docker-compose.staging.yml`, set `*.staging.factorylm.com` domains, configure GitHub webhook for per-PR previews.
- [ ] Run 5 PRs through Coolify preview; compare deploy time, rollback ergonomics, and secret-injection workflow against the hand-rolled flow.
- [ ] Decision point: keep Coolify or fall back. Document outcome in this file.

**Month 2 (only if Coolify proves out):**
- [ ] Install Coolify on prod VM; import `docker-compose.saas.yml`.
- [ ] Cut bots first, then web UIs, then chat path.
- [ ] Decommission `deploy-vps.yml`.

---

## 7. Risks & how we'd mitigate

| Risk | Likelihood | Mitigation |
|---|---|---|
| Coolify can't honor external Docker networks `core-net`/`bot-net` as-imported | Medium | Coolify v4 supports `networks: { external: true }` in compose; verify on staging before prod cutover. If it fails, declare networks inside the Coolify project and rename references — one-line PR. |
| Doppler `factorylm/stg` is missing keys present in `prd` | High | `doppler secrets --project factorylm --config stg --raw | sort > /tmp/stg.txt` vs prd; diff before first staging boot. |
| UID-1001 bind-mount permissions on Coolify-managed volumes | Medium | Switch SQLite mounts to named volumes (Coolify-friendly) or run `scripts/host_perm_setup.sh` as a Coolify pre-start hook. |
| Per-PR previews multiply Atlas/Nango Postgres containers and blow VM disk | Medium | Configure previews to skip CMMS + Nango (the rarely-changing stateful pieces); reuse the staging instances by passing their hostnames via env override. |
| Solo founder absorbs another tool's mental overhead pre-demo | Very High this week | This is exactly why Phase 0 is "do nothing new in prod." Coolify adoption is post-demo, period. |

---

## 8. Honest tradeoffs

- **Coolify isn't free of operator pain.** It moves the pain from "where is my deploy script?" to "where in the Coolify UI is the setting that controls this?" The trade is worth it because it adds rollback + previews, not because it removes work.
- **Staying on the hand-rolled stack indefinitely is a real option.** You already have a working CI gate, smoke test, and deploy. If staging-gate.yml + a second Doppler config gets you to "prod doesn't break," you may not need a PaaS at all until you hire a second engineer. The cost of *not* adopting Coolify is approximately zero functional regressions and one missed UX win (preview deploys). That is a defensible choice.
- **The biggest "PaaS-shaped" win you're missing isn't a PaaS — it's preview deploys.** If only one feature is worth migrating for, it's this. Everything else (rollback, secrets, SSL, multi-env) you can replicate in two days of bash on the existing setup.

---

## 9. References

- `docker-compose.saas.yml` — 624 lines, 14 services, the production blueprint
- `.github/workflows/deploy-vps.yml` — current SSH-based prod deploy
- `.github/workflows/smoke-test.yml` — production health gate
- `.github/workflows/apply-migrations.yml` / `apply-seeds.yml` — NeonDB-only, orthogonal to PaaS choice
- `install/up.sh` — pre-creates external Docker networks
- `oracle-bootstrap.sh` — VM provisioner (Docker + nginx + certbot + Tailscale + Doppler)
- `doppler.yaml` — pins `factorylm/prd` as default config
- `.claude/rules/security-boundaries.md` — Doppler-only secrets, no `.env` in git
- PRD §4 (in root `CLAUDE.md`) — Apache/MIT only, no LangChain/n8n abstractions
- Cluster `~/factorylm/CLUSTER.md` — Law 1 (evidence-only completion), Law 3 (300-line orchestrator)
- Coolify docs: <https://coolify.io/docs>
- Dokploy docs: <https://docs.dokploy.com>

---

**Recommendation, in one line:** Ship the staging slice you already have in flight (PRs #1386 / #1415), demo on the current Oracle VM stack, and adopt Coolify post-demo on a separate VM for staging before cutting prod over. Do not migrate prod this week.
