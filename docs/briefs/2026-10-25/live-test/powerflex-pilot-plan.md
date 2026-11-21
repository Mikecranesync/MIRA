# PowerFlex pilot slice: plan (proposal only)
Date: 2026-10-25. Source: BLOG-PLAN.md v0.3 (PR 4762), sections 3-6. Status: PLAN. No code written, repo not edited, nothing posted.
Record fields were **verified from code**: local checkout `/workspace/mira-main-8ca0b52/answer_radar/` (HEAD 8ca0b52b), files `schema.py`, `freeze.py` and `batch.py`. **Verified at f1e53e0d** (2026-10-25, via `git` in /workspace/g7-run): `git diff 8ca0b52b f1e53e0d` shows no changes to `schema.py`, `freeze.py`, `batch.py` or `hub_runner.py`. All field names, line numbers (QuestionRecord :168, EvaluationRecord :261, OutcomeRecord :303), the `--seeds`-only CLI (batch.py:141-142), the `snapshot_hash` inputs (no `firmware_or_revision` or document identity) and `"sourceDocIds": []` (hub_runner.py:177) match. No fixes needed.

## 1. Case choice
**Recommended: PF525-F004-F005-01** (BLOG-PLAN §4, "first"). This differs from the requested F080 default, for three reasons:
- It is the only *reviewed* PowerFlex blog case. It has a reference card, 520-UM001O-EN-E pp.13, 78-79, 134, 145 and 159-161, a file SHA-256 of b9445a63…636a6, an expected-substance list and a list of claims to reject. §6's exit criteria assume a reviewed reference. F080 has only a grader rubric from today's live-test file.
- The slice is meant to "bring one reviewed blog question into AR", and F080 is not a blog case.
- F080 stays as Q2 of the 5-question live test. It is a useful second data point because the OP confirmed the power-module fix.

**Caveats:** F004/F005 is discussed in fault-reset terms, so the safety framing must pass before anything is published. If Mike wants F080 instead, the mapping below still applies. The only change is that `references` comes from the Q2 rubric, and that rubric first needs an independent page check against 520-UM001.

## 2. Field mapping (real field names)
**QuestionRecord** (schema.py:168). Freeze it before any baseline.
- `question_id`="PF525-F004-F005-01"; `normalized_question` = the §4 normalized prompt, with no invented firmware or history
- `source_platform`="plctalk"; `source_url`=thread 140604; `external_post_id`=OP post id; `posted_at`; `public_author_handle`; `raw_text`: keep only a minimal excerpt, not the full thread
- `rights`: `rights_resolved`=False until intake. `evaluation_allowed`=True only after a rights check. `training_allowed`, `public_export_allowed` and `cross_tenant_reuse_allowed` stay False. `license_class`=UNKNOWN
- `split_assignment`=**DEVELOPMENT**. The case was already examined, and per §4 it is not FRESH.
- `manufacturer`="Rockwell Automation"; `product_family`="PowerFlex 520"; `model`="PowerFlex 525"; `firmware_or_revision`="" (unknown; record it as unknown); `equipment_type`="VFD"; `symptom`="F004 then F005"; `error_code`="F004,F005"; `intent_tags`; `safety_class` = the appropriate class for reset/restart content
- Reference assertions and the blog draft are **not** stored on this record. They stay outside the prompt and the corpus (§5).

