# PLAN — Autonomous gap-closure run, 2026-07-11 (CHARLIE orchestrator)

Operator authorization: "find the gaps that can be done programmatically without my intervention and continue the work" (Mike, 2026-07-11). Mode: orchestrator dispatch — no code edits in the shared checkout; every subagent works in its own worktree off origin/main; PRs opened, **never merged**; no prod access.

## Scope (numbered, with success criteria)

1. **G1 — manual_queue.json deploy-wipe fix** (mira-crawler). Queue state moves out of git-tracked state (gitignore + runtime path or DB) so `deploy-vps.yml git checkout --force` can't erase queued work (#2562 Phase 2). Done when: unit test proves queue survives a simulated reset; PR green.
2. **G2 — KG upsert ON CONFLICT fix** (mira-crawler/ingest/kg_writer.py + mira-hub/db/migrations if needed). Reproduce `ON CONFLICT (tenant_id, entity_type, name)` "no matching constraint" on ephemeral postgres; fix conservatively (#2564 secondary). Done when: repro test red→green; PR green.
3. **G3 — needs_ocr dead-letter drain** (mira-crawler). 0-char extractions fall through to Tika OCR; drain path for quarantined items. Done when: unit test proves fallback fires; PR green. Runs AFTER G1 (same module).
4. **G4 — neon_recall reads per-tenant uploads** (mira-bots/shared). Bot/chat retrieval honors the hybrid law `(is_private=false OR tenant_id=$caller)` + node-scoped folder=brain uploads, closing "bot surfaces can't cite customer uploads" (P0, beta audit). Done when: GS11/bot-grounding suite + eval watch set do not regress; new test proves a tenant upload is retrievable; PR green.
5. **G5 — hygiene**: close PR #2632 (respawned promo draft, standing decision); add `.claude/rules/fast-path-optimization.md` codifying the Supervisor fast-path pattern (engine-cohesion audit P2). Done when: PR open + #2632 closed.
6. **G6 — knowledge_entries hybrid-filter security fixture** (tools/qa/security + CI). Deterministic check that every knowledge_entries read surface carries the hybrid filter; wired as a CI step. Done when: fixture catches a seeded violation in test-of-the-test; PR green.

## OUT of scope (hard)
- mira-web / drive-packs / Stripe / checkout — BRAVO's lane (#2621/#2626/#2625/#2620).
- Merging anything; prod SSH/docker/psql; Doppler prd; GitHub secrets; VPS memory/staging moves; mira-sidecar migration (prod write); beta-gate DOPPLER_TOKEN (Mike).
- Engine FSM/classifier behavior changes beyond the retrieval read-path in G4.

## Dispatch + write-path isolation
Parallel: G2, G4, G5, G6. Sequential: G1 → G3 (shared mira-crawler cron files). Each agent: own worktree off origin/main, conventional commits, /VERSION bump on code PRs, evidence in PR body.
