# Data Tier Architecture — Implementation Plan

**Date:** 2026-04-24
**Status:** DRAFT — awaiting review
**Companion docs:**
- [`../architecture/FactoryLM_Data_Tier_Architecture.md`](../architecture/FactoryLM_Data_Tier_Architecture.md) — source technical design
- [`../legal/FactoryLM_MSA_Draft_v1.md`](../legal/FactoryLM_MSA_Draft_v1.md) — customer contract (pending attorney review)
- [`v1-customer-scope.md`](v1-customer-scope.md) — v1 pricing discussion ($499/facility option)
- [`2026-04-19-mira-90-day-mvp.md`](2026-04-19-mira-90-day-mvp.md) — active 90-day MVP plan ($97/mo, 10 customers)

---

## 0. What This Plan Covers

Implement the four commercial tiers defined in the MSA — **Community / Professional / Enterprise / On-Premise** — inside MIRA. Each tier represents a different isolation posture and a different data-sharing relationship with the Knowledge Cooperative.

```
                      Knowledge Cooperative
                      (anonymized, k ≥ 10 facilities)
                              ^
                              |
    Community tier  --------->| contributes + receives
    Professional tier         | does NOT contribute, does NOT receive
    Enterprise tier           | isolated, opt-in available
    On-Premise tier           | zero data leaves customer network
```

FactoryLM, Inc. is the legal Provider (per MSA §preamble). MIRA is the Service (per MSA §1.1). This plan lives in the MIRA repo because every change it describes is a MIRA code change.

---

## 1. Current State Audit (2026-04-24, MIRA repo)

Grounding: the MSA and the Data Tier Architecture doc assume less than what MIRA actually has. A large part of the Community-tier foundation is already built.

### What exists

| Component | Location | Notes |
|---|---|---|
| `tenants` table | `mira-core/mira-ingest/db/neon.py` (auto-created) | Fields: `id, email, company, tier, first_name, stripe_customer_id, stripe_subscription_id, atlas_password, atlas_company_id, atlas_user_id, atlas_provisioning_status, activation_email_status, demo_seed_status, provisioning_attempts, provisioning_last_attempt_at, provisioning_last_error, created_at`. Rich, Stripe-wired, CMMS-provisioning-aware. |
| `plg_tenants` (signup funnel) | `docs/migrations/003_supporting_tables.sql` | `id, email, company, first_name, tier, created_at`. Funnel table, probably redundant with `tenants` — check for consolidation. |
| `tenant_id` on knowledge | `knowledge_entries.tenant_id` | Scoped RAG retrieval via `recall_knowledge(embedding, tenant_id)`. |
| Tier gate in product code | `mira-web/src/lib/auth.ts`, `src/lib/quota.ts` | `if (tenant.tier !== "active") return 403`. Free-tier quota: `FREE_DAILY_QUERIES=5`. |
| Stripe integration | `mira-web/src/server.ts` lines 420, 485, 596, 660 | Checkout → `tier: "pending"` → webhook → `tier: "active"`. Billing portal for churn. |
| CMMS per-tenant provisioning | `atlas_*` columns in `tenants` | Each tenant gets an isolated Atlas CMMS company + user on signup. |
| Activation email / demo seed | `activation_email_status`, `demo_seed_status` | Post-payment onboarding already instrumented. |
| Shared Postgres (Neon) | `NEON_DATABASE_URL` via Doppler `factorylm/prd` | Same DB hosts MIRA's `knowledge_entries`, `tenants`, + FactoryLM's brain schema. |
| GSDEngine | `mira-bots/shared/engine.py` | Supervisor class. Intent classify → safety bypass → FSM → RAG → inference cascade → PII sanitize. Ready to consult a cooperative layer. |
| Chat adapters | `mira-bots/{telegram,slack,teams,email,reddit}/main.py` | Telegram production, Slack code-complete, others experimental. |
| Per-container tenant context | `MIRA_TENANT_ID` env var | mira-bridge reads this; single-container-per-tenant pattern exists for some services. |
| SaaS compose | `docker-compose.saas.yml` | Cloud-specific services including `mira-relay` for Ignition tag streaming. |
| 90-day MVP freeze | `docs/plans/2026-04-19-mira-90-day-mvp.md` | Active $97/mo × 10 customers plan; Unit 6 (hybrid retrieval) in flight. |

