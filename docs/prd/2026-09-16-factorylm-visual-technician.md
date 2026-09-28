# FactoryLM Visual Technician — Discovery & Implementation PRD (DRAFT, in progress)

**Status:** read-only discovery synthesis, 2026-09-16. No code/migrations/deploys/merges during
this phase. Ends in a first-slice recommendation, then stops for approval.
**Author:** discovery session (CHARLIE). Intended repo home on approval: `docs/prd/`.

## Product direction (owner, 2026-09-16)
> "Photograph the machine. Ask what's happening. Watch its maintenance brain assemble."

One camera-first conversation where photos, questions, QR scans, manuals, prints, repair history,
and trustworthy live data progressively build a **persistent machine memory**. **MIRA is the single
technician-facing voice.** Specialized capabilities produce **typed evidence** underneath it — never
separate personas or disconnected workflows. The unified FactoryLM cutover is intentional; **no
classic Notebook UI, no parallel experience.** Prefer an orchestration/projection over existing
VisualSession / workspace-file / asset / equipment-notebook / interaction contracts — do **not**
introduce another asset DB or standalone demo architecture unless discovery proves the existing
contracts cannot support it.

Required experience: zero-setup start (type / speak / scan / photo) → original photo becomes
**canonical evidence** → multiple capabilities process it concurrently (quality, OCR, nameplate
identity, equipment recognition, prints, manual matching, mismatch, later live signals) → UI shows
progressive trustworthy states (**Captured → Observed → Candidate → Confirmed → Grounded →
Connected**) → candidate identity requires **human confirmation** before verified-asset/KG promotion
→ MIRA asks for the single most useful next photo/action → technician can ask at every stage →
answers distinguish general / visible-evidence / OEM-doc / machine-history / live → photo citations
open the **original photo** (not an OCR sidecar) → machine/evidence/conversation/work survive restart
and move phone↔web.

