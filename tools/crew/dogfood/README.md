# Dogfood Judge

A daily judge that walks FactoryLM/MIRA's **core product paths** against the live
staging Hub as real QA personas, classifies each **GREEN / YELLOW / RED** in
business language, and writes a one-page report a non-technical founder can read
in two minutes: **`qa/dogfood/latest-report.md`**.

It is the "is the product actually usable today?" companion to the bug-filing
`tools/crew/run_synthetic_workers.sh`. It reuses — never reinvents — the
verification gate (`tools/qa/create_issue.sh`), the staging persona auth states,
and the dedupe logic. The only new code is orchestration + the report.

## Run it

```bash
tools/crew/dogfood/judge.sh                  # dry-run (DEFAULT) — would-file, never touches GitHub
tools/crew/dogfood/judge.sh --check work-order
tools/crew/dogfood/judge.sh --file-issues    # file CONFIRMED REDs through the gate (still deduped)
QA_BASE_URL=http://host:port tools/crew/dogfood/judge.sh
```

Output: `qa/dogfood/latest-report.md` (the report) + raw transcripts under
`dogfood-output/qa-runs/dogfood-<ts>/` (evidence; not required reading).

## The four paths (`checks/*.check`)

| Check | Question it answers |
|---|---|
| `maintenance-tech` | Can a tech log in, open their asset, see live status, and get a **cited** fault answer that doesn't invent data? |
| `contextualization` | Is the asset grounded — identity, customer documents, UNS map? Exercises the proposed→trusted approval wall **when proposals exist** (reports NOT EXERCISED otherwise — never passes it vacuously). |
| `work-order` | Does a completed work order keep its resolution + close time on read-back? (re-verifies #2375) |
| `demo-readiness` | Can a prospect follow the ProveIt story end to end: asset → fault → live signal → cited evidence → recommended action? |

## Verdict contract

A `.check` is a sourced bash fragment that sets `SCN_*` metadata and defines
`run_check()`, which prints human `EVIDENCE:` lines and then **one verdict on its
last line**:

- `GREEN` — a real user can do this today.
- `YELLOW:<reason>` — works but degraded (reported, not auto-filed).
- `RED:<reason>` — a customer/demo is blocked (file-eligible).
- `INFRA:<reason>` — auth failure / unreachable / non-JSON → flaky, **never filed**.

Reasons are **business language** (the report is read by a founder, not an SRE):
"`signals` returns `[]`" → "the live status panel is empty; a prospect sees
nothing moving."

## Filing rules (enforced by `judge.sh`)

1. **Never from one persona alone.** A RED is re-run under a *second* persona's
   session (`SCN_VERIFIER`); both must reproduce it. Finder == verifier → refused.
2. **Ambiguous → not filed.** If the verifier session disagrees, the path is
   downgraded to YELLOW and not filed.
3. **Repro evidence required.** Both transcripts are embedded in the issue body.
4. **Dedupe first.** Every RED routes through `create_issue.sh`, which searches
   open+closed issues and declines (comments) on a match. **Prove a new check's
   `SCN_DEDUPE` term surfaces the intended issue with `gh issue list --search`
   before trusting it** — a silently-empty term creates duplicates.
5. **Dry-run by default.** Real filing needs `--file-issues`.

## Tenant note (methodology — keep this honest)

The RBAC personas live on a **synthetic test tenant** (assets seeded; live
signals/docs sparse), so YELLOWs there reflect that tenant's state. The dedicated
**demo tenant** (live conveyor signals) needs `DEMO_API_TOKEN`, which is not
provisioned for this harness — so demo-readiness is *reported*, not auto-driven.
The report states this so an empty test tenant is never dressed up as a product
failure.

## Add a path

Drop a new `checks/<name>.check` (copy an existing one), point it at endpoints
you've **probed live**, give it distinct finder/verifier personas and a
dedupe term you've **verified surfaces the right issue**. Run `--check <name>`
until the verdict is right, then add it to the daily run.

## Tests

`bash tools/crew/dogfood/test_judge.sh` — hermetic (no Hub, no GitHub; checks
emit fixed verdicts, `create_issue` shimmed). Proves classification, the
two-persona gate, ambiguous downgrade, dedupe-decline, and report shape.
