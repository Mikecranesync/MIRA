# #6085: the technician confirms the order number on the identity card

Status: design approved by Mike 2026-11-27 (asked in session). This spec awaits his review before the implementation plan.
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

A new exported helper in `mira-hub/src/capabilities/notebook-manual-acquisition.ts`, `offeredOwnNumber(question, identity)`, sits beside `threadStatusScope` and shares its internals (`modelsNamedIn`, `familyCovers`, `norm`, the maker check). It returns the one number to offer, or null:

1. **Build the identifiers.** Build `own` from the proposed model exactly as `threadStatusScope` does.
2. **Check the maker.** If the question names another maker, return null. The scope would class the thread as other whatever number is confirmed.
3. **Find the other numbers.** These are the ones `modelsNamedIn(question, own)` names that are not covered by `own` or a family rule.
4. **Require exactly one.** With zero or several, return null.
5. **Verify.** `threadStatusScope([question], machine with that number confirmed)` must return `own`. Otherwise return null; that guards the shared-prefix rule, which can name more codes once the identifier set grows.
6. **Find the display form.** It is the one whitespace-delimited token of the question, trailing punctuation stripped, whose `norm` equals that number. If there is no such token, or there are two different ones, return null. The card shows the technician's own spelling, never a normalised string.

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
- The checkbox uses the existing card tokens. No new colour is introduced.

### 4.3 Adapters (not guarded)

- **Hub.**
  - `mira-hub/src/factorylm-ui/to-interaction.ts` carries `offeredNumber` from both the persisted entry (`identityProposalOf`) and the live frame.
  - `hub-host.tsx`'s `onConfirmIdentity` adds `confirmedNumber` to the request body when present.
- **Mobile.**
  - `mira-mobile/src/unified/to-interaction.ts` carries `offeredNumber`.
  - `mira-mobile/src/api/identity-confirm.ts` adds `confirmedNumber` to the body.
  - These ship only through the separate, dispatch-only OTA release.
- **Legacy surfaces stay untouched.**
  - The legacy Hub chat (`components/equipment/notebook-chat-utils.ts`) and legacy mobile screens copy named fields only. They drop `offeredNumber` and confirm without a number, as today.

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
  - The revoke trigger (`equipment_notebooks_revoke_auto_manuals`, migration 101) fires only on `UPDATE OF manufacturer, model, catalog_number, identity_status`, so a write to this column never touches search state.
- **Entry shape.** Each entry is `{ "number": "<display form>", "manufacturer": "<confirmed>", "model": "<confirmed>", "confirmedAt": "<iso>" }`. Storing the identity with the number lets the reader ignore numbers saved for an identity the notebook no longer has, for example after a Settings edit. No other identity writer has to clear the list.
- **The write.** `saveConfirmedNumber(tenantId, notebookId, entry)` is one `UPDATE` under `withTenantContext`. It appends the entry unless one with the same normalised number, manufacturer and model is already there, so a repeated confirm is idempotent.
- **The migration file is fixed once pushed.** Draft it against a throwaway Postgres first. `migration-verify.yml` applies the first pushed version to the persistent staging branch, and after that the file is immutable (`.claude/rules/mira-hub-migrations.md` §8).

### 4.5 The confirm route

`mira-hub/src/app/api/equipment-notebooks/[id]/identity/confirm/route.ts`:

- **Reading the number.** It reads `confirmedNumber` with the existing `readString`. It accepts the number only when the trimmed value is 1 to 64 characters, contains a digit and has no whitespace. Any other value is ignored.
- **The identity confirm.** It is unchanged. `catalogNumber` is still written as sent (`""` for text cards), and the lookup key and the search are unchanged.
- **Saving the number.** After `confirmNotebookIdentity` succeeds, the route calls `saveConfirmedNumber` with the confirmed manufacturer and model. If that write fails, the route logs it and the confirm still succeeds. When a number was sent, the response gains `numberSaved: boolean`.
- **When the confirm is refused.** On a 409 (`identity_already_confirmed`) or a failed confirm, nothing is saved.
- **The route does not check that a card offered the number.** It is the technician's own statement about their own notebook, and only the display scope reads it.

