# Site Hardening Plan — 2026-04-30

**Author:** agent-claude (audit + triage)
**Window before first paid demo:** 2026-05-04 (4 days)
**Audit scope:** factorylm.com + app.factorylm.com + cmms.factorylm.com + the DigitalOcean VPS (165.245.138.91 / 100.68.120.99) hosting the SaaS stack

This is plan-only. No code changes. Triage owner: Mike.

---

## Anchoring on the 90-day plan

**Unit 8** in `docs/plans/2026-04-19-mira-90-day-mvp.md` is "Atlas one-way sync hardening" — wrap `create_work_order()` in retry+outbox so a Atlas outage doesn't drop work orders. **That is orthogonal to this plan.** Site-hardening (this doc) is about the public-facing edge: HTTP headers, auth tokens, rate limits, OS-level controls. Both are needed; they don't conflict; pick whichever is more pressing first. Recommendation: **site hardening before first paid demo, Unit 8 in week 6 as planned** — public-facing risk is "embarrassment / data" (today), Atlas-write resilience is "lost work orders" (only matters once a customer is actively using Atlas writes, which is post-onboarding).

---

## Methodology

What I actually checked (not a generic checklist):

- `curl -I` against `factorylm.com`, `app.factorylm.com`, `factorylm.com/cmms` for live response headers
- 8 rapid POSTs to `/api/v1/inbox/email` and 3 rapid POSTs to `/api/register` to observe rate limiting
- `mira-web/src/lib/auth.ts` (JWT config, expiry, source precedence) and `mira-web/src/server.ts` (middleware, CORS)
- `mira-web/src/lib/stripe.ts` and `lib/mailer.ts` for webhook signature handling and dependency posture
- `mira-web/package.json` for dep ages + license
- VPS: `ufw status verbose`, `sshd -T`, `systemctl is-active fail2ban unattended-upgrades`, `ss -tlnp`, `nginx -T`, `certbot certificates`
- External probe of Docker-bound ports (5432/6379/5555/3000/3200/8100/9002) from this laptop to verify whether they're publicly reachable
- Doppler `secrets --only-names` to confirm what's centralized
- Search for any error-tracking SDK (Sentry, Datadog) in mira-web

Not checked (would extend audit further):
- mira-mcp, mira-pipeline, mira-bots auth (they sit behind VPS firewall on Tailscale-only — lower exposure)
- ChromaDB / mira-sidecar (sunset pending per CLAUDE.md)
- Atlas CMMS internals (third-party app)

---

## P0 — must-fix before paid demo (May 4)

Real risk that could embarrass us or burn data.

### P0.1 — JWT accepts `?token=` query param → URL leakage everywhere

**Where:** `mira-web/src/lib/auth.ts:71` — `const query = c.req.query("token")`. Any request with `?token=<jwt>` authenticates. That JWT then leaks into:
- nginx access logs (`/var/log/nginx/access.log`, 14-day retention) — anyone with shell on the VPS reads sessions
- Browser history of the customer's device
- HTTP `Referer` header sent to any third-party (analytics, image CDN, Stripe, embedded iframe)

**Fix:** delete the `query` source from `requireAuth`, `requireActive`, `requireAdmin` (3 functions, same shape). Keep `Authorization: Bearer` and `mira_session` cookie. Audit any links emitted by the system that include `?token=` and convert them to set-cookie redirects (Magic Link, activated email, /api/cmms/login already do this).

**Effort:** 2 hours (code + scrub call sites + manual smoke test of magic-link → /activated → /cmms login flow).

**Autonomous?** Yes — no secret rotation needed.

### P0.2 — JWT expiry is 30 days

**Where:** `mira-web/src/lib/auth.ts:22` — `const JWT_EXPIRY = "30d"`. Combined with no revocation list, a stolen JWT is valid for 30 days. For a $97/mo SaaS pre-launch this is too generous.

