# Retrieval / evidence acceptance — decision log and known-good state

**Known-good staging:** `26eae84e1cfdaba2bbea89e855e368cc2c21a3a0` (v3.354.3), deploy run 35698169241.
**Known-good automated run:** `retrieval-acceptance.yml` run **35698495558** — six scenarios, 65/65 invariant checks, auto-fired by the deploy.
**Production:** untouched throughout (`recovery-0178b1b07`; zero `OTEL_*` variables in `factorylm/prd`).
**Decision log:** `docs/architecture/observability/2026-09-22-retrieval-acceptance-decision-log.md` · **Runbook (how to run/debug):** `docs/runbooks/turn-flight-recorder.md` §§1–9. **Flight recorder design:** `2026-09-22-turn-flight-recorder.md`. **Routing plan:** `docs/plans/2026-09-22-retrieval-routing-evidence-continuity.md`. **ADR:** `docs/adr/0037-otel-turn-flight-recorder.md`. **Proofs:** `docs/proofs/2026-09-22-retrieval-acceptance-all-pass.md`.

## The loop that replaced manual phone testing

```
change → PR (CI + exact-head independent review) → merge → deploy-staging.yml
      → retrieval-acceptance.yml (workflow_run, success only)
      → tools/qa/retrieval_acceptance.py: six live scenarios, mobile request shapes,
        packets read via /turns/{turnId}/diagnostics, invariants as machine checks
      → PASS/FAIL + artifact retrieval-acceptance-<run> (30 days) with every trace id
```

A failing scenario fails the workflow (proven: run 35696696601 → `failure`). Manual dispatch is supported. The script refuses any base URL that is not staging.

## The six scenarios (the contract)

| # | Scenario | Must hold |
|---|---|---|
| 1 | Empty notebook, generic question | `skipped_general_mode`, OEM not searched, general badge, answered |
| 2 | Empty notebook, resolved manufacturer identity, equipment question | `oem_corpus_bm25` executed, `oem_manufacturer_source=notebook`, candidates with `source_url#page` ids, chunks reach a grounded prompt, then **either** a cited answer with the documentation badge **or** an honest `insufficient_evidence` refusal with no basis claim — never an uncited documentation claim |
| 3 | Notebook with an attached manual | `notebook_sources_bm25`, `source_doc_count>0`, attached doc among returned ids, ≥1 citation, "notebook's sources" badge |
| 4 | Photo turn, then text-only follow-up (no photo re-sent) | `prior_visual_observations_considered ≥ 1`, the photo's file id on the packet, visual evidence in context, badge not bare general, `VISUAL_EVIDENCE_DROPPED` silent |
| 5 | No evidence, exact rating requested | `evidence_sufficient=false`; no value asserted as this machine's fact (blocked, refused, no number, or a hedged range beside an explicit can't-verify disclaimer); the gate never serves an unhedged exact rating |
| 6 | Every row | trace id identical on header / first SSE frame / packet / diagnostics; `environment=staging`; provider+model; numeric token usage; no secret markers, no question/answer text in the packet; documentation badge only with a shipped citation; general badge never with docs in context |

## Root causes closed (earliest wrong decision, file:function)

| PR | Merge SHA | Root cause | Fix |
|---|---|---|---|
| #3943 | e545202f9 | `chat/route.ts`: the only retrieval call was skipped in general mode; no OEM path existed | Policy by evidence context: notebook sources → OEM corpus via existing `retrieveManualChunks` (hybrid tenant law, approval gate, raw pool, tenant fallback off) → skipped. Equipment context = notebook manufacturer or a stored photo observation naming a corpus manufacturer (`corpusManufacturers`, corpus-derived, `manual-rag.ts`) |
| #3943 | e545202f9 | Prior photo observations never reconsidered; client history is text-only by construction | Server-side recall: `listTurns` → prior `visual_observation.fileId` → `loadVisualEvidenceForPhoto` (newest 2), rendered under a guarded "earlier photos" block, counted |
| #3943 | e545202f9 | `evidence_sufficient` computed after the stream, observability only; gate rejected only imperative settings | `evidenceSufficient` feeds `validateAnswer` before release; new `unsupported-specificity:exact-rating` rule (`answer-validation.ts`) using the existing rejection/replacement plumbing |
| #3944 | aee324685 | Downstream keyed on request mode; OEM chunks fetched then discarded | `docGrounded = chunks.length > 0` drives prompt, `[n]`, citations, badge, gate lane |
| #3945 | b9a8ee79d | Badge keyed on grounding alone; tokens never in packet; OEM chunks had no evidence ids | Documentation badge earned by a shipped citation; photo-grounded → `workspace_evidence`; tokens wired; `source_url#page` ids |
| #3946 | 26eae84e1 | `isRefusal` missed "references do not specify…" | Verbs + plural nouns extended at the decision site and its observability mirror |
| this PR | — | `isRefusal` missed "can't give … without the data sheet" / "don't have the specific rating" (live case-5 shapes) | Evidence nouns gain data sheet / rating / specification; pinned with grounded negative controls |

