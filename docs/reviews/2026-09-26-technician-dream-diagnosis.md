# What actually stands between MIRA and "a technician's dream"

**Written:** 2026-09-26 · **Reviewer session:** Claude (reviewer role for Codex)
**Grounded in:** PR #3999 @ `4fdfc7e9`, PR #3970, issue #3973, and the source of
`mira-hub/src/capabilities/answer-validation.ts` + `mira-hub/src/lib/manual-rag.ts` at that SHA.

**This is not a PRD.** #3990, #4001, `docs/prd/2026-09-07-factorylm-ui-ux-v1.md` and the
UNIFIED_UI_CUTOVER charter already describe the next phase. This is a diagnosis of why that
phase keeps failing, and the one change that would unblock it.

---

## 1. The app is not blocked on design. It is blocked on one repeated architectural mistake.

Three workstreams failed independently in the last week, and all three are the same defect:

| | symptom | the fix that was applied |
|---|---|---|
| **#3999** | answer "asserted a drawing-to-hardware match without proving it"; earlier, claimed actual voltage from a nameplate | tightened the summary prompt |
| **#3970** | HMI LOOK cited SINAMICS V20 — wrong OEM family | bound OEM identity more narrowly |
| **#3973** | energized-hazard **was detected**, then only fed the prompt and a banner; the semantic judge called the answer "safe" | added grammar traps to `answer-validation.ts` |
| **#3984** | the safety floor is **sentence-scoped**, so a numbered energized-work procedure walks straight through — *reproduced on staging*, still `needs-triage`, **release-blocking** | nothing yet |

Each of the first three was repaired in a different layer by a different session. **None of them fixed
the class**, and the fourth — the release blocker — is the class in its purest form.

### The class, stated precisely

> A fact that an upstream layer already knew **structurally** is thrown away, and then guessed
> back from English prose by a regex downstream.

Two instances of this sit side by side inside PR #3999 alone:

**Instance A — `manufacturerFromObservationText` (`manual-rag.ts`).** It decides "did this label
claim a manufacturer?" by regex over lowercased prose. The OCR field parser
(`nameplate/passes.ts::parseCatalogNumber`) **already knows** whether a token came from a
`CAT. NO.` field or a manufacturer field. The code comment says so out loud — *"Unlike the OCR
field parser in nameplate/passes.ts (parseCatalogNumber), prose matching requires a heading and
a digit-bearing value"* — so the structured answer is known to exist and is deliberately
re-derived from text anyway.

The cost, reproduced against `4fdfc7e9` today, **in both directions at once**:

- **Under-masks.** `CAT_NO_9012` returns `CAT` — as do `CAT NO_9012`, `CAT.NO_9012`,
  `CAT_NUMBER_9012`, `CAT NUMBER_77`, `CAT_no#1`. Root cause: `_` is a regex word character, so
  `no\b` never fires before it. The head commit exists *specifically* to close separator variants
  and shipped with six open.
- **Over-masks.** `CAT no 2 cylinder misfire`, `CAT no 3 injector`, `CAT number 1 bearing hot`,
  `CAT no. 2 fuel filter` all lose the genuine `CAT` mention — ordinary technician speech for
  "number 2 cylinder" is read as a catalog heading.

That combination is the whole argument. Tightening the lookahead to close the first widens the
second; loosening it to keep the second reopens the first. `CAT NO: 2` (a real two-character
catalog number) and `CAT no 2 cylinder` **are not separable from lowercased prose at all** — the
disambiguator was discarded upstream, where `parseCatalogNumber` knew, without ambiguity, whether
the token sat in a `CAT. NO.` field or a manufacturer field. No regex over this input can be
correct, which is why the file is on Iteration-3 and why there will be an Iteration-4.

