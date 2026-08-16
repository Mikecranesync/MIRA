# /gate7-review

Run the **Gate 7 independent adversarial review** on a PR and produce the evidence block a
`docs/architecture/convergence/units/CU-*.md` record cites.

Doctrine: `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md` §Gate 7 — *the
implementation agent does not perform final review.*

## Usage

```bash
py tools/gate7_review.py <PR>                 # auto-detect effort from the diff
py tools/gate7_review.py <PR> --xhigh         # force xhigh
py tools/gate7_review.py <PR> -o /tmp/g7.md   # write the report to a file
```

Requires at least one of `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHERAI_API_KEY` — all
Doppler-managed:

```bash
doppler run -p factorylm -c dev -- py tools/gate7_review.py <PR> -o /tmp/g7.md
```

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | A review was produced | **Read the verdict** — 0 does not mean PASS |
| 2 | The whole cascade failed | Fall back to a substitute panel (below) and **record the deviation** |
| 1 | Usage / PR fetch error | Fix the invocation |

## Reviewer

**No OpenAI** (owner decision, 2026-08-16). The doctrine's original "GPT-5.6 Sol / Codex"
default is dropped — it had no configuration, credential, or vendor identity anywhere in the
repo. The lane runs on the free-tier **Groq → Cerebras → Together** cascade already proven in
`.github/workflows/code-review.yml`.

**Say what this is, and what it isn't.** Independent here means *a different vendor and model
from the implementing agent, on a fresh context, briefed to disprove.* It is **not** a second
human, and the reviewer did **not** run the tests. Gate 7 is one check of eleven. A unit record
that implies more than that is drifting — the generated report carries this caveat inline, so
paste it whole rather than summarising it away.

## Effort escalation

`escalation()` in `tools/gate7_review.py` implements the §Gate 7 auto-xhigh list
deterministically (database/schema, UNS, asset identity, authn, authz, tenant scoping, security
boundaries, cross-repo contracts, prod deployment, destructive changes, concurrency/state, and
broad multi-module changes by count). It is a zero-token artifact — the stable half of the
reasoning is code, not a per-run model judgement
(`.claude/rules/zero-token-architecture.md`). Locked by `tests/test_gate7_review.py`.

## When the cascade is down (exit 2)

Dispatch the `gate7-adversarial-reviewer` agent as a substitute panel — ideally 3 agents on
distinct axes (e.g. factual re-derivation, doctrine/scope compliance, defect hunt), each with
`isolation: "worktree"` and fresh context. This is what CU-P1 and CU-02 did.

**Record the deviation in the unit record.** A substitute walk is legitimate for docs-only and
CI-only units; it is **not** legitimate for an auto-xhigh unit (CU-03 and anything tenancy-,
schema-, or auth-adjacent). Those wait for the real lane.

## Reading the result

- **BLOCK** → fix at the root, then re-run. Round 1 BLOCK → fix → round 2 PASS is the normal,
  healthy shape; record both rounds.
- **PASS with findings** → the findings still go in the record. A PASS is not "nothing found".
- **PASS with "None found"** → check that it answered the follow-up (*what could these tests
  structurally not catch?*). An empty answer there is a weak review, not a clean bill of health.
- A **high** finding forces BLOCK even if the model wrote PASS — a review that lists a
  high-severity defect and then approves is contradicting itself, and the finding is the
  evidence.

## Related

- `.claude/agents/gate7-adversarial-reviewer.md` — the posture, and the substitute-panel role
- `tools/gate7_review.py` · `tests/test_gate7_review.py`
- `docs/architecture/convergence/units/CU-11.md` — this lane's unit record
- `.github/workflows/code-review.yml` — the general per-PR cascade review (different job:
  broad quality pass on every PR, not the per-unit adversarial gate)