### What is missing for MSA compliance

| Gap | Severity |
|---|---|
| **Commercial tier taxonomy.** Current `tier` column holds **lifecycle** (`pending|active|churned`). MSA assumes **commercial** tiers (`community|professional|enterprise|onprem`). Schema conflates these. | **Critical** — name collision. |
| **Row-Level Security policies.** No RLS on `knowledge_entries` or any tenant-scoped table. `tenant_id` filtering is app-layer-only — one missing `WHERE` clause = cross-tenant leak. | **Critical** — this is the worst-case bug class. |
| **Knowledge Cooperative table.** Not in `docs/migrations/`. No aggregated pattern storage. | High |
| **Anonymization pipeline.** No Celery beat task, no k-anonymity gate, no equipment-class taxonomy, no regional generalization. | High |
| **Neon branch provisioning.** No Neon API client in the repo. Branching is a platform feature we haven't wired. | High |
| **Downgrade flow & consent UI.** MSA §2.3 requires 30-day notice and data-sharing consent for Prof→Community. Not in mira-web. | Medium |
| **BYOD provisioning.** No runner that applies MIRA migrations to a customer-supplied Postgres. | Medium (Enterprise-tier, can slip) |
| **On-premise package.** `docker-compose.saas.yml` exists; there's no `docker-compose.onprem.yml` with Ollama + license activation. | Medium (last phase) |
| **Legal asset pack.** MSA is a v1.0 draft only. No DPA template, no subprocessor register, no COI. | Blocking for Enterprise deals |
| **Insurance.** Product liability + E&O not sourced. | Blocking for Enterprise deals |
| **Equipment-class taxonomy.** Anonymization groups rely on one. No `docs/reference/equipment-classes.md` exists. | Medium |

### Cross-repo dependency

MIRA and the FactoryLM monorepo (`~/factorylm`) share `NEON_DATABASE_URL` and Doppler project `factorylm/prd`. The corporate/cluster code lives in factorylm; the product lives in MIRA. The MSA + insurance + Neon-enterprise contracts are **corporate-entity** work (FactoryLM, Inc.) but every code change is MIRA. Do not cross-import between the repos for this feature.

---

## 2. First-Decision Block (resolve before any code)

These decisions shape the rest of the plan. If they're not settled, execution drifts.

### 2.1 Lifecycle vs commercial tier — schema decision

The current `tier` column collapses two concepts. Three options:

| Option | Schema change | Pros | Cons |
|---|---|---|---|
| **A. Split columns** | Add `plan TEXT` for commercial (`community|professional|enterprise|onprem`). Keep `tier` for lifecycle. | Minimal disruption. Existing code keeps working. | Mild naming confusion; `tier` is no longer the "obvious" field to gate on. |
| **B. Rename and add** | Rename `tier` → `lifecycle`. Add `tier` → commercial. | Clean semantics. | Every `WHERE tier = 'active'` breaks. ~20+ touch points across `mira-web`, `mira-bots`, `mira-mcp`. |
| **C. Merge into one** | Redefine `tier` to commercial; kill lifecycle states (manage via Stripe subscription status). | Cleanest final schema. | Loses local lifecycle state; breaks free-tier logic; requires Stripe as source of truth. |

**Recommendation: A.** Add `plan` column, default `'community'`, backfill all existing tenants as `'community'`. Update gates incrementally. Reversible in one migration.

### 2.2 Pricing reconciliation