**Fix:** drop to 24h or 7d (Mike's choice). Issue a refresh-flow if 24h is too aggressive for current UX. Easiest interim: 7 days. Document the rotation cadence ("PLG_JWT_SECRET rotates quarterly; that flushes all sessions").

**Effort:** 30 min (one-line constant change + one decision).

**Autonomous?** Yes.

### P0.3 — CORS wildcard on every route including `/api/*`

**Where:** `mira-web/src/server.ts:164` — `app.use("*", cors())` with no config = `Access-Control-Allow-Origin: *`. Confirmed live (`Access-Control-Allow-Origin: *` in `curl -I https://factorylm.com/`). Any origin can `fetch()` from `/api/register`, `/api/v1/inbox/email`, etc. JSON GETs are also exposed. For pure-public marketing endpoints this is fine; for `/api/*` it's an unnecessary attack surface.

**Fix:** scope `cors()` to `/api/*` only with an explicit origin allowlist (`factorylm.com`, `www.factorylm.com`, `app.factorylm.com`, `localhost:3000`/`3200` for dev). Hono's `cors()` accepts `origin: string | string[] | (origin) => string | null`.

**Effort:** 30 min (config + verify magic-link CMMS handoff still works, since it crosses domains).

**Autonomous?** Yes.

### P0.4 — No rate limit on `/api/v1/inbox/email` or `/api/register`

**Where:** observed empirically — 8 rapid POSTs to inbox + 3 rapid POSTs to register all returned the same response with no throttle. The inbox endpoint does HMAC compute on every request; sustained junk traffic burns CPU and floods logs. Register creates DB rows (rate limit needed to prevent enumeration/DoS).

**Fix:** Hono middleware that token-buckets per IP (10 req/min on inbox, 3 req/min on register, 100 req/min default elsewhere). Use in-memory map keyed by `c.req.header("x-forwarded-for") || c.env.remote.address`. No Redis required for n=1 customer scale.

**Effort:** 1.5 hours (middleware + tests + tune limits).

**Autonomous?** Yes.

### P0.5 — SSH `PasswordAuthentication yes` is effective

**Where:** `sshd -T` output: `passwordauthentication yes`. The `60-cloudimg-settings.conf` tries to set it to `no` but is overridden by `50-cloud-init.conf`. Root is forced to key-only via `PermitRootLogin without-password` (✅ that part is fine), but any non-root user can SSH with a guessable password. No `fail2ban` to throttle brute-force attempts.

**Fix:** edit `/etc/ssh/sshd_config.d/50-cloud-init.conf` (or add a `99-hardening.conf` that loads last and forces `PasswordAuthentication no`). Reload with `systemctl reload ssh`. Verify with `sshd -T | grep passwordauth`.

**Effort:** 5 min.

**Autonomous?** Mike-hands. Risk: if any user without an authorized SSH key relies on password auth, they get locked out. Mike must confirm all users have keys before reload.

### P0.6 — nginx `.bak` files in `/etc/nginx/sites-enabled/` are actively loaded

**Where:** `nginx -T` confirms it loads:
- `mira.bak.20260426-082325`
- `mira.bak.inbox`
- `mira.bak.phase1`

Plus `factorylm-landing` plain file. nginx loads everything in `sites-enabled`; the convention "files without .conf are ignored" is wrong (debian-style ignores `.bak` only when `include sites-enabled/*.conf` is set; this VPS uses `include sites-enabled/*` per the config). Result: **two `server_name factorylm.com` blocks exist**, which means nginx behavior is undefined / first-wins, fragile under a config reload, and could route real traffic to a stale config.

**Fix:** `mv /etc/nginx/sites-enabled/*.bak* /root/nginx-attic/ && nginx -t && systemctl reload nginx`. Done.

**Effort:** 5 min.

**Autonomous?** Mike approval first (touches prod nginx). Tier-1 risk: low if `nginx -t` passes before reload.

---

## P1 — must-fix before scale (5 → 50 customers)

Acceptable for first 5; not for 50.

### P1.1 — No CSP on `factorylm.com` apex

**Where:** `app.factorylm.com` has a CSP. `factorylm.com` does NOT. Confirmed by `curl -I`. Marketing site = lower risk than the app, but still: any XSS in user-generated content (blog comments, future) executes freely.

**Fix:** mirror the app CSP on the apex nginx server block, allowing the third-party scripts the marketing site loads (PostHog, Google Fonts, Stripe.js if used). Start in `Content-Security-Policy-Report-Only` mode for a week to catch breakage before enforcing.

**Effort:** 1 hour (write policy + dry-run + flip to enforce after observation period).

### P1.2 — No error tracking (no Sentry, no equivalent)

**Where:** searched mira-web — only PostHog (analytics) is loaded. No Sentry SDK, no Datadog, nothing. Mike's only path to discovering an error is `docker logs mira-web --since 1h | grep -i error` (which is exactly how today's "Telegram noise" sweep was done — by hand). At 50 customers this won't scale.

