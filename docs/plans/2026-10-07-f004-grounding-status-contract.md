# F004 contract proposal: separate retrieval and citation status, and require a tap before falling back on the phone

**Status:** proposal only. No code has been implemented; this document authorizes no implementation, spend, merge or deploy. Each step in §7 needs separate approval.
**Base:** `main` @ `f83e9df255533e7c09d3f6b40e72e8aacfc91b44`. Design reference: draft PR #4303.
**Risk class:** R2. It changes a shared contract and two client surfaces. It needs no migration, no tenant-filter change and no safety-policy change.

## 0. What F004 does and does not establish

The exact cause of the two observed F004 turns is still **unresolved**. Three candidates remain open, and none is proven:

- **B:** passages were retrieved, the model answered without citing them, and the turn was labelled general.
- **A2:** passages were retrieved, the model refused, and the phone silently re-asked in general mode.
- **A1:** the scope missed, so zero passages came back and the phone silently re-asked.

Two sources would settle it:

- the per-turn rows (`answer_status`, `basis`, source counts), which need `factorylm/stg` access;
- the staging `jev-shadow-report` CSV for 2026-10-06 22:00Z to 2026-10-07 00:24Z. The 06:17Z run on 2026-10-07 covers that window, but downloading its artifact from this container is blocked.

**This proposal does not depend on knowing which candidate it was.** In all three the server discards *why* the turn ended, and in A1 and A2 the phone then changes mode without telling the technician. The proposal fixes that contract; it does not claim to fix F004 retrieval quality.

## 1. Two statuses, never merged

Both statuses are carried in one persisted evidence entry. It contains ids and counts only, never chunk text:

```ts
// mira-hub/src/capabilities/grounding-status.ts (new, unguarded)
type RetrievalStatus =
  | "passages_found"        // ≥1 chunk from the validated in-scope doc set entered the prompt
  | "no_passages_in_scope"  // retrieval ran, returned 0 → today's abstain gate (route.ts L2599)
  | "not_attempted";        // general mode or no node: the selected manual was NOT consulted

type CitationStatus =
  | "validated"      // ≥1 [n] marker resolved to a chunk that was retrieved in scope this turn
  | "uncited"        // an answer was produced with no resolvable marker
  | "refused"        // model output matched the refusal verdict → insufficient_evidence (L3521/L3676)
  | "not_applicable";// no model call (abstain) or not_attempted retrieval

interface GroundingStatusEntry {
  kind: "grounding_status";
  v: 1;
  retrieval: {
    status: RetrievalStatus;
    reason?: "general_mode" | "no_node";   // only when not_attempted
    passageCount: number;                    // chunks that entered the prompt
    docIds: string[];                        // returned doc ids (≤32, same cap as the trace)
  };
  citation: {
    status: CitationStatus;
    citedDocIds: string[];
    unresolvedMarkerCount: number;           // [n] markers silently dropped today
  };
  grounded: boolean;                         // === (citation.status === "validated"), derived, never set independently
  fallbackOf?: string;                       // turn id of the failed manual-based attempt this general turn replaced
  retrievalFailed?: true;                    // OEM branch only: carries the existing oemRetrievalFailed (§1 rule 5)
}
```

Rules:

1. `grounded` is true **only** when `citation.status === "validated"`. If passages reached the prompt but the answer has no validated citation, the turn is `passages_found` + `uncited`, so `grounded` is false, whatever `basis` says.
2. "Validated" means a citation marker **resolves** to an in-scope retrieved chunk. It does **not** prove that the passage supports the claim. Semantic support remains the job of the existing groundedness scorer, and this contract does not claim to replace it (see test T3b).
3. `basis` keeps its migration-084 enum and its current derivation. The status entry adds a reason to `basis`; it does not change `basis`. A new `basis` value would need a migration because of the 084 CHECK, so none is added.
4. `answer_status` (073 CHECK: `answered | insufficient_evidence | error`) is unchanged.
5. **Retrieval errors.** Today the notebook-retrieval path at L1922 runs inside `releaseClaimOnFailure`: an error abandons the claim, returns an HTTP error before streaming, and persists **no turn**. The contract keeps that behavior, because no answer is better than an unlabelled one. The proposal adds no `retrieval_error` status to a persisted row: there is no row to carry it. That part of the path is pinned by test (T5).
   - The OEM-corpus branch (L1907) works differently. It catches the error, sets `oemRetrievalFailed`, and continues with `[]`. That turn persists `retrieval.status = "no_passages_in_scope"` plus `retrievalFailed: true`. This is the one optional additive field: it carries the existing `oemRetrievalFailed` value forward instead of dropping it.

