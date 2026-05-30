# ADR-0016: Evaluate replacing mira-bridge with FlowFuse — investigation draft

## Status
**Draft / investigation** — 2026-05-20

**Tracks issue:** #1465
**Related:** ADR-0014 (product-led wedge)

> Research only. No code changes accompany this commit.

---

## 1. Context

`mira-bridge` is a self-hosted Node-RED 4.x deployment (`nodered/node-red:4.1.7-22`) wrapped in a custom Dockerfile + a shared SQLite WAL coordination layer. Today it does three things:

1. **Message routing.** Inbound Telegram webhooks → MIRA core services. REST triggers (`/uns-confirmed`, `/scrape-complete`, etc.) → `mira-mcp` and `mira-bots`.
2. **Shared SQLite write authority.** `mira-bridge` holds the write lock on `mira.db` (WAL mode). `mira-mcp` and `mira-ingest` read/write the same file via a Docker volume.
3. **Scheduled tasks.** `mira-scheduled-tasks.json` runs periodic Node-RED-driven jobs.

The three current flows total 858 lines of JSON across `mira-dashboard-conveyor.json`, `mira-scheduled-tasks.json`, `mira-setup-wizard.json`. Flow edits are made in the Node-RED UI, exported, and committed manually — a workflow that has drifted (commits frequently lag the deployed flow state).

**FlowFuse** is a managed Node-RED platform (commercial + open-source self-host) that adds:
- Multi-tenant project isolation (each team gets its own Node-RED instance).
- Centralized secrets, env vars, deploy snapshots, audit log.
- A blueprint / template system (publish a flow, deploy to N tenants).
- Role-based access (admin / editor / viewer).
- Hosted plan that maps to MIRA's expected SaaS tier model.

The question is whether the operational debt of self-hosted Node-RED + custom WAL coordination is greater than the lift + ongoing cost of FlowFuse.

---

## 2. What mira-bridge does today (feature inventory)

| Capability | Implementation | Risk if changed |
|------------|----------------|-----------------|
| Inbound webhook routing (Telegram, REST) | Node-RED HTTP-in nodes | High — production chat path goes through this |
| SQLite write lock on `mira.db` | mira-bridge holds write authority; others use WAL reads | Medium — relocating the write authority is a coordinated migration |
| Scheduled jobs (`mira-scheduled-tasks.json`) | Node-RED scheduler | Low — replaceable with Celery beat or `mcp__scheduled-tasks__` |
| Setup wizard flow (`mira-setup-wizard.json`) | Node-RED UI flow | Medium — embedded into early-customer onboarding |
| Dashboard / conveyor flow (`mira-dashboard-conveyor.json`) | Node-RED UI flow | Low — demo/visualization layer, not production-critical |
| Volume coordination with mira-mcp + mira-ingest | Docker volume mount of `/data` | High — shared SQLite is the database for these three services |

**Customer-visible surface:** none. mira-bridge runs at `:1880` internally; not exposed to the public.

**Test surface:** `tests/regime3_bridge/` (Node-RED-specific) + integration tests under `tests/regime4_*` that depend on the shared `mira.db`.

---

## 3. FlowFuse feature-parity assessment

| Capability we need | FlowFuse equivalent | Parity |
|--------------------|---------------------|--------|
| Node-RED 4.x flow engine | ✅ Native | Full |
| HTTP-in inbound routing | ✅ Native | Full |
| Shared SQLite WAL across containers | ❌ FlowFuse isolates per-project storage | **No parity** — would have to move shared state out of mira-bridge entirely (e.g. all writes through NeonDB or a managed Postgres) |
| Docker-volume bind mounts | ❌ Hosted FlowFuse uses internal storage; self-hosted FlowFuse supports volumes but loses the tenancy benefit | Partial |
| Manual JSON commits of flow edits | ✅ Replaced by FlowFuse snapshots + Git sync | **Improves on current** — Git sync is built-in |
| Per-tenant isolation | ✅ Native (FlowFuse Teams) | **Improves on current** — today mira-bridge is single-tenant |
| Secrets management | ✅ FlowFuse env vars + secrets | Equivalent (we already use Doppler; either works) |
| Audit log of flow changes | ✅ Native | **Improves on current** — today flow changes only show up as JSON diffs at commit time, if at all |
| Scheduled tasks | ✅ Node-RED scheduler nodes still work | Full |