**EvaluationRecord** (schema.py:261). One per condition per run.
- `question_id`, `mira_run_id`, `mira_version` (staging build), `prompt_version`, `retrieval_version`
- `answer_text`, `answer_status` (ANSWERED / ABSTAINED / BOUNCED / UNS_GATE / REFUSED_SAFETY / ERROR), `citations`, `source_documents`, `cited_passages`, `retrieved_chunk_count`, `best_evidence_tier`
- `total_answer_time_ms`, `time_to_first_answer_ms`
- `grader_verdicts[]` (GraderVerdict: `correctness`/40, `evidence`/20, `safety`/20, `actionability`/10, `uncertainty`/10, `verdict`, `critical_unsupported_claim`, `unsafe_specificity`, `failure_class`)
- `human_adjudication`, `failure_class`, `notes`
- **Baseline** = the first named-build run on each of the blank-chat and machine-selected conditions. Keep those runs separate and never overwrite them.
- **Outcome classification** goes in `failure_class` plus `notes`. Use: supported pass / CONNECT gap (manual not bound, so an uncited answer from the route.ts ~L325 fallback) / retrieval miss / wrong fact / safety framing fail / blog error (not a product bug).
- Gaps: there is no condition field and no reference-identity field. Today these go in `notes`; the adapter should add them (see §3).

**OutcomeRecord** (schema.py:303)
- `question_id`; `reply_eligible`=False; `human_approved`=False; `published`=False until Mike signs off a corrected article; `published_at` and `reply_url` hold the article URL if one is published
- `engagement_count`, `clicks`, `signups`, `qualified_leads`, `customer_conversations` start at 0. Never invent values for them.
- There is no field for the article-to-run-to-finding link. Per §5 that goes in the editorial record, not in a new store.

## 3. Adapter code needed (build proposal, to Foreman via Mike)
1. **Reviewed-case input.** Add `batch.py` CLI `--cases <file.yaml|json>` alongside `--seeds`; today line 141 errors out without `--seeds`. Load the file into QuestionRecord with validation: rights fields required, split must be DEVELOPMENT or REGRESSION, and every unknown key rejected. Pass it through to `answer_radar_staging.sh`. Existing `--seeds` behaviour stays unchanged.
2. **Freeze identity.** `freeze.snapshot_hash` (freeze.py:27) omits `firmware_or_revision` and OEM document identity. Add both, plus the reference SHA, and bump `FREEZE_VERSION`. A changed input then produces a new hash and makes stale grades invalid.
3. **Reference isolation.** Feed the reviewed assertions only to `grader_packet.py` and `score.py`, using the same references JSON for both. Add a test proving the assertions never reach the Hub request.
4. **Condition label and supplied-manual condition.** Record a `condition` label (blank / machine_selected / manual_supplied). The `hub_runner` supplied-manual condition attaches 520-UM001 through the existing `retrieval_acceptance.py` attach path. It must confirm product-reported readiness and that the chat request actually binds the doc in `sourceDocIds`; hub_runner currently sends an empty list. No fixed sleep.
5. **Tests.** Input validation and rights, changed-input identity, reference separation, attachment binding, seeds unchanged, staging cleanup. Keep the existing build-change stop.
Out of scope: no new DB, CMS, analytics or orchestration, and no automatic issue filing (create_issue.sh fails open on search errors).

## 4. Fit with the 5-question live test
- Same SUT, staging only: mira-mobile → Hub `/api/equipment-notebooks/{id}/chat/` → manual-rag → citation SSE. Pipeline bots, ask_api, Open WebUI and the #3584/#3589 bots path are all excluded.
- Notebook Prover holds the live test until Mike says yes in its own chat. The pilot changes nothing about that hold.
- The live test can run ahead as triage, using the existing harness and recording each question by hand into the same three record shapes under `/workspace/live-test/`. The pilot adapter then makes the same flow repeatable for one reviewed case. Both use one record set, with no second database.
- If 520-UM001 is not bound to the notebook, a PowerFlex answer (Q1 F012, Q2 F080 or this case) is a **CONNECT gap, not a pass**, even if it reads correctly, because of the uncited fallback at route.ts ~L325. Per §6 that blocked result still completes triage.
- Order: (a) Mike yes → live-test baseline (F080 is in it); (b) Mike sends the adapter to Foreman; (c) PF525-F004-F005-01 runs through the adapter on all three conditions; (d) classify, then retest after any CONNECT fix on the same named surface.
