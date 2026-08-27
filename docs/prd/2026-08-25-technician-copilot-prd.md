# FactoryLM Technician Copilot — the ChatGPT × NotebookLM contract

**Status:** Approved execution PRD (supersedes nothing; it *sequences* existing doctrine)
**Owner:** Mike Crane · **Written:** 2026-08-25 · **Verified against:** `origin/main` @ `d387b679e`
**Constitution:** `docs/specs/mira-technician-app-dogfood-system.md` §1.1–§1.4 — read it first.
**Engineering map:** `docs/plans/2026-08-24-universal-technician-current-target-map.md`
**Ingest research:** `docs/plans/2026-08-10-chat-with-any-manual-design.md`

> This document exists because the end goal is spread across five documents and a dozen
> issues. It states the end state ONCE, maps it to verified current reality, and cuts the
> gap into phases an agent session can execute and verify without re-deriving intent.
> Where this PRD and the constitution disagree, the constitution wins.

---

## 1. The product in one paragraph

FactoryLM's Notebook is **ChatGPT fused with NotebookLM for maintenance technicians**. The
ChatGPT half: open the app beside any machine and ask anything, immediately, in a
multi-turn conversation — zero setup, no asset, no manual, no scan required. The
NotebookLM half: every notebook is an evidence workspace — throw manuals, photos,
nameplates, work history, and (eventually) live signals at it, and answers become
grounded, **cited to the page**, and honest enough to refuse when the evidence isn't
there. The fusion rule: **one conversation, two evidentiary states, always labelled.**
General reasoning is never dressed up as machine evidence; machine evidence is never
locked behind setup.

## 2. The four laws (from the constitution — restated, not amended)

1. **Universal Technician (§1.1).** A technician who has configured nothing still gets
   useful help. Any design that requires create/pick/scan *before* MIRA answers is a
   defect — including copy that says so.
2. **Progressive Context (§1.2).** L0 general → L1 identified component → L2 assembled
   machine → L3 connected machine. Each level is an upgrade, never a prerequisite.
3. **Evidence ladder (§1.3).** Every answer carries its basis:
   `general_reasoning | identified_component | oem_documentation | workspace_evidence |
   machine_history | live_machine_evidence`. The UI never implies equal certainty.
4. **Grounding not relaxed (§1.4).** Grounded mode with zero retrieved chunks refuses
   with **no provider call**. General mode is opt-in per turn, never a silent fallback.
   One conversation store. No parallel Chat tab (`nav.ts` is a frozen 5-tab contract).

**Standing non-goals:** no control writes ever; no second cascade / safety classifier /
evidence model / conversation store / ingest pipeline; no 6th tab; no upfront wizard;
read-only toward equipment at every level.

## 3. Verified current state (2026-08-25)

What exists and works — do not rebuild:

