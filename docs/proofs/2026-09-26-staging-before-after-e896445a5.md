# Staging before/after — merging #3970 (`e896445a5`)

BEFORE/AFTER pair captured on the advice of a peer session: measuring only after a deploy leaves an
identical result ambiguous between "the fix did not take" and "the fix works but something else
dominates". Same scenario set both sides.

## BEFORE — staging at `f41e57054dda30600246c5f835c46c48df4fa069`

`/api/health` at 11:15Z: `service=mira-hub  version=3.359.3  gitSha=f41e57054  builtAt=2026-09-26T05:18:59Z
approvedRetrievalEnforced=false  environment=staging`

Acceptance run **36220668438** (05:23:48Z, the run that followed the 05:18Z deploy) — **FAILURE, 5/6**:

| # | scenario | verdict |
|---|---|---|
| 1 | empty notebook + generic question | PASS |
| 2 | empty notebook + resolved Siemens identity | PASS — `oem_corpus_bm25 n=6`, but answer `insufficient_evidence`, `cit=0` |
| 3 | notebook with attached manual | PASS |
| 4 | **photo turn → text-only follow-up** | **FAIL** |
| 5 | no evidence + exact rating requested | PASS |
| 6 | (sixth row) | PASS — only scenario 4 is listed under FAILURES |

Scenario 4's four failing assertions:

```
[FAIL] prior_visual_observations_considered ≥ 1            0
[FAIL] prior file id recalled == the photo's file id       []
[FAIL] visual evidence in context on the follow-up         0
[FAIL] follow-up badge is not bare general                 general_reasoning
```

### Two things this baseline establishes

1. **Staging's acceptance loop has been RED since the 05:18Z deploy.** The preceding session verified
   the deployed SHA by probing `/api/health` and reported staging "verified" — which was true about
   *which code is running* and silent about *whether it works*. The health probe and the acceptance
   verdict are different claims; only the second one is the gate.
2. **The failing scenario is server-side photo memory across turns — which is exactly PR #3999's
   subject** ("keep conversations available", "preserve photo context across turns"). So scenario 4
   is expected to stay red until #3999 lands. **#3970 must not be blamed for it**, which is the whole
   reason for capturing this before deploying.

## Prediction recorded before the deploy (so it can be wrong)

- Scenarios 1, 2, 3, 5, 6 stay PASS ⇒ #3970 introduced no regression.
- Scenario 4 stays FAIL with the same four assertions ⇒ needs #3999, not #3970.
- Scenario 2 is the one #3970 could move; if its `insufficient_evidence` / `cit=0` shape changes,
  that is #3970's effect and nothing else in the diff touches that path.

## AFTER — staging at `e896445a50f53e1a2d5b3657f12fe8ef18f51528`

Deploy run **36238445295**, both jobs success. SHA re-confirmed from `/api/health`, not from the
dispatch input: `gitSha=e896445a50f53e1a2d5b3657f12fe8ef18f51528  version=3.359.4
builtAt=2026-09-26T11:19:43Z  environment=staging  approvedRetrievalEnforced=false`.

Acceptance run **36238719876** — **FAILURE, 4/6**. Scenario 4 still fails identically, **and
scenario 2 newly fails**:

| # | scenario | BEFORE `f41e5705` | AFTER `e896445a5` |
|---|---|---|---|
| 1 | empty notebook + generic question | PASS | PASS |
| 2 | empty notebook + resolved Siemens identity | **PASS** — `oem_corpus_bm25 n=6` / `insufficient_evidence` | **FAIL** — `oem_corpus_bm25 n=0` / **`answered`** `cit=0` |
| 3 | notebook with attached manual | PASS | PASS — `n=1 / cit=1` |
| 4 | photo turn → text-only follow-up | FAIL | FAIL — same four assertions |
| 5 | no evidence + exact rating requested | PASS | PASS |
| 6 | (sixth row) | PASS | PASS |

## The prediction was WRONG, in the direction that matters

I predicted "1, 2, 3, 5, 6 stay PASS ⇒ #3970 introduced no regression." **Falsified.** Scenario 2 —
the one row I correctly identified as the only one #3970 could move — moved, and it moved the wrong
way. Without the BEFORE capture this would have been indistinguishable from the pre-existing red.

**Scenario 2's two new failures:**

```
[FAIL] candidates traceable (source_url#page ids)                          0 / 0
[FAIL] cited answer OR honest refusal (never uncited documentation claim)
       status=answered cit=0 basis=general_reasoning
```

### Mechanism, traced not guessed

Scenario 2 creates a notebook with `manufacturer="Siemens"`, **`model="TP700 Comfort"`**,
`identityStatus="user_confirmed"` and asks for the panel's supply voltage and operating temperature
range. That is precisely the model #3970 was built around (its body: *"TP700 admits TP700/TP700
Comfort, but excludes KTP700, TP7000, TP7001 and V20"*).

1. `identityBound = callerModel !== null` → **true**, because the notebook supplies the model.
2. `scopeCascade` with a model and `identityBound` pushes **only** `{mfr: Siemens, model: TP700}` —
   the vendor-only fallback is deliberately suppressed. That is #3970 working exactly as designed.
3. The shared corpus has **no TP700 manual** — a known, deliberately-untuned gap. So the correctly
   scoped query returns **0 chunks**, where the old vendor-wide query returned 6 Siemens chunks
   (some of which were the wrong-family V20 material #3966 was filed about).
4. `docGrounded = chunks.length > 0` → false → the turn falls through to the general lane, and the
   model **answers from general knowledge with zero citations**.

### So #3970 made retrieval more correct and the answer less safe

Its own design comment promises the opposite: *"Empty model-scoped results become an honest
refuse-to-cite rather than a wrong-family Siemens VFD manual."* The refuse-to-cite half did not
materialise — nothing forces abstention when an identity-bound scope comes back empty, so the
fallthrough produces an uncited answer instead.

Both states are bad, differently: before, six wrong-family chunks plus an honest refusal; after, no
chunks plus a confident uncited answer. **The second violates the harness contract "never uncited
documentation claim", which is the stricter and more important invariant.**

### Recommendation — fix forward, do not revert

Reverting reinstates the wrong-family citation bug (#3966) that #3970 correctly fixes. The targeted
repair is at the answer path, not the retriever: **when `identityBound` is true and the scoped
retrieval returns empty, force the abstention lane instead of falling through to general
reasoning.** That is the behaviour #3970 already documents as its intent. It also closes the same
gap scenario 5 guards, from the other side.

This is the fourth instance today of one defect class — *the answer asserts more than the evidence
establishes*. See `docs/reviews/2026-09-26-technician-dream-diagnosis.md`.

## Unit Tests / Eval Offline red on main — probably NOT this change

`CI` run 36238155784 on `e896445a5` fails on `Unit Tests`, `Eval Offline` and therefore the required
`CI Gate`. Five failures, all Postgres RLS/migration tests
(`test_visual_session_migration.py`, `test_visual_equipment_migration.py`), e.g.
`create_session returned None -- either the migration did not apply, the factorylm_app grant is
missing, or the RLS WITH CHECK rejected tenant A's own insert`.

#3970 contains **no Python and no migration changes**. And the timing rules out a stale base:
`f41e5705` landed 17:39:03Z on 09-24, #3970's CI ran at **17:45:58Z** — after it — and `Unit Tests`
and `Eval Offline` both **passed** there on `d9c62409`. Since the squash is content-equivalent, the
most likely cause is an environmental/flaky disposable-Postgres failure. A `--failed` rerun was
dispatched to settle it; treat this as INCONCLUSIVE until that returns, not as proven-unrelated.
