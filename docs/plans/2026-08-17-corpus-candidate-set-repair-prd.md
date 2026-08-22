# PRD — Corpus Candidate-Set Repair

> **Status:** DRAFT — awaiting Mike's approval before implementation
> **Owner:** Claude Code session `01Dgej4v`
> **Claim:** [#3177](https://github.com/Mikecranesync/MIRA/issues/3177) (`[WORK-CLAIM]`, ACTIVE)
> **Base SHA:** `969caf4d783f7dec950ccc01d8a25f6f651cc68b`
> **Blocks on:** PR #3268 (CU-03) for the shared `base_crawler.py` call site — see §10
> **Closes / re-measures:** #3177 (direct) · #3049, #3165, #3218, #3156, #3160 (downstream — see §3)

---

## 1. Thesis

**MIRA's retrieval work has failed twice because a candidate-set defect was treated as a ranking
problem.**

The product-scoped retrieval stream — the one specifically designed to answer "what does *this
machine's* manual say" — is gated on `knowledge_entries.model_number`. The crawler that ingests
OEM manuals **never writes that column**. So for the flagship GS10 drive, the stream that is
supposed to find the right chunk from the right manual is choosing from **11 rows out of 4,295**.

No amount of query rewriting, reranking, or grounding-guard engineering can fix a retrieval layer
whose candidate set has been filtered down to 0.3% of the corpus before ranking begins. Two prior
attempts (§4) proved this empirically and were correctly abandoned.

This PRD fixes the writer, repairs the history it corrupted, and closes the content gap — then
re-measures the downstream defects instead of assuming they were fixed.

---

## 2. What is actually broken

Traced on `969caf4d7`. Two independent defects with a shared symptom.

### 2.1 Defect A — the crawler drops `model_number` (code)

`mira-crawler/crawler/base_crawler.py::process()` reads the model from the source entry:

```python
equipment_id = entry.get("equipment_id", "")     # line 103 — the model, in hand
```

forwards it to chunking and dedup — and then **omits it from the write**:

```python
stored = store_chunks(                            # lines 163-167
    valid,
    tenant_id=(...),
    manufacturer=manufacturer,
    verified=self.oem_trusted,
)                                                 # model_number never passed
```

`store_chunks` accepts `model_number: str = ""` (`ingest/store.py:144`). The default silently wins.

### 2.2 Blast radius — one missing argument, three broken systems

`model_number=""` propagates into `store_chunks` and disables three things:

| # | Mechanism | Consequence |
|---|---|---|
| 1 | `insert_chunk(model_number="")` writes a blank column | `neon_recall._product_search` filters `AND model_number ILIKE :pat` (`neon_recall.py:543`). Blank never matches. **The product-scoped stream cannot see the chunk at all.** |
| 2 | `store.py:186` — `if kg_writer is not None and manufacturer and model_number:` evaluates **False** | `register_equipment_and_manual` never runs. No `equipment` entity, no `manual` entity, `equipment_id` stays `None`. |
| 3 | Step 2/3 are nested under `if kg_writer is not None and equipment_id:` | `link_chunk_to_equipment` never runs (**no `equipment_entity_id` FK**), and the fault-code extractor **never runs** — so `register_fault_code` produces **zero** KG fault nodes for everything this crawler ingests. |

The UNS+KG flywheel (component-intelligence spec §4.4) has therefore been inert for the entire
manufacturer / `sources.yaml` crawl path. This was observable the whole time: the existing summary
log prints `equipment_id=None` on every batch (`store.py:250`).

### 2.3 Defect B — the GS10 manual was never ingested (data)

`mira-crawler/sources.yaml:93-102` carries the **corrected** GS10 URL
(`gs10usermanual.pdf`, "Verified 2026-07-27").

`mira-crawler/cron/allowlists/drive_manuals.yaml:39-43` still carries the **stale** block:

```
# ── Known-stale, DO NOT re-add until the correct URL is verified ──────
# AutomationDirect GS10 (`gs10m.pdf`, the sources.yaml URL) returns 404 ...
```

`queue_populate.py` reads the allowlist, not `sources.yaml`. The GS10 manual was never queued.
Its correct URL has been sitting in a different file for three weeks.

This is why #3177 measured **zero** AutomationDirect rows containing any fault-clear procedure
phrase. It is a coverage gap, not a retrieval gap — and no retrieval change can fix it.

### 2.4 Existing tag pollution (discovered while tracing)

`model_number` is not merely empty — it is partly **wrong**. #3177's distribution shows values like
`drives g vg 4 manual` and `drives g mini manual`: document titles written into a model column.

And the fallback heuristic manufactures junk. `chunker.py::_extract_equipment_id` fires when no
explicit `equipment_id` is supplied:

```python
_extract_equipment_id("gs10usermanual.pdf") -> "GS10USERMANUAL"
```

(`^[A-Z]{1,5}\d{2,}` matches `gs10`, then consumes the rest of the token, ≤20 chars.)

That value is *worse than blank*: `model_number ILIKE '%GS10%'` **does** match `GS10USERMANUAL`,
but the very next predicate — `NOT (model_number ~* :exclude_re)`, the word-boundary guard from
#2914 that stops "PowerFlex 40" matching "PowerFlex 400" — then **excludes** it for having an
alphanumeric suffix. A filename-derived tag looks correct in the database and is silently dropped
at query time. Any backfill that trusts this heuristic will bake the failure in permanently.

---

## 3. The causal graph — what this defect explains

```
base_crawler drops model_number
├─ knowledge_entries.model_number = ''
│    └─ _product_search blind for the asset
│         ├─ long-tail asset falls back to BM25/vector over a corpus
│         │  dominated by high-volume vendors ......................... #3049 (Lenze→Yaskawa,
│         │                                                                    Danfoss→Rockwell)
│         └─ exact-token evidence outranked by bulk .................... #3218
└─ store.py:186 guard False -> equipment_id None
     ├─ no link_chunk_to_equipment -> no equipment_entity_id FK ........ UNS/KG cannot scope by asset
     └─ fault-code extractor never runs -> no fault KG nodes ........... KG fault lookups empty

drive_manuals.yaml GS10 stale-blocked
└─ manual never queued -> zero fault-clear content
     └─ "how do I reset it" retrieves adjacent-but-wrong chunks;
        the model fills the gap with an invented specific ............... #3165 (P0 `P0594`),
                                                                          #3156, #3160
```

**These are not five bugs. They are one data defect with five symptoms**, plus one coverage gap.

That claim is falsifiable, and §8 says how we falsify it. If repairing the candidate set does not
move #3049 and #3165, the graph above is wrong and we will have learned that cheaply.

---

## 4. Why the two previous fixes failed — and what it teaches

Both prior attempts were **downstream mitigations of an upstream data defect**. Both were correctly
measured and correctly abandoned. Neither should be revived in its original form.

**Option A — grounding guard on fabricated specifics** (spec `2026-08-09-fabricated-parameter-grounding-hole.md`).
Require a parameter-shaped token in a reply to appear in the turn's retrieved sources. Measured in
PR #3168 over the entire population of parameter claims in 22 ledgers: **1 true positive, 2 false
positives.** It suppressed two *correct* `P09.03` answers. The measurement's own conclusion:

> A retrieval-grounded guard is measured against a retrieval layer that is itself broken, so **it
> suppresses hardest precisely where MIRA is already weakest.**

**Option B — query-side sense disambiguation for "reset"** (PR #3176, HELD). Falsified. The
verbatim-quote ceiling measurement is decisive: a query that *quotes the target chunk verbatim*
still tops out around rank 5 against a realistic rank-119 baseline. If quoting the answer cannot
retrieve the answer, no rewrite of the technician's question will either.

**The lesson, stated as a rule:** *measure the candidate set before designing a ranking fix.* A
guard or reranker inherits every defect of the layer beneath it. This PRD is upstream of both.

---

## 5. Non-goals

Explicitly **out of scope**, to keep this shippable and reviewable:

- ❌ Implementing Option A's grounding guard. Re-decide after §8 re-measurement, with fresh numbers.
- ❌ Query-side retrieval rewriting, reranking, or embedding-model changes.
- ❌ Bulk re-crawl of the corpus. Only the GS10 manual is newly ingested here.
- ❌ Changing `_product_search`'s SQL, the suffix-exclude regex, or any retrieval-side code.
- ❌ Touching `ingest/store.py` or `tasks/ingest.py` — owned by #3268/#3280 (§10).
- ❌ Fixing the other `insert_chunk` writers (#3275, #3269, #3282). Related, separately claimed.

---

## 6. Design

### D1 — Make the tag explicit at the writer, don't just pass it

The one-line fix (`model_number=equipment_id`) repairs today's bug and leaves the trap armed for the
next caller. Instead, **adopt the pattern CU-03 just established for `is_private`**: make the
decision mandatory rather than defaulted.

```python
def store_chunks(
    chunks_with_embeddings, tenant_id, manufacturer="",
    *,
    model_number: str,        # REQUIRED — no silent "" default
    ...
)
```

Rationale: CU-03 made `is_private` required precisely because a default caused a silent, invisible,
production-wide data defect (#1833). This is the identical failure shape — a defaulted column that
nothing validates and everything depends on. The same medicine applies, and adopting the same
pattern makes this change *compose* with #3268 rather than compete with it.

A caller with genuinely no model passes `model_number=""` explicitly, which is a reviewable
statement of intent rather than an accident.

### D2 — Backfill from provenance, never from content

**Do not infer the model from chunk text.** 1,206 rows contain "GS10" in `content`, but many are
GS20/GS30 manuals *cross-referencing* the GS10. Content inference would mis-tag them and corrupt
the very column we are repairing — a worse end state than blank.

The authoritative key is the document's declared identity:

```
source_url  ->  sources.yaml / drive_manuals.yaml declaration  ->  equipment_id
```

Backfill is then a deterministic join against a version-controlled manifest, auditable per row.

**`metadata->>'equipment_id'` is corroboration, not authority.** It is already written on every row
(`store.py:117`) and is usually right — but it is contaminated by the filename heuristic (§2.4).
Rule: backfill where the manifest and metadata **agree**; quarantine and report where they disagree;
never write a value sourced from the heuristic alone.

Tiers:

| Tier | Source of truth | Action |
|---|---|---|
| 1 | `source_url` matches a manifest entry; manifest `equipment_id` == `metadata.equipment_id` | Backfill |
| 2 | `source_url` matches; values disagree | Quarantine → report → human adjudication |
| 3 | No manifest match (`metadata.equipment_id` only) | **Do not backfill.** Report count. |
| 4 | Existing non-blank value that is a title or heuristic artifact (`drives g vg 4 manual`, `GS10USERMANUAL`) | Report only. Correcting these is a separate, human-approved slice. |

### D3 — The backfill must be reversible

It is an `UPDATE` on production data. Requirements:
- Emit a dry-run diff (`row id, old, new, tier, manifest source`) and stop.
- Apply only with an explicit flag, in one transaction, writing a reversal manifest (`id -> prior
  value`) to disk **before** committing.
- Never widen: `WHERE model_number IS NULL OR model_number = ''` only. Tier-4 rows are untouched.
- dev → staging → prod, per `docs/environments.md`. Never `psql` prod from a session.

### D4 — Close the content gap (GS10)

1. Verify `gs10usermanual.pdf` serves `application/pdf` (200/206) to UA `MIRA-KB/1.0` — the
   allowlist's own stated precondition.
2. Replace the stale-block comment in `drive_manuals.yaml` with a `trust_status: curated` entry.
3. Queue and ingest **through the fixed writer**, so it lands correctly tagged the first time.
4. Assert the fault-clear procedure content is present and retrievable (§8).

If the URL does **not** verify, stop and report. Do not substitute a different URL or scrape —
that violates the allowlist's curation rule.

### D5 — Re-densify the KG for backfilled rows

Backfilling `model_number` does **not** retroactively create the KG entities that §2.2 rows 2–3
skipped. A separate pass must re-run `register_equipment_and_manual`, `link_chunk_to_equipment`,
and the fault-code extractor over repaired rows.

Favourable property: the fault-code extractor reads `chunk.text`, which is already stored. **No
re-download, re-chunk, or re-embed is required** — this is a pure offline pass over existing rows.

Sequenced last, gated on the backfill's tier-1 set, and idempotent by construction (all KG entity
writes are `UNIQUE(tenant_id, entity_type, name)` upserts).

---

## 7. Phases and acceptance criteria

Each phase is independently shippable and independently revertable.

### Phase 0 — Baseline measurement (no code change)
Prove the defect and capture the numbers the fix will be judged against.

- [ ] Against **staging**, record per vendor/model: total rows, blank `model_number`, tier
      distribution (D2), rows matching fault-clear phrases.
- [ ] Record the `_product_search` candidate count for GS10 and PF525.
- [ ] **Control-group check:** is PF525 (7,592 rows, ingested via a different path) correctly
      tagged? If yes, the defect is confirmed path-specific to `base_crawler`. If PF525 is *also*
      blank, the blast radius is larger than this PRD assumes — **stop and re-scope.**
- [ ] Reproduce #3165's `P0594` turn via `retrieval_probe.py` and record the ranked source list.

**Exit:** a committed baseline report under `docs/testing/`. No baseline, no claim of improvement.

### Phase 1 — Fix the writer (D1)
- [ ] `model_number` becomes a required kwarg on `store_chunks`; `base_crawler.process()` passes it.
- [ ] Regression test: a crawl entry with `equipment_id` produces a row with that `model_number`
      **and** a non-null `equipment_entity_id` **and** at least one fault-code KG node.
- [ ] Architecture guard in `tests/test_architecture.py`: no caller of `store_chunks` may rely on a
      defaulted `model_number` (same shape as the CU-03 `is_private` contract).
- [ ] **Blocked on #3268** (§10).

**Exit:** new ingests are correctly tagged and densify the KG. Existing rows unchanged.

### Phase 2 — Backfill history (D2, D3)
- [ ] Manifest builder from `sources.yaml` + `drive_manuals.yaml`.
- [ ] Backfill tool with mandatory dry-run, tier report, reversal manifest, single transaction.
- [ ] Dry-run reviewed by a human before apply. dev → staging → prod.
- [ ] Tier-2/3/4 counts reported, not silently dropped.

**Exit:** tier-1 rows tagged; a reversal manifest exists; `_product_search` candidate counts rise.

### Phase 3 — GS10 content (D4)
- [ ] URL verified; allowlist entry replaces the stale block; manual ingested via the fixed writer.
- [ ] AutomationDirect fault-clear phrase count: **0 → >0**.
- [ ] The GS10 fault-clear procedure is retrievable in the top-k for a realistic technician query.

**Exit:** MIRA can cite a real GS10 fault-clear procedure.

### Phase 4 — KG re-densification (D5)
- [ ] Offline pass over tier-1 rows; idempotent; dry-run first.

**Exit:** `equipment_entity_id` populated and fault-code nodes exist for repaired rows.

### Phase 5 — Re-measure downstream (§8)
- [ ] Re-run #3165's probe, #3049's 15-case eval, and the offline eval suite.
- [ ] Report **net** movement including regressions, per `.claude/rules/session-discipline.md` §2.
- [ ] Re-decide #3165's guard **with the new numbers**, not the old ones.

**Exit:** an evidence-backed statement of which downstream issues actually closed.

---

## 8. Measurement plan

The causal graph in §3 is a hypothesis. These are its falsification tests.

| Metric | Baseline | Target | Instrument |
|---|---|---|---|
| GS10 `_product_search` candidates | 11 | all chunks of `gs10usermanual.pdf` | direct query, staging |
| AutomationDirect blank `model_number` | 2,034 | tier-1 subset → 0 | backfill tier report |
| AutomationDirect fault-clear phrase rows | 0 | > 0 | phrase probe (#3177's own probes) |
| #3165 `P0594` reproduction | fabricates | real fault-clear chunk in top-k | `retrieval_probe.py` |
| #3049 long-tail eval | 8/15 failing | measured, not assumed | existing eval |
| Offline eval suite | current | **no net regression** | `tests/eval/` |

**Honesty constraints, learned from this arc:**
- Every probe records `embedded=true/false`; a mixed set is not comparable (#3168's own caveat).
- The offline suite varies ±8 fixtures with no code change (#3116, σ=2.46). **A single run is not
  evidence.** Report a distribution across seeds, or the result means nothing.
- Report regressions with the same prominence as improvements.

**Explicit falsification:** if candidate-set repair lands and #3049/#3165 do not move, §3 is wrong.
Say so in the report, and the guard work (Option A) returns to the table on its own merits.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Backfill mis-tags rows; corrupts a column retrieval depends on | **High** | Provenance-only (D2); tier gating; dry-run + human review; reversal manifest (D3) |
| Tagging changes retrieval for *every* query — silent regression | **High** | Phase 5 full eval, multi-seed, net reporting; staging first |
| Merge conflict with #3268 on the shared call site | Medium | Declared in the claim; sequenced behind it (§10) |
| Filename-heuristic junk (`GS10USERMANUAL`) baked in permanently | Medium | Tier 3 never backfills from metadata alone; tier 4 reported not written |
| GS10 URL 404s again | Low | Verify before queueing; stop and report rather than substitute |
| KG re-densification double-writes | Low | Upserts are `UNIQUE`-idempotent by construction |
| Prod `UPDATE` outside migration discipline | **High** | dev → staging → prod; no session-side prod `psql`; human-gated apply |

---

## 10. Sequencing and dependency on #3268

**#3268 (CU-03) is the earlier ACTIVE claim on `mira-crawler/crawler/base_crawler.py` and
`mira-crawler/ingest/store.py`.** It edits the *exact* `store_chunks(...)` call at lines 163–167
(adding `is_private=False`) and makes `is_private` a required kwarg on `insert_chunk`. Phase 1's
change lands on the same lines — a guaranteed textual conflict.

Per protocol §4, resolved by coordination, not force:

1. Phases **0, 2, 3** touch none of #3268's files → proceed now.
2. Phase **1** waits for #3268 to merge, then rebases onto it.
3. Alternatively, #3268's owner folds the `model_number` argument in directly — offered on #3177.
   Their call; the claim releases that portion if they take it.

Phase 1's design (D1) deliberately mirrors #3268's `is_private` pattern so the two compose.

---

## 11. Open questions for Mike

1. **Sequencing:** wait for #3268 to merge, or hand the one-line `model_number` fix to its owner to
   fold in? (Recommend: hand it over — it's three tokens on a line they are already editing.)
2. **Backfill blast radius:** tier-1 only (conservative, provenance-proven), or also adjudicate
   tier-2 disagreements this round? (Recommend: tier-1 only; tier-2 as a follow-up with the report
   in hand.)
3. **Tier-4 pollution** (`drives g vg 4 manual` as a model number) — separate slice, or fold in?
   (Recommend: separate. It needs human adjudication per value.)
4. **Prod backfill authorization** — Phase 2 ends in a production `UPDATE`. That is a hard human
   gate under `docs/environments.md` and will not proceed without explicit GO.

---

## 12. Cross-references

- `.claude/rules/knowledge-entries-tenant-scoping.md` — the hybrid corpus read/write law
- `.claude/rules/one-pipeline-ingest.md` — why no new ingest path is introduced here
- `.claude/rules/multi-session-protocol.md` — the claim and the #3268 coordination
- `docs/superpowers/specs/2026-08-09-fabricated-parameter-grounding-hole.md` — Option A, measured
- `docs/testing/campaign-reports/2026-08-09-retrieval-probe-first-measurement.md` — the 1 TP / 2 FP result
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — why GS10 coverage is revenue-path
- PR #3168 — `retrieval_probe.py`, the instrument Phase 0 and Phase 5 depend on
