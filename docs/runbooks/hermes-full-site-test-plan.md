# Hermes — Full-Site Test Plan (secret-shopper QA of app.factorylm.com)

**Audience:** Hermes (headless QA agent; can drive Playwright + curl).
**Pairs with:** `docs/runbooks/secret-shopper-testing-setup.md` (access + tenants + photo checklist).
**Created:** 2026-06-21.

Goal: exercise the whole product the way a real maintenance customer would, find what's
broken, and file it — ranked, deduped, evidence-backed. Work the phases in order; Phase 0 is
a hard gate (skip it and you'll file false "broken" bugs that are really "deploy hadn't
landed").

**Invoke these skills — don't reinvent them:** `qa` (deploy-truth + run specs), `web-review`
(Playwright + Lighthouse adversarial sweep, P0–P3 + issue dedup), `retrieval-diagnostics`
(grounding/refusal/wrong-vendor at the production layer). Runbooks: `upload-manual-verify-citable`,
`kiosk-askmira-deploy-and-verify`.

**Golden rules**
- **Phone-first.** Techs read in a noisy plant on a phone. Test the **412×915** viewport as
  the primary, 1440×900 as secondary.
- **Read-only.** MIRA is read-only troubleshooting in beta — never expect/trigger a control
  write. Don't mutate other tenants' data.
- **A correct refusal is not a bug.** If you ask about content not in the KB, MIRA *should*
  say it can't ground an answer. Validity-check before filing (see Phase 4).
- **Evidence or it didn't happen.** Every finding gets a screenshot + URL + console/network
  excerpt + repro steps.

---

## Phase 0 — Setup & deploy-truth (GATE)

1. **Confirm the deploy is live** (via the `qa` skill's pattern): the newest `deploy-vps.yml`
   run's `headSha` must equal `git rev-parse origin/main`. If not, the site is running older
   code — note it and test anyway, but tag findings "pre-deploy".
2. **Get access** (see secret-shopper-testing-setup.md §2/§5):
   - **Stardust tenant (`e88bd0e8`)** — log in as `rico@factorylm.com` via **"Sign in with
     password"** once Mike has provisioned it. This is the rich tenant (Stardust Racers UNS,
     proposals, assets).
   - **Public, no-login** surfaces you can test right now: `/` and `/cmms` (marketing,
     `factorylm.com`), `/login`, `/quickstart` (public demo ask), `/pricing`.
3. **Record environment:** browser, viewport, logged-in email+tenant, timestamp, deploy SHA.
   Put this header on every report.

---

## Phase 1 — The money path / beta gate (HIGHEST PRIORITY)

This is the North Star: *a stranger uploads their own manual, asks a real troubleshooting
question, and gets a grounded answer with citations — no human fixing anything.* If only one
thing is tested, it's this.

1. **Upload** a real equipment manual PDF through the **real door** (`/documents/` upload, or
   the folder=brain `/api/uploads/*` flow). Use a manual whose vendor/model you know.
2. **Verify it became citable**, not just stored — follow `upload-manual-verify-citable.md`.
   Landing in the Open WebUI KB only is NOT the citable path.
3. **Ask a troubleshooting question** answerable *only* from that manual (a specific fault
   code / procedure). Expect: a grounded answer **with a `[1]`-style citation** back to the
   uploaded doc.
4. **Pass/fail:** PASS = cited, grounded answer with no manual intervention. FAIL = generic
   answer, no citation, or "KB doesn't contain enough information" for content you just
   uploaded (that's the upload→retrieval gap — a P0).
5. Repeat once via the **public `/quickstart`** ask to confirm the unauthenticated demo path
   also grounds.

---

## Phase 2 — Surface functional sweep (every nav route)

For each route: load at 412px **and** 1440px, then record (a) HTTP status, (b) **console
errors**, (c) **failed network requests** (4xx/5xx on `/api/*`), (d) does the primary action
work, (e) does it render real data vs. a spinner/empty/crash.

Authenticated Hub nav (from the app shell):

| Route | What to check |
|---|---|
| `/feed/` (Command Board) | Open items render; "Ask MIRA" + "View WO" links resolve; refresh works |
| `/conversations/` | List loads; open a thread; no 500 |
| `/alerts/` | List loads; filters work |
| `/knowledge/` | KB list loads; **`/api/uploads/` does not 500** (regression #961); manufacturer counts sane (#1895) |
| `/knowledge/map/` | Graph renders; **h1 present + tap targets ≥24px** (regression #2191) |
| `/assets/` | Asset list; open an asset detail (Stardust subsystems) |
| `/workorders/` | List + a WO detail (`WO-…`) loads; status badges correct |
| `/schedule/` | PM calendar renders; no overflow at 412px |
| `/requests/` | Loads; submit flow if present |
| `/parts/` | Loads |
| `/documents/` | List + upload control; this is the Phase-1 door |
| `/reports/` | Reports render with real numbers |
| `/channels/` | Loads |
| `/integrations/` | Loads; connector states render |
| `/usage/` | KB count + usage render |
| `/team/` | Member list (you'll see the `e88bd0e8` members) |
| `/event-log/` | Audit entries render |
| `/namespace/` | UNS tree (Phase 3); **disabled buttons should explain why** (#2182) |
| `/proposals/` | Pending proposals (Phase 3) |

Public/marketing (regression-confirm — several are old web-review issues, may be fixed):
`/` , `/cmms` (#960 `/api/cmms/stats/` 503), `/scan/` (#1289 500 on prod), `/login`
(#1110 unused JS, #973 perf), `/pricing` (trailing-slash 404 was fixed #2179 — confirm).

---

## Phase 3 — UNS / Namespace / Stardust deep test (the product's spine)

Logged in to the Stardust tenant (`rico@`):

1. **Namespace tree** (`/namespace/`): confirm the hierarchy renders —
   `Celestial Park → Stardust Racers → Launch 1 / Launch 2 / Station Load / Station Unload`.
   Disabled controls must say why they're disabled (#2182).
2. **Proposals** (`/proposals/`): the 3 seeded edges should be pending — Launch 1 **DRIVES**
   Launch 2 (high-risk), Station Load **UPSTREAM_OF** Launch 1, Station Unload **DOWNSTREAM_OF**
   Launch 2. Test **Verify** and **Reject** on a low-risk one; confirm the status transition
   persists and high-risk ones require human review. **Do not** expect auto-verify.
3. **Asset detail + asset chat (RAG):** open a subsystem asset and use its chat. This path is
   the secret-shopper P0 from 2026-06-21 (`manual-rag.ts`): it must retrieve the **shared OEM
   corpus**, not refuse for every manufacturer. Ask a grounded question; confirm citations.
4. **UNS gate behavior:** asset chat is a *direct connection* — it should NOT ask "are you
   sure you're looking at X?" (that gate is for Slack/Telegram only). A confirmation prompt
   here is a bug.

---

## Phase 4 — Retrieval & grounding quality

Use the `retrieval-diagnostics` skill discipline (diagnose at the production layer, not a
benchmark wrapper). Run a small battery of asks and classify each answer:

- **Should-ground:** ask about a vendor/model/fault that IS in the corpus (e.g. an
  Allen-Bradley PowerFlex code). Expect a cited, grounded answer.
- **Should-refuse (validity check):** ask about content that does NOT exist — e.g. **"Yaskawa
  GS20 fault F030"** (GS20 is an **AutomationDirect** drive; there is no Yaskawa GS20 / no
  Yaskawa F030). MIRA *should* refuse or correct — that's CORRECT, not a bug.
- **Wrong-vendor regression (#2198):** ask a **GS20** question; confirm it does **not** cite
  Yaskawa V1000/J1000 docs. If it answers with the wrong manufacturer's manual, that's the
  live P2 — add evidence to #2198, don't open a dup.
- **Cross-vendor synonyms:** Allen-Bradley ≡ Rockwell should retrieve the same corpus.

Record for each: query, grounded? (y/n), citations present?, correct vendor?, refusal
appropriate?

---

## Phase 5 — Security & tenancy

- **Unauthed API = 401:** hit a few `/api/*` endpoints with no session; expect 401, never
  data (pattern: `api-unauth-returns-401.spec.ts`).
- **Tenant isolation:** as `rico@` (tenant `e88bd0e8`) you must **not** see another tenant's
  assets/uploads/WOs. Try fetching a known other-tenant asset id → expect 401/403/empty, not
  the row (IDOR).
- **Private upload no-leak:** an upload you make should be visible to you but carry
  `is_private=true` semantics — it must not appear in any other tenant's document list, and
  the shared OEM corpus must still be visible to you (hybrid read law).
- **No control writes:** confirm there is no UI affordance that writes to a PLC/asset — beta
  is read-only.

---

## Phase 6 — Web quality (drive the `web-review` skill)

For the key pages (`/login`, `/feed`, `/knowledge`, `/knowledge/map`, `/namespace`, `/cmms`,
`/`): run the `web-review` sweep — Playwright console/network capture + Lighthouse +
`curl -I` headers. Catch:
- Console errors / unhandled rejections; 4xx-5xx on `/api/*`.
- Broken links / images; missing alt text; **contrast below floor** (#2050 VFD wizard).
- a11y: page `<h1>`, label/aria, **tap targets ≥44px** (Hub root font is 14px → verify
  `min-h-[44px]`, not `h-11`), focus order.
- Perf: Lighthouse score, image weight (#1093 WebP/lazy-load), unused JS (#1110), HTTP/2
  (#1095).
- **Naming consistency** (#619): FactoryLM vs MIRA vs Mira; Troubleshooter vs Copilot.

---

## Phase 7 — Reporting (how to file)

1. **Rank** every finding **P0–P3, most-obvious-first** (P0 = money path / data leak / 500
   on a core route; P3 = cosmetic).
2. **Dedup against existing issues BEFORE filing** (the `web-review` skill does this). Known
   live targets to *add evidence to* rather than duplicate: **#2198** (GS20 wrong model),
   **#2191** (map a11y), **#2182** (namespace disabled buttons), **#1895** (knowledge polish),
   **#960/#961** (cmms/knowledge 500s — confirm fixed or reopen), **#1289** (`/scan/` 500),
   **#2013** (Hub login provisioning — what this test exercises).
3. **Propose, don't auto-file** noisy findings — surface the list to Mike for a go/no-go, then
   file the approved ones with the evidence header (env + SHA + screenshot + repro).
4. **Update the tracking issue** for this run with pass/skip/fail counts per phase.

---

## Quick reference — what "fully tested" means here
- ✅ Money path grounds with citations (Phase 1) — the one that matters most.
- ✅ Every nav route loads at phone + desktop with no console/500 errors (Phase 2).
- ✅ Stardust UNS tree + proposals + asset-chat RAG behave (Phase 3).
- ✅ Retrieval grounds the real, refuses the fake, never cites the wrong vendor (Phase 4).
- ✅ Auth/tenancy holds; no leaks; read-only (Phase 5).
- ✅ Web-quality sweep clean or filed (Phase 6).
- ✅ Findings ranked, deduped, evidence-backed, tracked (Phase 7).

## Cross-references
- `docs/runbooks/secret-shopper-testing-setup.md` — access, tenants, Stardust photo checklist
- `docs/runbooks/upload-manual-verify-citable.md` — prove an upload is citable (Phase 1)
- `.claude/skills/{qa,web-review,retrieval-diagnostics}/SKILL.md`
- `.claude/rules/{knowledge-entries-tenant-scoping,direct-connection-uns-certified,uns-confirmation-gate}.md`
- `mira-hub/tests/e2e/` — existing specs to model selectors/routes on
