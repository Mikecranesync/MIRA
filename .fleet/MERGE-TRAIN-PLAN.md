# Post-Pixel merge train — PREPARED, NOT STARTED

**Do not begin until `.fleet/PIXEL-ACCEPTANCE.md` returns an overall PASS on the baseline.**
Serial, one PR at a time. Same protocol that ran nine PRs cleanly overnight.

---

## Rollback anchors — captured BEFORE any merge

| what | value |
|---|---|
| main before the train | **`1306ce989dca9dac3d6acf1732bd80c5afe5257f`** |
| short | `1306ce989` |
| last rollback tag | `rollback/2026-09-06-v3.327.3` |
| prod verified healthy at | `1306ce989` (app 200, re-verified 2026-09-06) |

**Rollback command (either PR, before or after deploy):**

```bash
# 1. revert the merge commit on a branch — never force-push main
git fetch origin main
git checkout -b revert/<pr> origin/main
git revert -m 1 <merge-sha>
git push -u origin revert/<pr>
gh pr create --base main --title "revert: <pr> — <reason>" --body "Rollback of <merge-sha>. Prod was healthy at 1306ce989."
# 2. merge that revert PR through the normal gate; deploy-vps redeploys automatically
```

**If prod is actively broken and a revert PR is too slow:** redeploy the known-good SHA rather
than hand-editing the VPS —
`gh workflow run deploy-vps.yml -f services="mira-hub"` from the revert branch once merged.
Do **not** `git reset` main. Do **not** touch the VPS directly.


> **Refreshed 2026-09-06.** Anchors above were re-derived; the originals pointed at `5307e922d`,
> which is 76 commits behind. Both HELD branches are stale by that many commits **but rebase
> cleanly** — verified by trial rebase, not assumed. None of the 76 commits touched
> `notebook-chat-utils.ts`, `AssetChat.tsx` or `NodeChat.tsx`, so the blast radius for these two
> PRs is zero despite the distance. Re-run the trial before trusting this line again.

---

## Order and rationale

`#3521` first: 2 lines + tests, one file, isolated, lowest blast radius. `#3531` second: larger,
and it changes failure-path transcript behaviour on two surfaces.

---

### Step 0 — gate

- [ ] Pixel baseline PASS recorded (screenshots in `~/pixel-acceptance/<ts>`)
- [ ] `git fetch origin && git rev-parse origin/main` still `1306ce989` — **main moves fast on this repo (76 commits in 5 days); if it moved again, re-derive these anchors before starting**
- [ ] prod healthy: `curl -sL -o /dev/null -w "%{http_code}" https://app.factorylm.com/`

### Step 1 — `#3521` (safety-stop excluded from LLM history)

Branch `fleet/chatui-slice-03` @ `9395f8911` — **trial-rebased onto `1306ce989` on 2026-09-06: CLEAN, 2 commits**

```bash
gh pr view 3521 --json mergeable,mergeStateStatus     # expect MERGEABLE (rebase if BEHIND)
gh pr checks 3521                                     # all green EXCEPT hold-gate (red = HELD marker)
gh pr edit 3521 --title "fix(hub): exclude a safety-stop turn from the LLM history payload"
# wait ~45s, confirm hold-gate flipped green, then:
gh pr merge 3521 --squash --delete-branch
```

- [ ] record merge SHA: ________________
- [ ] wait for `Deploy to VPS` = success on that SHA
- [ ] `curl` prod 200/200/401; deploy SHA == main
- [ ] **known-red, ignore:** `Namespace inline-create E2E` + `PrintSense Production Activation`
      (red on every main commit since 2026-08-17 / 2026-08-30 — see `#3398`)

**Stop the train if:** any other check fails, deploy fails, or prod degrades.

### Step 2 — `#3531` (Retry + duplicate-turn fix)

Branch `fleet/chatui-slice-13` @ `22ae52e2d` — **trial-rebased onto `1306ce989` on 2026-09-06: CLEAN, 3 commits**

```bash
gh pr view 3531 --json mergeable,mergeStateStatus     # will be BEHIND after step 1 — rebase:
#   cd /Users/charlienode/MIRA-worktrees/merge-train
#   git fetch origin && git checkout -B mt-3531 origin/fleet/chatui-slice-13
#   git rebase origin/main && cd mira-hub && bun run vitest run && npx tsc --noEmit -p tsconfig.json
#   git push --force-with-lease origin mt-3531:fleet/chatui-slice-13
gh pr edit 3531 --title "feat(hub): a real Retry button for AssetChat/NodeChat (CMPS-2, FLEET-013)"
gh pr merge 3531 --squash --delete-branch
```

- [ ] record merge SHA: ________________
- [ ] deploy success, prod healthy, deploy SHA == main

### Step 3 — focused Pixel Retry acceptance

Run **only §5 and §6** of `.fleet/PIXEL-ACCEPTANCE.md` against the new build.

- [ ] Retry re-sends with no retyping
- [ ] **the question appears exactly once** — the defect `#3531` fixes
- [ ] rapid Retry ×5 → one request, no duplicates, no crash

**If the question appears twice: roll back `#3531` immediately** (revert recipe above).

### Step 4 — ADR-0040

Branch `docs/adr-conversation-turn-state` @ `9264f22d4`. Docs only, no deploy impact.
Merge after step 3 so it documents what is actually live.

- [ ] merge SHA: ________________

### Step 5 — soak CI

Branch `soak/overnight-2026-09-01` @ `f4feac235`. Adds the fast PR tier, the nightly workflow,
and the vitest exclusion.

- [ ] confirm the fast tier runs inside `Hub Unit Tests` on its own PR
- [ ] after merge, `gh workflow run stream-soak-nightly.yml -f seeds=64 -f runs=2000` once by hand
- [ ] merge SHA: ________________

---

## Explicitly NOT in this train

Prepared, HELD, independent — land on their own merits, not bundled:

| branch | head | what |
|---|---|---|
| `fix/amber-marker-status-token` | `fbde59187` | tokenize the safety-alert marker; adds `--status-yellow-ink` (fixes a 3.19:1 → 5:1 contrast shortfall) |
| `fix/nodechat-gate-citations-on-outcome` | `cc1c0e25c` | a stopped NodeChat turn must not show citation chips (ADR-0040 §4; reachable since `#3527`) |
| `fix/namespace-e2e-unique-fixture` | `ffe8b4e1b` | byte-unique E2E fixture; unblocks the 2-week-red gate (does **not** fix `#3398` itself) |

`fix/nodechat-gate-citations-on-outcome` is the one worth prioritising after the train — it is a
correctness gap that tonight's `#3527` made reachable in production.