**Instance B — `answer-validation.ts`.** It decides "did the model affirm energized work?" by
regex over the model's English: `HAZARD_ACTIONS`, `ENERGIZED_STATE`, `ENERGIZED_LINK`. It is on
*Iteration-3* of adding connector words — the file's own comment reads *"Iteration-3:
'when'/'whilst'/'during' work as energized connectors exactly like 'while'/'with'."* And it is
honest about what that means: *"these are bounded invariants, not a truth oracle."*

Meanwhile #3973 records that the hazard classification **already ran and already knew**. It was
handed to the prompt and a banner instead of to a gate.

**So both files are patching holes in a guess that did not need to be a guess.** That is why
three sessions can each ship a real fix and the product still fails the same way next week: the
holes are unbounded. English is unbounded.

**Instance C — the release blocker, #3984.** Every character class in the A4 hazard pattern
(`answer-validation.ts:135`) is `[^.!?\n]`, so the affirmation head, the hazard action and the
energized state must all land in **one sentence on one line**. Verified against the verbatim
pattern: `Reset the fault while the drive is energized.` is caught — and

```
1. Leave the drive powered on.
2. Reset the fault at the keypad.
```

escapes, as does a single instruction defeated only by a line wrap. Widening the classes to cross
newlines makes the window span unrelated steps, and *that* false-positive direction is a safety stop
on a correct answer — the failure mode that teaches technicians to ignore the banner. So the
enumeration cannot be completed and cannot be widened. The file's own comment at line 250 describes
needing *"a consecutive round to find a new head family."* There is always another round.

---

## 2. Why "a technician's dream" is the same problem, not a different one

A technician's dream tool is not beautiful. It is **bettable** — they would put their name on a
shutdown decision because it said so.

That reframes polish as a risk multiplier. A delightful interface raises the confidence a
technician places in the answer. If the answer overstates its evidence, **design makes it more
dangerous, not more lovable.** The order is forced: make the answer bettable, then make it
beautiful. Not the reverse.

The specific sin in every failure above is **tier promotion** — four tiers a technician already
thinks in, silently upgraded:

1. **Observed** — visible in your photo. *"the relay looks seated"*
2. **Printed** — the label or drawing says it. *"nameplate reads 480V 3PH"*
3. **Measured** — a live tag or your meter says it. *"PLC tag shows 0 A"*
4. **Inferred** — reasoning over the above. *"so the contactor probably isn't pulling in"*

- #3999 promoted **printed → measured** ("actual voltage established" from a nameplate).
- #3999's replay L promoted **inferred → printed** (a drawing-to-hardware match asserted as read).
- #3970 and the `CAT` leak asserted attribution with **no tier at all**.

Technicians do this distinction natively and constantly. It is the whole skill. A tool that
blurs it is not a junior colleague — it is a confident stranger.

---

## 3. The one change: make the tier a type, not a sentence

**Stop re-deriving structure from prose. Carry it.** Generate the answer *from* typed evidence so
that a `printed` item cannot be rendered as `measured` — not because a regex caught the sentence,
but because the claim was never constructible.

This is precisely what `.claude/rules/zero-token-architecture.md` already demands: stable
reasoning gets exported to a deterministic artifact instead of being re-inferred per turn.
"Don't overstate your evidence" is the most stable rule in the product and is currently
re-inferred, in English, on every single turn.

Every seam already exists. This is connect-and-enforce work, not new architecture.