**The blocker:** FlowFuse's tenancy model assumes per-project storage. The current `mira-bridge` SQLite WAL pattern (mira-mcp + mira-ingest share the file via volume) is incompatible with multi-tenant FlowFuse. To use FlowFuse multi-tenancy we must first move the shared state out of SQLite-on-volume.

---

## 4. Multi-tenant story

**Current state:** mira-bridge is single-tenant. All factory data is co-mingled in one `mira.db` SQLite file. Tenancy is enforced upstream in `mira-bots/shared/chat_tenant.py` and `mira-pipeline`, not in Node-RED. This works for now because:
- The bridge mostly does stateless message routing; the tenancy filter happens before/after the bridge.
- The shared SQLite is essentially a queue + state cache, not a primary record.

**FlowFuse multi-tenant variants:**

- **(a) Self-hosted FlowFuse, single team.** Same tenancy posture as today, but with FlowFuse's improved flow management + Git sync + audit log. No tenancy improvement. Cost: open-source self-host (free), single VPS.
- **(b) Self-hosted FlowFuse, multiple teams.** Each MIRA customer gets a separate Node-RED instance. Requires moving shared SQLite state to NeonDB (or a managed Postgres) first.
- **(c) FlowFuse Cloud (managed).** Same as (b) but FlowFuse runs the infrastructure. Removes the operational tax of patching Node-RED + the FlowFuse control plane.

**The product-led wedge implication (per ADR-0014):** self-serve onboarding implies many small tenants. If each tenant gets a Node-RED instance, the per-tenant cost has to be near zero. Variants (b) and (c) only make sense at scale; variant (a) is the conservative path.

---

## 5. Cost projection at MIRA's SaaS scale

Working assumptions: $97 tier customer, ~150 paying tenants by Q4 2026, ~1,000 by 2027 EOY.

| Variant | Per-tenant cost | At 150 tenants | At 1,000 tenants | Notes |
|---------|-----------------|----------------|-------------------|-------|
| (a) Self-hosted FlowFuse, single team | $0 / tenant | $0/mo + 1 VPS ($30/mo) | Same | No tenancy improvement, but better flow ops |
| (b) Self-hosted FlowFuse, multi-team | Compute per instance — assume 256MB RAM, $0.01/hr per Node-RED process = ~$7/mo at idle | ~$1k/mo | ~$7k/mo | Plus the lift to move shared SQLite to NeonDB |
| (c) FlowFuse Cloud (Team plan, $30 / team / mo per published pricing snapshot 2026-Q2) | ~$30 / tenant | $4.5k/mo | $30k/mo | Margin death at $97 ARPU |

**Numbers are illustrative — FlowFuse Cloud pricing must be re-checked against the live page before any commit.**

Conclusion: variant (c) is incompatible with the $97 / $297 tier ARPU. Variant (b) is plausible at small scale but loses margin past ~500 tenants. Variant (a) is cost-neutral and gives flow-ops upside.

---

## 6. Migration plan / risk

### If we choose variant (a) — self-hosted FlowFuse, single team

**Lift:** ~1 week

1. Stand up FlowFuse OSS on the staging VPS. Confirm Node-RED 4.x project boots with the existing flow JSON.
2. Import current flows (`mira-dashboard-conveyor.json`, `mira-scheduled-tasks.json`, `mira-setup-wizard.json`) into a FlowFuse project.
3. Wire FlowFuse's Git sync to a `mira-bridge-flows/` repo (or stay in the monorepo at `mira-bridge/flows/`).
4. Hand-test on staging: webhook routing, scheduled jobs, setup wizard.
5. Cut over prod: replace `mira-bridge` container with FlowFuse-managed Node-RED.

**Risks:** low. FlowFuse OSS is well-supported; the migration is "lift and shift" a Node-RED runtime.

