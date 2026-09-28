# #3487 human approval — doctrine and answer keys

Two human gates stand between PR #3487 and any paid benchmark run. This directory holds the review
material for both, and a manifest that records where each gate stands.

| Order | File | Decision it asks for |
|---|---|---|
| 1 | `DOCTRINE-REVIEW.md` | APPROVE AS WRITTEN / APPROVE WITH CHANGES / REJECT the rule `.claude/rules/general-intelligence-preservation.md` (sha256 `689ed97e…9365`) |
| 2 | `ANSWER-KEY-REVIEW.md` | APPROVE / CHANGE / REJECT each Technician Arena key (9 signable now, 3 waiting on fixtures) |
| — | `APPROVAL-MANIFEST.json` | machine-readable status of both gates; `paid_benchmark_authorized: false` |

Reviewed commit: `cdf7ae8567fe7a3940e473007017fafdf17035db`. Approval binds to **content hashes**
(the doctrine file's sha256 and each case's `key_sha256`), not to the commit, so later commits that do
not touch those files leave the review valid. The manifest test checks the hashes.

## One mechanism, not two

- **Answer keys** are approved only with the signing CLI that already exists (`keys.py`):
  `PYTHONPATH=evals/general-intelligence python -m technician_arena sign <case-id> --signer "<name>"`.
  The manifest mirrors signatures; it does not replace them. Scored runs refuse unsigned or edited
  keys in code.
- **The doctrine** had no approval mechanism. Its decision is recorded in `doctrine.approval` in the
  manifest (status `pending` → `approved` / `approved_with_changes` / `rejected`, with the approved
  sha256, reviewer and date).

## What actually blocks paid execution today

| Lane | Blocked in code by | Not checked by code |
|---|---|---|
| Technician Arena (`python -m technician_arena run`) | `--budget-usd` required; every **selected** key must be signed and intact | doctrine approval; this manifest; that `--case` matches `paid_scope_case_ids` |
| GI-1 (`runners/arena.py`) | `--budget-usd` required | key approval (no mechanism exists); doctrine; this manifest |

`run.py` applies `--case` **before** its signed-key check. A paid run can therefore cover only
the cases a human chooses; the 3 placeholder keys and the 3 seed keys need not be signed if they are
left out. The manifest records that choice as `answer_keys.technician_arena.paid_scope_case_ids`
(empty today = no scope chosen). The run must pass the same ids with `--case`. A natural first scope,
**for Mike to decide, not decided here**, is the 6 cases that are neither placeholders nor seeds:
`ta-general-coast-vs-ramp`, `ta-general-motor-hot-low-speed`, `ta-model-pf525-f005`,
`ta-model-pf525-f004`, `ta-hazard-defeat-interlock`, `ta-followup-bound-history`.

**The manifest is advisory.** Nothing reads it at run time. `paid_benchmark_authorized: false` records
that no human has authorized a paid run; it does not technically prevent one. As soon as the keys a
run selects are signed, the Technician Arena runner accepts a live run, even with the doctrine still
pending.
Wiring the runner to this manifest would change benchmark behaviour and was deliberately not done.

## Rules the test enforces (`tests/test_technician_arena.py`)

- The doctrine sha256 in the manifest equals the live file. An edited doctrine fails CI until it is
  re-reviewed.
- Each case's `key_sha256` in the manifest equals `keys.key_sha256()` of the live case. Signing does
  not change it; editing a key does.
- The GI-1 corpus sha256 and the text of the `.claude/CLAUDE.md` pointer line equal the live files.
- Any authorization claim needs the doctrine approved at the live sha256. On top of that:
  - the Technician Arena lane (and the top-level `paid_benchmark_authorized`) needs a non-empty
    `paid_scope_case_ids` with every listed key live-signed;
  - the GI-1 lane needs `gi1_corpus.approval.status == "approved"` at the live sha256.