**Fix:** Sentry free tier (5k errors/mo) or Better Stack ($30/mo for unified errors+uptime). Plumb `@sentry/bun` into `server.ts` startup. PII scrubbing config for email/JWT in error context.

**Effort:** 2 hours (sign up + integrate + verify a thrown error appears).

**Autonomous?** Mike-hands for the signup + DSN; agent can wire the SDK once the DSN is in Doppler.

### P1.3 — No external uptime monitor

**Where:** no Pingdom/UptimeRobot/Better Stack subscription evidence. If `mira-web` crashes at 03:00 UTC, Mike learns about it when a customer emails. The DigitalOcean monitoring agent provides VPS-level metrics but not HTTP health.

**Fix:** Better Stack free tier (10 monitors). Probe `/api/health`, `/`, `/cmms`, `/api/v1/inbox/email` (expects 401 on bad sig as a heartbeat). Telegram alert on 2 consecutive failures.

**Effort:** 30 min.

**Autonomous?** Mike-hands for signup; agent can write the runbook for the alert path.

### P1.4 — `fail2ban` not installed

**Where:** `systemctl is-active fail2ban` → inactive. SSH brute-force attempts hit a stock-Ubuntu box with no rate limit beyond what sshd enforces by default (which is generous). Combined with P0.5 (password auth on), this is a meaningful exposure window.

**Fix:** `apt install fail2ban` + the default `[sshd]` jail. After P0.5 lands the surface is much smaller, but fail2ban is still cheap insurance.

**Effort:** 15 min.

**Autonomous?** Mike-hands (touches prod packages).

### P1.5 — `PLG_JWT_SECRET` has no documented rotation cadence

**Where:** secret exists in Doppler. No runbook for rotating. With P0.2 down to 7d expiry, a quarterly rotation flushes any compromised token within the JWT lifetime.

**Fix:** add to `wiki/runbooks/secret-rotation.md` (file may not exist yet — create) — cadence, command, blast radius (rotation logs out all customers), pre-comms script.

**Effort:** 1 hour (doc only).

### P1.6 — `stripe@17.7.0` two majors behind

**Where:** `mira-web/package.json` pins stripe ^17.7.0. Latest is v22. Dependabot PR #787 already proposes the upgrade. Major bumps in the Stripe SDK occasionally include security-relevant changes and improved webhook signature verification.

**Fix:** review + merge Dependabot PR #787 with smoke-test of the checkout flow.

**Effort:** 30 min if PR #787 is green; ≤2h if there's a breaking change to address.

### P1.7 — VPS-local data unbacked