## Known current state (established LIVE tonight — ground truth)
- Prod is healthy on OVH (`40.160.141.61`); TLS on `updates.factorylm.com` repaired (valid → Dec 15).
- Deployed pilot APK `com.factorylm.mira` **1.2.0 / vc 11**, source SHA `1d20ab5e`, is **unified-only**
  (App roots to `UnifiedRoot`). origin/main is ahead (HEAD `f10b687c`, incl. publicDemo #3811/#3812);
  `UnifiedRoot.tsx`/`App.tsx` differ local↔main↔deployed — **target-state = origin/main**.
- Unified drawer = **Projects → {Machine, Chats}**. CV-101 ("Discharge Conveyor",
  asset `64a24de7-2809-4c35-b4fe-202be80393d6`, tenant `e88bd0e8`, owner mike@cranesync.com) is a
  **verified** asset with a resolvable notebook (`8e329a9c-…`) that now has **3 attached, citable
  sources** (`canChat=true`) — yet it **does not appear** as a Project/Machine in the unified drawer
  (search "Discharge" → nothing). QR `/m/CV-101` lands on a mira-web "Register equipment" page
  (nginx `/m/` → mira-web:3200; Hub is 3101) per `docs/dogfood/garage-cv101-kit.md` §5.
- Provider cascade 2/3 (Cerebras 402, billing); live-data flags off in prod (honest by default).

---

**Headline:** The camera-first pipeline is ~80% built as **disconnected, individually-tested pieces**.
The product direction is reachable primarily by **connecting existing seams under one projection**,
not by building new services. The single highest-leverage gap is one unwired function
(`evidence_from_visual_session`) plus a technician-facing **trust-state projection** over vocabularies
that already exist. Everything below is grounded in the per-agent discovery notes at the end of this doc.

## 1. Verified current-state capability map
Full table in **Discovery notes → Visual capability map (agent 4)**. Summary by build state:
- **EXISTS & reusable as-is (7):** canonical immutable original-photo store (`namespace_direct_uploads`
  + `parkOrReuseFile`); camera capture (`native-pick.ts::capturePhoto`); server quality gate
  (`quality_gate.py::score_image`); print/schematic engine (`printsense/*`, CAS-cached, production);
  OEM manual matching with a full ladder (`manual-applicability.ts` `ApplicabilityVerdict` +
  `equipment_notebook_sources.match_state`); **citation→original photo, already shipped for the
  notebook path** (migs 084/085, `ChatCitation.originFileId`, chat route + `NotebookScreen`,
  regression-tested); the `VisualSession` observation ledger (migs 063/069, `mira-bots/shared/visual/`).
- **PARTIAL / thin-adapter (5):** client capture-quality (`assessCapture`, built+tested, **0 callers**);
  OCR bbox extracted but `region_id` not persisted; equipment recognition is routing-only (no
  appearance classifier); KG-level mismatch scaffolded (`contradict` trigger + `apply_kg_approval`,
  **0 callers**); concurrent fan-out (`vision_worker` gathers 3 lanes → one classification, but
  `ingest_image` is sequential + branch-exclusive, **Telegram-only**).
- **MISSING (the real design work):** a **unified technician-facing trust-state vocabulary** (Captured…
  Connected has 0 repo hits — three real ladders exist: `EvidenceState`, `NameplateFact.status`,
  `MatchState`); **true concurrent multi-capability fan-out over one photo**; a **single confirm path
  camera→verified asset/KG**; **CAS recall on the live photo turn** (vision re-runs every turn — ME
  rule-1 violation); the wiring of `evidence_from_visual_session` into the one policy.
- **DEFECT to fix:** bot-side `engine.py::_handle_nameplate` writes Atlas CMMS with **no human confirm**
  (skips Candidate/Confirmed) — the Hub path does it correctly; converge on the Hub path.

## 2. End-to-end data & interaction flow (first photo → confirmed machine → cited answer)
```
Technician taps camera (or types/scans/uploads) on the unified surface
  └─ native-pick.capturePhoto → parkOrReuseFile → namespace_direct_uploads (immutable, sha256)   [CAPTURED]
     └─ open/attach a VisualSession bound to the InteractionThread (machine memory spine)
        └─ ONE "photo received" event fans out concurrently (asyncio.gather) over independent producers:
             quality_gate → (reject → NEEDS_CONTEXT, "clearer photo")                              [gate]
             VisionWorker(OCR + prose) → observations (VISIBLE per token, LIKELY prose)            [OBSERVED]
             NameplateWorker → EquipmentIdentityCandidate / NameplateFact(candidate)               [CANDIDATE]
             printsense (if schematic) → machine_proposed symbols/edges (CAS-cached)               [CANDIDATE]
             manual-discovery/applicability → ApplicabilityVerdict(candidate) + match_state         [CANDIDATE]
             resolve_equipment mismatch → CONFLICTING/NEEDS_CONTEXT (blocks promotion)             [branch]
        └─ each producer writes a typed EvidenceItem(trust="candidate") to the observation ledger
        └─ UI projects the ledger as trust-state transitions in the machinePanel + typed thread parts
           (visual_observation, machine_evidence, evidence_basis, approval_request)
  ── MIRA asks for the single most useful next photo/action (answer_composer.next_best_evidence)
  ── Technician confirms candidate identity  → nameplate-confirm / kg proposal-transition           [CONFIRMED]
       (human-only; promotes to verified asset/KG entity; binds thread.primaryAssetId)
  ── Technician asks a question at ANY stage:
       build_turn_context + augment_with_retrieval + evidence_from_visual_session  ← WIRE THIS
         → ONE TechnicianContext (candidate vs verified, read-only, fail-closed)
         → Supervisor/mira-pipeline single policy composes the answer
         → answer labeled by evidence_basis (general/identified/oem/workspace/history/live)
         → citation [n] resolves to the ORIGINAL photo (origin_file_id) or OEM page                [GROUNDED]
  ── (later) live read-only signal joins, with freshness; else "Live unavailable"                  [CONNECTED]
  ── Everything persists on the thread/session → survives restart, moves phone↔web (typed SSE + tables)
```

## 3. Smallest architecture connecting existing capabilities
**One orchestration + one projection over existing contracts — no new service, no second asset DB, no
second message store, no cassette engine for the app.**
1. **Trust-state projection (new, but a read-model not a table):** define
   `Captured→Observed→Candidate→Confirmed→Grounded→Connected` as a pure function over existing state,
   with the crosswalk in §6. It is the technician-facing view; it retires nothing.
2. **Wire `evidence_from_visual_session()` into `mira-bots/shared/technician_context.py`** (the one
   unwired seam) behind `MIRA_CONTEXT_CONTRACT` — visual observations reach the single MIRA policy as
   typed candidate evidence. This is the core of the whole program.
3. **VisualSession ↔ InteractionThread ↔ asset binding:** the photo's session is the machine's thread;
   confirmed identity sets `thread.primaryAssetId`. "Machine memory assembles" = ledger observations
   projected as trust-state transitions in the `machinePanel` slot + typed parts (already defined in
   unified-interaction-v1 part-3).
4. **Concurrent fan-out:** replace `ingest_image`'s sequential/exclusive branches with `asyncio.gather`
   over independent producers; ledger already supports it.
5. **Single confirm path:** one human action promotes candidate→verified (reuse nameplate-confirm +
   `apply_kg_approval`, wire the missing caller).
6. **CAS recall on the live turn:** key vision/OCR on `(photo_sha, producer, prompt_version)` before
   recompute (reuse `printsense/cas.py` pattern) so re-asking about the same photo doesn't re-infer.

## 4. Public-demo design & how it shares production contracts
Full detail in **Discovery notes → Public demo (agent 5)**. Design:
- **Reuse the shipped `publicDemo` profile verbatim** (#3812): `SurfaceProfile.publicDemo` → `DemoNotice`
  (non-dismissible "Sample data"), `ConversionIntent`/`onConvert`, Composer/ Sidebar conversion states,
  and the new `FactoryLMShell.machinePanel` slot. Same shell, fewer capabilities, curated data.
- **The demo's machine-assembly is a deterministic REPLAY of recorded VisualSession typed events** for a
  **sanitized CV-101 evidence set** — rendered in the same `machinePanel` + thread parts a signed-in
  session uses. This replay source is the **one genuinely-new demo piece** (a small event player over
  recorded `visual_observation`/`machine_evidence` frames); it is NOT SimLab (SimLab = the separate
  live-signal demo). Visitor watches CV-101 go Captured→Observed→Candidate→Confirmed→Grounded in near
  real time.
- **Isolation = adopt #3815/#3828 as-is:** default-deny path allowlist, hardened no-DB/no-network
  container, same-origin rate-limited proxy. Public demo **egresses nothing**; publicDemo Composer
  disables uploads → no anonymous private-photo storage exists to isolate.
- **"Build my first machine" → auth, preserving the question:** replicate the existing
  `workorders/new/prefill.ts` `?prefill_*` pattern as `?prefill_question=` into `/signup`.
- **OWNER FORK (blocking the "ask + cite pre-signup" clause):** anonymous grounded chat is deliberately
  OFF (`sessionOr401`, decision #3815). Either **(a)** ship demo-v1 as watch-assemble-then-convert
  (no pre-signup chat), or **(b)** build a scoped, rate-limited, session-free demo-chat over a curated
  public-safe notebook. #3828 (awaiting your approval) is the trigger #3815 named for revisiting. → §11.

## 5. Root cause & repair — CV-101 unified visibility + /m/CV-101 routing
**A. Visibility — CONFIRMED LIVE (not a filter; a frozen label).** No exclusion filter exists;
`notebookProjects` maps every tenant notebook. CV-101's asset (`64a24de7`, "Discharge Conveyor") is
bound to notebook `8e329a9c`, whose `display_name` is frozen as **`"Sensor v0 overnight 2026-08-28"`**
with `manufacturer/model/asset_tag = null` (verified via `GET /api/equipment-notebooks/8e329a9c/` as
owner). `createAndBindNotebookTx` (`mira-hub/src/lib/equipment-notebooks.ts:453,463-470`) copies
`display_name` from `kg_entities.name` **once at bind time** and never carries mfr/model/tag; the
`dogfood-cv101-identity.sql §3b` rename to "Discharge Conveyor" is a guarded UPDATE that no-ops on
collision and never propagated to the notebook row. So CV-101 **is** the top drawer item, under a wrong
name — invisible to a "Discharge" search and unrecognizable to a technician.
**Repair (reuse):** resolve the Project/Machine label **live from the bound asset** at read time in
`listNotebooks`/`rowToNotebook` (via `equipment_entity_id → kg_entities.name`/`cmms_equipment`), and/or
carry `manufacturer/model/asset_tag` onto the notebook at bind time; backfill existing rows. No filter, no
new table.

**B. `/m/CV-101` routing — CONFIRMED (funnel mis-route + fragile app-link).**
`deployment/nginx-app-factorylm.conf:124` routes `/m/` → `mira-web:3200` (PLG funnel), not Hub:3101,
unconditionally. `mira-web/src/routes/m.ts` checks `hubSessionPresent` (NextAuth browser cookies the
Capacitor app never carries) → its own JWT (also not presented) → unauth path → `asset_qr_tags`
(mira-web schema, disjoint from Hub `cmms_equipment`) → CV-101 absent → `302 /m/CV-101/register`
("Register equipment"). The **native app-link path is correctly wired** (`assetlinks.json` +
`AndroidManifest autoVerify` + `main.tsx appUrlOpen/getLaunchUrl` → `handleDeepLink` → `extractAssetTag`
→ `UnifiedRoot.resolveScan` → `openAssetNotebook`) and bypasses nginx entirely **when Android hands the
tap to the installed, domain-verified app** — it fails identically to anonymous only when App-Link
verification isn't holding, the app isn't installed, or a scanner/browser opens the URL itself.
**Repair:** (1) extend `m.ts` hub-handoff to also accept the mobile app's bearer/session token as a
routing hint to the Hub (reuse `hub-handoff.ts` pattern); (2) verify on-device App-Link association holds
(device fact, add to the walk checklist). Both touch **guarded legacy paths** → require a
`legacy-ui-exception` label per `.claude/rules/factorylm-unified-ui-cutover.md`.

## 6. Implementation-ready PRD

### 6.1 Invariants (enforced, not aspirational)
1. **One voice, one policy, one context.** Exactly one conversational runtime (Supervisor/mira-pipeline).
   Every specialist emits typed **candidate** `EvidenceItem`s via `context_contract.py`; **no second
   context schema, evidence ledger, provider cascade, safety classifier, or chat persona**
   (dogfood §1.4; NORTH_STAR Bravo boundary).
2. **Candidate ≠ verified; the model never self-promotes.** Promotion to `verified` is a human action
   (or an explicitly deterministic approved process) through the existing approval systems
   (`ai_suggestions`/`relationship_proposals`/`kg approval_state`; nameplate-confirm; `match_state`).
3. **Read-only, fail-closed.** `validate_context()` rejects any write-shaped `allowed_action` and any
   non-`read_only` `authorization_state`. No control writes in beta (fieldbus-readonly).
4. **Original evidence is canonical & immutable.** One content-addressed store
   (`namespace_direct_uploads`); a derived-text citation MUST resolve to the original
   (`origin_file_id`). No second asset/photo DB.
5. **Zero-setup.** Any single input yields useful help; asset-specific claims are gated on **confirmed**
   identity; general help never is (dogfood §1.1/§8).
6. **Every answer is basis-labeled** (general/identified/oem/workspace/history/live); never present
   reasoning as an OEM doc.
7. **Public demo egresses nothing, stores no anonymous private photo, writes nothing, reads no customer
   data.** External egress (ADR-0036) is owner-gated and ships dark until decided.
8. **Extend, don't fork.** Notebook = a per-machine `InteractionThread`; reuse the typed parts, the
   VisualSession ledger, `evidence_from_visual_session`, and the `publicDemo` profile.

### 6.2 Trust-state model — the unifying projection + crosswalk (closes the central gap)
Six technician-facing states, **computed** from existing vocabularies (not a new stored column):

| Projected state | Meaning | Crosswalk (existing) | Promotion |
|---|---|---|---|
| **Captured** | original input stored, immutable | `namespace_direct_uploads` row exists | automatic |
| **Observed** | a capability read content off it | `EvidenceState.VISIBLE`; `NameplateFact.observed`; OCR/prose observation | automatic |
| **Candidate** | a capability proposed identity/fact/edge | `EvidenceState.LIKELY`/`MACHINE_VERIFIED`; `NameplateFact.candidate/corroborated`; `MatchState.candidate`; `kg approval_state=proposed`; printsense `machine_proposed` | model — never trusted |
| **Confirmed** | a human confirmed the candidate | `NameplateFact.technician_confirmed`; `MatchState.user_confirmed`; `kg approval_state=verified` | **human only** |
| **Grounded** | an answer cites confirmed evidence, resolvable to original/OEM page | `evidence_basis ∈ {oem_documentation, workspace_evidence, machine_history}` + resolvable citation | per-answer |
| **Connected** | live read-only signal joined, with freshness | `evidence_basis=live_machine_evidence`; L3; `LiveStateOverlay` | per-turn; NO-GO today → "Live unavailable" |
| _branch:_ **Conflicting / Needs-context** | contradiction or insufficient evidence | `EvidenceState.CONFLICTING/NEEDS_CONTEXT`; `NameplateFact.conflicting` | blocks Candidate→Confirmed |

### 6.3 Interfaces (reuse-first)
- `evidence_from_visual_session(observations, evidence, regions) -> list[EvidenceItem]` (exists) — wire
  into `technician_context.build_turn_context`/`augment_with_retrieval`.
- `VisualSessionService.ingest_image(...)` — refactor to concurrent producer fan-out; keep the ledger.
- `listNotebooks`/`rowToNotebook` — live label resolution from bound asset.
- `m.ts` hub-handoff — accept mobile token (legacy-ui-exception).
- `parseWorkOrderPrefill` pattern → `?prefill_question=` in `/signup`.
- Shell: `FactoryLMShell.machinePanel` + `publicDemo` profile + typed thread parts (all exist).

### 6.4 Failure behavior
Bad photo→NEEDS_CONTEXT+ask clearer. No confirmed identity→general help only; ask to confirm before
asset-specific claims. Contradiction→CONFLICTING, block promotion, request disambiguating evidence. Live
unavailable→say so, never render stale as live. Context-contract violation→fail-closed on the prompt
block, fail-open on the turn (never block the answer). Egress dark→degrade to ingested-corpus-only.

### 6.5 Privacy boundaries
Per-tenant photos private (tenant scoping; `knowledge_entries.is_private`). Public demo: sanitized CV-101
set only, egress nothing, no writes, no anonymous upload store. Serial-number egress gated on ADR-0036;
sanitizer masks `[SN]` except the deliberate owner-approved nameplate-vision carve-out.

### 6.6 Acceptance criteria
Adopt **unified-interaction-v1 part-5 §19** (25 criteria) + **commodity-first §19** photo-citation tests
A/B, and add the camera-first assembly acceptance: **the CV-101 golden journey** — photograph CV-101's
nameplate → watch Captured→Observed→Candidate → confirm identity → ask a manual-grounded question → cited
answer with correct `oem_documentation` basis → tap citation → **original photo (or OEM page) opens** →
force-restart → thread + citation persist → open same thread on web. The **Golden Conversation**
(part-4 §14 Phase 2) is the umbrella flow.

## 7. Phased build plan (smallest E2E vertical slice first)
- **Slice 0 (unblock the demo machine, trivial):** CV-101 label live-resolve + backfill → CV-101 is
  findable/recognizable in the drawer. (Also enables recognizing the machine we already provisioned.)
- **Slice 1 — the tracer bullet (recommended first build):** on the signed-in unified mobile surface,
  **photograph CV-101 nameplate → Candidate identity → human Confirm → ask a manual-grounded question →
  citation opens the original photo**, by WIRING existing pieces (capture store, quality gate, Hub
  nameplate candidate, nameplate-confirm, manual-applicability, `evidence_from_visual_session`,
  `origin_file_id`) + the trust-state projection in the `machinePanel`. Proves the whole promise
  end-to-end on real contracts with the least new code.
- **Slice 2:** concurrent fan-out over one photo (`ingest_image` → `asyncio.gather`); persist OCR
  `region_id`; CAS recall on the live turn.
- **Slice 3:** `/m/CV-101` routing repair (legacy-ui-exception) + on-device App-Link verification.
- **Slice 4:** public-demo visual-assembly replay (publicDemo shell + `machinePanel` + recorded-event
  player + `?prefill_question=`), sanitized CV-101 set, isolation adopted from #3815/#3828.
- **Slice 5+:** KG-level mismatch consequences (`apply_kg_approval` caller); converge bot nameplate onto
  the Hub confirm path (fix the no-confirm defect); Connected/live when the CV-101 gate passes.

## 8. File-level change map & PR sequence (dependencies, rollback boundaries)
| PR | Scope | Key files | Depends on | Rollback |
|---|---|---|---|---|
| PR-0 | CV-101 label live-resolve + backfill | `mira-hub/src/lib/equipment-notebooks.ts` (`listNotebooks`/`rowToNotebook`), migration to backfill display fields | — | revert; label reverts to frozen string |
| PR-1 | **Slice 1**: wire visual evidence → one policy + capture→confirm→ask→cite on unified mobile | `mira-bots/shared/technician_context.py`, `materialized_evidence/context_contract.py` (adapter already exists), `mira-mobile/src/screens` capture→VisualSession, trust-state projection in `packages/factorylm-ui` `machinePanel` | PR-0 | flag `MIRA_CONTEXT_CONTRACT`=off restores baseline |
| PR-2 | Concurrent fan-out + OCR region_id + CAS recall | `mira-bots/shared/visual/session_service.py`, `vision_worker.py`, `printsense/cas.py` reuse | PR-1 | keep sequential path behind flag |
| PR-3 | `/m/` routing hub-handoff + App-Link check (legacy-ui-exception) | `mira-web/src/routes/m.ts`, `mira-web/src/lib/hub-handoff.ts`, `deployment/nginx-app-factorylm.conf`, `deployment/well-known/assetlinks.json` | — (parallel) | revert nginx/redirect (guarded rollback path) |
| PR-4 | Public-demo visual-assembly replay + question prefill | `packages/factorylm-ui`, `apps/factorylm-ui-lab/src/PublicDemo.tsx`, new recorded-event player, `mira-hub/src/app/signup` `?prefill_question=` | PR-1 | feature-gate the demo route |
| PR-5+ | KG mismatch caller; bot-nameplate→Hub-confirm convergence; Connected/live | `proposal_transition.py`, `engine.py::_handle_nameplate`, live overlay | PR-1/PR-2 | per-flag |

All app-facing UI PRs live under the shared-shell packages / `src/factorylm-ui/**` adapter roots per the
cutover charter; none touch guarded legacy trees except PR-3 (with the exception label).

## 9. Verification matrix
| Layer | What | How |
|---|---|---|
| Unit | trust-state projection fn; live label resolver; `evidence_from_visual_session` (has tests); prefill parse | vitest/pytest; positive+negative controls |
| Integration | photo→VisualSession→context→cited answer; candidate→confirm→verified promotion; contradiction blocks | pytest against hermetic fixtures + staging Neon |
| Browser | Golden Conversation + CV-101 journey on the shared shell | Playwright (web-review skill) |
| Mobile handset | capture→Candidate→Confirm→ask→citation-opens-original; on unified build | on-device walk (adapt tonight's harness to the unified Projects/Machine nav, NOT classic) |
| Restart/resume | thread + citation survive force-stop; phone↔web parity | handset force-stop + web reopen (the PR-#3807 cold-restart idea, re-homed to unified) |
| Citations | citation resolves to ORIGINAL photo (path A) and OEM page | commodity-first §19 tests A/B |
| Fail-closed | no identity→general only; contradiction→block; egress dark→corpus-only; context violation→answer still served | negative-path tests |
| Public-demo isolation | allowlist default-deny; no egress; no writes; no anon upload | reuse `tests/simlab/test_public_demo_trust_boundary.py` shape |

## 10. Product metrics (→ where instrumented)
- **Time to first useful observation** — capture→first `Observed` ledger row (`decision_traces`/session ts).
- **Time to candidate identity** — capture→first `Candidate` (NameplateFact/EquipmentCandidate ts).
- **Time to first cited answer** — capture→first `oem_documentation`-basis answer with resolved citation.
- **First-photo useful-action rate** — sessions whose first photo yields an Observed/Candidate (not
  NEEDS_CONTEXT) / total first photos.
- **Identity correction rate** — `technician_confirmed` corrections vs. accepted (nameplate-confirm log).
- **Citation-open success** — citation taps that resolve to a viewable original/page / taps.
- **Duplicate asset/source rate** — idempotency guard (commodity-first Test B) hits.
- **Demo→signup→first-private-photo conversion** — `onConvert(intent)` → signup complete → first
  `namespace_direct_uploads` under the new tenant (needs the `?prefill_question=` + funnel events).

## 11. Owner decisions & unresolved risks
1. **⚠ External egress (ADR-0036) — TOP RISK, blocks the nameplate→manual arc.** Nameplate vision:
   (A) approve a named runtime exception + amend `AGENTS.md §2`/PRD §4, or (B) route via the governed
   inference boundary (needs a serial-`[SN]` sanitizer carve-out). Manual discovery: (C) approve Serper
   for identity-strings-only, or (D) drop external, rely on ingested OEM corpus. Ships **dark** until you
   decide.
2. **Public-demo chat fork** — (a) watch-assemble-then-convert (no pre-signup chat), or (b) scoped
   rate-limited anonymous demo-chat. #3828 is the trigger event; also gates the "ask + cite pre-signup"
   clause of the direction.
3. **The 7 deferred unified-interaction-v1 decisions** (part-5 §21): web host (app. vs factorylm.com/app),
   default project name, project-instruction editors, folder depth, default sharing, Work-run templates,
   Hub/mobile React alignment.
4. **Confirm the Notebook↔Projects reconciliation** — this PRD takes "unified wins; Notebook = a
   per-machine `InteractionThread`" as settled by your direction; please confirm so the dogfood
   "no sixth tab / Notebook is the home" constitution clauses are formally superseded, not silently.
5. **Deployed-build target** — the shipped 1.2.0 APK (`1d20ab5e`) is unified-only (no chatUi branch);
   origin/main is ahead. Confirm the next pilot build is cut from origin/main (or later) so these repairs
   ship. (Tonight's TLS/provisioning/CV-101-attach are all in place and reusable.)
6. **Sub-brand naming** — "Field Lens"/"Print Studio" (mira-visual-technician PRD) as UI surface labels
   vs. a one-voice risk if surfaced to users.
7. **Bot-nameplate no-confirm defect priority** — `engine.py::_handle_nameplate` writes Atlas with no
   human confirm (against train-before-deploy); schedule convergence onto the Hub confirm path.

**Unresolved / not verified this discovery:** exact field names in `materialized_evidence/schema.py` +
`printsense/cas.py` (described from docs, not read) — confirm before PR-2 commits to key tuples;
whether the CV-101 asset→notebook binding to a "Sensor v0 overnight" notebook is a mis-bind or an
intended reuse (PR-0 should reconcile identity, not just relabel).

## First build slice recommendation → STOP for approval
**Build Slice 0 + Slice 1 first**, nothing else:
- **Slice 0:** make CV-101 findable — live-resolve the machine label from the bound asset (+ backfill).
  Trivial, unblocks the permanent demo machine's recognizability (it's currently the mislabeled "Sensor
  v0 overnight" item).
- **Slice 1 (the vertical tracer bullet):** on the signed-in unified mobile surface, **photograph
  CV-101's nameplate → Candidate identity → human Confirm → ask a manual-grounded question → tap the
  citation → the original photo opens**, implemented by **wiring existing, tested pieces** (capture store,
  quality gate, Hub nameplate, nameplate-confirm, manual-applicability, `evidence_from_visual_session`
  into `technician_context`, `origin_file_id` citation) plus the trust-state projection in the
  `machinePanel`. Behind `MIRA_CONTEXT_CONTRACT` for a clean rollback.

This proves "photograph → ask → watch it assemble → cited answer" end-to-end on real production contracts
with the least new code, on the intended unified surface, using the intended permanent demo machine — and
it is the foundation every later slice (fan-out, /m routing, public demo, live) builds on.

**No code, migrations, deploys, or merges have been made. Awaiting approval of the first slice.**

---

# Discovery notes (rolling capture — distilled per agent)

## Doctrine (agent 1) — origin/main
- **Trust-state gap:** the six-state sequence in the product direction is NOT in the corpus. Five
  overlapping vocabularies exist: L0–L3 identity maturity (`docs/specs/mira-technician-app-dogfood-system.md`
  §1.2); 6-value **evidence-basis** ladder (§1.3, exact wording below); 8-value visual-fact status
  (`docs/prd/mira-visual-technician.md` §6: VISIBLE→DOCUMENTED→MACHINE_VERIFIED/LIKELY/…); KG
  approval (`proposed→verified/rejected`); PrintSense TrustState↔approval crosswalk
  (`docs/adr/0032-ontology-foundation.md` §7 — the ONLY existing crosswalk, and lossy). **Invariant
  common to all: a model never self-promotes to the trusted end; only human confirmation (or an
  explicitly deterministic approved process) does.** → PRD must define the 6-state model as a
  *unifying projection* with a crosswalk table, retiring nothing silently.
- **Evidence-label taxonomy (reuse verbatim; persisted as `basis` on `equipment_notebook_turns`,
  CONV-1 done):** `general_reasoning` "General guidance - not grounded in this machine's documents" ·
  `identified_component` "For a PowerFlex 525 - no manual attached yet" · `oem_documentation`
  "Allen-Bradley PowerFlex 525 User Manual, p.146" · `workspace_evidence` "From your workspace" ·
  `machine_history` "Previous repair on this asset, 2026-08-02" · `live_machine_evidence` "Live PLC
  observation, 8 s old". Hard rule: never present general reasoning as OEM doc.
- **Single-voice doctrine (load-bearing):** `NORTH_STAR.md` §"Bravo runtime boundary" — specialists emit
  `EvidenceKind.*` *candidate* items via `context_contract.py::evidence_from_visual_session`; the sole
  conversational runtime is mira-pipeline/Supervisor; **no second context schema/evidence ledger/persona**.
  ADR-0033 `TechnicianContext` = the one case file; products are a `task_mode` tag, never a persona
  (status: Proposed, wired default-off, `MIRA_CONTEXT_CONTRACT`). Dogfood §1.4: "No second
  implementation of anything… a new provider cascade, safety classifier, or evidence model is a defect."
- **Already specified — extend, don't reinvent (`docs/prd/factorylm-unified-interaction-v1/part-3,5`):**
  `InteractionThread/InteractionRun/InteractionTurn`; ordered part types incl.
  `source, evidence_basis, machine_evidence, visual_observation, safety_notice, approval_request,
  observation, hypothesis, finding, artifact`; typed SSE (no fabricated streaming); additive tables
  (`workspace_projects/folders/project_items`, `interaction_threads/runs`, `project_findings`; add
  nullable `thread_id/run_id` to `equipment_notebook_turns` — **do not create a second message store**);
  shared packages `factorylm-theme / mira-interaction / factorylm-shell / factorylm-parts`;
  `SurfaceProfile` gates features but "may not redefine navigation, message parts, or component
  appearance"; **Golden Conversation** (part-4 §14 Phase 2) is the canonical acceptance flow;
  migration Phases 0–6 with instant rollback. Photo-citation-opens-original: fully specced
  `docs/prd/2026-08-26-commodity-first-mobile-prd.md` §5/§10/§19 (+ acceptance tests A/B).
- **CORE TENSION (resolve explicitly):** dogfood "constitution" = 5-tab shell, **Notebook** sole
  conversation home, "no sixth Chat tab"; unified-interaction-v1 = **Projects + New chat + threads**
  (the LIVE surface). Owner direction settles it → **unified wins; "Notebook" = a per-machine
  `InteractionThread` bound to `primaryAssetId`.** part-3 §10.2 already points this way (notebook turns
  gain `thread_id`).
- **Gaps to honor:** voice **parked** (copilot PRD §6 out-of-scope) — "speak" is aspirational;
  **camera capture broken** #3353 (opens picker, not camera) — blocks "photograph the machine";
  **live-data NO-GO: REPLAY** (render "Live unavailable", never hide); sub-brand names ("Field Lens",
  "Print Studio") are a one-voice risk if surfaced to users.
- **Do NOT resolve unilaterally (part-5 §21 deferred):** web host (app. vs factorylm.com/app), default
  project name, who edits project instructions, folder depth, default sharing, Work run templates,
  Hub/mobile React alignment. → these go under §11 Owner Decisions.

## Evidence / VisualSession / egress (agent 2) — origin/main
- **VisualSession EXISTS = the seam to reuse** (ADR-0027; migrations `063_visual_sessions.sql` + the
  authoritative `069_visual_tenant_text.sql` → `tenant_id TEXT`, NOT uuid). Code: `mira-bots/shared/visual/`
  (`models, evidence_state, session_service, store, equipment, answer_composer, quality_gate`). Six tables:
  `visual_session, evidence_item, region_of_interest, observation` (append-only ledger), `visual_question,
  answer_claim`. Hub UI `mira-hub/src/app/(hub)/visual/[id]/page.tsx`; Hub API `api/visual/sessions/...`.
  Entity/connection **candidates reuse `kg_entities`(proposed) + `wiring_connections`** — no new tables.
- **`ingest_image` lifecycle** (`session_service.py`): quality_gate.score_image (reject → `NEEDS_CONTEXT`,
  "send a clearer photo") → VisionWorker classify (`ELECTRICAL_PRINT|NAMEPLATE|EQUIPMENT_PHOTO`) →
  add_evidence_item → observations (`VISIBLE` per OCR item, `LIKELY` for prose) → branch: print →
  schematic_intelligence + print theory (`LIKELY`); nameplate/drive/panel/component → NameplateWorker +
  `equipment.resolve_equipment()` (`RESOLVED→DOCUMENTED`, `CONFLICTING→CONFLICTING`, else `NEEDS_CONTEXT`;
  "identified from nameplate; not field-verified installed"). **Sequential + mutually exclusive branches —
  NOT concurrent.** True multi-capability-per-photo is designed-not-built
  (`docs/plans/2026-07-31-visual-intake-asset-identity-manualsense-audit.md`).
- **`EvidenceState` enum** (view over existing vocab, not new): VISIBLE, DOCUMENTED, MACHINE_VERIFIED,
  LIKELY, NEEDS_CONTEXT, CONFLICTING, FIELD_VERIFICATION_REQUIRED, REJECTED, SUPERSEDED. → this is the
  richest existing basis for the "Captured→…→Connected" projection; map onto it, don't replace it.
- **TechnicianContext** (`materialized_evidence/context_contract.py`, ADR-0033 Ph3): the ONE per-answer
  case file. `EvidenceItem.trust="candidate"` default; 10 `EvidenceKind`s incl. `PRINT_OBSERVATION`.
  `evidence_from_visual_session()` promotes to `verified` ONLY if review ∈ {confirmed,corrected} — never on
  model confidence. `validate_context()` fail-closed + read-only (FORBIDDEN_ACTION_SUBSTRINGS incl.
  start/stop/reset/bypass…; `authorization_state=="read_only"` enforced). Manifest → `decision_traces.context_manifest`
  (mig 071). Flag `MIRA_CONTEXT_CONTRACT` **default OFF** (`technician_context.py::contract_enabled`).
- **⭐ CORE WIRING GAP:** `evidence_from_visual_session()` is a tested pure adapter with **ZERO production
  call sites** — `build_turn_context/augment_with_retrieval/augment_with_live` only assemble PRIOR_DECISION
  + LIVE today. A cited *visual* answer cannot reach the single MIRA policy through the documented seam.
  **Wiring this is the smallest-architecture core.**
- **Original-photo citation gap (path-split):** Hub upload route
  `mira-hub/src/app/api/visual/sessions/[id]/evidence/route.ts` stores raw `content` bytes (retrievable via
  `.../view`); the bot path `mira-bots/shared/print_workspace.py:338 → ingest_image` sets only
  `original_hash`, never `original_uri` (3 call sites) → anchored but not fetchable. Schema
  (`region_of_interest.transform_to_original`, `Observation.superseded_by`) supports it; ingest must populate URI.
- **Not materialized (ADR-0029):** VisualSession has no `dataset_version_id`/recall-before-recompute; a
  re-submitted identical photo re-runs vision. (Not verified this session: `printsense/cas.py`,
  `materialized_evidence/schema.py` — close before committing exact field names.)
- **⚠ EGRESS = OWNER GATE (ADR-0036, PROPOSED/NOT accepted, blocks the nameplate→manual merge).** Nameplate
  vision (`mira-hub/src/lib/nameplate/index.ts`, Together MiniMax) + Serper manual-discovery
  (`mira-ask /manual-discovery/search`) are OUTSIDE `AGENTS.md:18 §2` cloud policy; ship **dark**
  (`NAMEPLATE_DETECT_ENABLED=0`). Owner must pick: nameplate (A) new named exception + amend AGENTS.md/PRD§4,
  or (B) route via `inference/router.py` (whose `sanitize_context()` masks serials `[SN]` — conflicts with
  reading serials, needs a vision carve-out); manual-discovery (C) approve Serper for identity-strings-only,
  or (D) drop external, rely on ingested OEM corpus. **No public-demo egress rule exists — public demo must
  egress nothing.** → §11 Owner Decisions, top risk.

## Public demo (agent 5) — origin/main + open PRs #3815/#3828
- **`publicDemo` (#3812) is REAL & complete — reuse verbatim.** `packages/factorylm-interaction/src/types.ts`
  `PROFILES.public={publicDemo:true,…}`; `packages/factorylm-ui/src/DemoNotice.tsx` (non-dismissible "Sample
  data" strip — prevents false grounding on a machine the visitor doesn't own); `Composer.tsx` swaps
  attachments for a conversion message on publicDemo; `Sidebar.tsx` "New chat"→"Start over",
  "New project"→"Create workspace"; `ConversionIntent = sign-in|create-workspace|try-your-equipment` +
  `HostHooks.onConvert`. Branches on real `SurfaceProfile` — no bespoke landing chrome.
  `FactoryLMShell.tsx` gained a **`machinePanel?: ReactNode` slot** (#3815) for a live-machine view above the
  conversation — **the extension point the visual-assembly demo should use.**
- **Isolation = SOLVED, adopt as-is (#3815/#3828):** `simlab/api.py` default-deny `PUBLIC_DEMO_PATHS` (11
  exact segments) under `SIMLAB_PUBLIC_ONLY=1` as outermost middleware (rubric/evidence structurally
  unreachable; tested `tests/simlab/test_public_demo_trust_boundary.py`); hardened `mira-simlab` container
  (`read_only`, `cap_drop: ALL`, `mem 256m`, **no DB, no volumes, no outbound network**, loopback
  `127.0.0.1:8099`); same-origin nginx `/simlab/` proxy `rate=10r/s`; `connect-src 'self'` unchanged.
  Anonymous private-photo storage is N/A — publicDemo Composer disables uploads.
- **⭐ DEMO FORK (owner):** anonymous grounded chat is **deliberately OFF** — `POST /api/equipment-notebooks/{id}/chat`
  = `sessionOr401`; owner decision 2026-09-15 (#3815) "no anonymous chat"; signed-out ask → `conversion_prompt`,
  never an answer/citation. So "ask a grounded question + open a real citation PRE-signup" is either
  **(a)** accept shipped behavior (watch assemble → convert, no chat) as demo-v1, or **(b)** build a scoped,
  rate-limited, session-free **demo-chat** over a curated public-safe notebook (new work). **#3828** (deploy
  demo to factorylm.com, MERGEABLE, awaiting Mike) is the trigger #3815 named for revisiting. → §11.
- **⚠ SimLab ≠ visual-assembly.** The shipped public demo is **SimLab** (deterministic seeded live-SIGNAL sim
  of a Case Packer, driven live by `packages/factorylm-ui/src/useSimLabDemo.ts` poll loop — NOT a cassette).
  The owner direction "watch CV-101 **assemble** from the same typed machine-building events the real pipeline
  produces" is the **VISUAL-evidence** pipeline (VisualSession observations Captured→…→Grounded), a different
  event source. → the visual-assembly demo = a **deterministic replay of recorded VisualSession typed events**
  for a sanitized CV-101 set, rendered in the SAME shell (`publicDemo` + `machinePanel`). This replay layer is
  the one genuinely-new demo piece; everything around it is reuse.
- **Question-preservation gap:** `apps/factorylm-ui-lab/src/PublicDemo.tsx::conversionDestination` → bare
  `/login`/`/signup`, no params; signup reads none. **Reuse** `mira-hub/src/app/(hub)/workorders/new/prefill.ts`
  (`parseWorkOrderPrefill`, `?prefill_*`) → add `?prefill_question=` into `/signup`.
- Registry drift: `CAPABILITY_CLOSURE.yaml unified_ui_shell` = `canary_enabled`, "not production-default,
  Hub/public adapters unconnected" — #3828 would be its first production mount → `finish-capability` follow-up.
  Also open: **#3822** (narrow-viewport drawer bug) — prerequisite or accepted known-gap for a phone-first demo.
- No `seed_demo_plant.py` (doesn't exist); demo-tenant seed infra = `.claude/commands/mira-create-demo-plant.md`
  + `tools/seeds/run_demo_seed.py` (tenant `…0000d1`) — signed-in internal demos, NOT the anonymous public path.

## Visual capability map (agent 4) — origin/main [EXISTS/PARTIAL/MISSING]
| Capability | Status | Reuse anchor | Typed evidence | State |
|---|---|---|---|---|
| 1 Camera + canonical original store | **EXISTS** | `namespace_direct_uploads(content,content_sha256)` immutable via `mira-hub/src/lib/workspace-files.ts::parkOrReuseFile`; `mira-mobile/src/lib/native-pick.ts::capturePhoto` | content-addressed bytes | Captured |
| 2 Quality gate | EXISTS(server)/PARTIAL(client) | `mira-bots/shared/visual/quality_gate.py::score_image` (wired); `mira-hub/src/lib/nameplate/capture-quality.ts::assessCapture` (built,tested, **0 callers**) | QualityScore / CaptureAssessment | pre-Captured |
| 3 OCR | EXISTS | `printsense/xref_extractor.py::ocr_tokens`; `vision_worker.py` | bbox extracted but **region_id not persisted** on live path | Observed/VISIBLE |
| 4 Nameplate identity (#1266) | EXISTS ×2 unreconciled | Hub(mature): `mira-hub/src/lib/nameplate/{index,evidence}.ts`, `nameplate/{recognize,confirm}/route.ts`, `NameplateFact.status` | Hub ladder observed→candidate→…→technician_confirmed; **bot path writes Atlas w/ NO confirm = DEFECT** | Observed→Confirmed |
| 5 Equipment recognition | PARTIAL | `vision_worker._classify_photo` (routing only) | `{type,confidence}` routing | gate only; no appearance classifier |
| 6 Print/schematic parsing | EXISTS(prod) | `printsense/{xref_extractor,designations/,cas.py}` | candidate dicts `status:machine_proposed`, CAS-cached | Observed→Candidate |
| 7 Manual matching | EXISTS | **7b best ladder ref:** `mira-hub/src/lib/{manual-discovery,manual-applicability}.ts`, `equipment_notebook_sources.match_state` | `ApplicabilityVerdict`, `MatchState candidate→user_confirmed→verified→rejected` | **1:1 Captured→Grounded** |
| 8 Mismatch detection | EXISTS(signal)/PARTIAL(KG) | `visual/equipment.py::resolve_equipment` (CONFLICTING); ADR-0017 `contradict` trigger `proposal_transition.py::apply_kg_approval` (**0 callers**) | EquipmentResolution CONFLICTING | blocks promotion |
| 9 Citation→ORIGINAL photo | **EXISTS ×2** | **(A) SHIPPED notebook:** migs 084/085 `origin_file_id→namespace_direct_uploads`, `ChatCitation.originFileId`, chat route + `NotebookScreen`, regression-tested. (B) `evidence_item/region_of_interest` bbox | originFileId (doc) / geometry (bbox) | Confirmed/Grounded |
| 10 Concurrent fan-out/photo | PARTIAL | `vision_worker.process` gathers vision+ocr+floor → ONE classification; `ingest_image` **sequential+branch-exclusive**, Telegram-only | VisualSession ledger shaped for fan-out, not fanned out | — |
| Confirm gate cand→verified | EXISTS ×2 | generic KG `proposal-transition.ts` (only kg_edge wired of 6); nameplate-confirm (stops at citable, refuses identity write) | ai_suggestions/kg approval_state; match_state | Candidate→Confirmed |

**Reuse as-is:** capture store, `score_image`, printsense engine (CAS-cached), `manual-applicability`/`MatchState` (the ladder reference), `origin_file_id` (citation→original, shipped). **Thin adapter:** wire `assessCapture` pre-upload; persist OCR `region_id`; fire the existing `contradict` trigger (call `apply_kg_approval`). **Genuinely MISSING:** (a) a **unified trust-state vocabulary** (Captured→…→Connected has 0 repo hits — 3 real ladders: `EvidenceState`, `NameplateFact.status`, `MatchState` → PRD must crosswalk); (b) **true concurrent multi-capability fan-out over one photo** (today sequential/exclusive, only Telegram → `ingest_image`; mobile recognize/LOOK never touch VisualSessionService — **3 disconnected photo surfaces + an unused `/api/visual/sessions`**); (c) appearance-based equipment recognition; (d) KG-level mismatch consequences; (e) a **single confirm path camera→verified asset/KG**; (f) **CAS recall on the live photo turn** (`vision_worker` re-runs OCR/vision every turn — ME rule-1 violation). **DEFECT:** bot-side `engine.py::_handle_nameplate` writes Atlas CMMS with no confirmation.
