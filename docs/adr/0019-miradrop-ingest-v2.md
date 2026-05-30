# ADR-0019: MiraDrop Ingest v2 — auto-splitter, KG flywheel, UNS templated artifact

**Status:** Accepted
**Date:** 2026-05-26
**Supersedes:** none
**Related:** ADR-0008 (sidecar deprecation), ADR-0013 (UNS schema canonicalization), ADR-0014 (AI suggestions as work queue), `docs/specs/maintenance-namespace-builder-spec.md`

## Context

`~/MiraDrop/inbox/` is the desktop drop-folder UX where a technician (today: Mike on CHARLIE; tomorrow: any tenant) drops a manual, photo, or wiring diagram and walks away. The watcher daemon (`tools/mira-drop-watcher/`) forwards files to Hub's `/api/uploads/folder` endpoint.

Today's path:
1. Watcher → Hub `local-upload.ts` (buffers entire file in RAM via `await file.arrayBuffer()`, hard 20 MB cap)
2. Hub → `mira-core/mira-ingest` (`/document`, also hard 20 MB cap — comment: "Telegram limit, enforced universally")
3. Open WebUI chunks + embeds + stores
4. No KG attribution. No UNS path. No dialogue with the technician.

A 33 MB Rockwell PowerFlex 525 reference manual dropped 2026-05-24 was rejected with `exceeds_20mb_limit`. The cap exists because the in-memory buffer is unbounded and the 8 GB VPS has OOM'd twice from docling in May 2026 (memory: `project_vps_oom_docling_incidents.md`). Lifting the cap naively reintroduces the OOM risk; keeping it caps the product wedge to ~20 % of real OEM manuals.

The deeper problem isn't the cap. It's that ingest is silent: chunks land in KB but nothing connects them to the technician's actual work context. The KG stays empty of evidence-grounded facts. There is no "templated item" a future reader can recognize.

## Decision

Build **mira-ingest-v2**, a new ingest service that replaces the OW path for MiraDrop. The pipeline is dialogue-driven, KG-attributed, and tech-confirmed.

### Architecture summary

| Layer | Choice |
|---|---|
| Splitting unit | Text-chunk granularity (not physical PDF split). One Drop → one logical document → one `hub_uploads` row → N chunks in `knowledge_entries`. |
| Network path | Watcher → Hub (streams) → mira-ingest-v2. Hub remains the multi-tenant gateway; never buffers the file. |
| Execution model | Async worker. HTTP returns 202 after the file lands on disk; worker advances `hub_uploads.status` through phases. |
| Queue | `hub_uploads` row IS the queue. Worker holds rows via `SELECT ... FOR UPDATE SKIP LOCKED WHERE ingest_route='v2' AND status='queued'`. |
| Schema strategy | Extend `hub_uploads` and `knowledge_entries` in place. No sibling tables. Nullable columns preserve legacy OW-path behavior. |
| Where v2 runs | CHARLIE only, this build. Cloud-side instance is a Day-2 deployment when a customer channel needs it. |
| Docling RAM control | `do_ocr=False` when the PDF has a text layer (the common case); spawn-per-job subprocess lifecycle. |
| Extraction | Hybrid — filename heuristic → rule-based first-N-pages → LLM cascade fallback. `extraction_method` annotated per drop. |
| UNS resolution | **Tech-confirmed via Slack dialogue**, not unilaterally assigned. The UNS Location-Confirmation Gate (from the namespace-builder spec) fires on drop. |
| KG promotion model | Two states (`proposed`/`verified`) with `verified_by` provenance (`tech` / `admin` / `system_consensus`). Tech's Slack tap promotes the manual binding. Derived facts (fault codes, components) promote only via corroboration or explicit admin action. |
| Revision handling | Detect-and-prompt the tech via Slack ("looks like a newer revision — replace, append, separate, cancel?"). Default-on-TTL-expiry = append. |
| Failure semantics | Per-phase checkpoints. Each phase commits idempotently. Crashed jobs resume from last phase via stale-claim sweep. |
| Readiness integration | After binding, the Slack confirmation DM reports the L0–L6 score delta and the next-action CTA from `health_scores.missing`. |
| Photos | Out of scope this build. PDFs only; photos continue on `mira-core/mira-ingest`. Path C (v2 orchestrates photo-ingest as a downstream) is the explicit follow-up. |
| Artifact | A model-level QR PNG sidecar in `~/MiraDrop/done/`, encoding the tech-confirmed UNS path's Hub URL. |

### Doctrine alignments

- **UNS Location-Confirmation Gate** (`.claude/CLAUDE.md` § Non-negotiable): the drop is treated as a new input event to the existing gate machinery. No KG writes before tech confirmation.
- **No silent KG promotion** (`.claude/CLAUDE.md` § Knowledge graph proposals): every `verified` row carries `verified_by` provenance. Pure transitive auto-verification is forbidden.
- **Environment doctrine** (`docs/environments.md`): all schema changes ship dev → staging → prod via `apply-migrations.yml`. v2 itself runs CHARLIE-local only; never on the prod VPS this round.
- **Slack is the front door** (North Star): the dialogue lives in Slack, mirroring the troubleshooting flow.
- **Provider cascade** (PRD §4 + memory `feedback_llm_cascade_default`): LLM-fallback extraction goes through Groq → Cerebras → Gemini. No Anthropic, ever.
- **Single source of truth**: `hub_uploads` is the queue, the audit log, and the row Hub UI renders. No sibling tables (the dual-truth pattern bit us with `kg_relationships` columns — `project_kg_relationships_schema.md`).