| Capability | State |
|---|---|
| Canonical inference seam + safety-first ordering | Live (stg+prod, `MIRA_CANONICAL_SEAM=1`) |
| Typed SSE contract `sources→content*→usage?→evidence?→safety?→status→[DONE]` | Live; clients ignore unknown frames (the additive-extension precedent) |
| Strict grounding, refusal-strips-citations, citation entailment | Live — preserve byte-for-byte |
| General mode (`mode:"general"`), streaming bracket stripper, amber badge | Live (#3386/#3388), Pixel-proven |
| Notebook CRUD, sources, chat, studio; notebook-without-asset | Live, device-proven |
| Scan→notebook (asset-create mints KG bridge row) | Live (#3381/#3382/#3384, mig 083) |
| Multi-turn on web (history + retrieval rewrite) + broad-question completeness | Live (#3201/#3202 line, merged via #3219) |
| Workspace Files: SHA-256 per-tenant dedup, capability model, park-first honesty | Live (mig 075/#3397/#3401) |
| Native file/image picker (phone's own picker, not WebView chooser) | Live (#3403) — **with the MIME defect fixed in Phase 1** |
| Signed OTA web-bundle updates + hub-served manifest | Live client-side (#3393/#3404); `updates.factorylm.com` nginx not live |
| Nameplate → identity → manual discovery pipeline | Live but notebook-coupled |

What is broken or missing — the gap this PRD closes:

| # | Gap | Evidence |
|---|---|---|
| G1 | Nameplate photo from the native picker is rejected as `application/octet-stream` → 415 → generic error | `native-pick.ts` `pickNameplatePhoto` sets no MIME (the PDF path does); recognizer trusts declared MIME only |
| G2 | Five distinct failures all render "Couldn't read the nameplate" | `ComponentNameplateFlow.tsx` discards the server reason; copy map exists unused |
| G3 | Evidence badge is stream-only — after reload a general answer is indistinguishable from a grounded one | #3387; `equipment_notebook_turns` has no basis column; reproduced on Pixel |
| G4 | Phone doesn't send conversation history — follow-ups reach the model contextless (web does send) | spec §3 truth table; mobile chat request body |
| G5 | Manual-first copy contradicts §1.1 ("Add a source to start asking questions") | universal-technician memory; mobile strings |
| G6 | Photos can never become sources — no OCR anywhere; images park as `viewable`, never indexed | design doc §3.8; `workspace-files.ts` capability model |
| G7 | Camera action opens the photo picker, not the camera | #3353, confirmed on hardware |
| G8 | Identity requires a notebook first — `ComponentNameplateFlow` takes `notebookId` at 3 call sites | current-target map §2 |
| G9 | Scanner is QR-only (no Data Matrix, Code 128, OCR) | `ScanView.tsx` uses `qr-scanner` lib |
| G10 | Uploaded chunks carry no manufacturer/model/section metadata → every model-scoped stream inert for uploads; tables shredded by the 1000-char chunker | design doc §1/§3 (the GS10-class INGEST defect, reproduced for every upload) |
| G11 | Large-manual retrieval ceiling (single best chunk outranks; verbatim-quote ceiling law applies) | #3218, #3220 probe lane |
| G12 | Live machine data currently NO-GO: REPLAY — product lacks a "live unavailable / stale" state | spec §3; gate run 32625347755 |
| G13 | Follow-up suggestion chips built and held | #3224 (Mike's merge call) |
| G14 | Release/store identity: debug-signed only; Play Console blocked on org-name verification mismatch; OTA nginx not live | Criterion J; payments email 2026-08-15; OTA memory |

## 4. Requirements

Each requirement has an ID, an acceptance test an agent can run, and its phase. "Device"
means physical-Pixel proof — **Mike-only**, never claimed by an agent.

### CONV — the conversation (ChatGPT half)

- **CONV-1 (done)** Assetless, sourceless, authenticated general answer, opt-in per turn,
  amber-labelled, citations force-empty. *Gate: general-mode tests green; grounded path
  byte-identical.*
- **CONV-2 [P2]** Evidence basis persists. Migration adds `basis TEXT NULL` (+ CHECK on
  ladder values) to `equipment_notebook_turns`; chat route writes it; turns list returns
  it; both clients render the badge from the *persisted* row. Never inferred client-side
  from "zero citations". *Gate: create general turn → reload → badge survives; grounded
  turn shows no general badge; migration idempotent + follows `mira-hub-migrations.md`.*
- **CONV-3 [P2]** Phone sends bounded sanitized history (last 8 turns, same shape web
  sends); server-persisted turns are the truth across devices. *Gate: phone follow-up
  "what about the second one?" resolves against the prior turn (fixture test on the
  request body + one live check).*
- **CONV-4 [P2]** Follow-up chips: decide #3224 (merge, rebase, or kill). Deterministic,
  evidence-derived, last-turn-only. *Gate: Mike's call recorded on the PR.*
- **CONV-5 [P1]** No copy anywhere makes setup a precondition of asking. All
  "add a manual/source first" strings replaced with ask-now-upgrade-later phrasing.
  *Gate: `grep -ri "add a source\|add its manual\|add the machine's manual" mira-mobile/src mira-hub/src` returns only the explicit grounded-mode
  affordance strings, none of which gate the ability to ask.*

### EVID — evidence intake (NotebookLM half, inbound)

- **EVID-1 [P1]** A photo picked on the phone reaches the recognizer with a truthful
  image MIME. The native pick seam resolves MIME from the picker, falling back to the
  file extension, never shipping `application/octet-stream` for an image. *Gate: unit
  test — picker returns `mimeType: undefined` and `octet-stream` for `x.jpg`/`x.png` →
  `File.type` is `image/jpeg`/`image/png`.*
- **EVID-2 [P1]** The recognizer does not trust declared MIME alone: it sniffs magic
  bytes (JPEG/PNG/GIF/WebP) and accepts a safelisted *sniffed* type when the declared
  one is wrong; 415 only when both fail. *Gate: route test — octet-stream body with JPEG
  magic bytes → 200 path; text body named `.jpg` → 415.*
- **EVID-3 [P1]** Every intake failure tells the technician what actually happened.
  The client maps server statuses/reasons (413, 415, 503 recognizer-not-configured,
  502 provider) to distinct copy; "Couldn't read the nameplate" is reserved for a
  genuinely unreadable nameplate. *Gate: reducer tests — each server reason renders its
  own sentence.*
- **EVID-4 [P3]** Photos become searchable evidence: an OCR fallback (Tesseract per the
  design doc; docling is dead) turns a photographed page/label into indexed
  `workspace_evidence` chunks under the same one-pipeline writer, honestly reporting
  quality. Scanned PDFs stop reporting `indexed:true, chunkCount:0`. *Gate: photograph
  of a spec table → cited answer sourced from it; zero-text file reports its state.*
- **EVID-5 [P3]** Real camera capture (G7/#3353). *Gate: device (Mike).*
- **EVID-6 [P4]** Identity without a notebook: lift `ComponentNameplateFlow` off
  `notebookId` (identify → then choose: just ask / save component / attach). Reducer and
  discovery pipeline reused, not duplicated. *Gate: identify from the front door with
  zero notebooks; existing notebook flow regression-green.*
- **EVID-7 [P4]** Scanner beyond QR: ML Kit evaluation (Data Matrix, Code 128/39,
  PDF417, OCR pass) against the WebView `qr-scanner`, decided with Pixel evidence, not
  vendor docs. FactoryLM QR stays the fastest exact-identity path. *Gate: comparison doc
  + decision; device proof.*

### GRND — grounding & retrieval (NotebookLM half, outbound)

- **GRND-1 (done, preserve)** Zero chunks in grounded mode → `insufficient_evidence`,
  no provider call, no citations on refusals. *Gate: existing tests stay green — any PR
  that touches this shows the diff explicitly.*
- **GRND-2 [P5]** Ingest metadata: title/manufacturer/model extracted at upload (cheap
  cascade call, unknown vendors pass through unchanged — never grow the alias table),
  written on chunks + a doc-level record. Un-inerts model-scoped retrieval for uploads
  and fixes citation labels. *Gate: upload a manual from an unknown vendor → doc record
  carries its real name; asset chat can find it.*
- **GRND-3 [P5]** Shared structure-aware chunker: port/extract the crawler's
  table+section chunker for the v2 writer; write `section_path`. *Gate: spec-table
  question answered from an uploaded manual whose table the old chunker shredded.*
- **GRND-4 [P5]** Large-manual completeness (#3218): measure the verbatim-quote ceiling
  FIRST (standing law), then fix at the proven layer. *Gate: the frozen probe lane
  (#3220) shows the rank improvement; no regression on the golden sets.*
- **GRND-5 [P5]** Embedding honesty: embed-on-write gets durable retry + coverage
  canary including `node_attachment`, or doc-chat is explicitly committed to BM25-only
  in writing. Either is acceptable; silence is not.

### IDNT — identity & assembly (L1→L2)

- **IDNT-1 [P4]** = EVID-6 (identity is an entry point, not a notebook feature).
- **IDNT-2 [P6]** Progressive assembly: after repeated work, MIRA *proposes* ("you've
  identified a Micro820 and two photoeyes while working on CV-101 — relate them?").
  Human confirmation stays authoritative; proposals never auto-verify (KG law).
- **IDNT-3 [P6]** Conversation → work-order draft handoff: from any notebook answer,
  a reviewable WO draft (existing Workorders surface; offline-queue pattern).

### LIVE — connected machine (L3)

- **LIVE-1 [P7]** Every live claim carries freshness + quality + provenance; the app has
  an explicit **Live unavailable — data is stale/untrustworthy** state. The current
  NO-GO: REPLAY becomes a rendered product state, not a hidden gate. *Gate: replay data
  renders the unavailable state; a fresh GO renders the live basis with age.*
- **LIVE-2 [P7]** Live context joins answers only server-side, only after equipment
  resolution, only read-only, surfaced as `live_machine_evidence` with age.

### PLAT — platform & release (parallel track, Mike-gated)

- **PLAT-1** Play identity: re-submit org verification with the exact registered name
  (currently failed on name mismatch — limited attempts, match the document
  character-for-character). **Mike-only.**
- **PLAT-2** Release-signed build + keystore (Criterion J). **Mike-only secrets.**
- **PLAT-3** `updates.factorylm.com` nginx live → OTA loop closes (client + manifest
  already shipped). Remember: `readyTimeout=0` disables rollback — set it.
- **PLAT-4** Blank-WebView recovery (#3405, in review) and picker round-trip stability.

## 5. Phases and gates

Phases are strictly ordered within a pillar but pillars can proceed in parallel where
files don't collide. Every phase ends with: tests green, lint clean, `/VERSION` bumped
(code PRs), CHANGELOG note, PR opened and **HELD — merges are Mike's**.

| Phase | Contents | Exit gate |
|---|---|---|
| **P1 — Honest intake** (this PR) | EVID-1, EVID-2, EVID-3, CONV-5 | Photo picked on device reaches recognition; every failure mode has its own sentence; no setup-gating copy. Unit gates runnable offline. |
| **P2 — Durable conversation** | CONV-2 (mig 084), CONV-3, CONV-4 decision | Badge survives reload on both clients; phone follow-ups carry history; #3224 decided. |
| **P3 — Photos are evidence** | EVID-4, EVID-5 | A photographed page yields a cited answer; camera is a camera (device gate). |
| **P4 — Identity anywhere** | EVID-6/IDNT-1, EVID-7 | Identify with zero notebooks; scanner decision made on Pixel evidence. |
| **P5 — Ingest & retrieval quality** | GRND-2..5 | Unknown-vendor manual fully usable; table questions answered; #3218 measured-then-fixed. |
| **P6 — Machine memory** | IDNT-2, IDNT-3 | Assembly proposals + WO handoff, human-confirmed. |
| **P7 — Live evidence** | LIVE-1, LIVE-2 | Stale data renders as unavailable; fresh GO renders live basis with age. |

**Agent rules for every phase:** worktree off fresh `origin/main` (never the shared
checkout); read the constitution + this PRD + the phase's gap rows before coding; no new
pipelines/seams (the one-pipeline and no-second-implementation laws); regression sets
named in the gate run before the PR claims them; device claims are Mike's alone.

## 6. Explicitly out of scope

- Consumer-manual *marketing* (the narrow reading of the 2026-08-10 design stands:
  vendor-agnosticism is a canary for the industrial wedge, not a pivot).
- Voice input (a §1.1 entry point on paper; parked until the core intake ladder is done).
- Control writes, PLC remote control, SCADA/CMMS replacement — never.
- Growing the vendor alias table; a second retrieval stack; engine forks.

## 7. Traceability

| Issue/PR | Requirement |
|---|---|
| #3353 | EVID-5 |
| #3387 | CONV-2 |
| #3218 / #3220 | GRND-4 |
| #3224 | CONV-4 |
| #3403 (defect introduced) | EVID-1..3 |
| #3405 | PLAT-4 |
| Play org-verification email 2026-08-15 | PLAT-1 |
| Dogfood spec §1.1–1.4 | The four laws (§2) |
| Current-target map slices 2/3/4 | EVID-6/7, ladder end-to-end |
| Any-manual design phases 1–2 | GRND-2..5 |
