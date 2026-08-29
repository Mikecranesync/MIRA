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
| `round-10-groupA-crawler-prod.md` | 10.1 | A (receipts-bound, High reasoning) | BLOCK — 3 findings |
| `round-10-groupA-rebuttal.md` | 10.2 | author rebuttal | — |
| `round-10-groupA-adjudication-1-quote-missed.md` | 10.3 | adjudication run 1 | BLOCK — F1/F3 REFUTED; F2 sustained on "quote not present" (the quote IS at `+` lines of the diff — grep-provable) |
| `round-10-groupA-adjudication-2.md` | 10.4 | adjudication run 2, byte-anchored rebuttal | BLOCK — ALL sustained, contradicting run 1 — **adjudicator variance; stopped per no-re-roll; DISPUTED** → resolved by round 12 below (no Gate 9 waiver exists) + repo-visible locks in `mira-crawler/tests/test_conflict_and_packaging_contracts.py` |
| `round-10-groupB-crawler-tests.md` + rebuttal + adjudication | 10 | B | review BLOCK ×4 → adjudication **PASS (4/4 refuted)** |
| `round-10-groupC-rest.md` + rebuttal + adjudication | 10 | C (code prefixes) | review BLOCK ×5 → adjudication BLOCK: 3 refuted, **1 real high sustained** (truncated-view-only receipt hash) → fixed (dual-hash receipts) |
| `round-10-groupD-docs-attempt1-malformed.md` | 10 | D (docs) | findings unparseable (no `severity:` keyword) — preserved; re-run below |
| `round-10-groupD-docs.md` + rebuttal + adjudication | 10 | D (docs; adjudicated on FULL untruncated diff) | review BLOCK (scope artifact) → adjudication **PASS** |
| `round-11-groupC-rest.md` + rebuttal + adjudication | 11 | C fresh review after the receipts fix | BLOCK ×3 → adjudication **PASS** (2 highs refuted; 1 medium sustained = recorded Windows-dev residual) |
| `round-12-groupA-final-head.md` (+ `.stderr.log`) | 12.1 (2026-08-29) | A + `provenance_policy.yaml` on the **FINAL head `fc00074c6`** — untruncated 78,857/78,857, High | BLOCK — 4 **new** findings (3 high, 1 medium); round-10 F1/F2/F3 did not recur |
| `round-12-groupA-rebuttal.md` | 12.2 | author rebuttal, verbatim diff quotes only; F3 conceded | — |
| `round-12-groupA-adjudication.md` (+ `.stderr.log`) | 12.3 | adjudication, scope + `tests/test_ingest.py` (85,217/85,217) | **BLOCK** — F1/F2/F4 REFUTED, F3 SUSTAINED (accepted; fixed at the root in the follow-up, proof commit `663144a14`; fresh review of the new head = the follow-up PR's Gate 7) |
| `followup-3481-gate7-{code,docs}.md` (+ `.stderr.log`) | #3481 round A (`0ee07b3f2`) | code group `mira-crawler/ tests/ .github/` · docs group `docs/` | BLOCK ×3 (one hardening taken) · BLOCK ×6 (docs-only scope artifact) |
| `followup-3481-round2-gate7-{code,docs}.md` (+ logs) | #3481 round B (`edb71a624`) | same groups | BLOCK ×6 (four hardenings + scanner self-test taken) · BLOCK ×7 (scope artifact) |
| `followup-3481-round3-gate7-{code,docs}.md` + `-{code,docs}-rebuttal.md` + `-{code,docs}-adjudication.md` (+ `-code-adjudication-attempt1-malformed.md`, logs) | #3481 round C (`611705cc5`) | code group; docs adjudicated on the **full** diff (117,974/117,974) | code: attempt 1 **UNKNOWN** (malformed ruling line, 6/7 parsed) → re-run **PASS** (0 sustained high; F4 medium + F7 low sustained) · docs: **BLOCK** (REFUTED read as "fixed"; wording clarified after, un-reviewed) — **escalated at the 3-round cap; not merged; awaiting fresh Codex Gate 9** |

Rounds 1–9 groups: A = `mira-crawler/{tasks,ingest,crawler,main.py}` · B =
`mira-crawler/tests/` · C = `tools/ mira-bots/ mira-hub/ tests/ .github/ docs/`.
**Correction (Gate 9 round 3):** that union did NOT cover `.claude/commands/gate7-review.md`
or `mira-core/scripts/ingest_equipment_photos.py` — the earlier "covered by another
group" claim here was false, and the two crash logs above were gitignored (`*.log`) and
absent from the PR until force-added on 2026-08-16. Round 10 adds `.claude/` and
`mira-core/` to group C so the union covers every file, and every round-10 report embeds
Run receipts (head SHA, scope, exclusions, chars sent/total, sha256 of the exact reviewed
diff bytes, requested reasoning_effort) so coverage is provable from the committed files.
The round-9 adjudicated "PASS" rows above are preserved as history but **VOID** — see
`../CU-03.md` § "Gate 9 round 3".
