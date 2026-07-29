# MIRA / FactoryLM — Go-To-Market Hardening Checklist

> **The master document.** Tracks everything that must be true before a stranger can use each
> product surface and pay for it. This is the single checklist the whole operation runs against.
>
> **North Star:** a stranger lands on `factorylm.com`, runs the public grounded chat, signs up on
> `app.factorylm.com`, uploads their own manual, gets a cited answer — and **nothing breaks, leaks,
> lies, or fails to charge their card.**

**Created:** 2026-06-11 · **Audited against:** `origin/main` @ `7d3483cf` (deploy truth — NOT the
local working branch, which was 66 commits behind). Live probes run against `factorylm.com` /
`app.factorylm.com` the same day.

**How to read a row:**

| Field | Meaning |
|---|---|
| **Status** | `DONE` (verified) · `IN-PROGRESS` · `BLOCKED` · `NOT STARTED` · `UNKNOWN` (needs a probe nobody has run) |
| **Owner** | `AGENT` (Claude can close it) · `HUMAN` (Mike must — credentials, billing, external dashboards) · `BOTH` |
| **Priority** | `P0` must fix before first paying customer · `P1` should fix · `P2` nice to have |
| **Evidence** | PR #, commit, `file:line`, live HTTP probe, or `gh` output. "verified by X" or "needs probe: <cmd>". |

**Sibling docs (do not duplicate — reference):**
- `wiki/orchestrator/BETA_READINESS.md` — the rotating A–F lens scorecard (Hub auth, engine, eval, promotion). The deep evidence for Surfaces 2/3/6 lives there; this doc summarizes and adds the surfaces it doesn't cover.
- `docs/hardening/hub-hardening-backlog.md` — line-level Hub HTTP-probe findings.
- `docs/known-issues.md` — broken/deferred/abandoned ledger.

---

## 0. Executive summary

