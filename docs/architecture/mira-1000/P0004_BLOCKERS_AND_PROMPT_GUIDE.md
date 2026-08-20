# MIRA-1000 — Blockers, Friction, and How to Prompt the Next Slice

**Written:** 2026-08-20 · **By:** the Claude Code session that executed P0001 → P0003 and produced the P0004 map
**Audience:** (a) Mike, for the decisions only he can make; (b) the agent writing my next prompt.
**Companion:** `P0004_IMPLEMENTATION_MAP.md` (the repo archaeology). This file is *what is in my way* and *how to hand me the next task*.

---

## Part 1 — Decisions I cannot make from code

These are genuinely blocked on a human. I have deliberately not guessed at any of them.

| # | Decision | Why it blocks | Cost of guessing wrong |
|---|---|---|---|
| **D1** | **Which runtime serves technicians?** `mira-mobile` talks to the Hub TypeScript chat path; MIRA-1000 has been hardening the Python one (`Supervisor` → P0002 seam → P0003 telemetry). | Gates P0004C onward, and gates Cloud Gold reaching mobile at all (ADR-0037 requires per-turn telemetry, which exists only on the Python path). | Highest-cost mistake available. Wrong choice invalidates every later slice. |
| **D2** | **Is the 5-tab contract still frozen?** `nav.ts` says frozen, citing `docs/specs/hub-mobile-spec.md` (which exists). `PRODUCT_SURFACES.md` says conversation-first. | Gates P0004A — literally the first slice. | I'd be editing a file that another document declares immutable. |
| **D3** | **Journal shape.** Extend `equipment_notebook_turns` with `entry_kind` + nullable `question`, or model journal entries separately? | Gates P0004B and every "notebook" behavior. | A wrong table forks conversation history, attachments and RLS. |
| **D4** | **Gemini in the Hub cascade** (`route.ts:88`) contradicts Hard Constraint #2. Stale code or stale doc? | Not blocking, but it means one of the two is lying to every future session. | Low. |
| **D5** | **Who owns the approval layer?** Nothing implements it. | Gates P0004E (agentic writes). | I would otherwise be tempted to invent one inline — which would be a second approval system. |

**D1 is the one that matters.** If you answer only one thing, answer D1.

---

## Part 2 — Repository/process state that is in my way

### 2.1 Nothing in the MIRA-1000 stack is merged, and the stack is now four deep

```
main
 └── #3339 architecture anchor        (OPEN)
      └── #3340 P0001 discovery        (OPEN, CONFLICTING)
           └── #3341 P0002 seam        (OPEN)
                └── #3342 P0003        (OPEN, GREEN)
                     └── p0004-implementation-map (pushed, no PR)
```

Consequences:

- **My code has never run full CI.** Stacked PRs (base ≠ `main`) run **only `actionlint`** in this repo. Every quality claim I have made is from *local* runs. That is a real gap, and it will stay a gap until something retargets to `main`.
- **#3340 is CONFLICTING** — parent moved; conflict surface is only the three ledger files (`CURRENT.md`, `HISTORY.md`, `TRACKER.yaml`), no code. It needs a rebase, which is a separate claim I did not take.
- Each new slice inherits a longer rebase chain.

**What I need:** either a merge decision, or explicit "keep stacking, CI gap accepted."

### 2.2 The evidence bar costs ~30 minutes per data point

The full `mira-bots` suite takes **29–30 minutes**. Proving P0003 regression-free honestly required **five** of them (two P0003 passes, two after fixes, one baseline in a throwaway worktree) — roughly **2.5 hours of wall clock spent on one number**.

This is the single biggest drag on throughput, and it is fixable:

- **No committed baseline failure list exists.** I had to generate one by checking out the P0002 head into a temp worktree and running 30 minutes. A committed `docs/testing/mira-bots-baseline-failures.txt` would make every future diff instant.
- **56 pre-existing failures** (39 of them `test_email_adapter`) are permanent noise that mask real regressions. They are why a +2 delta hid behind an aggregate count for two rounds.
- **3 adapter tests fail collection** (`test_gchat_adapter`, `test_slack_relay`, `test_teams_adapter`) from `sys.path` module shadowing — they must be `--ignore`d on every run, forever, or fixed once.

### 2.3 My own mistakes worth encoding as rules

Stated plainly so the next session does not repeat them:

- I captured `tail -2` from the first two full-suite runs. **That summary line let a real regression hide for two rounds.** Always capture the full `FAILED` list (`-rf --tb=no`) and diff *names*, never totals.
- I recorded `observable: true` because a migration and a builder existed, while nothing wrote those columns from a real turn. **Schema existing is not observability.**
- I hypothesised "order dependence" for a suite delta. It was wrong — both extra failures were real regressions I caused. **Don't reach for flakiness as an explanation before diffing names.**
- I added a keyword argument to `RAGWorker._call_llm`, which is passed around as a callable in production (`engine.py:2263`) and stubbed in tests. **Check whether a method is used as a value before changing its signature.**

