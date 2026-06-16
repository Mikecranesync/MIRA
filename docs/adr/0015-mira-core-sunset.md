# ADR-0015: Sunset mira-core (Open WebUI) — investigation draft

## Status
**Draft / investigation** — 2026-05-20

**Tracks issue:** #1463
**Related:** ADR-0008 (sidecar deprecation), ADR-0014 (product-led wedge)

> This ADR is *research only*. No code changes accompany this commit.
> Decision is deferred until the migration plan in §6 is reviewed.

---

## Context

`mira-core` is the SaaS bundle's Open WebUI deployment (`ghcr.io/open-webui/open-webui:v0.8.10`), wired in via `docker-compose.saas.yml` as the container `mira-core-saas`. It originally served three roles in the v0.x MIRA architecture:

1. **Chat UI** — the customer-facing chat surface and conversation history.
2. **Auth** — Open WebUI's account system + JWT.
3. **KB browse / upload** — Open WebUI's RAG document library + embedding store.

It also hosts `mira-ingest` (the photo / asset-tag ingestion service) at `mira-core/mira-ingest/`, which is a separate FastAPI service that *talks to* Open WebUI for embedding storage but is logically distinct from the Open WebUI process itself.

The MIRA architecture has evolved past most of those roles:

- **Chat path moved to `mira-pipeline`** (ADR-0008): the OpenAI-compat shim wrapping `Supervisor` (`mira-bots/shared/engine.py`) is now the production chat path on the VPS.
- **Hub auth (NextAuth)** is the canonical multi-tenant auth surface (ADR-0014).
- **Hub `/knowledge` and `/documents`** routes already surface KB content from `kg_entities` / `knowledge_entries` via NeonDB.
- **`/quickstart`** (ADR-0014) is the public, no-auth grounded-answer surface — already shipped, owned by `mira-pipeline`, indexed by NeonDB.

The `docs/THEORY_OF_OPERATIONS.md` layer map does **not** list `mira-core` as a canonical layer. It is, today, infrastructure with diminishing product purpose.

---

## 1. What mira-core currently provides

Mapped from the live `docker-compose.saas.yml` and code grep (`OPENWEBUI_BASE_URL`, `mira-core` references):

