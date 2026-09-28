# FLEET-012 — FINAL Review (independent, adversarial)

**Commit reviewed:** `2ed8e4ffdb52fbf6f492964c88c6d1009ecd14af` on branch `fleet/chatui-slice-12`
(2 commits ahead of `origin/fleet/chatui-slice-12` @ `d519c380f`; not pushed, per task constraint).
Reviewed in Bravo's own worktree (`.cao/worktrees/bba9ea89`) — re-ran everything from scratch.

## Scope claim under test

"`AssetChat.tsx`/`NodeChat.tsx` gain a local `restoreComposer` (byte-identical logic to Notebook
chat's tested CMPS-2 fix, not imported) called from the real-failure catch branch — restoring a
failed message to the composer unless the technician already started typing something new. The
abort/stop path is untouched."

## Independent verification

**1. Commit/branch/scope** — confirmed directly: 2 commits ahead, clean tree, `git diff
--name-only` shows exactly the 5 claimed files.

**2. Both component diffs read in full, plus the surrounding context beyond the diff hunk —
structurally identical across both files:**
- `restoreComposer(current, failedMessage)` — byte-identical `current.trim() ? current :
  failedMessage` logic to the Notebook chat reference I verified before writing the task.
- **Verified the placement relative to the abort path myself, not just trusted the diff hunk** —
  read the full surrounding `catch (err) { if ((err as Error).name === "AbortError") return; ...
  }` block in both files: the `AbortError` branch is an early `return`, so
  `setInput((current) => restoreComposer(current, text))` genuinely never executes on the
  stop/abort path — only on a real failure. Correct.
- **Verified `text` is genuinely `sendMessage`'s own parameter** (`const sendMessage =
  useCallback(async (text: string) => {...})`), in scope at the catch site with no plumbing
  needed — matches the claim.

**3. Tests — verified they exercise real branches, not trivially true assertions** (the specific
concern flagged going into this review, same discipline as FLEET-011's IME-test check):
- Empty composer → restores the failed message (exercises the falsy-`current.trim()` branch).
- A real in-flight draft → NOT clobbered, returns the draft unchanged (exercises the truthy
  branch).
- Whitespace-only composer content → still treated as empty and restores — this specifically
  proves the `.trim()` call is doing real work, not just a bare truthy check on `current`. A
  weaker/wrong implementation (e.g. `current ? current : failedMessage` without `.trim()`) would
  fail this exact test.
- Honestly disclosed, not silently skipped: the actual catch-block *wiring* (a real fetch failure
  triggering `setInput`) isn't directly tested, since this repo's Vitest has no jsdom/interaction
  simulation — noted in HANDOFF.md rather than glossed over. I independently covered this gap
  myself via direct code reading (point 2 above), so the review as a whole still verifies the
  wiring, just via a different method than a unit test.

**4. Fresh exhaustive check across the full files (not just the diff)** — this window's
established standard (FLEET-007/011):
- `restoreComposer` appears exactly once as a definition + once as a call site, per file — no
  duplication.
- Both `setInput("")`-clearing sites per file (`handleSubmit` and `handleKeyDown`) call the SAME
  `sendMessage`, which has the ONE catch block now fixed — confirming there's no second,
  un-covered send path that would need its own fix. No missed site.

**5. Targeted tests — re-run myself:**
```
$ bun run vitest run src/components/AssetChat.test.tsx src/components/namespace/NodeChat.test.tsx
 ✓ src/components/namespace/NodeChat.test.tsx (3 tests) 1ms
 ✓ src/components/AssetChat.test.tsx (6 tests) 7ms
 Test Files  2 passed (2)
      Tests  9 passed (9)
```
Matches exactly.

**6. Full-suite — re-run myself, checked the math against the established clean baseline** (244
files / 2445 tests): `245 files / 2451 tests` — 244+1=245 (new `NodeChat.test.tsx`); 2445+6=2451
(3 new tests each file) — exact match, zero regression.

**7. Targeted + full tsc — re-run myself:** targeted grep empty; full tsc 32 errors, same 7
pre-existing files as every prior slice this window.

**8. Environment note verified as genuine, not covering anything up.** The worker reported a
gitleaks pre-commit false-block from a stale persisted cwd (same class of issue I hit myself
during FLEET-007's review) — this is a tooling/environment artifact, not a code defect, and the
worker correctly diagnosed and worked around it rather than silently retrying or skipping the
hook.

## Findings

**None BLOCKING. None IMPORTANT.** Clean.

## Acceptance criteria verified

| Criterion | Result |
|---|---|
| Commit/branch/push state matches claim | ✅ |
| File scope matches task authorization exactly (5 files) | ✅ diff read in full |
| Both files kept in lockstep | ✅ byte-identical diffs |
| `restoreComposer` matches Notebook chat's reference logic exactly | ✅ verified |
| Fix placed after the `AbortError` early-return (never fires on stop/abort) | ✅ verified by reading the surrounding block, not just the diff hunk |
| `text` genuinely in scope, no plumbing needed | ✅ verified |
| Tests exercise real branches, not trivial (specific concern this review) | ✅ verified, including the whitespace-`.trim()` case |
| Fresh exhaustive check: no duplicate, no missed second send path | ✅ |
| Targeted + full-suite vitest | ✅ re-run, exact match, zero regression |
| Targeted + full tsc | ✅ re-run, empty / unchanged baseline |
| Source modified during this review | ❌ none — read-only independent verification |

## Remaining known limitations

The catch-block wiring itself has no direct unit test (no jsdom in this repo's Vitest setup) —
disclosed honestly by the worker, and independently covered by this review's direct code reading
instead. Not a gap in confidence, just a gap in automated-test coverage that would need a
different testing approach (or an integration/e2e layer) to close, out of scope for this slice.

---

**VERDICT: PASS**
