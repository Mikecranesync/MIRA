# CU-03 — Gate 7 evidence (intact, verbatim)

Full outputs of every real-lane Gate 7 round for PR #3268, preserved unmodified per
doctrine §Gate 7 ("full outputs are preserved intact as unit evidence — summaries do
not satisfy the evidence requirement", amendment of 2026-08-16). Dispositions live in
`../CU-03.md`; nothing here is edited.

| File | Round | Scope | Result |
|---|---|---|---|
| `round-1-crash.log` | 1 | full diff | lane crashed (Windows subprocess encoding fails-open — fixed in-branch) |
| `round-2-crash.log` | 2 | full diff | lane crashed (cp1252 report write — fixed in-branch) |
| `round-3-full-diff.md` | 3 | full diff (truncated at 40k) | BLOCK — 1 real [high] (`file://` carve-out), fixed |
| `round-4-full-diff.md` | 4 | full diff (truncated) | BLOCK — 0 surviving after triage |
| `round-5-full-diff.md` | 5 | full diff (truncated) | BLOCK — reviewer's NOT-REVIEWED notes admit findings concern truncated code |
| `round-6-group{A,B,C}-*.md` | 6 | `--paths` groups (untruncated) | BLOCK ×3 — 0 surviving |
| `round-7-group{A,B,C}-*.md` | 7 | `--paths` groups | BLOCK ×3 — 2 cheap hardenings taken, 0 surviving |
| `round-8-group{A,B,C}-*.md` | 8 | `--paths` groups + verbatim-quote rule | BLOCK ×3 — 0 surviving |
| `round-9-group{A,B,C}-review.md` | 9.1 | `--paths` groups | BLOCK ×3 (9 findings) |
| `round-9-group{A,B,C}-rebuttal.md` | 9.2 | author rebuttals, verbatim quoted evidence | — |
| `round-9-group{A,B}-adjudication-1-scope-limited.md` | 9.3 | adjudication, scope missing referenced files | SUSTAINED correctly — quotes not visible in scoped diff (the mechanism judging on evidence) |
| `round-9-group{A,B}-adjudication-2-PASS.md` | 9.4 | adjudication, evidence-complete scope (`--diff-cap 48000`) | **PASS ×2** (A: 2/2 refuted; B: 4 refuted + 1 medium sustained, non-blocking) |
| `round-9-groupC-adjudication-PASS.md` | 9.3 | adjudication | **PASS** (high refuted; 1 medium sustained, non-blocking) |

Groups: A = `mira-crawler/{tasks,ingest,crawler,main.py}` · B = `mira-crawler/tests/` ·
C = `tools/ mira-bots/ mira-hub/ tests/ .github/ docs/`. Every file excluded from a
group's scoped diff is printed in that run's output and covered by another group.
