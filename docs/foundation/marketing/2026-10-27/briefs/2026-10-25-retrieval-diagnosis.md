# T-038 Retrieval diagnosis: why MIRA misses answers that are in the manual (2026-10-25)

Read-only. Code read from current `main` @ 8acc2769 through the GitHub connector. No DB, Doppler, staging or prod access was used, and nothing was changed.
Abbreviations: `MR` = `mira-hub/src/lib/manual-rag.ts`, `DR` = `mira-hub/src/lib/document-readiness.ts`, `HR` = `mira-hub/src/capabilities/hybrid-retrieval.ts`, `STG` = `docker-compose.staging-vps.yml`, `SAAS` = `docker-compose.saas.yml` (prod).

## TL;DR
The leading cause is **not** missing embeddings. **[PROVEN in code]** When a question names a model, the notebook's model-applicability filter does an exact identity match only, with no family match. A question that names "PowerFlex 525" or "TP700" therefore **rejects every chunk** of the "PowerFlex 520-series" manual and the "Comfort Panels" manual. That matches 2 of the 3 non-citing manuals exactly. The 2 manuals that cite (ACS355, S7-1200) have titles that name the exact model. Micro820 is not explained by this and is still open (see 1c).

## 1. How notebook retrieval works with no vector lane

- The Hub notebook chat path is `retrieveNodeChunks` (MR:1256). It is lexical only unless `NOTEBOOK_HYBRID_RETRIEVAL=1` (HR:27-28, MR:1742-1744). Both composes default that flag to `0` (STG:336, SAAS:858). With it off, `vectorLane="off"` and there is no cosine pass.
- **Correction to the earlier premise [PROVEN]:** the staging Hub *does* have an embedder. `OLLAMA_BASE_URL=http://mira-ollama:11434` is set for the Hub (STG:329). `disabled://staging` applies to `INGEST_URL` (STG:401) and to the pipeline and bots (STG:243, 278, 583). The batch log fits this: PF525 embedding coverage rose from 2.8% to 19%. So embeddings are being *written* on staging. They are just not *read* by notebook chat while the hybrid flag is 0.
- The lexical lanes are, in order (MR:1677-1721):
  1. A Postgres FTS AND pass, `plainto_tsquery` (MR:1677, SQL at MR:1505-1527, `content_tsv @@` MR:1524).
  2. OR passes on the expanded variants.
  3. An exact-token ILIKE lane.
  4. A fault-code regex lane.
  5. An OR pass on the raw message.
  6. A last-resort OR pass **only if the pool is empty** (MR:1721).
  Every pass requires `ingest_route='v2'` (MR:1520) and goes through the same `admit()` filter (MR:1612-1665).
- **Keyword-only is a partial factor, not the main one [INFERRED].** FTS stemming can miss wording ("recalibrate" stems to `recalibr`, while the manual says "calibrating"). Also, unlike the quickstart path, the notebook path has no weak-AND check (`isWeakAndResult` is used only at MR:1146). However, OR passes still run on the variants, so pure wording misses should usually still produce *some* candidate. Getting zero citations on simple facts points to a filter, not to ranking.