| # | Surface | Verdict | One-line state |
|---|---|---|---|
| 1 | Public website (`factorylm.com`) | 🟢 **Ship-ready** | All pages 200, SEO complete, Assessment checkout wired. Higher tiers are email-only by design. |
| 2 | Public quickstart chat (`app.factorylm.com/quickstart`) | 🟡 **Hardened infra; flagship-demo refusal fix in review (PR #1877)** | Rate-limited (429), vendor-scoped, BM25-bounded. Live probe caught a **false refusal** on the canonical PowerFlex F004 demo (retrieves the right manual, then refuses) — root cause was a BM25 ranking miss, **not** vendor aliasing; fix in **PR #1877**. See Surface 2. |
| 3 | Hub (`app.factorylm.com`) | 🟢 **Ship-ready, 1 ops gap** | Auth/tenant isolation GREEN; upload→retrieval wired; Google SSO still broken (credentials login works). |
| 4 | Slack bot | 🟡 **Deployed, unverified** | In default deploy targets + last deploy green; live responsiveness never probed this cycle. |
| 5 | Telegram bot | 🟡 **Deployed, unverified** | Same; on the **prod** token (`@FactoryLM_Diagnose`). Photo→diagnosis flow not re-verified. |
| 6 | MIRA engine (shared) | 🟢 **Ship-ready, degraded redundancy** | Cascade healthy on Groq+Cerebras; **Gemini key 403** (tail provider only). Safety + citation enforce GREEN. |
| 7 | SimLab (demo/benchmark) | 🟢 **Merged to main** | Juice bottling line + doc seed + runner-recall all merged. Staging-gate wiring is the open item (#1836). |
| 8 | Infrastructure | 🟡 **Healthy, 2 payment risks** | VPS+Hub+SSL green. **DigitalOcean & NeonDB billing at risk** — HUMAN must confirm cards on file. |
| 9 | Revenue pipeline | 🔴 **Cannot charge real money** | **Stripe is in TEST mode (#1831).** No real payment can be taken until live keys are wired. |

### 🔴 P0 — must fix before first paying customer (the short list)

| # | Blocker | Owner | Evidence | Issue |
|---|---|---|---|---|
| P0-1 | **Stripe in TEST mode** — no real card can be charged. Checkout flow is code-complete; only the Doppler `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID` need to be live values. | HUMAN | **Confirmed LIVE 2026-06-11**: `GET /api/checkout/session?plan=assessment` → `checkout.stripe.com/c/pay/`**`cs_test_`**`…`. `mira-web/src/lib/stripe.ts:16-17,40` reads keys from env (mode = key prefix). | [#1831](https://github.com/Mikecranesync/MIRA/issues/1831) `ready-for-human` |
| P0-2 | **DigitalOcean VPS payment at risk** — if the card lapses, every prod surface goes dark. | HUMAN | VPS is live now (`/api/health` 200), but billing is external. needs probe: DO dashboard. | — |
| P0-3 | **NeonDB payment at risk** — DB outage = total data-plane outage (chat, KB, tenants). | HUMAN | Neon proj `divine-heart-77277150` serving now; billing external. needs probe: Neon dashboard. | — |

Everything else is P1/P2 and does **not** stop the first sale + first grounded answer once P0-1/2/3 clear.

### Top AGENT-closable items (no human credential needed)

- **Quickstart false-refusal (P1) — FIX IN REVIEW (PR #1877)** — fault-code-aware retrieval so the flagship PowerFlex F004 demo answers instead of refusing (the alias hypothesis was wrong; root cause was BM25 ranking). Merge + deploy + re-probe to close.
- `buy.html` missing `og:image` (P2) — `mira-web/public/buy.html`.
- `activated.html` missing `<meta name="description">` (P2).
- Wire `playwright.command-center.config.ts` into a staging-gated workflow (P1) — post-signup surface has no CI regression gate (BETA_READINESS Lens B).
- Apply `patches/2026-06-10-canary-reverse-drift-check.patch` (P2, detective control) — BETA_READINESS Lens B.

---

## Surface 1 — Public website (`factorylm.com`)

Hono/Bun app: static HTML in `mira-web/public/*.html`, routes in `mira-web/src/server.ts` + `mira-web/src/routes/`. Live probes 2026-06-11: `/`, `/assess`, `/pricing`, `/robots.txt`, `/sitemap.xml` → **200**.

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| All marketing pages load | DONE | — | P0 | Live: `/` `/assess` `/pricing` `/robots.txt` `/sitemap.xml` all 200. Pages: pricing, buy, assess, activated, status, trust, terms, privacy. |
| Page content accurate (no lorem/placeholder/"Coming Soon") | DONE | — | P1 | Agent grep across `public/*.html`: clean. Only gap: `activated.html` Loom block falls back to "awaiting signal" if `LOOM_UPLOAD_URL` unset (`server.ts:415`). |
| Pricing CTAs wired | DONE | — | P0 | `pricing.html:368,385,402` → `/buy` and `mailto:mike@factorylm.com`; "free Hub account" → 301 → `app.factorylm.com/signup` (`server.ts:1745`). |
| `/buy` Assessment checkout ($500) | DONE | — | P0 | `buy.html:228` → `GET /api/checkout/session` → `createDirectCheckoutSession()` (`server.ts:947-954`) → Stripe hosted page; `success_url=app.factorylm.com/feed/?checkout=success` (`stripe.ts:107`). |
| `/buy` Pilot / Operating / Enterprise checkout | NOT STARTED | HUMAN | P2 | Email-only today (`buy.html:247,266,284` → mailto). Intentional high-touch sale, or add Stripe products. `?plan=` query param is parsed-but-unused — all plans use one `STRIPE_PRICE_ID`. |
| `/assess` self-assessment works | DONE | — | P1 | Fully client-side 6-dim scorecard, `localStorage`, computes on-page (`assess.html:469,579`). No backend to break. |
| `/assess` lead capture (email) | NOT STARTED | HUMAN | P2 | No email collected on submit — no nurture for assess→buy drop-offs. Intentional per "nothing stored" copy; flag as GTM lever. |
| Stripe checkout test vs live | BLOCKED | HUMAN | **P0** | See **P0-1**. Code is mode-agnostic; mode = Doppler key prefix. [#1831](https://github.com/Mikecranesync/MIRA/issues/1831). |
| SEO: robots.txt | DONE | — | P1 | `server.ts:313` — allows GPTBot/ClaudeBot/Perplexity, blocks Semrush/Ahrefs. |
| SEO: sitemap.xml | DONE | — | P1 | Dynamic `buildSitemapXml` (`server.ts:328`). |
| SEO: meta/OG tags | DONE (1 gap) | AGENT | P2 | `head.ts:43-55` full stack on home; pricing/assess OG present. **`buy.html` missing `og:image`** (AGENT-fixable). `activated.html` missing meta description. |
| SEO: `llms.txt` / GEO | DONE | — | P2 | Both served (`server.ts:446-458`); `llms.txt` cites 68k+ OEM chunks. |
| Marketing-site "Mira AI" chat widget | BLOCKED | BOTH | P2 | `mira-chat.js/css` exist but **wired to nothing** — `POST /api/mira/session` never implemented; FAB removed to stop 404s (`blog-renderer.ts:132-136`, CRA-60 / [#992](https://github.com/Mikecranesync/MIRA/issues/992)). No try-it-now demo on marketing. Product decision needed (open chat to non-payers?) then AGENT-buildable. |
| Auto-deploy on marketing PR | NOT STARTED | AGENT | P2 | `deploy-vps.yml` default TARGETS excludes `mira-web`. Manual: `gh workflow run deploy-vps.yml -f services=mira-web`. Known-issue. |

---

## Surface 2 — Public quickstart chat (`app.factorylm.com/quickstart`)

> ⚠️ **Canonical URL is `app.factorylm.com/quickstart` (the Hub), NOT `factorylm.com/quickstart`** — the
> latter returns **404** (verified live). If marketing should link "/quickstart", it must point at the Hub.
> Live: `/quickstart` 200; `GET /api/quickstart/ask` → 405 (POST-only route live).

Deep evidence: BETA_READINESS Lens C/F. This is the unauthenticated money-path chat a stranger hits first.

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| Rate limit merged (the "#1838" question) | DONE | — | P0 | **PR #1838 MERGED** 2026-06-09 (`fix(hub): rate-limit /api/quickstart/ask — closes #1832`). Per-IP-hash 20/min → **429**. Also via PR #1837. |
| Citation relevance / wrong-vendor filter (the "#1871" question) | DONE | — | P0 | **PR #1871 is still OPEN** — but its goal **landed via PR #1858 MERGED** 2026-06-10 (`stripConflictingVendors()` wired at `route.ts:151` before `citations[]` at `:181`). #1871 is effectively superseded; confirm + close it. |
| BM25 OR-fanout DoS bound | DONE | — | P1 | **PR #1859 MERGED** — query bounded to 32 terms (`#1766`). |
| Smoke gate wired (money path) | DONE | — | P0 | `smoke-test.yml` runs `playwright.smoke.config.ts`: pricing→Stripe 303, `/quickstart` answers (P1-1), `/api/quickstart/ask` flood→429 (P0-1). Last run **green** (`gh run list --workflow=smoke-test.yml`). |
| Stranger gets a grounded answer | FIX IN REVIEW | AGENT | **P1** | **Live probe 2026-06-11 caught a false refusal on the flagship demo query** — `POST /api/quickstart/ask` "Allen-Bradley PowerFlex 525 fault F004" → HTTP 200, `provider:"Groq"`, **6 correct PowerFlex 525 citations**, **yet `answer` = "I don't have manuals for that…"**. ⚠️ **Corrected diagnosis (the PR #1875 alias hypothesis was WRONG — disproven by probes):** the `Allen-Bradley→Rockwell` alias **already exists** in `vendor-relevance.ts` (`resolveVendor("Allen-Bradley")="Rockwell Automation"`). Real cause = a **BM25 ranking miss**: terse `"F004"` / `"fault F004"` answer correctly (UnderVoltage), but the verbose query's extra tokens dilute the OR-fallback ranking so the F004 chunk drops below top-6 → model **honestly** refuses. Fix = **PR #1877** (fault-code-aware retrieval pass keyed on the code + phantom-citation gate; +10 tests, 417/417 lib green, no live verify until deploy). After deploy verify: `curl -s -X POST app.factorylm.com/api/quickstart/ask/ -d '{"question":"My Allen-Bradley PowerFlex 525 is showing fault F004, what does it mean?"}'` → should answer (UnderVoltage), not refuse. |
| Phantom citations on a genuine refusal | FIX IN REVIEW | AGENT | P2 | Citations render 1:1 from chunks (`route.ts:181`) regardless of whether the model cited them — a true coverage gap (e.g. F081 if absent) shows phantom cards under "I don't have manuals." **PR #1877** gates citations to `[]` on a refusal (`isRefusalAnswer`). |
| All LLM providers fail | DONE (no local fallback — by design) | — | P1 | **Verified in code:** the public path is the **TS** `cascadeComplete` (Groq→Cerebras→Gemini); on all-fail it **returns `null` (`cascade.ts:114`) and `route.ts:169` returns a clean HTTP 503** *"every model provider is unreachable — try again in a minute"*. There is **NO Open WebUI/Ollama fallback on the public Hub path, and that is correct** — the prod Hub container cannot reach CHARLIE-local Ollama; the Open WebUI fallback is the **Python engine path only** (Surface 6, Slack/Telegram). Live probe shows `provider:"Groq"`, so the **Gemini 403 is harmless today**. Do NOT build a Hub→Ollama fallback. Fresh Gemini key → [#1830](https://github.com/Mikecranesync/MIRA/issues/1830). |
| Rate limiter survives horizontal scale | NOT STARTED | AGENT | P2 | In-memory `Map` per instance (`route.ts:22`) — fine for single VPS; port to DB-backed before scaling. BETA_READINESS Lens A NB#2. |

---

## Surface 3 — Hub (`app.factorylm.com`)

Deep evidence: BETA_READINESS Lenses A (auth) + B (functional) + `docs/hardening/hub-hardening-backlog.md`. Live: `/` 200, `/login` 200, `/api/health` → `{"status":"ok"}`.

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| Auth / tenant isolation (RLS) | DONE | — | P0 | Lens A 🟢: middleware 401-JSON for `/api/*`, 7 public prefixes each self-guard, secrets scan clean. Chokepoints `sessionOr401()` + `withTenantContext()`. |
| Cross-tenant data leak closed | DONE | — | P0 | `/api/documents` `WHERE id=$1 AND tenant_id=$2` (#1833); hybrid corpus `is_private=false OR tenant_id=$1`. |
| Signup: magic-link / credentials | DONE | — | P0 | Credentials login verified working (hub-hardening-backlog); `__Secure-next-auth` cookie issued. |
| **Google SSO** | BLOCKED | HUMAN | P1 | `redirect_uri_mismatch` — GCP console must list `https://app.factorylm.com/api/auth/callback/google`. DUP [#1756](https://github.com/Mikecranesync/MIRA/issues/1756). Credentials login is the working fallback. |
| Onboarding wizard → first question | DONE | — | P1 | All 21 authed routes return 200 w/ real content (hub-hardening-backlog). |
| Knowledge upload → retrieval → citation | DONE | — | P0 | folder=brain path: PR #1592 (write+plumbing on NodeChat); BM25 `plainto→` fix PR #1807. `/api/knowledge` = 83.5k chunks live. |
| Command Center deployed | DONE | — | P1 | PR #1593 (Phase 1) + #1603 (Phase 2) merged; route returns 200. **No CI regression gate** — wire `playwright.command-center.config.ts` (Lens B). |
| KG visualization (NaN crash) | UNKNOWN | AGENT | P1 | `/knowledge/map` live (PR #1688). NaN-crash status not re-probed this cycle. needs probe: render `/knowledge/map` with Playwright + watch console. |
| Proposals / AI suggestions functional | DONE | — | P1 | `proposals` GET reads `ai_suggestions` (×6); `applyHubProposalTransition()` lockstep helper present (Lens B 🟢). |
| Proposal reverse-drift detective check | NOT STARTED | AGENT | P2 | Canary has 2 forward checks; reverse drift (terminal proposal + stale `pending`) uncaught. Patch staged: `patches/2026-06-10-canary-reverse-drift-check.patch`. |
| Asset agents: train-before-deploy | BLOCKED | AGENT | P1 | Wizard step shipped (#1781/#1783/#1790 merged). BUT "Train & approve → Insert failed" (tenant-id TEXT vs UUID) fix is on **PR #1874 — OPEN, not merged** (Smoke green 2026-06-11). ⚠️ **Migration-number collision:** the fix file is `048_asset_agent_tenant_text.sql` while `048_schema_migrations_ledger.sql` already holds 048 on main (head = 049) — **renumber to `050_asset_agent_tenant_text.sql` before merge.** See `docs/tech-debt/2026-06-10-train-approve-insert-failed-diagnosis.md`. |
| Security headers (HSTS/XFO) | NOT STARTED | HUMAN | P2 | Missing HSTS/frame-ancestors/X-Powered-By leak — FILED [#1762](https://github.com/Mikecranesync/MIRA/issues/1762). nginx + next.config. |

---

## Surface 4 — Slack bot

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| Deployed | DONE (unverified live) | BOTH | P1 | `mira-bot-slack` in `docker-compose.saas.yml:322` **and** in `deploy-vps.yml` default TARGETS (`:203`). Last deploy **success** 2026-06-11 00:20Z. |
| Actually responsive | UNKNOWN | HUMAN | P1 | Socket Mode = no public endpoint to curl. needs probe: post in the Slack workspace, or `docker ps` on VPS for `mira-bot-slack` healthcheck (`import slack_bolt`, `:363`). |
| UNS confirmation gate | DONE | — | P0 | Slack is a chat surface → gate applies; `_should_fire_uns_gate` enforced engine-side (Lens C, `engine.py:5372`). |
| Citation compliance | DONE | — | P1 | `citation_compliance` enforce-mode default-ON on both engine emit paths (Lens C). |
| Channel/thread scoping | DONE | — | P1 | `mira-bots/slack/bot.py` dispatcher → `Supervisor.process_full()`; per-channel context (master plan §1.1). |
| Token hygiene (stg≠prd) | NOTE | HUMAN | P1 | `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN` are **identical in Doppler stg and prd** — never run `mira-bot-slack` in staging without a separate workspace (memory: slack-token-stg-prd-shared). |

---

## Surface 5 — Telegram bot

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| Deployed | DONE (unverified live) | BOTH | P1 | `mira-bot-telegram` in compose (`:275`) + default deploy TARGETS (`:203`). Last deploy green 2026-06-11. |
| On prod or dev token | DONE (prod) | — | P1 | `TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}` from Doppler `factorylm/prd` (`:283`) = `@FactoryLM_Diagnose`. **Watch for stale local pollers on CHARLIE** (one process per token). |
| Actually responsive | UNKNOWN | HUMAN | P1 | Long-poll, no public endpoint. needs probe: message `@FactoryLM_Diagnose`, or `curl https://api.telegram.org/bot<token>/getMe` (HUMAN — needs token). |
| Photo upload → diagnosis | UNKNOWN | HUMAN | P1 | Vision path exists (qwen2.5vl); not re-verified this cycle. needs probe: send a nameplate photo in Telegram. |
| UNS gate / citations | DONE | — | P0 | Same engine path as Slack (chat surface → gate applies). |

---

## Surface 6 — MIRA engine (shared)

Deep evidence: BETA_READINESS Lens C 🟢. Engine itself is GREEN; the one historical YELLOW (public-chat vendor lie) is closed by #1858.

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| Inference cascade Groq→Cerebras→Gemini | DONE (degraded) | HUMAN | P1 | `router.py:3` cascade order; key-based enablement. **Gemini 403** = tail only; falls through to Cerebras/Groq then Open WebUI/Ollama. ⚠️ **This Open WebUI fallback is the Python engine path (Slack/Telegram) only** — the public Hub quickstart uses a separate TS cascade with no local fallback (Surface 2). [#1830](https://github.com/Mikecranesync/MIRA/issues/1830). |
| No Anthropic | DONE | — | P0 | Removed PR #610/#649; cascade is Groq→Cerebras→Gemini only. |
| Safety keyword detector — hot work | DONE | — | P0 | `guardrails.py:40` `"hot work"` present (+ arc flash `:14`, loto `:18`, confined space `:28`). Phrase-level to avoid false positives. |
| PII sanitization (router path) | DONE | — | P0 | `InferenceRouter.complete()` `sanitize=True` default-on; `rag_worker._call_llm()` also sanitizes (security-boundaries.md). |
| Citation enforce-mode | DONE | — | P0 | `_check_citation_compliance(..., enforce=...)` at `engine.py:2602` + `:3436`; `citation_enforce_enabled()` default ON. |
| Groundedness scoring | DONE | — | P1 | 1–5 dims; low-groundedness clarify episode `engine.py:2413-2511` (Lens C). |
| Cross-tenant prompt/citation races | DONE | — | P0 | Closed: kg_context per-call (#1846/#1872, the deploy HEAD) + kb_status per-turn (#1704, smoke green). |
| Offline eval pass rate | IN-PROGRESS | AGENT | P1 | ~50/57 (88%) last run (#1788). 7 failures span 3 file clusters → autopatch hard-stop. Determinism seam shipped but **inert** (fixtures `.gitignore`d, wired into 0 CI) — Lens D 🟡. Beta-critical checkpoints (No5xx, safety 9/9) stable. |

---

## Surface 7 — SimLab (demo / benchmark)

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| Juice bottling line | DONE | — | P2 | **PR #1816 MERGED** 2026-06-08. `simlab/` package on main (api/approval/baselines/…). |
| Doc fixtures ingested | DONE | — | P2 | **PR #1842 MERGED** (seed SimLab docs → `knowledge_entries`, closes #1835) + **#1849** (bind runner to `SIMLAB_TENANT_ID` so recall cites seeded docs). |
| Machine-behavior eval framework | DONE | — | P2 | **PR #1741 MERGED**. |
| Underfill scenario runs | UNKNOWN | AGENT | P2 | Scenarios on main; not executed this cycle. needs probe: run the SimLab harness (`tests/simlab/`) for the underfill case. |
| Run through **real** Supervisor via staging gate | NOT STARTED | AGENT | P2 | Open: [#1836](https://github.com/Mikecranesync/MIRA/issues/1836) `beta-readiness`. Today SimLab is its own harness, not wired into the prod engine staging gate. |

---

## Surface 8 — Infrastructure

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| VPS health (DigitalOcean) | DONE | — | P0 | Hub `/api/health` → `{"status":"ok"}` live. Provider = **DigitalOcean** (not Hetzner). |
| **VPS payment** | UNKNOWN | HUMAN | **P0** | **P0-2** — billing external; lapse = full outage. needs probe: DO dashboard card on file. |
| **NeonDB payment** | UNKNOWN | HUMAN | **P0** | **P0-3** — proj `divine-heart-77277150` serving; billing external. needs probe: Neon dashboard. |
| Docker containers up | DONE (inferred) | HUMAN | P1 | Last `deploy-vps.yml` run **success** 2026-06-11 00:20Z (8 services force-recreated). needs probe: `ssh prod docker ps`. |
| Doppler secrets current | IN-PROGRESS | HUMAN | P1 | `factorylm/prd` live. Gaps: Gemini key 403 (#1830); Stripe keys still test (#1831); confirm `staging` GH-env secrets (Lens E). Reminder: a secret only reaches a container if also in the compose `env:` block. |
| Migrations applied (dev gap) | UNKNOWN | HUMAN | P1 | Hub migration head on main ≈ **049** (Lens E). Dev branch may lag (031–047). `apply-migrations.yml` only runs `mira-hub/db/migrations`. needs probe: `mira-hub` node `pg` against dev (psql not on CHARLIE). |
| Migration numbering hygiene | IN-PROGRESS | AGENT | P2 | **048 collision** (`048_schema_migrations_ledger.sql` on main vs `048_asset_agent_tenant_text.sql` on PR #1874). **Migration head on origin/main is `049_grant_app_knowledge_entries_insert.sql`** → safe renumber = **`050_asset_agent_tenant_text.sql`**. Plus 8 known dup prefixes (006/008/021/025/026/027/032/033) + 040–042 gap (Lens E). Ledger keys on full filename so apply still works, but renumber #1874's mig to 050 before merge (recommended via a comment on #1874, not from this branch). |
| SSL certs valid | DONE | — | P0 | `factorylm.com` notAfter **Aug 27 2026**; `app.factorylm.com` notAfter **Aug 31 2026**. Live-checked. |
| Domain DNS correct | DONE | — | P0 | `factorylm.com` 200; `app.factorylm.com` resolves + serves (301→https→200). |
| Self-healer can recreate removed containers | NOT STARTED | AGENT | P2 | Known gap: healer `restart_container`=`docker restart` can't recreate a *removed* container (caused 7h 502). Recovery: `gh workflow run deploy-vps.yml -f services=mira-hub -f skip_staging_gate=true`. |

---

## Surface 9 — Revenue pipeline

| Item | Status | Owner | Pri | Evidence / Blocker |
|---|---|---|---|---|
| **Stripe live vs test mode** | BLOCKED | HUMAN | **P0** | **P0-1** — TEST mode. Code is live-ready (`stripe.ts`); flip Doppler `STRIPE_SECRET_KEY`→`sk_live_…` + `STRIPE_PRICE_ID`→live price. Webhook `checkout.session.completed` already flips tenant tier→active + activates Hub user (`server.ts:1067-1160`). [#1831](https://github.com/Mikecranesync/MIRA/issues/1831). |
| Assessment product ($500) checkout | DONE | — | P0 | Wired end-to-end (Surface 1). Only blocked by live-key flip. |
| DT Assessment product page | DONE | — | P1 | `/assess` + `/pricing` + `/buy` live; Assessment tier is the lead product. |
| Lead pipeline (HubSpot) | UNKNOWN | HUMAN | P1 | Lead count not visible from repo. needs probe: HubSpot dashboard. Marketing leads land via `mailto:mike@factorylm.com` (no CRM auto-capture on `/assess` or higher tiers). |
| LinkedIn presence | UNKNOWN | HUMAN | P2 | GTM motion is LinkedIn-first (STRATEGY.md); status external. needs probe: LinkedIn. |
| Post-purchase activation page | DONE (1 gap) | HUMAN | P1 | `/activated` renders; Loom walkthrough block needs `LOOM_UPLOAD_URL` in Doppler or shows "awaiting signal" (`server.ts:415`). |

---

## P0 action queue (do these, in order, to take the first dollar)

1. **[HUMAN] Flip Stripe to live** — Doppler `factorylm/prd`: `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_PRICE_ID=<live Assessment price>`. Then redeploy mira-web and run a real $0.50 test against the live key. Closes #1831. *(P0-1)*
2. **[HUMAN] Confirm DigitalOcean billing** — valid card, no dunning. *(P0-2)*
3. **[HUMAN] Confirm NeonDB billing** — valid card, plan headroom. *(P0-3)*

Once those three are green, a stranger can buy the Assessment and get a grounded answer. Everything below is P1/P2 hardening that improves trust, conversion, and operability but does not gate the first sale.

## P1 follow-ups (trust + reliability)

- **[AGENT]** Quickstart false-refusal — **PR #1877 in review** (fault-code-aware retrieval; alias hypothesis disproven). Merge → deploy → re-probe the F004 demo to close.
- **[AGENT]** Renumber PR #1874's migration `048_asset_agent_tenant_text.sql` → **`050_…`** (head on main is 049), then merge to close the asset-agent "Insert failed" loop.
- **[HUMAN]** Fresh Gemini key (#1830) — restores cascade tail redundancy.
- **[HUMAN]** Fix Google SSO redirect URI (#1756) — until then credentials login carries signup.
- **[HUMAN]** Probe Slack + Telegram live responsiveness (post a message each).
- **[AGENT]** Wire `playwright.command-center.config.ts` into a staging-gated workflow (post-signup surface has no CI gate).
- **[AGENT]** Confirm asset-agent tenant-TEXT fix (mig 048) merged to main; close the "Insert failed" loop.
- **[HUMAN]** Verify dev migration ledger is caught up (031–049).

## P2 polish

- `buy.html` `og:image`; `activated.html` meta description (AGENT).
- Apply canary reverse-drift detective patch (AGENT).
- Add Stripe products for Pilot/Operating tiers, or keep high-touch (HUMAN decision).
- `/assess` email capture for nurture (HUMAN decision).
- Implement `POST /api/mira/session` to put a try-it-now chat on marketing (#992) (BOTH).

---

## Maintenance

This is a **living document**. After any surface changes:
1. Re-audit against `origin/main` (NOT a feature branch — the working tree lies; see BETA_READINESS reconciliation).
2. Ground every Status flip in a PR #, commit, `file:line`, or live probe — no "trust me" rows.
3. Keep ops/runtime rows (deploy, billing, SSL, bot liveness) as `UNKNOWN`+probe-command until a human or a live probe confirms them — never code-infer "DONE" for a runtime fact.
4. Update the Executive Summary verdicts + the P0 queue.

**Cross-references:** `wiki/orchestrator/BETA_READINESS.md` · `docs/hardening/hub-hardening-backlog.md` · `docs/known-issues.md` · `docs/plans/2026-06-01-mira-master-architecture-plan.md` · `NORTH_STAR.md` · `STRATEGY.md`