The 90-day MVP plan ([2026-04-19-mira-90-day-mvp.md](2026-04-19-mira-90-day-mvp.md)) targets **$97/mo × 10 customers**. The MSA and [v1-customer-scope.md](v1-customer-scope.md) assume **$499/facility/mo** for Community. These are different offers, not different prices. Decide:

- $97 = per-user / per-seat (maintenance-tech-as-buyer)
- $499 = per-facility flat (plant-manager-as-buyer)

**Recommendation:** Keep both. $97/mo is the **Starter / PLG individual plan** (not in the MSA's four-tier structure — this is the free-conversion tier). $499/mo is **Community** as named in the MSA. Update MSA Exhibit B to list Starter as a fifth tier or reframe Starter as the entry point to Community.

### 2.3 Tenant-context propagation

Today:
- `mira-web` uses JWT → `tenant_id` claim.
- `mira-bridge` uses per-container `MIRA_TENANT_ID` env.
- `mira-bots` routes on chat_id → tenant lookup.
- Cross-service calls pass `tenant_id` as a header or argument.

For multi-tier isolation, every DB connection must carry tenant context. **Decision:** one shared Python helper (`mira-core/mira-ingest/tenancy.py`) + one TypeScript helper (`mira-web/src/lib/tenancy.ts`) that both set `SET LOCAL app.tenant_id = $1` on the Postgres session before any query. Fail-closed when tenant_id is absent.

### 2.4 Neon branching vs schema-per-tenant

MSA §2.2(b) calls for Professional-tier isolation. Two implementations:

| Approach | How | Trade-off |
|---|---|---|
| **Neon branch per tenant** | Copy-on-write branch; nearly free storage; distinct connection string. | Neon pricing at scale (need Phase 0.3 answer); connection pool per branch; cold starts. |
| **Schema-per-tenant** in one DB | Postgres schema `tenant_acme`, schema `tenant_foo`; same DB. | No Neon dependency; manageable at small scale; schema migrations must run N times. |

**Recommendation:** Neon branches if Neon pricing holds. Schema-per-tenant as fallback. Decide in Phase 0.

### 2.5 K-anonymity floor and chicken-and-egg

MSA §7.3 requires ≥ 10 facilities per `(equipment_class, fault_category)` group. Until Community has 10+ signups, the cooperative produces zero rows, so Community's value prop is empty.

**Mitigation:** Seed the cooperative with FactoryLM-internal synthetic data labeled `source='seed', synthetic=true`. Never leaks tenant identity (there is none). Disclose in MIRA onboarding: *"Cooperative data is seeded from internal testing and will grow with customer contributions."* Remove seed rows once real tenant count ≥ 20 per class.

---

## 3. Phased Plan

Each phase has a **ship gate** (measurable) and **rollback**.

### Phase 0 — Non-Code Foundations (this week, parallel with 90-day MVP)

- **0.1** MSA attorney review. Scope: §1.3/§7 anonymization wording, §9 disclaimers, §10 liability cap, §10.3 equipment-and-safety carve-out, §15.2 Florida arbitration.
- **0.2** Product liability + E&O insurance. $2M per-claim / $5M aggregate minimum. Hiscox, Coalition, Embroker.
- **0.3** Neon enterprise pricing — branches, connection limits, PITR, egress, POPs.
- **0.4** Equipment class taxonomy v0 — `docs/reference/equipment-classes.md`. Start with ~30 classes drawn from Conveyor of Destiny + standard plant equipment (VFDs by HP band, gear reducers, pneumatic cylinders, photo sensors, safety relays, e-stops, PLCs, HMIs, sorters, conveyors).
- **0.5** Subprocessor register — `docs/legal/subprocessors.md` listing Neon, Groq, Gemini, Anthropic, Cerebras, Stripe, GitHub, Doppler; retention terms per provider.
- **0.6** Pricing reconciliation decision (§2.2 above) + MSA Exhibit B update.
- **0.7** DPA template drafted (GDPR + CCPA variant). Attorney reviews with MSA.

**Ship gate:** attorney redline doc in repo; COI scanned to `docs/legal/insurance/`; Neon pricing doc in repo; taxonomy + subprocessors + DPA merged.

**Rollback:** n/a (non-code).

### Phase 1 — Tenancy Foundation (post-0, weeks 1–2)

- **1.1** Alembic/SQL migration `006_commercial_plan.sql`:
  ```sql
  ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'community';
  ALTER TABLE tenants ADD CONSTRAINT plan_valid
    CHECK (plan IN ('community','professional','enterprise','onprem'));
  CREATE INDEX tenants_plan_idx ON tenants(plan);
  ```
  Apply to `plg_tenants` too if we keep both tables.
- **1.2** Rename `MIRA_TENANT_ID` docs/code to clarify it is a legacy single-tenant hint; new helpers prefer request-scoped context.
- **1.3** Add RLS policies to every tenant-scoped table:
  ```sql
  ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON knowledge_entries
    USING (tenant_id = current_setting('app.tenant_id', true)::text);
  ```
  Repeat for `conversation_state`, `feedback_log`, `equipment_photos`, `manual_cache` (if tenant-scoped).
- **1.4** Shared tenancy helpers: `mira-core/mira-ingest/tenancy.py`, `mira-web/src/lib/tenancy.ts`. Both set `SET LOCAL app.tenant_id` on connection acquisition. Fail-closed.
- **1.5** Cross-tenant leak test suite: `tests/tenancy/test_cross_tenant_isolation.py`. Seed two tenants, attempt reads without context → expect error; attempt reads with wrong context → expect zero rows.

**Ship gate:** `pytest tests/tenancy/` green; EXPLAIN on every production query shows the RLS predicate; zero regressions in MIRA's existing 76 offline tests + 39 golden cases.

**Rollback:** drop policies (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`), drop the `plan` column. Migrations are additive and reversible.

### Phase 2 — Commercial Tier Gates (week 3)

- **2.1** Quota table keyed on `plan` (not `tier`):
  ```sql
  CREATE TABLE IF NOT EXISTS plan_limits (
    plan TEXT PRIMARY KEY,
    daily_requests INTEGER,
    monthly_requests INTEGER,
    photo_uploads_per_day INTEGER
  );
  INSERT INTO plan_limits VALUES
    ('community', 1000, 30000, 50),
    ('professional', 1000, 30000, 50),
    ('enterprise', NULL, NULL, NULL),  -- uncapped
    ('onprem', NULL, NULL, NULL);
  ```
- **2.2** Update `mira-web/src/lib/quota.ts` to read `plan_limits` by `plan` and keep the lifecycle gate (`tier === 'active'`).
- **2.3** Billing page shows `plan` and `tier` separately; plan upgrade triggers Stripe tier change + `plan` update.

**Ship gate:** Unit tests cover every plan-combination quota gate; existing PLG flow unaffected.

**Rollback:** Feature-flag the plan-aware quota lookup; old quota logic stays live until flag flips.

### Phase 3 — Anonymization Pipeline (weeks 4–5)

- **3.1** Migration `007_knowledge_cooperative.sql`:
  ```sql
  CREATE TABLE knowledge_cooperative (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_class TEXT NOT NULL,
    fault_category TEXT NOT NULL,
    resolution_strategy TEXT,
    effectiveness_score FLOAT,
    sample_size INT NOT NULL CHECK (sample_size >= 10),
    contributing_tenants INT NOT NULL CHECK (contributing_tenants >= 10),
    region TEXT,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    source TEXT DEFAULT 'contributed',  -- 'contributed' | 'seed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(equipment_class, fault_category, region, window_start)
  );
  ```
  No `tenant_id` — intentional.
- **3.2** Celery beat task `mira-crawler/tasks/cooperative_aggregate.py`, nightly 02:00 UTC. Queries `feedback_log` + conversation outcomes for Community-plan tenants only.
- **3.3** K-anonymity gate: `COUNT(DISTINCT tenant_id) >= 10` per group.
- **3.4** Dominance suppression: if any single tenant represents > 50 % of a group, drop the group.
- **3.5** Equipment-class generalization via taxonomy (Phase 0.4).
- **3.6** Region generalization: metro area, not ZIP. Use a zip→metro mapping table seeded from USPS data.
- **3.7** Audit log: every cooperative write records cohort size + suppression reasons + source, never tenant IDs.

**Ship gate:** Synthetic 12-tenant dataset produces rows; 8-tenant produces zero. Manual red-team: attempt to re-identify a tenant from three sample rows — fail.

**Rollback:** Disable the Celery beat schedule; truncate `knowledge_cooperative`. Append-only design makes this safe.

### Phase 4 — Cooperative Retrieval in GSDEngine (week 6)

- **4.1** `mira-bots/shared/cooperative.py` — retrieval helper. Given `(equipment_class, fault_category)`, returns top-K patterns with citation metadata.
- **4.2** `Supervisor` calls the helper **only when** `tenant.plan == 'community'` OR (`tenant.plan == 'enterprise' AND tenant.cooperative_opt_in == true`).
- **4.3** Response formatting: *"Based on patterns from 47 facilities with similar VFDs …"*. Never below k=10.
- **4.4** Cache cooperative hits with 24 h TTL (the aggregate table only changes nightly).

**Ship gate:** A/B snapshot diff — Community tenant response includes the "N facilities" citation; Professional tenant response does not, for the same prompt.

**Rollback:** Feature flag on `Supervisor`; off returns to pre-cooperative behavior.

### Phase 5 — Professional Tier Isolation (weeks 7–8)

- **5.1** Decide branch vs schema (per §2.4). Assuming branch:
- **5.2** `mira-web/src/lib/neon.ts` — thin client for Neon REST API (create/list/delete branch, get connection string).
- **5.3** Signup flow: when customer selects Professional at Stripe checkout, on `tier: 'active'` transition, call `createBranch(slug)` → store encrypted connection string in `tenants.database_url_encrypted`.
- **5.4** Tenant router (server-side): for `plan='professional'`, open connections against the branch URL instead of the shared URL.
- **5.5** Migration runner `tools/run_migrations_all_branches.py` iterates all Professional branches on deploy.
- **5.6** Cooperative aggregator already skips non-Community (Phase 3.2) — verify with synthetic Professional tenant.

**Ship gate:** Test Professional tenant → branch visible in Neon console → data never appears in cooperative → branch deletion when tenant terminates.

**Rollback:** Branch deletion is reversible via Neon PITR for 7 days; tenant flipped back to `plan='community'` routes back to shared DB.

### Phase 6 — Enterprise Tier (month 3)

- **6.1** Enterprise = dedicated DB or BYOD. Start with dedicated (another Neon branch, bigger compute).
- **6.2** BYOD flow: pre-flight checker (`tools/byod_preflight.py`) — Postgres ≥ 14, `pgvector`, `pg_trgm`, required roles. Provision script runs all migrations.
- **6.3** Encrypted connection string storage: KMS envelope in `tenants.database_url_encrypted`. Key rotation documented.
- **6.4** SSO/SAML via `mira-web` — likely `@hono/oauth-providers` or WorkOS.
- **6.5** Custom CMMS connector framework — `mira-mcp/cmms/base.py` pattern extended to accept customer-specific adapters.
- **6.6** Cooperative opt-in UI in billing page.

**Ship gate:** BYOD tenant provisioned against a fresh Postgres 14 instance completes full GSDEngine flow end-to-end.

**Rollback:** BYOD tenant reverts to hosted Neon branch; contractual exit path spelled out in Order Form (MSA Exhibit B).

### Phase 7 — On-Premise Packaging (month 4)

- **7.1** `docker-compose.onprem.yml` — `mira-pipeline`, `mira-hub` (when the Next.js stub is ready), `mira-telegram` adapter, `postgres` (pgvector), `ollama` (GPU-gated optional).
- **7.2** Multi-arch images published to GHCR. ARM64 for Apple Silicon maintenance labs; AMD64 for plant servers.
- **7.3** License activation: signed JWT with 90-day offline validity; online refresh at `factorylm.com/activate`; annual keys for air-gapped.
- **7.4** Local inference: Ollama + `qwen2.5vl:7b` for vision + `qwen2.5:7b` for text. Config flag `INFERENCE_BACKEND=local|cloud`.
- **7.5** No cooperative contribution from on-prem (MSA §7.2(b)). Enforced by the absence of a phone-home.

**Ship gate:** Clean install on isolated macOS/Ubuntu → local Telegram-equivalent adapter answers a test prompt using Ollama.

**Rollback:** License-key expiration revokes on-prem. Cloud migration path offered.

---

## 4. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Cross-tenant leak** via missing RLS policy or un-wrapped DB query. | Medium | Catastrophic | RLS enforced at schema. Fail-closed tenancy helper. `tests/tenancy/` suite. External pen-test before first Enterprise signup. |
| R2 | **K-anonymity floor** leaves Community tenants value-poor at first 9 signups. | High | High | Seed cooperative with synthetic FactoryLM-internal data labeled `source='seed'`. Communicate the floor explicitly in onboarding. |
| R3 | **Re-identification** via quasi-identifiers (region + equipment class + rare fault). | Medium | High | Metro-level region (not ZIP); dominance suppression; graduate to ε-differential privacy before Enterprise GA. |
| R4 | **Pricing incoherence** between 90-day MVP ($97) and MSA ($499). | High | Medium | §2.2 reconciliation. Update MSA Exhibit B or add Starter tier. |
| R5 | **Schema drift in BYOD tenants** as customer Postgres evolves. | High (over time) | Medium | Weekly drift detection job; schema hash stored on customer cluster; auto-reconcile with alert. |
| R6 | **Neon branch economics** break at scale (100+ Professional tenants). | Medium | Medium | Phase 0.3 pricing discovery. Fallback to schema-per-tenant. |
| R7 | **Lifecycle ↔ plan gate confusion** causes users to lose access during upgrade. | Medium | High (UX) | Split column (§2.1 Option A). Integration tests cover every (plan × tier) combo. |
| R8 | **Stripe and plan mismatch** — webhook updates `tier` but not `plan`. | Medium | Medium | Stripe subscription metadata carries `plan`; webhook idempotency + explicit plan sync test. |
| R9 | **Legal liability** on AI-misdiagnosed maintenance action. | Low per incident, certain eventually | Catastrophic per incident | Insurance (Phase 0.2). §9.2 + §9.3 disclaimers. Safety keyword LOTO kept first-class. |
| R10 | **Downgrade expectation gap** — customer expects Prof→Community to retract data. | Medium | Reputation | Confirm UX banner before Community opt-in. Cite MSA §7.6 in the modal. |
| R11 | **On-prem license bypass.** | Medium | Low-medium revenue | Signed JWT + node binding. 90-day refresh floor. Accept some leakage; chase at renewal. |
| R12 | **Subprocessor data retention drift** from MSA representations. | Medium | Medium | Quarterly subprocessor review; automated script diffs provider DPAs against register. |

---

## 5. Cross-Repo Coordination

| Decision | MIRA | FactoryLM | Owner |
|---|---|---|---|
| MSA signed by FactoryLM, Inc. | Customer-facing terms live here (`docs/legal/`). | Corporate record kept in `~/factorylm/docs/legal/` (symlink or copy). | Mike |
| Equipment class taxonomy | Used by anonymization pipeline. | Used by PLC / Conveyor of Destiny instrumentation. | Both repos reference the same canonical list. Publish in MIRA; symlink from factorylm. |
| Doppler `factorylm/prd` | Reads `NEON_DATABASE_URL` + plan-specific secrets. | Reads same for cluster services. | Doppler project structure unchanged; add `NEON_COOPERATIVE_URL` if cooperative moves to its own branch. |
| Cluster ops (CHARLIE node) | No change — MIRA services run on VPS + dev boxes. | FactoryLM/CLUSTER.md governs. | No change. |

The factorylm monorepo has an "Arrested Development" phase (feature freeze until V1 Solo Technician ships) that does **not** apply to MIRA. MIRA's own active constraint is the 90-day MVP plan's $97/mo × 10 customers target. This data-tier work is compatible with that MVP — the $97 tier becomes Starter / PLG and $499 Community is the next rung up.

---

## 6. Immediate (Non-Code) Next Actions

- [ ] Reconcile pricing (§2.2). Decide whether Starter ($97) is the fifth tier or the entry point to Community.
- [ ] Engage Florida SaaS/data-privacy attorney for MSA redline. Budget $3K–$8K.
- [ ] Three insurance quotes (product liability + E&O).
- [ ] Email Neon sales — enterprise pricing for 50–100 branches.
- [ ] Draft equipment taxonomy v0 — `docs/reference/equipment-classes.md`.
- [ ] Draft subprocessor register — `docs/legal/subprocessors.md`.
- [ ] Draft DPA template.
- [ ] Five prospect conversations validating $499 vs $649 split (30 % premium hypothesis).

---

## 7. Verification — Per-Phase Proof

| Phase | Proof |
|---|---|
| 0 | MSA redlines in `docs/legal/msa-redlines-round-1.md`; COI scanned; Neon pricing doc; taxonomy + subprocessors + DPA merged. |
| 1 | `pytest tests/tenancy/` green; 2-tenant leak test fails before policies, passes after. |
| 2 | Plan-aware quota logic replaces tier-aware; Stripe webhook idempotency test green. |
| 3 | Synthetic 12-tenant → cooperative rows written; 8-tenant → zero rows; audit log tenant-free; red-team re-identification fails. |
| 4 | A/B snapshot: Community prompt includes "N facilities" citation; Professional does not. |
| 5 | Test Professional tenant visible as branch in Neon; cooperative excludes it; deletion on termination. |
| 6 | BYOD tenant provisioned against fresh Postgres 14 runs full GSDEngine. |
| 7 | Air-gapped install answers a test prompt via Ollama; license tamper fails validation. |

---

## 8. Explicit Non-Goals

- Regional data residency enforcement (EU-only hosting) — deferred to post-Enterprise GA.
- SOC 2 Type II — parallel track.
- Per-tenant model fine-tuning — cooperative aggregates are sufficient.
- Federated learning between on-prem installs — explicitly not in design (on-prem doesn't contribute per MSA §7.2(b)).
- Multi-region active-active — single region (US-East) for all cloud tiers.
- Migrating the 90-day MVP $97 tier into this framework immediately — Starter stays simple until Phase 2 is done.

---

## 9. Document Index (for future sessions)

| File | Purpose |
|---|---|
| `docs/legal/FactoryLM_MSA_Draft_v1.md` | Customer contract draft (v1.0, 2026-04-24). Pending attorney review. |
| `docs/architecture/FactoryLM_Data_Tier_Architecture.md` | Original technical design (source for this plan). |
| `docs/plans/2026-04-24-data-tier-implementation.md` | This file. |
| `docs/plans/v1-customer-scope.md` | v1 pricing discussion — $499 facility-flat rate. |
| `docs/plans/2026-04-19-mira-90-day-mvp.md` | 90-day MVP plan — $97/mo × 10 customers. |
| `docs/reference/equipment-classes.md` | *TODO (Phase 0.4).* |
| `docs/legal/subprocessors.md` | *TODO (Phase 0.5).* |
| `docs/legal/dpa-template.md` | *TODO (Phase 0.7).* |

---

*When Phase 0 deliverables are in, open a tracking issue in GitHub and update the "Currently in-flight" table in `2026-04-19-mira-90-day-mvp.md`.*
