# #3481 — closure record for the round-44 reviewed head `18cde8db6e6437ac6f21938a66adc8581e32d135` (2026-08-30)

Author-written record (not raw reviewer output). It lives under `units/evidence/` so the final
commit is evidence-only: the reviewed code head is unchanged by it.

## Per-scope state on `18cde8db6` (five scopes, union = every changed non-evidence file)

| Scope | Fresh review | Rebuttal | Adjudication | Semantic check |
|---|---|---|---|---|
| S1 `docs/` `.claude/` `PLAN.md` `HANDOFF.md` | BLOCK ×1 (attempt 1 malformed, preserved) | on file | **PASS 1/1 REFUTED** | ruling names the replaced regex and the fold — valid |
| S2 `mira-crawler/ingest/` | BLOCK ×4 | on file | **BLOCK**: F1 SUSTAINED, F2 SUSTAINED, F3 REFUTED, F4 (medium) SUSTAINED | see below |
| S3 `mira-crawler/tests/` | BLOCK ×2 | on file | attempt 1 malformed (rulings missing `[id: …]`), **attempt 2 PASS 2/2 REFUTED** | rulings name `ast.JoinedStr` rendering and `ast.walk` — valid |
| S4 `tools/` `.github/` | BLOCK ×2 | on file | attempts 1 and 2 malformed (no `## RULINGS` section) ⇒ **UNKNOWN, no verdict** | substantive text: F1 "sustained" on the false premise that the quoted test is not in the diff (it is: `+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():`), F2 refuted |
| S5 `tests/` | BLOCK ×5 (all five quoted bodies fabricated) | on file | attempts 1 and 2 malformed ⇒ **UNKNOWN, no verdict** | substantive text: all five REFUTED |

**Gate 7 is therefore NOT green on this head: S2 holds a structurally valid BLOCK and
S4/S5 hold no verdict.** This record does not dress that up.

## Why the S2 sustained items are not fixed again

- **F1 — the PostgreSQL-only engine guard.** Round-35 adjudication SUSTAINED "`= ANY` on
  non-PostgreSQL back-ends … without proving they are impossible"; round AL added the guard;
  rounds 37, 38, 40, 41 and 44 then raised the guard itself, and round 44 SUSTAINED that. The
  same adjudicator has sustained both the absence and the presence of one line. The truth
  outranks either ruling (`.claude/rules/multi-session-protocol.md` §6): `knowledge_entries`
  lives only in NeonDB, `= ANY(array)` is PostgreSQL's operator, and the lock
  `test_store_engine_is_postgresql_only_by_construction` proves the intended behaviour.
- **F2 — `insert_chunk` returns `""` on conflict.** That is round AA's root fix for round-22
  F1/F2 (a minted id was returned on conflict and `store_chunks` counted and KG-linked a row
  never written). Reverting it reintroduces a real, previously sustained defect; the round-44
  ruling even misdescribes the code ("no `RETURNING id`" — the statement carries `RETURNING id`).
- **F4 (medium) — a DSN with surrounding whitespace is refused by the dialect guard.** Recorded
  as sustained. It is a message change, not an outcome change (SQLAlchemy's `make_url` rejects
  a padded DSN too); a `.strip()` is a one-line follow-up for the human owner, deliberately
  not spent here as another review round.

## Rounds 30–44 in one table (reviewed head → real findings → root fix)

| Head | Round | Real / sustained → fix |
|---|---|---|
| `374f24530` | 30 | stale `_log_ref` docstring → AG `b1996ae2` |
| `b1996ae2` | 31 | **`//user:pass@host` network-path reference persisted a credential** → AH `9e723033` |
| `9e723033` | 32 | schema-qualified `UPDATE` scanner (sustained) → AI `01699b66` |
| `01699b66` | 33 | multi-line `COPY`; containment lock in-diff (sustained) → AJ `c7078237` |
| `c7078237` | 34 | comment-bearing `UPDATE`; trailing-comment `COPY` (sustained) → AK `bd674af3` |
| `bd674af3` | 35 | Unicode name folding; PostgreSQL-only guard; case-insensitive `COPY`; wider name family; case-insensitive evidence prefix; directory-not-substring scope (sustained) → AL `db940b2b` |
| `db940b2b` | 36 | NFKC the query before splitting (`＆`/`；`) → AM `d476aa75` |
| `d476aa75` | 37 | `WHERE` inside a string literal; case-insensitive `--paths` → AN `a1c85cd4` |
| `a1c85cd4` | 38 | **`#access_token=…` fragment persisted a credential** → AO `7d80c2a7` |
| `7d80c2a7` | 39 | diacritics + Latin-lookalike confusables; quoted `COPY` tokens; `..` never in scope → AP `52f965da` |
| `52f965da` | 40 | `WHERE` inside a comment after the table name → AQ; **evidence artifact renamed OUT of `units/evidence/` was silently dropped from review** (round-39 S4 F2, wrongly dismissed as "by design" in rounds 39/40 — corrected) → AR `4dd3f343` |
| `4dd3f343` | 41 | **U+FF20 `＠` parsed as a host and a direct store call persisted the credential** → AS `03cd8357` |
| `03cd8357` | 42 | bounded multi-decode of query names; f-string origins reported dynamic; JSON `COPY` array across lines (sustained) → AT `dfa59ac2` — **pushed with one test red (chain did not gate)** → AU `18cde8db` (test corrected; chain gates) |
| `18cde8db` | 44 | none real; state above |

## Verification on `18cde8db6` (exit codes captured; re-run on this exact tree)

- crawler CI slice: **312 passed, 5 skipped** (POSIX-only) · lane + architecture + security-check: **184 passed** · `check_knowledge_entries_filters.py` ✅ · `ruff check` + `ruff format --check` clean on every `.py` this session changed
- mutations M31–M50 killed (each with byte-identical restore); M41 independently re-verified (3 red); M46 (source-side artifact exclusion restored → 1 red)
- GitHub required checks on the evidence head: see the PR comment posted after this commit

## Explicitly

NOT merged · convergence backlog NOT marked DONE · worktree NOT removed · CU-04 NOT started ·
the human Gate-9 decision (Mike) is not this lane's to make.