## 2. Example outcomes

| Case | answer_status | basis (unchanged rule) | retrieval | citation | grounded | Phone shows |
|---|---|---|---|---|---|---|
| Manual passage cited `[1]` | answered | oem_documentation / workspace_evidence | passages_found, 1–6 | validated, citedDocIds=[DOC_A] | true | answer + citations (as today) |
| F004 candidate B: passages found, answer has no `[n]` | answered | general_reasoning | passages_found, n | uncited | **false** | answer + "Your manual was searched, but this answer doesn't cite it. Treat it as general guidance." |
| Irrelevant passages, model answers anyway with no `[n]` | answered | general_reasoning | passages_found | uncited | false | same as above |
| Answer has only `[7]` against 3 chunks | answered | general_reasoning | passages_found | uncited, unresolvedMarkerCount=1 | false | same as above |
| F004 candidate A2: passages found, model refuses | insufficient_evidence | null | passages_found | refused | false | failed bubble kept + "The manual was searched but didn't answer this." + **[Answer without the manual]** |
| F004 candidate A1: zero passages in scope | insufficient_evidence | null (no model call) | no_passages_in_scope, 0 | not_applicable | false | failed bubble kept + "Nothing in the selected manual matched." + **[Answer without the manual]** |
| Technician taps the fallback | answered | general_reasoning | not_attempted, reason=general_mode | uncited or not_applicable | false | new general answer, linked `fallbackOf=<failed turn id>`, labelled "General guidance, not from your manual" |
| Notebook retrieval throws | (no turn) | — | — | — | — | error with retry (as today), no answer |
| Turn saved before this change | any | as stored | **absent** | absent | **unknown** (never inferred true) | exactly what it shows today |

## 3. One carrier for live responses, saved history and replay

- **Live response:** the route emits the entry as its **own SSE frame**, byte-identical to the saved entry (`{kind:"grounding_status", …}`). It is not a field on the existing evidence frame. *(Corrected after checking: the phone's `sse.ts` copies only known fields off the evidence frame, so a `grounding` field there would be dropped. Reading it would need an edit to that frozen file. A frame kind the phone doesn't know already arrives intact as `unknownFrames` (`sse.ts` L87/L172 → `turns-to-parts.ts` L364), so the unguarded unified adapter can pick it up with no `sse.ts` change.)*
- **Web live view:** the web stream parser (`mira-hub/src/components/equipment/notebook-chat-utils.ts` L243-267) is **guarded** and ignores unknown frames. But `hub-host.tsx` L422 reloads the saved turns right after every send, so web shows the status from the saved entry as soon as the answer finishes, with no guarded edit. It is not shown while the answer is still streaming; that is accepted and stated.
- **Saved history:** the same object is appended to `equipment_notebook_turns.evidence` (JSONB) by the existing `recordTurn` calls: the normal persist step at L3863, the stopped-turn persist at L3441, and the abstain persist at L2652. A stopped turn records `citation.status = "not_applicable"`, `grounded = false`. `listTurns` already returns `evidence` as-is, so its SQL does not change.
- **Replay:** `replayNotebookTurnResponse` (L719-819) reads the persisted entry and puts it on the replayed frame. Live, reload and replay are therefore built from one object, written once, and tests can compare them directly.
- **One builder:** `buildGroundingStatus({retrievalRan, reason, chunks, emittedCitations, unresolvedMarkers, refusal, modelCalled})` in `capabilities/grounding-status.ts` is the only producer. It is pure and has its own unit test.

### Compatibility, verified by reading the code (not assumed)

