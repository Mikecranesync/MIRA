# RESUME — Equipment Notebook retrieval + answer corrective mission (2026-08-12)

**Branch:** feat/equipment-notebook-v1 · **HEAD at diagnosis:** b0e05664c · **PR #3189 (base=main, HELD).**
Repro notebook (dev): `bffdd034-2df8-4d3a-bc5c-ce942c1a2abe`, node `114657aa-...`, quick-start uploadId `8e44302d-...` (142 chunks).

## Bakeoff verdict (exp/phase15-doc-intel-bakeoff, `docs/architecture/PHASE-1.5-DOCUMENT-INTELLIGENCE-BAKEOFF.md`)
Verdict B: thin evidence layer + retrieval repair. Phase-2 leverage order: (1) parse-then-QA answer stage (8→18/28), (2) retrieval repair: (a) unstemmed simple tsvector OR english, (b) candidate widen + rerank, (3) Docling adapter, (4) evidence contract, (5) native-model as extraction/cross-check not serving. Gemini native = 28/28 but operationally fenced (whole-manual re-read, quota, self-cited). **P0: Groq `llama-3.3-70b-versatile` shuts down 2026-08-16; Hub chat cascade defaults to it (`route.ts:50`).**

## BEFORE evidence (current system, quick-start loaded which DOES contain the answers)
- Q1 "slow down ramp" → "could not find" WRONG (P042 verbatim in doc) + cites 4 irrelevant pages. Root: query vocab mismatch — english('slow down ramp')='paramet'&'slow'&'ramp'; decel chunk has "decel" not "slow"/"ramp". plainto('deceleration') matches 6 chunks. → QUERY EXPANSION.
- Q2 "terminal second speed" → "could not find" WRONG (t067/terminal 07 = Spd+Strt 2). → QUERY EXPANSION + rerank.
- Q3 "motor frequency" → gets P032 but WANDERS into b015/b016 monitoring (forbidden conflation), misses P043/P044/P047/A410. → ANSWER STAGE.
- Q4 "what do you know" → summarizes first retrieved paragraph (startup checklist) — forbidden. → ANSWER STAGE (identity/coverage summary).
- Q6 "What parameter is P042?" → "could not find" though p.21 cited: 2 chunks on p.21 (P033/P035 FLA + P042); dedup-by-page + ts_rank_cd surfaced the FLA chunk not P042. → WIDEN + RERANK.
- Q5 "F004" → CORRECT (UnderVoltage) — some retrieval works.

## Retrieval/answer code map (agent-traced)
- Route: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` — BASE_SYSTEM_PROMPT :34-40; providers :44-65 (Groq default llama-3.3-70b-versatile :50); retrieveNodeChunks call :139 topK=6; buildCitations :69-102 (dedup by url::page, NO entailment); Gate G abstain (chunks===0) :150-185.
- Retrieval: `mira-hub/src/lib/manual-rag.ts` — retrieveNodeChunks :386; runRetrieval :450 uses `ts_rank_cd` (NOT BM25) + `english` tsvector ONLY; AND→OR two-pass :476; NO rerank, NO query expansion, NO simple lane; boundBm25Query :111 is a no-op ≤32 tokens.
- Ingest: `node-knowledge-ingest.ts` writePdfChunksForNode — unpdf per-page text, ~1000-char windows, page stamped; no section_path/bbox.
- tsvector def: `mira-core/mira-ingest/db/migrations/006_knowledge_tsvector.sql` english only.

## Oracle (verified vs Rockwell 520-QS001/UM001)
P042 [Decel Time 1] (Max Freq→0Hz). P043=[Minimum Freq], P044=[Maximum Freq] (NOT Decel Time 2). Terminal: t067/07="Spd+Strt 2"→P048/P049, OR t065/t066 (05,06)="Preset Freq"→A410-A425 (accept both). P032 [Motor NP Hertz]; P047/P049/P051 [Speed Reference1/2/3]; A410-A425 [Preset Freq 0-15]; b001 [Output Freq]/b002 [Commanded Freq] read-only. F004=UnderVoltage, F005=OverVoltage, clear via Stop or A551 [Fault Clear]. QS001 explicitly "does not replace the User Manual".

## PLAN (serving-path, no new pipeline, follows Verdict B)
1. manual-rag: industrial query normalization + multi-query expansion (synonyms) + exact-token (param/fault/terminal) inline `simple` lane OR'd with english + candidate widen (24) + deterministic rerank (exact-token/phrase boost) → slice topK.
2. route: answer-stage prompt (answer-first, no config/monitoring conflation, ambiguity, cite-or-refuse) + post-gen citation entailment (drop unsupported [n]; on refusal emit NO citations — kill the irrelevant-pages-as-proof anti-pattern).
3. Benchmark harness `mira-hub/tests/equipment/benchmark/` + before/after.
4. UI P0/P1 (hide hub chrome on /equipment/[id], fix height chain, collapse citation pills to "N passages", format answers, drop avatars).

## SERVER stability blocker
Standalone process crashes on `/api/work-orders` → `column "source_run_diff_id" does not exist` (dev-DB migration gap) → whole process exit(-1). Unrelated route but takes down the server. Startup VBS relaunches it. Need to either apply the missing migration to dev or guard the route.
