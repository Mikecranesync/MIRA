# Prove The Test Fails (the golden rule of TDD here)

**A test is not a valid test until you have made it fail on the thing it names.**

A passing test and a test that proves nothing are visually identical. Both are a
green line. Neither the name, the assertions, nor a careful read distinguishes
them — only breaking the thing under test and watching the alarm go off does.

So: write the test, **break the code it protects, watch it go red**, restore,
watch it go green. Until that has happened, you have a line of code that returns
green, not a test.

This is the repo's TDD golden rule. It sits above `karpathy-principles.md` §4
("evidence beats assertion") and Cluster Law 1 ("evidence-only completion"): the
evidence that a test works is a **red run you caused on purpose**.

## The rule

1. **Red before green, on the real regression.** For every new or changed test,
   mutate the specific behaviour it names and confirm *that* test fails. Not "the
   suite fails" — *that* test, by name.
2. **Check the test count, not just the colour.** A test that fails to load, is
   skipped, or is deselected also produces "not green" and looks like success in
   the wrong direction. `2 failed, 21 passed` is a proof; `1 error during
   collection` is not. Record the counts both ways.
3. **Mutate under the same conditions CI uses.** Environment variables, installed
   packages, and parallel workers change behaviour. A mutation verified only in
   your shell proves your shell.
4. **Isolate to one field.** If the test says "X is rejected when `sha` is
   missing", the input must be complete except for `sha`. A payload missing three
   fields is rejected for whichever the validator checks first, and the test
   passes with its own rule deleted.
5. **Assert preconditions, don't assume them.** If a test depends on a state
   (empty tenant, missing file, disabled flag), assert that state before
   asserting the outcome. Otherwise a setup that silently doesn't happen becomes
   a test that silently proves nothing.
6. **Pin the environment; never inherit it.** Constructors and modules that
   backfill from `os.environ` will quietly undo your setup. Patch the variable to
   the value the test needs.
7. **Add a control.** For every "must reject" test add a "must accept" one, and
   vice versa. Without the control, a change that hardcodes the answer passes
   every test you wrote.
8. **Guards get this doubly.** Anything whose job is to *prevent* something — a
   CI gate, a hook, a schema constraint, an approval check — must be shown to
   fail on the thing it prevents, or it is documentation. A check that runs but
   cannot fail the merge is not a guard (`ci.yml:453`).

## Why this exists (evidence, not theory)

**2026-09-07, FLEET-PEER-NETWORK-001 Slice A.** Seven guards were examined as an
independent verifier. **Seven were defective. Zero were catchable by reading.**
Each was found by mutation. The set is catalogued on issue #3648:

- a contract suite that ran in an ungated job — red, and merged anyway
- a fix that would have landed via a PR configured to run no CI at all
- a step that could be relocated to an ungated job and still satisfy its check
- five behavioural proofs silently skipped on a missing library, step still green
- a rejection proof that passed for an unrelated missing field
- the rule "a guard must be made to fail", itself unpinned by any assertion
- the fix for that, pinning document *layout* so a reflow false-reds

**Two of those were written after the author knew the failure mode and was
actively hunting for it.** That is the point: this is not a carefulness problem.

**Same day, hours later**, the verifier who found all seven shipped
`test_retrieval_skip_is_honest.py` with the identical defect — the worker's
tenant was backfilled from `MIRA_TENANT_ID`, so the "no tenant" precondition
never held. Green locally (no env var), red in CI (env var set), asserting
nothing about the code under test in either. Fixed by rules 3, 5 and 6 above.

**Also that week**, an audit prompted by the above found the production guard
allowed `scp`/`rsync` writes to production when the host was addressed by ssh
alias instead of IP, and the beta gate could report green by skipping.

Nobody in this sequence was careless. The defect is invisible from the inside.

## What a reviewer must ask

- "Did you see this test fail?" — and **on what mutation, with what counts**.
- For a guard: "Which regression did you break to prove it fires?"
- For a rejection test: "Was the input complete except for the field under test?"
- For anything env-sensitive: "Did you verify under CI's environment?"
- If the answer is "it passes" — that is not an answer to any of these.

## When this applies

Every new or modified test, in any language, anywhere in this repo. Most
emphatically to CI gates, `PreToolUse` hooks, schema constraints, approval gates,
and anything else whose value is that it can say **no**.

## When this does NOT apply

- A test that already fails and you are making it pass (red is established).
- Pure refactors that neither add nor change a test's assertions.
- Deleting a test.

## Cross-references

- `.claude/rules/karpathy-principles.md` §4 — evidence beats assertion
- `.claude/rules/debugging-conventions.md` — a cause asserted from static
  analysis is a hypothesis, not a finding
- `.claude/rules/session-discipline.md` §2 — regression recheck; net, not gross
- `.github/workflows/ci.yml:453` — "a check that runs but cannot fail the merge
  is not a guard, and '27 checks passed' does not distinguish the two"
- Issue #3648 — the seven-guard catalogue and the audit recommendation