### 1a. PF525 and TP700: model filter rejects family manuals [PROVEN in code, consistent with batch]
- If the question names one model, `questionScoped` is true (MR:1412) and `requestedIdentities` is built from the question (MR:1604).
- `admit()` then calls `documentCoversRequest(requestedIdentities, titleIdentities)` (MR:1639). That function (MR:310-323) compares identities and catalog to panel only. **It never consults `FAMILY_ROOTS`** (MR:338: PF520 covers PF52x, MICRO800 covers MICRO8x0, COMFORT covers TP###).
- The family rule is applied only on the *notebook-identity* branch, through `documentCoversNotebook` and `familyCovers` (MR:376-386). The comment at MR:324-337 shows the authors knew that "PowerFlex 520-Series" resolves to {PF520} while a 525 resolves to {PF525}. They fixed this for the notebook branch only.
- PF525 question: "Which **PowerFlex 525** parameter…". This gives {PF525}. The manual title on p.1 is "PowerFlex 520-series…", which gives {PF520}, so every chunk is rejected. The result is `insufficient_evidence` with an empty answer, exactly as observed.
- TP700 question: "…on a **TP700** Comfort panel". This gives {TP700}. The title is "Comfort Panels Operating Instructions", which gives {COMFORT} (no catalog on the doc side), so every chunk is rejected. Again empty, as observed.
- ACS355 and S7-1200: their titles name the exact model, so they pass the filter and cite. This matches the observed result.
- The F080 / PF525 forum questions would hit the same wall for as long as they say "525".

### 1b. "Readiness 1.0" was irrelevant to these misses
See section 2.

### 1c. Micro820: open [INFERRED, needs a trace]
The 2080-UM005 title on p.1 is "Micro820 Programmable Controllers", so the family bug does not apply. Possible causes, which I could not tell apart without DB or trace access:
- (i) The older staging doc `1d6acc64` is a different file, edition or ingest route (for example not `v2`, or a heading that reads as an ambiguous cover).
- (ii) An AND hit lands on the wrong page (an "AND hijack", e.g. the 2080-UM005 network-settings chapter without the p.64 DHCP text). There is no weak-AND guard, and the last-resort OR pass is skipped because the pool is not empty. The model then says "excerpts do not state".
- (iii) The notebook identity is `candidate` or bare-number scoping (MR:1428-1436).

`NOTEBOOK_RETRIEVAL_DEBUG=1` (MR:1840) logs the pool and the final pages, which would settle this in one question.

### 1d. ACS355 A5001 false abstain [INFERRED]
The table on p.356 lists the code as "5001" in the "Alarms generated by the basic control panel" table. The question says "a5001". Whether the code lane normalises A5001 to 5001 depends on `codeTokenMatcher`, which I did not trace. The likely cause is a token-shape mismatch, not missing embeddings.

## 2. Why readiness does not match what can be cited [PROVEN]
- `DR:17-28` states that chat readiness is text readiness, not embedding completion. `meetsBasicReady` (DR:105-115) checks bytes, parse, `chunkCount>0`, page anchors, scope and original only.
- The number shown, `embeddingCoverage` (DR:117-123), is `embedded/chunks`. It only moves the state between `enhancing` and `chat_ready_enhanced` (DR:178-196).
- So "1.0" means *every chunk has a vector*. Notebook chat does not read those vectors while `NOTEBOOK_HYBRID_RETRIEVAL=0`, and **readiness knows nothing about the model-applicability filter**. A document can be 100% "ready" and still be 100% inadmissible for any question that names a member model. ACS355 at 0% cited because the lexical path plus an exact-title match is all it needs.

## 3. Prod vs staging config
- **[PROVEN]** The notebook path has the same flags in both composes: `NOTEBOOK_HYBRID_RETRIEVAL` defaults to 0 (SAAS:858 vs STG:336), and the Hub uses colocated `mira-ollama` (SAAS:851 vs STG:329). `MIRA_ENFORCE_APPROVED_RETRIEVAL` defaults to false in both.
- The real difference is that prod has live ingest (`INGEST_URL=http://mira-ingest-saas:8001`, SAAS:934) where staging has `disabled://staging` (STG:401). Staging also carries staging-only flags (`NOTEBOOK_RERANK`, `NOTEBOOK_LEXICAL_V2`, guided procedure; STG:349-355), all defaulting off.
- **[UNKNOWN]** The actual Doppler values may override any of these defaults. I did not read them.
- **#4780 is a different path [PROVEN from the issue text]:** it covers prod `/api/quickstart/ask` → `retrieveManualChunks` (MR:690), with manufacturer-scoped BM25 over the *shared* corpus. The same build cites on staging but not on prod, so **[INFERRED]** the cause is corpus contents (the prod and staging Neon branches hold different shared OEM rows or `model_number` values), not code or flags. Fault-code questions still cite on prod, which fits a thinner vague-query OR or family-fallback pool on prod.
- **#4773 does not exist.** GitHub returns 404. **#4772** (merged 2026-10-25 9:02 AM EDT) fixed the asset-page and `searchKB` reads of shared OEM rows under RLS (#4250). It does not touch `retrieveNodeChunks` and is not a cause of these misses.

## 4. Smallest fixes
| # | Fix | Size | Files |
|---|---|---|---|
| A | **Family coverage on the named-ask branch:** in `documentCoversRequest` (or at MR:1639), admit when a title identity is a FAMILY_ROOT that `familyCovers` the requested model, for the same vendor. Keep the sibling rejection (a Micro810 doc still cannot answer a Micro820 question). Add red-first tests: "PowerFlex 525" question vs 520-series title, "TP700" question vs Comfort Panels title, and Micro810-vs-820 still rejected. | **S**, about 15 LOC plus tests | `mira-hub/src/lib/manual-rag.ts` and its test |
| B | **Fair staging test:** re-run the batch-2 sanity questions with `NOTEBOOK_RETRIEVAL_DEBUG=1`, after A lands. That classifies Micro820 and A5001 as filter, ranking or token problems. Optionally set `NOTEBOOK_HYBRID_RETRIEVAL=1` on staging so the vectors it already writes get used (embedder already wired, STG:329). Needs Mike's OK (env/deploy). | S (env only) | staging env / Doppler (Mike) |
| C | **Readiness honesty:** label `embeddingCoverage` as enrichment only, or show it only when the hybrid lane is on, so "1.0" is not read as "citable". Better still, add a citation smoke probe per doc. | S–M | `document-readiness.ts`, the readiness UI |
| D | **Notebook weak-AND guard:** run the OR pass when every AND row scores below `WEAK_AND_RANK` (mirrors MR:1146). Only if the B trace shows an AND hijack. | S | `manual-rag.ts` |
| E | **#4780 prod:** read-only count of shared `knowledge_entries` rows for Rockwell/PF525 and Yaskawa/GA800 on the prod and staging Neon branches (`is_private=false`, `ingest_route`, `model_number`), then backfill the missing OEM docs to prod. | M (ops, needs Mike's OK for credentials and prod writes) | none in code if this is confirmed |

## Proven vs inferred
- **Proven (code):** the lexical-only notebook path while the hybrid flag is 0; the staging Hub embedder being live; readiness measuring vector coverage only; the named-ask filter lacking family coverage; compose parity for notebook flags; #4772 scope; #4773 not existing.
- **Inferred:** that the family filter is *the* cause for PF525 and TP700 (the code path matches the observed empty answers exactly; not trace-confirmed); the Micro820 and A5001 causes; #4780 being a corpus difference.