- **No migration.** `evidence` is `JSONB NOT NULL DEFAULT '[]'` and has no CHECK (073 L96). The only CHECK in 073 is on `answer_status`; the 084 CHECK is on `basis`, which this proposal doesn't touch. Every server-side reader of `evidence` selects entries by predicate, so they ignore the new kind:
  - replay (L721: string `docId`);
  - the prior-look loop (L1399);
  - `enrichCitationsWithOrigin`;
  - the request-claim SQL (`e->>'kind' = 'safety_stop'`, `equipment-notebooks.ts` L1329-1371);
  - hub `to-interaction` (`identityProposalOf`, `hasIdentityDispute`);
  - part-search-claim.

  A real-database insert test is not possible from scratch: the migration directory has no base-table bootstrap (the 003 `knowledge_entries` gap), so this evidence comes from reading the code.
- **⚠ Compatibility hazard on installed phone builds (found and verified).**
  1. Mobile `unknownEvidenceEntries` (`turns-to-parts.ts` L32-45) passes through only these evidence kinds: citations, `machine_evidence`, `visual_observation`, `safety_notice`, `safety_stop` and `identity_dispute`. Any other kind becomes a `{type:"unknown", raw}` part (L214/L274).
  2. On the unified shell, `unifiedPart` → `unknownInteractionPart` (`unified/to-interaction.ts` L247-281) gives that part to `PartRenderer`, which shows a visible "Unrecognized part (preserved for inspection)" `<details>` containing the JSON (`packages/factorylm-ui/src/parts.tsx` L621-631).
  3. The classic runtime maps it to `data-unknown`, for which there is no renderer.

  **Consequence:** if the server writes the entry before the phone update reaches installed devices, technicians see a raw JSON box on every new turn.

  **Mitigation, which sets the order:**
  1. The phone change ships first. `unknownInteractionPart` recognises `raw.kind === "grounding_status"` the same way it already recognises `identity_proposal` and `manual_search_status`. That file is unguarded and needs no edit to the guarded `turns-to-parts.ts`.
  2. The server starts writing the entry only after that update is live. It goes behind the server flag `NOTEBOOK_GROUNDING_STATUS_ENABLED`, default off. The flag is the rollout switch, and is recorded in `CAPABILITY_CLOSURE.yaml` per the finish-capability rule.
  3. Test T9 pins that an installed-build-shaped turn with the entry renders no "unknown" part.
- **Web (`/v3` hub).** Hub `to-interaction` does not turn unrecognised evidence kinds into unknown parts, so the entry is ignored until it is used.

## 4. Phone behavior

Current behavior: `NotebookScreen.sendQuestion` L392-409 re-asks silently. Five conditions trigger it:

- `!replay`
- `!notebook.asset`
- `body.mode === undefined`, which means scope was non-empty, so an applicable manual was selected
- `!truncated`
- `status === "insufficient_evidence"`

In that case the phone re-asks with `{scope: [], mode: "general"}`. The failed bubble is replaced and the attempts are not linked. This is intentional behavior from #3862/#3742 and is pinned by `mira-mobile/src/screens/__tests__/notebook-composer.test.tsx` L240.

Proposed behavior, which is an **intentional reversal** of that test:

1. When an applicable manual was selected and the result is `insufficient_evidence`, the phone does **not** re-ask. The failed bubble stays in the thread.
2. Under it, the phone shows a plain-language explanation derived from `grounding`:
   - `no_passages_in_scope` → "Nothing in <manual> matched this question."
   - `refused` → "<manual> was searched but didn't answer this."
   - grounding missing (older server) → "<manual> didn't answer this."
3. The phone shows one explicit action: **"Answer without the manual (general guidance)"**. Tapping it sends `{scope: [], mode: "general", clientRequestId: <new>, fallbackOf: <failed turn id>}`. The server validates that `fallbackOf` is a turn in the **same notebook, tenant and owner** (tenant isolation), then persists it on the new turn's grounding entry. If validation fails, it answers 400 (`fallback_of_invalid`) without calling the model.
4. The general answer is labelled "General guidance, not from your manual". This uses the existing `general_reasoning` caption, plus the link back to the failed attempt.
5. If no applicable manual was selected (the scope was empty to begin with), behavior is unchanged.
6. **Trade-off to accept or reject.** The test name at L240 shows the auto re-ask was built for *general* questions asked with a manual attached (e.g. "what does a VFD do"). After this change those also need one tap. That is the cost of never silently switching modes.