| need | it already lives here | what has to change |
|---|---|---|
| the type | `materialized_evidence/context_contract.py` → `EvidenceItem.trust` | today: `trust: str = "candidate"  # free-form tolerated`. **Close it into an enum carrying the four tiers.** The type exists but is not load-bearing. |
| the audit trail | `decision_traces.context_manifest` (migration 071) | already manifested per turn — tier violations become queryable for free |
| the gate | `mira-hub/src/capabilities/answer-validation.ts` | replace prose pattern-matching with a **structural** check: a claim asserting a quantity must carry a tier, and may never exceed the tier of the evidence it cites. Fail closed → abstain. |
| the render | `packages/factorylm-ui` (unified shell) | the phone renders the **unified shell**, not `ChatV2`/`NotebookScreen` — a tier chip added to a classic screen is dead code (#3917 → #3972) |
| the score | the automated retrieval acceptance loop (6 live scenarios per staging deploy) + `tests/golden_*.csv` | add **tier-violation rate** as a scored dimension |

That last row is the one that ends the recurrence. Right now "FAIL for answer quality" is prose
in a PR body, re-litigated by hand every night. Until overstatement is **a number that moves**,
it will be rediscovered forever.

---

## 4. What the technician sees (the UX falls out of the type)

- **Every claim carries a one-word tier.** Muted by default, colour only for state, per
  `.claude/rules/ui-style.md`. Not a badge-fest — one word, where the eye already is.
- **Tap a claim → the pixels that produced it.** The photo region or manual page, at the page it
  came from. The visual-evidence tracer bullet already does the hard part.
- **"I don't know" is a designed, first-class answer.** Today a stranger's first message can
  return `Chat unavailable (412)` in a permanent banner with no retry (recorded 2026-09-07).
  Abstention has to look *deliberate*, not broken — that single screen is where trust is either
  earned or lost, and it is currently the worst screen in the product.
- **The promise, in nine words:** *MIRA never says "is" when it means "probably."*

---

## 5. The website is the same claim, shown rather than asserted

- **Do not sell "AI for maintenance."** Every competitor sells that, and a maintenance buyer has
  already been burned by it. Sell **"every answer shows its work."**
- **The hero is not a chat screenshot — it is a citation resolving.** Twelve seconds: photo →
  the exact page highlighted → the answer with tier chips visible. That loop *is* the product,
  and no competitor can fake it in a GIF.
- **Publish the scoreboard.** A live page with the acceptance loop's pass rate *and the
  abstention rate*. Nobody in this category publishes their failure rate. Doing it is the entire
  differentiator, and it is nearly free because the loop already runs after every staging deploy.
- **Make the beta gate the landing page, not a claim about it.** "A stranger uploads their own
  manual and gets a cited answer" should be something a visitor *does*, on their own PDF, in
  under 60 seconds. The gate is already CI-enforced on the retrieval path; the missing half has
  always been the product surface.

---

## 6. Sequence

1. **Finish the boundary before adding surface.** Land #3999's two mechanical fixes (allowlist
   line bump; the underscore leak). Then take the tier type end-to-end on **one** journey —
   BENCH-FIREPLACE-001, already registered by #4001.
2. **Make overstatement a number.** Tier-violation rate in the acceptance loop. Nothing else on
   this list survives without it.
3. **Then polish.** UI work on a bettable answer compounds; on an unbettable one it amplifies risk.
4. **Collapse the PRD pile.** #3990, #4001, the UI-UX PRD and the cutover charter all govern the
   same phase. One governing doc; the rest become references. Four constitutions is zero.

## 7. What to stop

- **Overnight loops that emit 82-file PRs.** #3999 is +3674/-211 across 82 files; the substantive
  behaviour change is **nine lines of regex**, and it shipped with six reachable leaks. The
  evidence-writing has outrun the fixing. A bounded mission should produce a bounded diff.
- **Treating DeepEval as a gate** while its judge returns truncated JSON and the same branch
  alternates 76.2% / 85.7% across consecutive commits.
- **Running container-based evidence without checking headroom.** #3999's own body records
  *"Docker builder storage I/O errors prevented a new Docker artifact"* — that was CHARLIE
  transiently at 146Mi free, not a defect in the change. Headroom has since recovered to ~5.9GiB
  on its own, so **do not reclaim on the strength of that number** — re-measure, then re-gather
  the container artifact. A build that fails on space should say so loudly instead of becoming a
  prose caveat in a PR body.

---

## One-line answer

The dream app is not a better interface on top of this answer — it is **an answer a technician
can bet their name on**, which requires the evidence tier to be a closed type enforced at the
seam instead of an instruction re-guessed from English on every turn. Everything desirable about
the app and the website is downstream of that, and cheap once it holds.
