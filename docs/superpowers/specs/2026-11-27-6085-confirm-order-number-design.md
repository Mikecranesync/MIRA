# #6085: the technician confirms the order number on the identity card

Status: design approved by Mike 2026-11-27 (asked in session). Written spec approved 2026-11-27 with **Option A** (§4.3, the one-line parser edit).
Branch: `bravo/6085-confirm-number`. Base: `8571e1215`. Claim: #6085, comment 7206432024.

## 1. Problem

The thread status scope (#5750, shipped in #5746) withholds the manual lookup status in a thread that is about another model. It decides this from the thread's wording.

- **The walk failure.** #5746's post-merge staging walk (2026-11-27) typed "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up".
  - The card proposed Siemens TP700, and the technician pressed Use its manuals.
  - The scope then found `6AV2124-0GC01-0AX0` in that same question. That number is not one of the confirmed machine's identifiers, so it classed the thread as being about another model.
  - The lookup outcome never showed in the thread where the technician asked for it.
- **Why prod is held.** Prod (37bedcf46) has no scoping, so this is a regression, and #5746 stays out of prod until it is fixed.
- **Why #6094 was closed.** It tried to settle the question by re-reading the card's question, and two Codex rounds each found a HIGH:
  - F1: a card number overriding a confirmed catalog number.
  - F7: a card adopting a neighbouring machine's number ("sits next to a 6AV2124-0JC01-0AX0").
  - Both came from the same root cause. Two readers, the proposer and the scope, disagree about the same text, so the code has to guess which number belongs to the machine. Any guess has another phrasing that defeats it.

## 2. Decisions (Mike, 2026-11-27, asked in session)

1. Stop guessing: the technician confirms the number.
2. The confirmed number is stored separately from the catalog number. Saving it as the catalog number would change the manual search (it becomes an exact-part query), the search key (it would orphan a search started before the confirm), reviewed manual matching (ACS355-03E-07A3-4 stops matching the reviewed ACS355 manual) and answer grounding. A separate field changes only the status scope.
3. The card shows the number beside a tick box that starts **unticked**. A careless tap never saves a neighbour's number.
4. The shared UI files wait their turn in the #3626 queue (comment 7208915318); everything else goes ahead.

## 3. Goals and non-goals

Goals:
- When the technician ticks the number on the identity card, the thread that produced the card shows that machine's lookup status.
- The number the card offers is worked out by the status scope's own reader, so the card and the scope can never disagree about the number again.
- No catalog number, lookup key, manual search, manual matching, retrieval or answer path changes.
- A failed read or write of the new data falls back to today's behaviour, never to a broken notebook.

Non-goals:
- Reading numbers from photos. The scope reads typed questions only, and #5671 owns photo models.
- Adding a number after the identity is confirmed. Cards appear only on a notebook with no identity, as the chat route's `!(nb.manufacturer || nb.model)` gate already ensures.
- Changing legacy presentation. Legacy surfaces show no tick box and confirm exactly as today.
- #6096 (Micro820 read as "820"). That is a different reader disagreement, and it stays open.

## 4. Design

### 4.1 The offered number (server)

A new exported helper in `mira-hub/src/capabilities/notebook-manual-acquisition.ts`, `offeredOwnNumber(question, identity)`, sits beside `threadStatusScope`. It asks the scope itself which number would settle the question, so the card and the scope cannot disagree. It returns the one number to offer, or null:

1. **The question must be withheld today.** With the proposed maker and model and no number, `threadStatusScope([question], …)` must return `other`. Otherwise there is nothing to fix, so return null.
2. **Candidates are the technician's own tokens.** These are the question's whitespace-delimited tokens, with surrounding brackets and trailing punctuation stripped, that contain a digit and are at most 64 characters. More than 20 such tokens, or a question over 500 characters: return null (bounded cost; the scope's cost grows faster than the text, and a 4,000-character paste took over a second for 20 scope calls).
3. **A candidate fixes the question** when `threadStatusScope([question], …)` with that one token as a confirmed number returns `own`.
4. **Exactly one candidate must fix it.** With zero or several, return null.
   - Another maker in the question: no candidate fixes it, because the maker check classes the thread as other whatever number is confirmed.
   - Two numbers: confirming one leaves the other, so neither fixes it.
   - The same number spelled with and without hyphens: only the hyphenated one is an order number (see 4.6), so it alone fixes the question and is offered.
5. **Display form.** The offered value is the fixing token as typed, never a normalised string.

Revision (2026-11-27, final review): a confirmed value counts only as the hyphenated order numbers written in it (4.6). Before this, a model name or a network could be offered and saved ("TP900" typed beside a TP700, "DH-485", the family name on an abstained manual request), and a ticked "TP900" would have made every TP900 thread in the TP700 notebook own, with no undo. Because one reader decides both, the offer stopped offering those values without any change to the offer itself. The cost: a number typed with no hyphens is never offered.

The route calls the helper inside a try/catch. A throw leaves the card without `offeredNumber` and logs one line; the turn answers as before.

Implementation note (2026-11-27, plan stage): an earlier draft read the candidates from the scope's internal identifier set (`modelsNamedIn`). One typed number can produce several identifiers there, so a draft that required exactly one identifier could offer nothing for the walk question. Asking the scope with the technician's own tokens has the same contract with one reader instead of two.

The chat route calls it once, from the typed `message`, wherever it builds the `identity_proposal` frame, and adds the result to the frame as `offeredNumber` when it is not null. The frame is persisted with the turn, as today, so a history reload shows the same card.

Type changes:
- `NotebookIdentityProposalFrame` and `NotebookIdentityProposalEvent` gain `offeredNumber?: string`.
- The frame validator in `mira-hub/src/lib/notebook-chat-types.ts` rejects a non-string `offeredNumber`, the same way it handles `catalogNumber`.

### 4.2 The card (shared UI, after the #3626 claim)

- `packages/factorylm-interaction/src/types.ts`: `IdentityProposal` gains `offeredNumber?: string` and `confirmedNumber?: string`.
- `packages/factorylm-ui/src/parts.tsx`, `IdentityProposalPart`:
  - When the card is live and `offeredNumber` is present, it renders a native checkbox, unticked, labelled "`<number>` is this machine's number".
  - "Use its manuals" passes `confirmedNumber` to `onConfirmIdentity` only when the box is ticked.
  - Settled cards (confirmed, rejected, superseded) render as today, with no box. The result line stays the server's copy.
  - Revision (Codex round 1, F2): the tick belongs to one send. The host adapter stamps the card with `tickKey`, the send's request id. The card keeps its choice per tick key, maker, model and offered number, and remembers a ticked or unticked choice for the page's lifetime, so the saved copy that replaces the streamed card keeps the tick even when it remounts or moves to another position. A different offered number, or another send's card in the same position, starts unticked. `tickKey` is never sent to the server.
- The checkbox uses the existing card tokens. No new colour is introduced.

### 4.3 Adapters and the live stream

**Hub, saved card (not guarded).**
- `mira-hub/src/factorylm-ui/to-interaction.ts` carries `offeredNumber` from the persisted entry (`identityProposalOf`).
- Once a send finishes, the saved row replaces the live turn: `hub-host.tsx` sets `livePersisted`, `liveTurns` becomes empty, and `turnsFromPersisted` renders the card.
- `hub-host.tsx`'s `onConfirmIdentity` adds `confirmedNumber` to the request body when present.

**Hub, live card: the stream parser is guarded.**

The new Hub shell reads the live stream through `readNotebookStream` in `mira-hub/src/components/equipment/notebook-chat-utils.ts`. That file is guarded legacy (checked with `path_is_guarded` from origin/main). Its `identity_proposal` branch copies `manufacturer`, `model` and `catalogNumber` only, so the live card can't receive `offeredNumber` without an edit there. Two options; Mike picks one at spec review:

- **Option A (recommended): a one-line edit to the parser.** It also copies `offeredNumber`, with the lifecycle guard rationale. The live card shows the box at once.
  - This is a decoder field for the canonical shell, not new legacy presentation; the legacy chat page never renders it.
  - Precedent: #6056 added `manualSafetyStatement` to the same frame loop, and its Codex review covered that file with 0 BLOCKER.
  - The risk is a reviewer who reads it as legacy expansion, which would be a BLOCKER.
- **Option B: no parser edit.** The box comes only from the saved card.
  - In the short gap between the end of the answer and the detail reload, the live card has no box.
  - A tap in that gap confirms without a number: this fails closed, the same as leaving the box unticked.

**Mobile (not guarded).**
- The raw frame JSON reaches the canonical adapter whole (`unknownInteractionPart`), so `mira-mobile/src/unified/to-interaction.ts` carries `offeredNumber` with no guarded edit.
- `mira-mobile/src/api/identity-confirm.ts` adds `confirmedNumber` to the body.
- Both ship only through the separate, dispatch-only OTA release.

**Tick keys (revision, Codex round 1, F2).** Both hosts render the assistant surface, where assistant-ui keeps message components by position, not by turn id. So each adapter stamps the identity card with `tickKey`, the send's request id: the Hub from the live request id and the saved row's `clientRequestId`; mobile from the same pair, in `UnifiedChat` (`answerTickKeys`, `withTickKeys`). The streamed card and its saved copy then share one key.

**Legacy surfaces.** The legacy Hub chat page and legacy mobile screens don't render `offeredNumber`. They confirm without a number, as today.

### 4.4 Storage: migration 118

```sql
BEGIN;
ALTER TABLE equipment_notebooks
  ADD COLUMN IF NOT EXISTS confirmed_numbers JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
```

- **What the migration changes.**
  - It is additive. It adds no table, policy or index.
  - The table's existing grants cover the new column (the plan verifies this on staging).
  - The revoke trigger (`equipment_notebooks_revoke_auto_manuals`, migration 101) fires only on `UPDATE OF manufacturer, model, catalog_number, identity_status`, so a write to this column never touches search state. It is the only trigger on `equipment_notebooks` in any migration (checked across `mira-hub/db/migrations/` on origin/main).
- **Entry shape.** Each entry is `{ "number": "<display form>", "code": "<order number>", "manufacturer": "<confirmed>", "model": "<confirmed>", "confirmedAt": "<iso>" }`. Storing the identity with the number lets the reader ignore numbers saved for an identity the notebook no longer has, for example after a notebook PATCH changes the model. Revision (round 3 pre-screens): the list is also replaced whenever a confirm settles the identity (below), and emptied by a notebook PATCH that writes the identity status or source by hand (API only; no shipped client sends one), so a number never outlives the settling it was ticked on. No other identity writer has to clear the list: a nameplate photo writes source `nameplate_image`, which never counts a ticked number, and a create starts with none.
- **The write.** Revision (Codex round 2, F3 and F4): the number is decided inside the identity confirm's own transaction, not in a second one after it. `confirmNotebookIdentity(tenantId, notebookId, identity, number)`:
  1. locks the row (`SELECT … FOR UPDATE`) and reads whether the identity card already settled the identity: the same predicate the confirm guard uses (`SETTLED_IDENTITY_SQL`) and source `user` (round 3 pre-screen: a nameplate photo settles without the card);
  2. writes the identity with the unchanged guarded `UPDATE`;
  3. calls `recordConfirmedNumber` on the same client, under its own savepoint, on every confirm that settles the identity, ticked or not, and on a ticked confirm of an identity the card already settled.
- **What `recordConfirmedNumber` decides.**
  - A confirm that settles the identity replaces the list with exactly its tick, or none (round 3 pre-screen). So an identity reopened by a notebook PATCH and settled again never brings an old number back, even when it comes back the same.
  - Only the confirm that settles the identity may add a number. If the card settled the identity before this confirm, nothing changes: a retry of the number already saved for this machine is still a success, and anything else is refused. So a stale second card for the same machine cannot add or clear a number, whichever box the first confirm left (round 2, F3), and the list holds at most one number (round 1, F3).
  - Only entries carrying a `code` count (round 1, F4), so an entry the scope cannot use never blocks or stands in for one it can.
  - Any failure rolls back to the savepoint, is logged, and is reported as not saved. A missing column (a Hub deployed before migration 118, where every read fails closed) ends there and the identity still commits.
  - Revision (round 3 pre-screen 3, the reviewer's gap): any other failure on a confirm that settles the identity then empties the list outside the savepoint, so the identity commits with no number rather than over one an earlier identity left. If even that write fails, the confirm fails and nothing commits; the route answers 500 and the card shows its retryable "Could not confirm." The same rule holds for the PATCH clear: a missing column is logged and the PATCH succeeds, any other failure fails the PATCH. A number the database cannot store (a NUL byte, sent only by a direct API call) is one way to reach the first case.
- **A catalog number refuses the tick** (round 2, F4). A machine with a catalog number never reads ticked numbers, so a confirm that writes one reports the number as not saved and touches nothing. A catalog edit from Settings takes the same row lock, so it is ordered before or after the confirm and can no longer land between the identity write and the number decision.
- **The migration file is fixed once pushed.** Draft it against a throwaway Postgres first. `migration-verify.yml` applies the first pushed version to the persistent staging branch, and after that the file is immutable (`.claude/rules/mira-hub-migrations.md` §8).

### 4.5 The confirm route

`mira-hub/src/app/api/equipment-notebooks/[id]/identity/confirm/route.ts`:

- **Reading the number.** It reads `confirmedNumber` with the existing `readString`. Revision (Codex round 1, F1): it accepts the number only when the value is at most 64 characters and `singleOrderNumber` reads exactly one hyphenated order number from it, the same reader the status scope uses for saved values. Any other value (blank, no digit, whitespace, two numbers joined, a number joined to a model, no hyphens) is ignored, and the identity is still confirmed.
- **The identity confirm.** It is unchanged. `catalogNumber` is still written as sent (`""` for text cards), and the lookup key and the search are unchanged.
- **Saving the number.** Revision (Codex round 2): the route hands the accepted number to `confirmNotebookIdentity`, which decides it in the confirm's own transaction (§4.4). With nothing ticked, the route makes exactly the call it always made. When a number was sent, the response gains `numberSaved: boolean`, which is true only when the confirm says it saved the number; a refused or failed number is `false`, and the identity is confirmed either way, with no number for a failed one (the one exception, a write that cannot even empty the numbers, fails the confirm: §4.4).
- **When the confirm is refused.** On a 409 (`identity_already_confirmed`) or a failed confirm, nothing is saved.
- **The route does not check that a card offered the number.** It is the technician's own statement about their own notebook, and only the display scope reads it.

### 4.6 The status scope

- **`threadStatusScope`.** The `machine` argument gains `confirmedNumbers?: readonly string[]`. Each one adds only the hyphenated order numbers written in it (the scope's existing catalog-code reader). Revision (Codex round 1, F1): a saved value counts only when it is exactly one order number (`singleOrderNumber`); a value joining two numbers, or a number and a model, adds nothing. It never adds a model name, so a mistaken tick can make no model's threads own. Ticked numbers count only while the notebook has no confirmed catalog number: a catalog set later (a notebook PATCH keeps the identity confirmed) is the machine's number, and wins (fail closed, the rule Mike set for #6094 r1 F1). The model and catalog number join `own` as before.
- **Revision (Codex round 3, F6): a saved value counts only when it is the card's own machine's number (`machineOrderNumber`).** A PLC model passes the one-order-number rule ("S7-1200" reads as one hyphenated code). Typed with a typographic hyphen beside a TP700 panel, it was offered and saved as the panel's number, and every later S7-1200 thread in the notebook became own. A value now counts only when the existing readers tie it to the card's machine: its first group is the card's model (ACS355-03E-07A3-4 on an ACS355, GS11N-20P2 on a GS11N), or it is a Siemens panel number that the proposer's own pairing (`panelOrderNumberPairs`, `sameMachine` in `identity-proposal.ts`) ties to the card's panel (6AV2124-0GC01-0AX0 on a TP700). The offer, the confirm route and the reader share the rule, so an entry already saved with another machine's value counts for nothing. Another panel's 6AV number is still offered, by decision 3: the box starts unticked. The cost: a machine's own order number that neither starts with its model nor is a paired panel number is no longer offered or counted, for example a PowerFlex 525's 25B number or an S7-1200 CPU's 6ES7 number on an S7-1200 card. Its threads stay withheld, as on main.
- **`manual-status-subject.ts`, `subjectMachine`.** It adds the confirmed numbers only when all three hold:
  1. the notebook's identity is settled (`user_confirmed` or `verified`) by the identity card, source `user` (round 3 pre-screen: an identity a nameplate photo settled reads no ticked number);
  2. the model the status names equals the notebook's model (the same rule `catalogNumber` already follows);
  3. the entry's normalised manufacturer and model equal the notebook's.
- **Reading the numbers.** `readConfirmedNumbers(tenantId, notebookId)` is a separate, tenant-scoped query. Any error returns no numbers and logs one line, which is today's behaviour. The column is deliberately not added to the main notebook `SELECT`, so a Hub deployed before the prod migration cannot break notebook reads.
- **The numbers are read only when they could matter.** The detail read asks for them only when the scope without them says `other`. Most thread reads, including every follow poll in an own thread, add no query.
- **Module boundary.** The read, the write and the entry filter live in a new module, `mira-hub/src/capabilities/confirmed-numbers.ts`. It imports nothing from `notebook-manual-acquisition.ts`, because existing route tests replace that module with a partial mock. The write (`recordConfirmedNumber`) is called only by `confirmNotebookIdentity`, inside its transaction.
- **No card re-reading.** The card-question logic from #6094 is not carried over. The scope never reads cards.

### 4.7 Failure behaviour

| Failure | Result |
|---|---|
| The helper finds 0 or several other numbers, another maker, or no display token | The card shows no box; the behaviour is today's |
| The technician leaves the box unticked | The identity is confirmed without a number; the thread is withheld as today |
| `confirmedNumber` has a bad shape | Ignored; the identity is confirmed |
| The number write fails (or the column is missing) | Rolled back to its savepoint and logged; the confirm succeeds; `numberSaved: false` |
| A different number is already saved for this machine | Refused, nothing written; the confirm succeeds; `numberSaved: false` |
| The card had already settled the identity before this confirm | No number added or cleared; a retry of the saved number is `numberSaved: true`, anything else `false`; the confirm succeeds |
| The identity was reopened and is settled again | The numbers become exactly this confirm's tick, or none |
| A nameplate photo settled the identity, then the card confirms | The card's first confirm decides the numbers afresh; a stale card after it adds nothing |
| The confirm writes a catalog number | No number added; the confirm succeeds; `numberSaved: false` |
| `readConfirmedNumbers` fails, or the column is missing | No numbers; the thread is withheld as today |
| The identity was later changed | Old entries no longer match and are ignored, and the next settle replaces them |

## 5. What this resolves, and what it does not

These are expectations, each to be proven by a test before it is claimed.

- **#6085.** Fixed when the technician ticks the number.
- **#6098** (a card more than 50 turns back). Resolved by construction, because the scope no longer reads cards.
- **#6099** (a labelled serial read as a card number). It becomes the technician's choice: it is offered, and saved only if ticked.
- **#6096.** Unchanged.

Known costs, accepted by Mike:
- **The box is left unticked.** The thread still withholds the outcome for that confirm, which is the #6085 symptom. This is the fail-closed cost of the unticked default.
- **A number can be added only on the card that settles the identity.** A number left unticked there cannot be added later, and threads that name it stay withheld, as now. A ticked number counts in every thread of the notebook while its identity is unchanged, and cannot be removed (revision after the final review: it counts only as an order number, so a mistaken tick can never make a model's threads own).
- **Two cards exist before confirming.** Only the pressed card's number is saved; the other card settles as superseded with no box. Revision (Codex round 1, F3): one number per machine, first saved wins; a later different number is refused. Revision (Codex round 2, F3): only the confirm that settles the identity may add a number, so a second card for the same machine adds none, even after an unticked first confirm.
- **A failed number write is not retried, and the card does not say so** (Codex round 2, F5, filed as #6116). The response says `numberSaved: false`, but both canonical clients settle the card on any confirm success and drop that field. Because only the confirm that settles the identity may add a number, a later card cannot recover it either. The thread stays withheld, as it is today without the tick.
- **A number belongs to one settling of the identity** (round 3 pre-screen). After a notebook PATCH reopens the identity, the next settle drops the earlier tick unless it is ticked again.
- **A notebook PATCH that writes the identity status or source by hand drops the ticked numbers** (round 3 pre-screen 2). It settles or reopens an identity without the card, and only the card adds a number. This holds even when it re-asserts the same machine (fail closed).
- **The tick lasts for the page.** A tick on a card that was never confirmed is gone after a full page reload, so that card starts unticked again (fail closed).
- **Legacy surfaces.** They show no box.

## 6. Testing

All tests are written first. Each one is seen red against a named mutation, with counts recorded, per `.claude/rules/prove-the-test-fails.md`.

- **`offeredOwnNumber`:**
  - The walk question offers `6AV2124-0GC01-0AX0`.
  - The F7 neighbour phrasing still offers the number, and an unticked confirm protects against it.
  - Two numbers offer nothing.
  - Another maker offers nothing.
  - A question with no number offers nothing.
  - A number covered by a family rule offers nothing.
  - The display form keeps the technician's spelling.
  - The verification step rejects a number that would still scope as other.
- **`threadStatusScope` with `confirmedNumbers`:**
  - The walk thread becomes `own`.
  - Without the number it stays `other`.
  - A TP900 control stays `other`.
- **`subjectMachine` and `readConfirmedNumbers`:**
  - Numbers apply only to a settled identity and the same model.
  - An entry for an old identity is ignored.
  - A read error gives no numbers.
- **Confirm route:**
  - A ticked confirm saves the number.
  - An unticked confirm saves nothing.
  - A bad shape is ignored.
  - A 409 saves nothing.
  - A save failure still confirms, with no number; a confirm that fails is never reported as a success.
  - The catalog number and the lookup key are unchanged.
  - A repeated confirm does not duplicate the entry.
- **Chat route:** the card frame carries `offeredNumber` live and after a reload, and the validator rejects a non-string value.
- **Shared UI:**
  - The box starts unticked.
  - A ticked confirm passes the number; an unticked one does not.
  - A settled card has no box.
  - A card without `offeredNumber` renders exactly as today.
- **Adapters:**
  - Hub and mobile both carry the field and send it.
  - Under Option A, `readNotebookStream` keeps `offeredNumber` on the live result. Under Option B, a live card without the field confirms with no number.
- **Real Postgres:** migration 118 applies and re-applies on a throwaway database; the write runs under `SET ROLE factorylm_app` with a UUID tenant.
- **Full suites before review:** Hub Vitest, typecheck against main's baseline count, mobile, shared UI with the UI lab verify, and the real-Postgres suites.

## 7. Delivery and gates

1. **The shared UI slot.** The server, migration and adapter work goes ahead now. The shared UI files wait for the #3626 slot, then get a real `[WORK-CLAIM]` and a reread of the claim namespace.
2. **The PR.** One new PR with a fresh Codex budget, since this is a different approach from #6094.
   - The Hub version gets a minor bump, because this is a feature.
   - The PR body carries the lifecycle guard rationale. These planned paths are guarded (checked with the guard's `path_is_guarded` from origin/main):
     - `mira-hub/package.json`;
     - `mira-hub/src/components/equipment/notebook-chat-utils.ts` (Option A, chosen).

     The new route-level tests live in `mira-hub/src/capabilities/__tests__/`, which is open. The guarded route test folders are left unchanged and still run (re-checked at plan stage, 2026-11-27). Every other planned path is open, including `mira-hub/src/lib/notebook-chat-types.ts`, both adapters and `mira-mobile/src/api/identity-confirm.ts`. Mobile `api/resources.ts` is guarded and is not touched.
   - The guard preflight runs from origin/main three ways before any Codex round.
3. **Codex.**
   - Rounds use `--review-only`.
   - Any HIGH means a stop and Mike's call.
   - CONVERGED means follow-up issues, then the merge, which is Mike's.
4. **The prod migration.** It is applied through `apply-migrations.yml` (`dry-run`, then `apply`), with Mike's go. It is safe before or after the Hub deploy, but the number only works once it is there.
5. **Staging and the walk.**
   - Check staging users first, then run `deploy-staging` including mira-hub.
   - Walk on the tablet:
     - the TP700 question with the box ticked shows the status in that thread;
     - the same question with the box unticked stays withheld;
     - a TP900 control stays withheld;
     - recheck the old J2 thread. It is expected to stay withheld: that notebook was confirmed with no number, and cards no longer appear on it. This is the known cost in §5, not a walk failure.
6. **Prod.**
   - Deploy only after a passed walk on the exact candidate, through `deploy-vps.yml`.
   - The rollback is the previous prod Hub image. The column stays; it is additive and harmless.
7. **Mobile.** The mobile OTA release is a separate dispatch, and it is Mike's.