## Consequences

### Positive
- The 20 MB rejection goes away by removing the in-memory buffer, not by raising a number. Streaming end-to-end means the cap is determined by disk, not RAM.
- Every drop produces a tech-confirmed UNS path, a KG entity, a verified manual binding, and a scannable QR sidecar. The "templated item future readers understand" goal is met per drop, not per-batch-admin-review.
- The L0 → L6 readiness score moves visibly per drop, giving the tech a continuous feedback loop and FactoryLM a visible value-prop artifact.
- The KG accumulates corroborating evidence across drops without auto-promoting unverified extractions. The two-state + `verified_by` model gives future readers a clear audit chain.
- No new infrastructure (no Redis, no separate queue service). Queue-by-table reuses what Hub already runs.
- Per-phase checkpoints make long jobs (1000+ page manuals) resumable and observable.

### Negative
- Two ingest surfaces during the cutover: v2 (new) + OW path (legacy, still serving photos). The `ingest_route` column on `knowledge_entries` and `hub_uploads` is the discriminator. This is the "dual-truth" risk we accept; it stops the day v2 absorbs photos.
- The Slack dialogue adds a step. A tech who drops 50 manuals at once will be asked to confirm bindings — mitigated by batching ("3 of 50 look like revisions — review?") but never zero-friction.
- Schema changes touch live tables (`hub_uploads`, `knowledge_entries`, possibly `kg_relationships`). All additive, but each migration is one more thing to roll forward through dev → staging → prod.
- Docling subprocess-per-job costs ~3 – 5 s of cold-start per drop. Acceptable for an async ingest; would be unacceptable for a sync API.
- LLM cascade fallback consumes free-tier quota when rules miss. Bounded but non-zero.

### Risks tracked elsewhere
- VPS OOM if v2 is later deployed cloud-side without the two docling levers. → `project_vps_oom_docling_incidents.md` is mandatory reading before that deployment.
- Recall regression on legacy chunks if `knowledge_entries` migration changes column behavior. → New columns are nullable; recall path is untouched.
- Slack DM noise if the tech is doing a bulk-drop. → Batching policy in the spec (Q12 default-on-TTL is the cap).

## Alternatives rejected

| Considered | Rejected because |
|---|---|
| Raise the 20 MB cap to 200 MB | Would solve the immediate rejection but not the OOM or the missing KG attribution. The cap is a symptom, not the cause. |
| Physical PDF split (qpdf → sub-PDFs) | Breaks page anchors; creates multiple "documents" per source; reinvents what `chunker.py` already does at text level. |
| Sync HTTP all the way through | A 1200-page manual exceeds every reasonable timeout. Hub's connection holds for tens of minutes. One slow job blocks the next. |
| Redis-backed queue (arq) | Adds Redis as a MiraDrop dependency for no win over queue-by-table. Postgres-as-queue scales fine at single-user / single-digit-drops-per-hour. |
| Sibling `mira_ingest_jobs` table | Dual-truth with `hub_uploads`. The pattern keeps biting us. |
| LLM-only extraction | Wrong on ~5 – 15 % of weird PDFs; silent corruption of KG identity. Rules-first is conservative; LLM is fallback. |
| Auto-promote all extracted facts after tech confirmation | Violates the "verification → admin" doctrine. Transitive promotion without corroboration is exactly the bug the doctrine names. |
| Latest revision supersedes older | Silently revokes tech-verified facts from the older revision. Violates "verification once granted, never silently revoked." |
| v2 includes photo path now | Doubles the build for unproven need. Photos work today on the existing path. |

## Open questions deferred to implementation

1. TTL for the Q10 dialogue (24 h default; revisit after observing real usage).
2. Whether the LLM fallback for extraction is sync (one call per drop) or batched per worker tick.
3. Exact Slack block-kit shape for the binding + readiness DM (owned by `slack-technician-ux-writer` skill).
4. Whether `verified_by='system_consensus'` requires N=2 or N=3 corroborating sources (start at 2, monitor false-positive rate).

## References

- Spec: `docs/specs/miradrop-ingest-v2-spec.md`
- Plan: `docs/plans/2026-05-26-miradrop-auto-splitter.md`
- Sibling specs: `docs/specs/maintenance-namespace-builder-spec.md`, `docs/specs/mira-component-intelligence-architecture.md`, `docs/specs/uns-message-resolver-spec.md`
- Memory: `project_miradrop_tracks`, `project_vps_oom_docling_incidents`, `project_recall_embedding_gate`, `project_uns_schema_canonicalization`, `project_kg_relationships_schema`
