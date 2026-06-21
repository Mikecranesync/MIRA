# Secret-Shopper Testing Setup (for Hermes / QA agents)

**Audience:** Hermes and any QA agent running secret-shopper / persona testing against
the live Hub (`app.factorylm.com`).
**Created:** 2026-06-21. **Status:** living doc.

The goal of secret-shopper testing: act like a stranger maintenance tech, exercise the
real product surfaces (login → namespace → upload → ask → cited answer), and report what
breaks — without Mike hand-fixing anything (the beta gate). This runbook removes the two
things that block a clean start: **which credentials work where**, and **which tenant
holds which data**. Then it gives the Stardust Racers **photo-gathering checklist**.

---

## 1. Three tenants — do NOT conflate them

The biggest setup trap: "log in as carlos, then look at Stardust Racers." Those are
**different tenants**. carlos lands in Lake Wales, not at the roller coaster. There are
three separate datasets in play:

| # | Tenant | Tenant id | What's in it | Seeded by |
|---|---|---|---|---|
| 1 | **Synthetic Test Plant — Lake Wales FL** | `00000000-…-000000000099` | 4 personas (carlos/dana/plantmgr/cfo); equipment VFD-07 (AB PowerFlex 755, fault F005), CONV-03 (Dorner 2100), Goulds 3196 pump | `mira-hub/scripts/seed-synthetic-users.ts` |
| 2 | **Epic Universe / Celestial Park (Stardust Racers)** | **`e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`** (= Mike's own primary tenant, confirmed on prod) | `enterprise.celestial_park.stardust_racers` UNS tree: Launch 1, Launch 2, Station Load, Station Unload + 3 pending relationship proposals | `tools/seeds/run_demo_seed.py --tenant epic-universe --tenant-id <UUID>` (file: `tools/seeds/epic-universe-stardust-racers.sql`) |
| 3 | **"Playwright · admin"** (the live browser session on CHARLIE) | (live) | AutomationDirect **GS1-45P0** asset; **WO-2FDA708E** "QA Secret Shopper CMMS Asset" — Packaging Line 2 pump bearing noise + conveyor stops | ad-hoc QA seeding |

**Verified 2026-06-21 from the live app (read-only):** the persisted CHARLIE Playwright
session is tenant #3 ("Playwright · admin"): 2 assets, 0 components, asset = AutomationDirect
GS1-45P0. Its `/namespace/` does **not** contain Stardust Racers — confirming #2 is a
separate, cross-tenant-isolated dataset unreachable from that session.

⇒ **The synthetic personas (#1) are a red herring for a Stardust Racers (#2) test.** Pick
the tenant whose data your test actually needs, and log in as a user *of that tenant*.

---

## 2. Credential reality (and the open decision for Mike)

**Synthetic persona credentials** (from `seed-synthetic-users.ts`):

| Email | Persona | Role (`hub_users.role`) |
|---|---|---|
| `carlos@synthetic.test` | Carlos Mendez (Technician) | owner |
| `dana@synthetic.test` | Dana Reyes (Maint. Manager) | owner |
| `plantmgr@synthetic.test` | Jordan Taylor (Plant Manager) | owner |
| `cfo@synthetic.test` | Pat Hoffman (CFO) | owner |

Password (all four): `SynthTest2026!` — bcrypt(12), `seed-synthetic-users.ts:402`.
Login path: `/login` → **"Sign in with password"** (NextAuth `credentials` provider,
`mira-hub/src/auth.ts:41`; prod auth API base is `/api/auth/*` — prod serves at root, no
`/hub` prefix). Note all four personas seed with `role: owner` — they are **not** RBAC-
differentiated in the seeder. If you need true Technician-vs-Manager RBAC testing, that's a
gap to raise, not something the current seed gives you.

**✅ CONFIRMED on PROD (2026-06-21, read-only via `db-inspect.yml` target=prod):**
the synthetic personas **do NOT exist on production** — `hub_users LIKE '%@synthetic.test'`
returns **0 rows**, and tenant `…099` returns **0 rows**. The seeder was only ever run
local/staging (its header says *"Never use in production"*). ⇒ **`carlos@synthetic.test /
SynthTest2026!` will not log in on `app.factorylm.com`.** (The login *mechanism* works — the
password path validates against the real backend; there's just no such account.)

**The decisive twist — Stardust Racers lives in MIKE'S OWN tenant, not a demo/synthetic
tenant.** The `enterprise.celestial_park` subtree is owned by tenant
`e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`, whose 9 users include `harperhousebuyers@gmail.com`
(Mike, owner) and `mike@cranesync.com` (Mike, owner). Of those 9, **only `mike@cranesync.com`
has a password set** (`has_password=t`); the other 8 (incl. Mike's Google account and
`alex@/deb@/elena@/holt@/linda@/marcus@/rico@factorylm.com`) are **Google-SSO only**.

⇒ **Seeding synthetic users into prod is the WRONG move for a Stardust test** — `carlos`
would land in the (currently nonexistent) Lake Wales tenant `…099`, which has **no Stardust
data**. He'd authenticate and see an empty plant. To *see Stardust* you need an account that
belongs to tenant `e88bd0e8`.

**Recommended paths to give a QA agent access to Stardust (Mike's call):**
1. **Tonight, fastest:** Mike (logged in as himself) screenshots the `/namespace/` Stardust
   tree + `/assets/` + `/proposals` and hands them over. *Note: the photo-gathering checklist
   in §3 is already built from the seed + confirmed prod data — you don't actually need
   screenshots to get it.*
2. **Standing access, clean:** Mike sets a password on (or invites) a **dedicated test member
   of tenant `e88bd0e8`** — e.g. enable a password for the existing `rico@factorylm.com`
   (technician) member, or invite a fresh QA member. Gives a real, non-admin login that sees
   Stardust without sharing Mike's own admin account.
3. **Avoid:** seeding `seed-synthetic-users.ts` against prod — pollutes prod with a weak
   password AND lands in the wrong (Stardust-less) tenant. Doubly wrong here.

This was settled read-only via the **`Secret-shopper testing prerequisites probe`** step
added to `.github/workflows/db-inspect.yml` (sanctioned prod read; no write). Re-run:
`gh workflow run db-inspect.yml --ref <branch> -f target=prod`.

---

## 3. Stardust Racers — UNS surfaces & photo-gathering checklist

Source of truth: `tools/seeds/epic-universe-stardust-racers.sql`. UNS uses the compact
Hub format `enterprise.{site}.{area}.{subsystem}`.

```
enterprise.celestial_park                                  (site — Celestial Park, Epic Universe, Orlando FL)
└─ enterprise.celestial_park.stardust_racers               (area — launched roller coaster)
   ├─ …launch_1        Launch 1        linear induction motor (forward launch)
   ├─ …launch_2        Launch 2        linear induction motor (reverse-boost launch)
   ├─ …station_load    Station Load    station conveyor — load platform, restraint check, dispatch
   └─ …station_unload  Station Unload  station conveyor — unload platform + return queue
```
Pending relationship proposals already seeded (visible in Hub `/proposals`): Launch 1
**DRIVES** Launch 2 (0.82, high-risk — safety-critical sequence), Station Load **UPSTREAM_OF**
Launch 1 (0.95), Station Unload **DOWNSTREAM_OF** Launch 2 (0.90).

### What the secret shopper photographs and why

Purpose of each photo: feed MIRA's onboarding (Command Center) so it can (a) resolve the
**UNS path** + manufacturer/model, (b) retrieve the matching **OEM manual** chunks, and
(c) ground a cited diagnostic answer. So prioritize **nameplates** (manufacturer / model /
serial — drives UNS resolution + manual retrieval) and **fault displays** (drives
diagnosis). Capture per subsystem:

**Per UNS node (all four subsystems):**
- [ ] **Subsystem ID / area sign** confirming which node (Launch 1 / Launch 2 / Station
      Load / Station Unload) — anchors the upload to the right UNS path.
- [ ] **Control panel / HMI screen**, especially any active **fault or alarm code** shown.
- [ ] **Main controller / PLC nameplate** (manufacturer, model, firmware label).
- [ ] **E-stop station + safety placard** in frame (context only — MIRA is read-only,
      never advises a control write; SAFETY keywords escalate).

**Launch 1 & Launch 2 (linear induction motor launches):**
- [ ] **LIM stator nameplate(s)** along the launch track (manufacturer/model/rating).
- [ ] **LIM drive cabinet / power-electronics nameplate** (VFD / motor-drive / capacitor
      bank labels) — the part that actually faults.
- [ ] **Drive fault display** if a code is present (overcurrent / overtemp / DC-bus).
- [ ] Any **block/zone brake** nameplate near the launch exit.

**Station Load & Station Unload (station conveyor + restraints):**
- [ ] **Conveyor drive motor + gearbox nameplate** (manufacturer/model/serial).
- [ ] **Restraint system unit nameplate** (hydraulic/pneumatic power unit) + its gauge/HMI.
- [ ] **Dispatch console / gate (air-gate) actuator** nameplate.
- [ ] **Position/proximity sensor nameplate(s)** at load/dispatch and restraint-locked
      check points.

### Photo capture hygiene (so the upload is actually citable)
- One asset per photo; **nameplate fills the frame**, in focus, legible text — model/serial
  are what UNS resolution + manual retrieval key on.
- Include the subsystem context shot so the uploader can tag the right UNS path.
- Upload through the **real Hub door** (`/documents/` upload / folder=brain), then verify it
  became **citable** per `[[upload-manual-verify-citable]]` — landing in the OW KB only is
  NOT the citable path (`.claude/rules/knowledge-entries-tenant-scoping.md`).
- A correct **refusal** is not a bug: if you photograph a drive whose OEM manual isn't in
  the corpus, MIRA *should* say it can't ground an answer. Validity-check before filing a
  "retrieval miss" (see the `retrieval-diagnostics` skill).

---

## 4. Quick-start: seed + verify Stardust Racers (when authorized for the target env)

```bash
# 1. find/confirm your tenant UUID
doppler run --project factorylm --config <stg|prd> -- \
  psql "$NEON_DATABASE_URL" -c "SELECT id, name FROM hub_tenants ORDER BY created_at DESC LIMIT 5;"

# 2. dry-run, then commit (staging first — dev→staging→prod)
doppler run --project factorylm --config <stg|prd> -- \
  python3 tools/seeds/run_demo_seed.py --tenant epic-universe --tenant-id <UUID> --dry-run
doppler run --project factorylm --config <stg|prd> -- \
  python3 tools/seeds/run_demo_seed.py --tenant epic-universe --tenant-id <UUID> --commit

# 3. verify the 6 entities landed
doppler run --project factorylm --config <stg|prd> -- \
  python3 tools/seeds/run_demo_seed.py --tenant epic-universe --tenant-id <UUID> --verify
```
Then log in as a user **of that tenant** and open `/namespace/` → the Celestial Park /
Stardust Racers tree, `/proposals` → the 3 pending edges, `/assets/` for the subsystems.

---

## 5. Provision QA standing access to the Stardust tenant (chosen path)

Decision (2026-06-21): give a **dedicated existing member of tenant `e88bd0e8`** a
password so the headless QA agent can use the password login. We reuse
`rico@factorylm.com` (already a `technician` member of that tenant — an apt secret-shopper
persona) rather than seeding synthetic users (which would land in the wrong tenant) or
sharing Mike's admin account.

**Operator (Mike) runs — prod write, your authorized action; agents must not run it:**
```bash
# staging first if you want a dry run on stg-shape data, then prod:
QA_PASSWORD='<pick-a-strong-password>' \
doppler run --project factorylm --config prd -- \
  bun run mira-hub/scripts/set-qa-member-password.ts
# defaults: QA_EMAIL=rico@factorylm.com  QA_TENANT_ID=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe
```
The script (`mira-hub/scripts/set-qa-member-password.ts`) **only sets a password on a member
that already exists in that tenant** — it never creates an account or changes membership, and
refuses if the email isn't found in the tenant. Then share `rico@factorylm.com` + the password
with the QA agent out-of-band. The agent logs in via **"Sign in with password"** and lands in
the Stardust tenant.

**Revoke when done:** `UPDATE hub_users SET password_hash = NULL WHERE email='rico@factorylm.com'
AND tenant_id='e88bd0e8-8a84-4e30-9803-c0dc6efb07fe';` (sends the account back to SSO-only).

## Cross-references
- `tools/seeds/epic-universe-stardust-racers.sql` — Stardust UNS seed (source of truth)
- `tools/seeds/run_demo_seed.py` — seed runner (`--tenant epic-universe`)
- `mira-hub/scripts/seed-synthetic-users.ts` — the 4 personas + Lake Wales tenant
- `mira-hub/src/auth.ts` — NextAuth credentials (password) provider
- `docs/runbooks/upload-manual-verify-citable.md` — prove an upload is citable
- `docs/runbooks/seed-demo-data.md` — demo-data seeding
- `.claude/rules/knowledge-entries-tenant-scoping.md` — citable-door / hybrid-corpus law
- `.claude/rules/debugging-conventions.md` — verify the query target before trusting "0 rows"
- `.claude/skills/retrieval-diagnostics/SKILL.md` — validity-check a refusal before filing a bug