Ownership of the phone change:

- The guarded `NotebookScreen.tsx` change is **removing** the auto branch and passing `fallbackOf` through `handlers`.
  - It removes a hidden behavior; it does not add a new legacy feature.
  - It still needs a `## Lifecycle guard rationale` and an exact-head Codex GREEN.
- The explanation and button render in the unguarded `UnifiedChat.tsx` / `unified/*`.
- A shared part change in `packages/factorylm-ui` / `packages/factorylm-interaction` is required for the button. Those packages are a one-writer lane, so check `[WORK-CLAIM]` on #3626 before claiming.

## 5. Exact files affected

| File | Change | Guarded? |
|---|---|---|
| `mira-hub/src/capabilities/grounding-status.ts` (new) | pure builder + types | no |
| `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` | count unresolved markers next to `citationsUsedInAnswer`; call builder at L2652 (abstain), L3441 (stopped), L3863 (persist), replay L719-819; validate `fallbackOf`; behind flag | no |
| `mira-hub/src/lib/notebook-chat-types.ts` | new `NotebookGroundingStatusFrame` in the frame union; `fallbackOf?` on request body | no |
| `mira-hub/src/lib/equipment-notebooks.ts` | type only (`evidence` already passed through); helper to look up `fallbackOf` turn scoped by tenant+notebook+owner | no |
| `mira-hub/src/factorylm-ui/to-interaction.ts` | read `grounding` → caption for uncited / refused | no |
| `packages/factorylm-interaction/src/types.ts` | optional `grounding` on `EvidenceBasis` + fallback action | shared lane (claim) |
| `packages/factorylm-ui/src/parts.tsx` | render explanation + explicit fallback button | shared lane (claim) |
| `mira-mobile/src/unified/to-interaction.ts` | recognise `grounding_status` raw kind (ships first) | no |
| `mira-mobile/src/screens/UnifiedChat.tsx` | wire fallback action → handler | no |
| `mira-mobile/src/screens/NotebookScreen.tsx` | remove silent re-ask; send `fallbackOf` | **yes** — rationale + Codex GREEN |
| `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml` | flag record | no |

Not touched: providers, prompts, the refusal verdict text set, safety policy, retrieval ranking, `retrieveNodeChunks`, migrations, SDLC tooling, coding-agent orchestration.

## 6. Red-first tests

Each test is written first and shown failing on `main` for the reason it names (the counts get recorded), then shown green. For the guards, a mutation is reapplied to prove the test bites. The harness is the one already proven in `f004-characterization.scratch.test.ts`: 7/7 pass on main, and mutations M1–M4 plus the refusal mutation each turned the intended test red.

**Hub route:** `mira-hub/src/app/api/equipment-notebooks/__tests__/chat-grounding-status.test.ts`

- **T1, cited relevant passage.** One chunk is returned and the model answers with `[1]`. Expect: `retrieval.passages_found`, `citation.validated`, `grounded=true`, `citedDocIds=[DOC_A]`.
  - *Red on main:* no `grounding` on the frame or the persisted evidence.
  - *Mutation:* derive `grounded` from `passageCount > 0` → T2 goes red.
- **T2, retrieved but uncited (F004 candidate B).** Chunk returned, answer with no `[n]`. Expect: `basis` is still `general_reasoning` (control: unchanged), `passages_found`, `uncited`, `grounded=false`.
- **T3, irrelevant passages.** The chunk is about F012 and the answer is uncited. Expect `uncited`, `grounded=false`.
- **T3b, limitation pin.** The chunk is about F012 and the answer still writes `[1]`. Expect `validated`. This test exists to document that marker validation does not measure relevance; it must not be read as proof of grounding.
- **T3c, unresolved marker.** The answer cites `[7]` with 3 chunks. Expect `uncited`, `unresolvedMarkerCount=1`.
- **T4, refusal (A2).** The refusal text from the scratch test. Expect `insufficient_evidence`, `passages_found`, `refused`, and that a model call happened.
- **T4b, abstain (A1).** Zero chunks. Expect `no_passages_in_scope`, `not_applicable`, no `fetch`, `model:null`, and that the entry was persisted through the abstain `recordTurn`.
- **T5, retrieval error.** `retrieveNodeChunks` rejects. Expect: no provider call, no persisted `answered` row, claim abandoned, error response.
  - *Characterization (green on main, kept as a guard):* mutating the code to catch the error and continue must turn this test red.
  - *Control:* the OEM-branch failure continues, with `retrievalFailed: true`.