**Wins:** Git sync, audit log, snapshot rollback, better UI.

### If we choose variant (b) — self-hosted FlowFuse, multi-team

**Lift:** ~6–8 weeks

1. Move shared SQLite state to NeonDB. Refactor mira-mcp + mira-ingest to talk to NeonDB instead of `/data/mira.db`. This is the biggest piece. Tracked by ADR-0013 (UNS namespace builder schema canonicalization) — likely overlaps.
2. Stand up FlowFuse OSS in multi-team mode. Build a tenant-onboarding hook that provisions a new team on signup.
3. Repackage the current flows as a FlowFuse blueprint. Each new tenant gets the blueprint deployed.
4. Per-tenant secrets injection from Doppler.
5. Migration of existing tenants — coordinated downtime or live cutover.

**Risks:** high. Touches the entire mira-mcp + mira-ingest data layer. The shared-SQLite-via-volume pattern is load-bearing today.

**Wins:** true per-tenant isolation at the orchestration layer; aligns with ADR-0014 product-led wedge.

### If we choose variant (c) — FlowFuse Cloud

Same lift as (b) plus a hosted-vendor dependency. Cost-prohibitive at MIRA's price point per §5. Not recommended.

---

## 7. Recommendation (preliminary — pending review)

**Defer. Stay on stock Node-RED for the MVP window. Revisit at 500 paying tenants.**

Rationale:
- The current pain (manual flow JSON commits, no audit log) is real but minor. Workarounds exist (e.g., a pre-commit hook that exports flows from the running container).
- The multi-tenant story (variant b/c) is a large, risky refactor that the 90-day MVP plan (`docs/plans/2026-04-19-mira-90-day-mvp.md`) does not have room for.
- Variant (a) is mostly upside but does not move the needle on the constraints we actually care about (multi-tenancy, cost-per-tenant). Net-net it's nice-to-have, not load-bearing.
- mira-bridge's role is already shrinking — ADR-0014 moved the chat path to mira-pipeline, and most scheduled tasks are migrating to MIRA Routines (`wiki/references/routines.md`). The amortized importance of mira-bridge is declining.

**Conditional acceptance triggers:**

- If we hit a multi-tenant deal that requires per-customer Node-RED isolation → fast-track variant (b).
- If Node-RED 4.x EOL is announced or a CVE forces a major patch → use that window to evaluate FlowFuse Cloud as a managed alternative.
- If the manual JSON-flow workflow causes a production incident (e.g., undeployed flow drift) → minimal variant (a) becomes the immediate fix.

---

## 8. Open questions (for the deciding review)

1. **Verify FlowFuse Cloud pricing for 2026-Q2.** Numbers in §5 are illustrative.
2. **Confirm Node-RED 4.x LTS window.** If EOL is < 12 months out, the urgency increases.
3. **Audit: how often are flows changed in prod without a commit?** If "frequently," the audit-log upside of variant (a) gets more weight.
4. **Quantify shared-SQLite usage.** How many writes/sec hit `mira.db` from mira-bridge vs mira-mcp vs mira-ingest? If most writes are bridge-only, variant (b) becomes cheaper than this draft assumes.
5. **Tenant-isolation requirement timing.** Do we actually need orchestration-layer tenancy, or is the upstream filter (`chat_tenant.py` + `mira-pipeline`) sufficient indefinitely?

---

## 9. References

- Issue #1465 — original investigation request
- `mira-bridge/CLAUDE.md` — current bridge context
- `mira-bridge/docker-compose.yml` — current deployment
- `mira-bridge/flows/*.json` — current flow definitions (858 lines total)
- ADR-0014 — product-led wedge (the strategic context that demoted bridge importance)
- ADR-0013 — UNS namespace builder schema canonicalization (the multi-tenant data layer)
- `wiki/references/routines.md` — MIRA Routines (the scheduled-task replacement path)
- FlowFuse OSS — https://github.com/FlowFuse/flowfuse (verify before citing in final version)
- FlowFuse Cloud pricing — verify against current page before final version