**Where:** NeonDB has managed point-in-time-recovery (Neon's default). But VPS-local data is unbacked:
- `/opt/mira/mira-bridge/data/*.db` (SQLite — bot interactions, queue state)
- `/opt/mira/manuals/` (downloaded OEM PDFs — re-downloadable but slow)
- `/opt/mira/agent_state/daily_context.json` (today's agent state)
- Doppler config history is held by Doppler — that part's fine

**Fix:** nightly `tar` of `/opt/mira/{mira-bridge/data,agent_state,manuals/index}` → DigitalOcean Spaces (or Backblaze B2 — cheaper). 7-day retention. Document RPO ≤ 24h, RTO ≤ 1h for restore.

**Effort:** 2-3 hours (script + cron + Spaces creds + restore drill).

**Autonomous?** Mike-hands for Spaces credentials; agent can write the script + restore runbook.

---

## P2 — track but don't block

| # | Item | Why P2 |
|---|---|---|
| P2.1 | nginx `Server` header reveals `nginx/1.24.0 (Ubuntu)` | Information disclosure only; one-line `server_tokens off` fix any time |
| P2.2 | `X-XSS-Protection: 1; mode=block` is set (deprecated) | Harmless, but cargo-cult — modern browsers ignore it. CSP supersedes |
| P2.3 | Document RPO/RTO targets in `wiki/runbooks/` | Useful for SOC 2 if it ever comes up; not blocking |
| P2.4 | JWT revocation list (denylist of compromised JTIs) | Only relevant after first paid customer; rotate-secret is fine for n<5 |
| P2.5 | Audit-log retention policy | Compliance signal for enterprise customers. Currently nginx 14d, no app-level audit trail beyond `recordAuditEvent` calls |
| P2.6 | Verify Docker port external reachability stays blocked | External probe today shows all blocked (DigitalOcean cloud firewall + iptables). Should be re-verified after any compose change that adds new published ports |

---

## Recommended order of operations

For Mike to execute (or delegate). Each row is one Telegram-able chunk.

1. **(20 min, agent)** Open one PR with P0.1 + P0.2 + P0.3 stacked — they all touch `mira-web` middleware and ship together cleanly. Review + merge + VPS rebuild.
2. **(1.5 h, agent)** Open a second PR for P0.4 — rate-limit middleware is its own concern, deserves its own review.
3. **(10 min, Mike)** Run P0.5 + P0.6 on the VPS. Both are one-line sshd / nginx changes; agent can produce the exact commands. Confirm `sshd -T | grep passwordauth` and `nginx -t` after each.
4. **(5 min, Mike + 30 min agent)** Sign up Better Stack free tier (P1.3). Hand DSN to agent → agent writes monitors + alert config.
5. **(15 min, Mike)** `apt install fail2ban` (P1.4). Default config is fine for SSH-only protection.
6. **(2 h, agent + Mike)** P1.2 Sentry. Same pattern as Better Stack — Mike signs up, hands DSN, agent integrates.
7. **(2-3 h, deferred to W2)** P1.7 backups. Worth doing before first paying customer; not blocking the demo itself.
8. **(W6, per the 90-day plan)** Unit 8 — Atlas hardening. Different concern; same week 6.

P2 items: track in this doc, sweep quarterly.

---

## Total effort

- **P0 (before May 4):** ~6 hours of agent work + ~15 min of Mike's hands. All five items shippable in one focused half-day.
- **P1 (before scale):** ~1-2 days agent work + ~30 min Mike (signups for Sentry + Better Stack).
- **P2:** ad-hoc; ~2 hours total whenever there's a quiet afternoon.

If we do nothing else, **P0.1 (remove `?token=` query) and P0.4 (rate limit on inbox + register)** are the two most defensible "could embarrass us in week one" fixes. P0.5 (SSH password auth) is the most "could-burn-the-whole-VPS" fix.

---

## Where this plan lives + how it gets executed

- This document: `docs/site-hardening-plan-2026-04-30.md`
- PR with this doc: TBD — will reference issue Mike opens after triage
- Each numbered item above: separate small PR per item (or stacked when files overlap)
- Execution mode: agent-driven where marked Autonomous, Mike-hands for the rest
- Re-audit cadence: quarterly. Re-run the curl probes + `sshd -T` + `nginx -T` checks; diff against this doc.

---

# Addendum 2026-04-30 — real-user walkthrough + synthetic-user audit

Two new tracks added to the audit after the initial pass:

- **(A) Real-user walkthrough** of factorylm.com + app.factorylm.com via the Claude-in-Chrome MCP (Playwright MCP wasn't loaded; local playwright in mira-web has no browsers installed).
- **(B) Synthetic-user interaction** — triggered Rico Mendez (the live synthetic technician at `mira-bots/synthetic/rico.py`) end-to-end on the VPS and captured the full transcript.

Artifacts:
- `outputs/site-hardening-2026-04-30/walkthrough-2026-04-30.md` — site-walk findings + screenshots context
- `outputs/site-hardening-2026-04-30/rico-shift-2026-04-30T1034.md` — live Rico shift transcript

## What works (positive findings)

- `factorylm.com/` renders cleanly, hero + 3-up-features + CTA all visible above fold (1200px)
- `Start Free — magic link` CTA → `/cmms` → magic-link form → "✓ Check your inbox" confirmation. **Conversion path is functional end-to-end.**
- `app.factorylm.com/` correctly 301s unauthenticated requests to the login page; 3 sign-in options render (Google, magic link, password)
- HSTS + clickjacking + referrer + permissions headers all already present on apex (per the Pre-Addendum audit above)
- Rico's NeonDB observation pipeline writes successfully — schema is sound, 10 rows persisted

## New issues found (this addendum)

### Public site (apex + hub)

| ID | Finding | Bucket | Effort | Autonomous? |
|---|---|---|---|---|
| **WEB-1** | Magic-link signup fires a real Resend email per submit; no per-email-address dedup. Submit the same address 10× in a minute = 10 emails | P1 | 1 h | Yes |
| **WEB-2** | MIRA replies sometimes contain truncated/unbalanced markdown (`*Lo` mid-italic) — caught in Rico transcript | P1 | 1.5 h | Yes (server-side fix in mira-pipeline reply-trim logic) |
| WEB-3 | Apex returns `Content-Length: 0` on HEAD (GET works fine) — confuses uptime probes that use HEAD | P2 | 30 min | Yes |
| WEB-4 | Mobile viewport not validated this pass (Claude-in-Chrome screenshots fixed at 1200px) | P2 | re-test 30 min | Yes (install playwright browsers + re-walk at 390×844) |
| **HUB-1** | Login page exposes 3 concurrent auth surfaces (Google OAuth + magic link + **password**). Password sign-in is the new attack surface — combined with no rate limit on the credential POST, it's an open brute-force target | **P0** | 1 h (rate-limit only) or remove password auth entirely | Yes for rate-limit; Mike call on whether to keep password auth |
| HUB-3 | NextAuth `callbackUrl` query param accepts arbitrary path; need to verify the redirect callback whitelists internal-only | P1 | 30 min audit + fix | Yes |

### Synthetic users — `mira-bots/synthetic/rico.py` (PR #879, OPEN, deployed)

Live Rico shift on 2026-04-30 10:34 UTC opened with an **undergrad research question from Reddit** (corpus filter too loose), and Rico's followups were `correct`, `yep`, `yep` to MIRA's specific equipment-model questions. Conversation never reached diagnosis.

| ID | Finding | Bucket | Effort | Autonomous? |
|---|---|---|---|---|
| **SYN-1** | Off-topic scenarios from Reddit corpus (undergrad research, not maintenance fault reports) | **P0** | 2 h | Yes (tighten `load_scenarios()` filter — require `[fault_code]` regex match in title OR an `equipment_type` tag, not just keyword presence) |
| **SYN-2** | `_generate_follow_up()` returns generic fillers when keyword-match misses (which is most cases). Rico never actually answers MIRA's specific questions, so conversation loops without progress | **P0** | 4 h | Yes (replace with an LLM-driven response: a small Groq/Cerebras call asking "Rico is a night-shift tech. MIRA just said X. What does Rico say next?" — keyword fallback only on LLM failure) |
| SYN-3 | `result.fsm_advanced` is heuristic (final reply >50 chars + no `?` in first 50) — doesn't measure real progress. Marks dead loops as "advanced" in the Telegram report | P1 | 1 h | Yes (read `quality_signals.fsm_state` from the actual MIRA reply if exposed, or assert "DIAGNOSIS" or "RESOLVED" reached) |
| SYN-4 | No cron entry for Rico — only runs when triggered by hand. **Total observations in 2 days deployed: 10 rows.** The synthetic-stack-heartbeat is barely heartbeating | P1 | 5 min | Mike approval (touches `install_crons.sh`); recommend `0 */4 * * *` (every 4h) |
| SYN-5 | `rico.py:_tg_send` uses `parse_mode=Markdown` with no fallback. Same bug class as PR #886 fixed for the orchestrator | P1 | 30 min | Yes (port the `_post_telegram` retry pattern from `orchestrator.py`) |
| SYN-6 | Rico runs against production tenant + production NeonDB + production Resend + real LLM tokens. No `synthetic_test=true` marker. `synthetic_observations` rows mix into any future analytics; `random.random() < 0.4` triggers real Atlas WO creation | **P0** | 3 h | Yes (add `synthetic_user_id` column + filter views; gate Atlas WO create behind `MIRA_SYNTHETIC_DRY_RUN=true` env) |
| SYN-7 | `mira-hub` has 4 seeded personas (carlos/dana/jordan/pat) + a Playwright spec that exercises them, but no scheduled exercise — they're CI fixtures, not autonomous agents | P2 | 1 h | Yes (cron the `synthetic-day.spec.ts` once daily; alert on regressions) |

### What I'd do first (synthetic-user track only)

If you only had 30 min on the synthetic side: **flip SYN-6 first** (gate Atlas writes behind a dry-run env so Rico stops creating real work orders into Mike's prod CMMS). Then **SYN-2** (replace generic fillers with an LLM-driven response). SYN-1 falls out naturally because tightening the corpus filter takes 30 min once SYN-2 is real.

## Updated P0 list (combined site + synthetic)

| # | Item | Source | Effort | Owner |
|---|---|---|---|---|
| P0.1 | JWT accepts `?token=` query → URL leakage | original audit | 2 h | agent |
| P0.2 | JWT expiry 30d (drop to 7d) | original audit | 30 min | agent |
| P0.3 | CORS wildcard on `/api/*` | original audit | 30 min | agent |
| P0.4 | No rate limit on inbox + register | original audit | 1.5 h | agent |
| P0.5 | SSH password auth effective | original audit | 5 min | Mike |
| P0.6 | nginx `.bak` files loaded | original audit | 5 min | Mike |
| **P0.7** | **HUB-1 hub password sign-in has no rate limit** (or remove password auth entirely; magic-link + Google is enough) | addendum WEB | 1 h | agent / Mike call |
| **P0.8** | **SYN-6 Rico runs against prod with no dry-run gate** — real Atlas WOs, real LLM spend, observations mix into prod analytics | addendum SYN | 3 h | agent |
| **P0.9** | **SYN-1 + SYN-2 Rico's conversations are off-topic + filler-driven; diagnostic loop never advances** — synthetic-user system isn't actually exercising the product | addendum SYN | 6 h (2+4) | agent |

**Revised P0 total:** ~15 hours of agent work + ~15 min Mike (P0.5 + P0.6 + Mike's call on P0.7 password-auth-or-not).

## Updated recommended order

1. **(20 min, agent)** Stack PR for P0.1 + P0.2 + P0.3 (mira-web middleware, all touch the same area)
2. **(1 h, agent)** P0.7 hub password sign-in rate-limit (or removal — needs Mike's "keep or kill password auth" decision first)
3. **(1.5 h, agent)** P0.4 inbox + register rate-limit middleware
4. **(10 min, Mike)** P0.5 SSH + P0.6 nginx-bak
5. **(3 h, agent)** P0.8 Rico dry-run gate — stops the real Atlas writes, isolates the observations table
6. **(6 h, agent)** P0.9 Rico content fix — LLM-driven followups + tightened corpus filter (this is the biggest item; defer to W2 if May 4 is too tight)
7. P1 sweep per the original plan (CSP on apex, Sentry, Better Stack uptime, fail2ban, JWT rotation runbook, stripe upgrade, backups)
8. W6: Unit 8 (Atlas hardening) per the 90-day plan

P0.9 is the only item that might not fit before May 4 — it's 6 hours of careful work and could surface more bugs once Rico actually answers questions properly. Consider shipping the dry-run gate (P0.8) before May 4 and deferring the content fix (P0.9) to W2 if needed. Without P0.9, Rico is "stack-up heartbeat" — useful as smoke test, useless as evidence the product actually solves problems.