Telemetry fixes en route: token-key redaction narrowed (`gen_ai.usage.*` visible), empty arrays omitted, co-hosted VPS IP is production only on production ports, per-stage timings and viewer link in the packet (#3941, #3943, #3945).

## Architecture decisions

- **One retrieval pipeline, one gate.** No parallel retrieval or safety system; the OEM path reuses `retrieveManualChunks` exactly as asset chat does; enforcement reuses `validateAnswer`'s `unsupported_specificity` plumbing.
- **Server owns evidence continuity.** The client is never the canonical evidence store; durable ids (turn rows, LOOK ledger) are recalled server-side.
- **Grounding follows evidence, not request mode.** `general` keeps its request-shape meaning (source validation, Gate G); everything document-dependent keys on `docGrounded`.
- **Badges tell the truth about the answer, not the pipeline.** Documentation only with a shipped citation; a photo-backed answer says so; a refusal claims no basis.
- **Acceptance is live or it is not acceptance.** Unit tests gate merges; the six live scenarios gate "done".

## How the mobile app selects staging vs production

Android product flavors (`mira-mobile/android/app/build.gradle`): `production` → `com.factorylm.mira`, `API_BASE=https://app.factorylm.com`, scheme `factorylm`; `staging` → `com.factorylm.mira.staging`, `API_BASE=https://app-staging.factorylm.com`, scheme `factorylmstaging`, label "MIRA Staging". The web layer reads them at runtime through `BuildConfigPlugin` (registered in `MainActivity`); `resolveApiBase()` / `resolveDeepLinkConfig()` (`src/plugins/build-config.ts`) **throw** `BuildConfigUnavailableError` rather than fall back, and deep-link trust rejects everything until the flavor config loads. Both flavors coexist on one device. The staging APK built from `fe1aea37e` (sha256 `a705c976…`) is current for every Hub deploy since: `git diff fe1aea37e..main -- mira-mobile/` is empty. **No rebuild is needed to test any Hub change**; a rebuild is only needed when `mira-mobile/` itself changes.

## Shadow judgment: Jev evidence sufficiency (2026-09-22, recorded not consulted)

`evidence_sufficient` is a **presence** test (`chunks.length > 0 || machine packet || photo observation`). Live case 2 showed its limit: six same-vendor chunks, none holding the asked-for value, still count as "sufficient". The credential probe (`docs/research/2026-09-22-jev-typesafe-credential-probe.md`) showed TypeSafe AI's System One model gives a deterministic, calibrated **relevance** judgment in ~450 ms (13/13 on hand-built sufficiency/relevance/completion cases; same-vendor wrong-model chunk 0.05, right-model wrong-quantity 0.03, hedged-but-specific range 0.91).

**Decision:** run it in **shadow** on staging only — `mira-hub/src/capabilities/observability/jev-shadow.ts`, behind `MIRA_JEV_SHADOW=1` (compose default `0`, production unset). After retrieval the route starts one fail-open call (1.5 s timeout, overlapping generation, so no first-token cost) over the scrubbed question + up to six chunk excerpts and records `answer_gate.jev_sufficient / jev_skipped_reason / jev_latency_ms` on the packet and `mira.evidence.jev_*` on the span. **The answer gate never reads it.** Promotion to a consulted signal is a separate decision, taken only after the shadow column has been compared against `evidence_sufficient`, the wire outcome, and the acceptance rows on real staging traffic (materialized-evidence rule 9). Pinned: model `jev-1.13.0`, rubric `sufficiency-v1`; a change to either is the invalidation trigger.

**Spend bound (zero-token rule 1).** At most one call per turn, and only for turns that retrieved at least one chunk (zero-chunk turns skip with `no_evidence`; general-mode turns therefore never call). Request size is capped by construction at 600 question characters plus six chunks of 700 characters — those character caps are the invariant the code enforces. **Measured on staging (#3954): up to 1,681 input tokens per call (~$0.00007), not the ~1,200 first estimated** — technical text with URLs, part numbers and units tokenizes at ~2.9 chars/token. Latency measured 85–168 ms per call against the 1,500 ms abort. Off-switch: unset `MIRA_JEV_SHADOW` in Doppler `factorylm/stg` and redeploy `mira-hub`. **Stop condition:** the shadow window ends, and the flag is turned off or the signal promoted by an explicit decision, once the acceptance suite has produced at least 25 packets with a non-null `jev_sufficient` alongside their `evidence_sufficient` and wire outcome — the comparison is the deliverable, not the column.

**First live evidence (run 35711335209, staging `5a563d9ad`):** three judged turns, three disagreements, no agreements yet — case 2 `D1` (refused, Jev 0.05: Jev agrees with the honest refusal, presence flag wrong), case 4 `D2` (answered "24 V DC (max 0.85 A)" from a V20/GH6 chunk with `ungrounded_unit_claim`, Jev 0.14 — #3950), case 3 `D3` (QR tag-sheet fixture, answer admits the meanings are absent, Jev 0.05). Zero-chunk skips 2/2, latency p50 133 ms / max 164 ms, no turn-total regression on the acceptance rows. Proof: `docs/proofs/2026-09-22-jev-shadow-first-evidence.md`. Collector + categories: `tools/qa/jev_shadow_report.py`, `.github/workflows/jev-shadow-report.yml` (runbook §10). **The window fills only with real staging usage; do not fabricate traffic to reach 50–100.**

**Data egress (staging only).** This is a new outbound flow: the technician's question plus scrubbed excerpts of retrieved chunks, which on case 3 includes the tenant's own attached-manual text (`is_private=true` rows), leaves for `api.typesafe.ai`. No identifiers, cookies, answers, photos, or prompts travel with it. Staging traffic only, on a stranger tenant the acceptance suite provisions. Enabling it in production is a separate data-egress decision for Mike, not a flag flip.

## Remaining known weaknesses (product, not blockers)

- **Retrieval quality.** Case 2's six Siemens chunks do not include the TP700 Comfort spec page; the model refuses honestly. Whether the page is in the corpus (seeding) or ranks poorly (BM25/rerank) is now a testable question; deliberately untuned until execution was proven.
- **Refusal classification is phrase-based** — narrowed 2026-09-22 (#3953): a doc-grounded answer that asserts something and cites a *shipped* source is no longer turned into a refusal by a limitation sentence beside it (`refusalVerdict` / `isCitedPartialAnswer`, route.ts). `isRefusal` itself is unchanged, so the packet's `refusal_phrase_matched` still reports the raw phrase match and a turn where the two disagree stays visible. A refusal whose only `[n]` sits inside the limitation clause, or that cites nothing, is still a refusal.
- **Residual: refusal classification is still phrase-based.** Five live shapes are pinned; a novel phrasing would persist as `answered` with `evidence_sufficient=false` and `ungrounded_unit_claim` still recorded, so it stays diagnosable and the acceptance harness's case 5 still judges the wire text.
- **Nameplate → identity is not automatic.** A photo unlocks OEM retrieval via the recognised manufacturer, but `identityStatus` stays `unknown` unless the nameplate flow is used; `IDENTITY_PIPELINE_DROPPED` records it.
- **Staging traces share the production Langfuse project** (tagged `deployment.environment.name=staging`). A dedicated staging project is an account action.