### 4.6 The status scope

- **`threadStatusScope`.** The `machine` argument gains `confirmedNumbers?: readonly string[]`. Each one joins `own` exactly as the model and catalog number do.
- **`manual-status-subject.ts`, `subjectMachine`.** It adds the confirmed numbers only when all three hold:
  1. the notebook's identity is settled (`user_confirmed` or `verified`);
  2. the model the status names equals the notebook's model (the same rule `catalogNumber` already follows);
  3. the entry's normalised manufacturer and model equal the notebook's.
- **Reading the numbers.** `readConfirmedNumbers(tenantId, notebookId)` is a separate, tenant-scoped query. Any error returns no numbers and logs one line, which is today's behaviour. The column is deliberately not added to the main notebook `SELECT`, so a Hub deployed before the prod migration cannot break notebook reads.
- **No card re-reading.** The card-question logic from #6094 is not carried over. The scope never reads cards.

### 4.7 Failure behaviour

| Failure | Result |
|---|---|
| The helper finds 0 or several other numbers, another maker, or no display token | The card shows no box; the behaviour is today's |
| The technician leaves the box unticked | The identity is confirmed without a number; the thread is withheld as today |
| `confirmedNumber` has a bad shape | Ignored; the identity is confirmed |
| `saveConfirmedNumber` fails | Logged; the confirm succeeds; `numberSaved: false` |
| `readConfirmedNumbers` fails, or the column is missing | No numbers; the thread is withheld as today |
| The identity was later changed | Old entries no longer match and are ignored |

## 5. What this resolves, and what it does not

These are expectations, each to be proven by a test before it is claimed.

- **#6085.** Fixed when the technician ticks the number.
- **#6098** (a card more than 50 turns back). Resolved by construction, because the scope no longer reads cards.
- **#6099** (a labelled serial read as a card number). It becomes the technician's choice: it is offered, and saved only if ticked.
- **#6096.** Unchanged.

Known costs, accepted by Mike:
- **The box is left unticked.** The thread still withholds the outcome for that confirm, which is the #6085 symptom. This is the fail-closed cost of the unticked default.
- **A number can be added only on the first card.** A later thread that names the number stays withheld, as now.
- **Two cards exist before confirming.** Only the pressed card's number is saved; the other card settles as confirmed with no box.
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
  - A save failure still confirms.
  - The catalog number and the lookup key are unchanged.
  - A repeated confirm does not duplicate the entry.
- **Chat route:** the card frame carries `offeredNumber` live and after a reload, and the validator rejects a non-string value.
- **Shared UI:**
  - The box starts unticked.
  - A ticked confirm passes the number; an unticked one does not.
  - A settled card has no box.
  - A card without `offeredNumber` renders exactly as today.
- **Adapters:** Hub and mobile both carry the field and send it.
- **Real Postgres:** migration 118 applies and re-applies on a throwaway database; the write runs under `SET ROLE factorylm_app` with a UUID tenant.
- **Full suites before review:** Hub Vitest, typecheck against main's baseline count, mobile, shared UI with the UI lab verify, and the real-Postgres suites.

## 7. Delivery and gates

1. **The shared UI slot.** The server, migration and adapter work goes ahead now. The shared UI files wait for the #3626 slot, then get a real `[WORK-CLAIM]` and a reread of the claim namespace.
2. **The PR.** One new PR with a fresh Codex budget, since this is a different approach from #6094.
   - The Hub version gets a minor bump, because this is a feature.
   - The PR body carries the lifecycle guard rationale: `mira-hub/package.json` and the route `__tests__` files are guarded.
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
     - recheck the old J2 thread.
6. **Prod.**
   - Deploy only after a passed walk on the exact candidate, through `deploy-vps.yml`.
   - The rollback is the previous prod Hub image. The column stays; it is additive and harmless.
7. **Mobile.** The mobile OTA release is a separate dispatch, and it is Mike's.