### 2.4 Environment traps that cost me real time

- Python on Windows **cannot read MSYS `/c/...` paths** — use `C:\...`. This silently failed a script mid-session.
- Files are **CRLF**; multi-line string replacements must normalise line endings or they match zero times.
- `cd` does not persist between tool calls; every command needs absolute paths.
- The Bash tool times out at 120 s by default — anything long must be backgrounded, and `pkill` on a backgrounded pytest **did not actually kill it** (a run I believed dead completed 20 minutes later and produced the number I needed).
- Worktrees accumulate. I created four this session and removed the one I owned; the repo already has 36.

---

## Part 3 — How to write my next prompt

Addressed to the agent drafting it. The P0001→P0003 prompts were good; these are the deltas that would make the next one land faster.

### 3.1 Answer the decisions in the prompt, or say "you decide and record it"

The single biggest accelerator. Every prompt so far has correctly told me to *stop and report* on ambiguity — which is right, but it means a round trip. If D1–D3 arrive **pre-answered**, P0004A–C become mechanical.

If a decision genuinely isn't made yet, say so explicitly:

> D2 is unresolved. Assume conversation-first, implement behind `MIRA_MOBILE_SHELL=conversation` (default off), and record the assumption in TRACKER.

That unblocks me without pretending the decision was made.

### 3.2 Declare the evidence bar, and make it cheap

Instead of "re-run the same baseline-vs-branch suite", specify:

> **Iteration gate:** `py -3 -m pytest tests/test_p0003_connected_caller.py tests/test_engine.py tests/test_router_coverage.py -q -p no:randomly` (< 10 s).
> **Closure gate:** ONE full run with `-rf --tb=no`, diffed by name against `docs/testing/mira-bots-baseline-failures.txt`.

And ideally, as its own tiny slice: **commit that baseline file.** It converts a 30-minute question into a `diff`.

### 3.3 State the stack and merge posture up front

One line saves me a full preflight round:

> Stack on #3342 (`66ce26976`). Do not rebase #3340. No merges. CI gap accepted.

### 3.4 Name the files I may touch, and the ones I may not

The P0003 prompt's *"avoid `engine.py` unless absolutely necessary because overlapping PRs exist"* was excellent — it directly shaped my design (I connected at `RAGWorker._call_llm` instead). More of that. For P0004:

> Touch: `mira-mobile/src/**`. Do not touch: `mira-hub/src/app/api/**`, any migration, any Python — unless D1 says otherwise.

### 3.5 Keep the closure vocabulary, drop the re-verification

`BUILT / CONNECTED / TESTED / OBSERVABLE / PROVEN` is genuinely good — it caught two overclaims of mine. Keep it.

But: don't ask me to re-read things the ledger already records. "Re-read #3339/#3341/#3342 state" cost a round every time and never once changed the answer after the first check. Better: *"TRACKER is authoritative; verify only that no new PR touches `mira-mobile/src`."*

### 3.6 Give me one slice, with its rollback

The best prompts I got were the narrow ones. P0003 was near the size limit — four parts (connect, telemetry, contract, inspect) in one slice, and the two closure gaps came from exactly the parts that got least attention. **P0004A alone is a better prompt than P0004A–C.**

### 3.7 Keep the budget line

`$0.00` in every prompt has been unambiguous and useful. Keep it, and if a paid lane ever opens, state the dollar cap in the prompt itself per ADR-0037.

---

## Part 4 — A prompt template that would work well

```markdown
# Claude Code Prompt — MIRA-1000 / P0004A

Stack on #3342 (66ce26976). Do not rebase #3340. No merges. Paid inference $0.00.

## Decisions (already made — do not re-litigate)
- D1: <answer>
- D2: <answer>
- D3: <answer>

## Slice
<one sentence>

## Touch / Do not touch
Touch: <paths>
Do NOT touch: <paths>

## Evidence bar
Iteration: <fast command>
Closure:   ONE full run, -rf --tb=no, diffed by NAME against
           docs/testing/mira-bots-baseline-failures.txt

## Closure vocabulary
BUILT / CONNECTED / TESTED / OBSERVABLE / PROVEN — record honestly; PARTIAL is a valid result.

## Stop conditions
- a decision above turns out to be unimplementable as stated
- the slice requires touching a "do not touch" path
- another PR claims the same files
Report rather than improvise.
```

---

## Part 5 — What I would do next, if it were my call

1. **Answer D1.** Nothing else in P0004 is safe to sequence without it.
2. **Commit the baseline failure list** (one tiny PR). Pays for itself on the next slice.
3. **P0004A — conversation-first shell, client only.** Small, revertible, no runtime dependency, and it makes the product direction visible.
4. **Decide the merge posture** on the four-deep stack before it becomes five.

I am not blocked on anything I can do myself — the map is written and P0003 is GREEN. I am blocked on **D1**, and slowed by the **30-minute evidence loop**. Fix those two and the next three slices should be fast.