- **T6, explicit mode switch.** `mode:"general"` + `fallbackOf=<turn in same notebook>`. Expect: retrieval not called, `not_attempted/general_mode`, `fallbackOf` persisted.
  - *Control:* without `fallbackOf`, everything else behaves the same.
- **T7, tenant isolation.**
  - `fallbackOf` pointing at a turn in another tenant → 400 `fallback_of_invalid`, no model call.
  - Turn in another notebook of the same tenant → 400.
  - Another owner → 400.
  - *Control:* same tenant, notebook and owner → 200.
  - Re-run the existing scratch TENANT test to confirm retrieval still uses `ctx.tenantId`.
- **T8, live = reload = replay.** For T1, T2, T4 and T4b, three objects must match field for field:
  - the `grounding` on the live frame;
  - the entry in `recordTurn`'s evidence argument (which is what `listTurns` returns);
  - the `grounding` on the replay frame (same `clientRequestId`).
  - *Mutation:* make the replay path recompute instead of reading the stored entry → this test goes red.
- **T8d, stopped turn.** The client stops mid-answer after passages were retrieved. Expect `not_applicable` and `grounded=false` on the L3441 row.
- **T8b, legacy turn.** A persisted row with no entry replays with `grounding` absent and is never marked grounded.
- **T8c, flag off.** Frames and evidence are byte-identical to today. This control proves the server-off rollout is inert.

**Pure builder:** `mira-hub/src/capabilities/__tests__/grounding-status.test.ts`

- Every row of the §2 table.
- The `grounded` derivation property: true if and only if `validated`.
- `docIds` capped at 32.
- No `content` field anywhere in the output (ids and counts only).

**Mobile:**

- **T9.** `mira-mobile/src/unified/__tests__/to-interaction.grounding.test.ts`: a turn with a `grounding_status` entry produces **no** `unknown` part.
  - *Red on main:* today it shows the "Unrecognized part" box.
- **T10.** Rewrite `notebook-composer.test.tsx` L240 (the intentional reversal; its opposite-direction test at L271 stays unchanged as a control):
  - with a manual selected and `insufficient_evidence`, exactly **one** POST is sent;
  - the failed bubble stays;
  - the fallback button is visible.
- **T11.** Tapping the button sends a second POST with `mode:"general"`, `scope:[]`, a **new** `clientRequestId`, and `fallbackOf=<first turn id>`. Both bubbles stay.
- **T12, control.**
  - Empty scope: behavior is unchanged.
  - `notebook.asset` bound: behavior is unchanged.
  - Replay path: no button, no auto POST.

**Hub web:** `mira-hub/src/factorylm-ui/to-interaction.test.ts`

- The uncited and refused captions render.
- A legacy turn without `grounding` renders exactly as it does today (snapshot control).

## 7. Order, gates, and what this does not cover

1. Write the tests red-first and record the counts.
2. Ship the builder plus the server, with the flag off; T8c proves the flag-off path is inert.
3. Ship the phone recogniser (T9) by OTA.
4. Ship the phone and shared-UI fallback change: the lifecycle rationale plus a Codex exact-head GREEN for the `NotebookScreen.tsx` change.
5. Turn the flag on in staging and run the stranger walk on an emulator (`tools/mobile-e2e/`).
6. Promote to production.

Each step is a separate PR with a `Risk:` line and needs separate approval.

This proposal does **not**:

- determine the F004 cause;
- improve retrieval;
- change which passages are found;
- assess semantic relevance.

Once the staging rows or the CSV are available, the `grounding` entry on future turns will make the next failure like F004 diagnosable from the turn row alone.