| Capability | Provided by mira-core | Live consumer |
|------------|-----------------------|---------------|
| Web chat UI at `:8080` | ✅ Open WebUI front-end | Some internal flows; not the customer surface |
| User accounts + JWT | ✅ Open WebUI auth | mira-ingest → `OPENWEBUI_API_KEY` |
| KB document library | ✅ Open WebUI RAG store | `mira-bots/shared/workers/rag_worker.py` `_call_openwebui()` fallback path |
| Embedding store (Open WebUI's internal vector DB) | ✅ | mira-crawler embedder fallback |
| `/api/chat/completions` Ollama proxy | ✅ Open WebUI passthrough | `mira-bots/shared/workers/{rag,nameplate,print}_worker.py` fallback layer |
| Branding / custom logo | ✅ via `entrypoint-mira.sh` + `/branding` volume mount | n/a (customer-invisible) |
| MCPO proxy (`mira-mcp` over OpenAPI) | ✅ via `Dockerfile.mcpo` | dev path; redundant with FastMCP REST |

**Other consumers in repo grep (`grep -rE 'OPENWEBUI|mira-core'`):**
- `mira-web/src/server.ts`, `mira-web/src/routes/inbox.ts` — marketing site uses Open WebUI as an inbox backend
- `mira-web/src/lib/account-deletion.ts` — account-deletion handler cascades through Open WebUI
- `tools/migrate_sidecar_oem_to_owui.py` — one-shot migration script (#195 follow-up)
- `tools/owui_tools/setup_owui_models.py` — model registration helper
- `mira-bots/setup_v2.py` — installer mentions OPENWEBUI envs
- `evals/query_stub.py`, `tools/staging_test.py` — eval/test harnesses

---

## 2. What the Hub already covers (today)

- ✅ **Auth** — NextAuth on `mira-hub/src/app/api/auth/`. Multi-tenant by design, Doppler-managed secrets, SAML on the way (`@node-saml/node-saml` already in deps).
- ✅ **Chat surface (cited)** — `/quickstart` (public no-auth) + the planned authenticated `/ask` surface, both routed through `mira-pipeline`.
- ✅ **KB browse** — `/knowledge`, `/documents`, `/library` routes; render from NeonDB.
- ✅ **Conversation history** — Hub's `conversations` route (still partly mocked at the time of writing; tracked separately).
- ✅ **Per-tenant settings, billing, team** — pure Hub responsibility.

---

## 3. What Hub does NOT cover (the gaps to close before sunset)

| Gap | Severity | Owned by | Notes |
|-----|----------|----------|-------|
| RAG fallback path in `rag_worker._call_openwebui()` | **High** | Engine | This is the catch-all if Groq/Cerebras/Gemini all fail. Need an equivalent fallback that does NOT route through Open WebUI. Options: (a) accept the cascade-failure error and return the structured "no grounded answer" payload, (b) replace the OWUI passthrough with a direct Ollama call on the same VPS, (c) drop the fallback (cascade already has 3 providers). |
| Nameplate worker OWUI fallback (`nameplate_worker._call_openwebui`) | **Medium** | Engine | Same calculus as above. Vision uses `qwen2.5vl:7b` via OWUI; can call Ollama directly. |
| Print worker OWUI passthrough | **Medium** | Engine | Same as above. |
| `mira-ingest`'s OWUI dependency for OEM document RAG indexing | **High** | Crawler / ingest | mira-ingest writes to OWUI's Knowledge collections (`OPENWEBUI_KB_*`). Need to confirm whether the new NeonDB-backed `knowledge_entries` path covers all the indexing flows. If yes, mira-ingest's OWUI dependency is gone. |
| Eval harness (`evals/query_stub.py`, `tools/staging_test.py`) targeting OWUI | **Low** | Tools | Rewrite eval target to mira-pipeline. One-day task. |
| mira-web inbox backend dependency (`mira-web/src/routes/inbox.ts`) | **Medium** | Web | The marketing site's inbox today routes via OWUI. Replace with Hub `/conversations` API or split inbox to a Hub-owned route. |
| MCPO proxy (Dockerfile.mcpo) | **Low** | Dev | Used in dev for MCP-over-OpenAPI prototyping. Not needed in prod sunset path. |
| `mira-core/branding/` custom logo + entrypoint | **Cosmetic** | Ops | Customer never sees OWUI today (mira-pipeline is the chat path). Cosmetic; dropped on sunset. |
| `mira-core/data/` volume — Open WebUI's SQLite (`webui.db`) | **Data** | Ops | Per-tenant chat history. Need to migrate to Hub conversations or accept loss with notice. |

---

## 4. Risk assessment

**HIGH risk:**
- The RAG-cascade fallback to OWUI is load-bearing during cloud-provider outages. Removing it without a replacement reduces reliability during Groq/Cerebras/Gemini incidents.
- mira-ingest's KB upload pipeline writes to OWUI Knowledge collections; sunset before NeonDB-backed indexing is at 100% parity loses upload functionality.
- mira-web's inbox is wired to OWUI. Cutting the cord with no replacement breaks the marketing-site inbox.

**MEDIUM risk:**
- OWUI also hosts the eval target for `evals/query_stub.py` and `tools/staging_test.py`. Sunset would invalidate the current staging-eval harness until eval targets are migrated.
- Account-deletion in `mira-web/src/lib/account-deletion.ts` calls OWUI; cleanup paths need an OWUI-free replacement.

**LOW risk:**
- The chat-UI surface of OWUI is not customer-visible (mira-pipeline owns chat today). Customers will not notice the sunset.
- Branding / theming files are inert without OWUI.
- MCPO proxy is dev-only; trivial to remove.

---

## 5. Hard prerequisites (must hold before sunset)

1. **OWUI fallback is no longer load-bearing.** Either accept cascade-only (no fallback), or replace OWUI passthrough with direct Ollama calls in `rag_worker`, `nameplate_worker`, `print_worker`. Decision pending; recommendation in §6.
2. **mira-ingest indexes to NeonDB only.** Confirm `knowledge_entries` round-trip parity with OWUI Knowledge collections for OEM corpus (Rockwell, ABB, Siemens, Schneider, GS10, PowerFlex, Micro820). Track via `tools/migrate_sidecar_oem_to_owui.py` follow-up (#195).
3. **mira-web inbox migrated.** Route to Hub `/conversations` API or split out a Hub-owned inbox.
4. **Eval target migrated.** Rewrite `evals/query_stub.py` + `tools/staging_test.py` to hit mira-pipeline. Confirm staging-gate / `tests/eval/` suites still pass.
5. **Account-deletion cascade rewritten.** Drop OWUI step from `mira-web/src/lib/account-deletion.ts`.
6. **Per-tenant chat history migration plan.** Either (a) export OWUI `webui.db` → Hub `conversations` on cutover, or (b) freeze legacy history at a public URL + retire.

---

## 6. Migration plan (proposed)

**Phase 1 — Decouple (2 weeks)**

- Audit OWUI fallback usage in `rag_worker`, `nameplate_worker`, `print_worker`. Confirm cascade reliability data (provider success rates from existing telemetry). Decision: drop fallback (cleanest) vs replace with direct Ollama (more reliable but more infra).
- Replace `mira-web/src/routes/inbox.ts` OWUI dependency with Hub-owned route. PR.
- Rewrite `mira-web/src/lib/account-deletion.ts` to skip OWUI step. PR.
- Confirm `mira-ingest` writes to `knowledge_entries` (NeonDB) as the primary path; OWUI write becomes opt-in.

**Phase 2 — Migrate (2 weeks)**

- Export per-tenant OWUI conversation history from `mira-core/data/webui.db` to Hub `conversations` table. Migration script + dry-run.
- Migrate eval targets in `evals/query_stub.py` and `tools/staging_test.py` to mira-pipeline.
- Remove `OPENWEBUI_BASE_URL` requirement from `mira-bots/setup_v2.py` installer.

**Phase 3 — Sunset (1 week)**

- Remove `mira-core` from `docker-compose.saas.yml`. Keep the directory in repo for one release as a fallback.
- Remove `OPENWEBUI_*` env vars from Doppler `factorylm/prd`.
- Drop `mira-core/branding`, `entrypoint-mira.sh`, `Dockerfile.mcpo`, `mcpo-config.json`.
- Tag `mira-core-sunset` release.

**Phase 4 — Cleanup (lazy)**

- Delete `mira-core/` directory in a follow-up commit after one release of soak time.
- Archive `mira-core/data/` snapshot for compliance / audit.

---

## 7. Open questions (for the deciding review)

1. **OWUI fallback: drop or replace?** What is the provider-cascade success rate over the last 90 days? Is the fallback ever triggered?
2. **Per-tenant conversation history migration: live cutover or accept loss?** Customers on `app.factorylm.com` may have OWUI history. Importance?
3. **mira-ingest indexing parity with NeonDB:** is `knowledge_entries` at 100% feature-parity for the existing OEM corpus and ingest flows?
4. **Branding / UI:** does any customer-facing flow today still link to the OWUI front-end at `app.factorylm.com:8080`? Best as of grep, no — but worth confirming on prod nginx.
5. **MCPO replacement:** the dev MCPO proxy exposes `mira-mcp` over OpenAPI. Do we need an equivalent in the post-sunset world, or is the FastMCP REST shim sufficient?

---

## 8. Recommendation (preliminary — pending §7 answers)

**Migrate, do not preserve.** mira-core has been infrastructure-debt since ADR-0014's product-led wedge decision. The sunset path is well-defined; the migration is bounded (~5 weeks of phased work); the value of keeping OWUI in-bundle is diminishing.

The conservative variant: replace the OWUI fallback in worker call-paths with a direct Ollama call on the VPS, rather than dropping the fallback entirely. That keeps the resilience story intact while removing the OWUI process.

**Next step:** answer §7 questions, accept this ADR, and open the Phase 1 PRs.

---

## References

- ADR-0008 — sidecar deprecation (the earlier "move chat off services-installed RAG" decision)
- ADR-0014 — product-led wedge (the strategic context that demoted mira-core)
- `docs/THEORY_OF_OPERATIONS.md` — canonical layer map (note: mira-core not listed)
- `docker-compose.saas.yml` — current mira-core bundle
- `mira-core/CLAUDE.md` (and submodule CLAUDE.md files) — local-deep context
- `mira-bots/shared/workers/{rag,nameplate,print}_worker.py` — OWUI fallback consumers
- Issue #1463 — original investigation request
- Issue #195 — OEM migration tracker (precondition)
