# HANDOFF — PR #3481, CU-03 Gate 9 gap closure

**Date:** 2026-08-29
**Branch:** `fix/pr3268-gate9-gaps` (worktree `.claude/worktrees/pr3268-gate9-gaps`) · **PR:** #3481 (base `main`)
**Plan:** `PLAN.md` (this PR's autonomous scope) · **Record:** `docs/architecture/convergence/units/CU-03.md`
§"Follow-up PR #3481" (rounds A–W) · **Evidence:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-*`
**Status:** PARTIAL — code + records complete through round W; the round-23 fresh review of the
final head is recorded in the final evidence commit (see §6). **Not merged; never merges itself.**
The remaining decision is the human Gate 9 / merge.

---

## 1. What this continuation did (PLAN rows)

| PLAN row | Result |
|---|---|
| 1 Gate 7 contract fixes | ✅ landed earlier on this branch (`dbd377e98`…`4abb63d00`): no round/attempt cap, every malformed attempt preserved and retried by a fresh call, BLOCK-with-zero-findings ⇒ UNKNOWN, strict adjudication shape (one `## RULINGS`, one `## VERDICT`, exact identity bijection, severity from the prior report), all locked in `tests/test_gate7_review.py` |
| 2 Honest fresh closure on the final code head | ⏳ round T's valid code BLOCK (F2/F3 high) was **not** accepted as closure: root-fixed in round U; round U/V/W findings root-fixed or refuted with verbatim evidence (§3); fresh review of the final head = round 23 (§6) |
| 3 Audit record + visible GitHub comms | ⏳ CU-03 + evidence README current through round W; PR body/comments + issues #3482/#3483 updated in the final commit |
| 4 Independent verification | ✅ §4 |
| 5 Final-head CI + this handoff | ⏳ CI on the final head + round-23 outcome appended in the final evidence commit |

## 2. Code changes on this continuation (all in `mira-crawler/ingest/store.py`, all red-first)

1. **`canonical_source_url` — expanded canonical identity (round U, `77b05c0c5`).** Scheme + host
   lower-cased (as before); an explicit default port removed for `http` (80) / `https` (443)
   including equivalent digit spellings (`:0443`), compared as strings after stripping leading
   zeros — **never `int()`** (a >4,300-digit port raised `ValueError` on the first draft); the hex
   digits of every valid `%HH` escape upper-cased in userinfo/path/query/fragment, nothing decoded,
   invalid `%` text byte-exact; non-default/empty/invalid port text and every other scheme
   byte-exact; idempotent. Root fix for round-T code F2/F3 (SUSTAINED high).
2. **`insert_chunk` historical-spelling guard (round V, `e9d5655b1`).** When the supplied spelling
   differs from the canonical key, the tenant-scoped `chunk_exists` lookup (canonical OR raw) runs
   at the write boundary and a hit returns `""` — the existing row wins; a canonical spelling pays
   no extra query. Accepted from round-21 code F1(b).
3. **`insert_chunk` reports only what the DB wrote (round W, this commit).** The INSERT is
   `… ON CONFLICT … DO NOTHING RETURNING id`; the function returns the id the database yielded
   (`scalar_one_or_none()`) or `""` when no row came back — no driver-metadata fallback (a
   `rowcount` draft with a fallback was rejected by supervisor review and never committed). Closes
   round-22 code F1/F2 (a minted id was returned on conflict and `store_chunks` counted **and**
   KG-linked it).

4. **`_log_ref` never carries userinfo (round X, this commit).** The refusal-warning reference is
   built from `hostname` (IPv6 re-bracketed, `[2001:db8::1]:8443`) + explicit `port`, never
   `netloc` (which carries `user:secret@`); `<unparseable>` for non-numeric port text; the
   exact-URL hash is unchanged. Closes round-23 code F1 (real; reproduced end-to-end in the
   captured log). Lane: `test_deleted_evidence_artifact_is_dropped_and_receipted` locks that a
   deleted artifact is dropped (a claim three malformed attempts made; false).

5. **Lane: `kind` from the reviewed diff (round Y, this commit).** `tools/gate7_review.py` now
   classifies the PR kind from `reviewed_paths(diff)` — the post-scope, post-artifact-drop diff —
   instead of the PR's file list, which still carried dropped artifacts (code + raw evidence was
   briefed as "mixed"). `scoped_paths` removed. `main()`-level locks: code + raw evidence ⇒ code
   brief; docs + raw evidence ⇒ documentation brief; evidence-only ⇒ exit 1, no provider call;
   `--include-evidence` ⇒ documentation. Closes round-23 code F2 (medium, materially right).

6. **Whitespace at the canonical seam (round AA, this commit).** Surrounding whitespace is
   stripped from a recognised **http/https/file** URL before every other rule; a padded non-URL
   (bare/local path, drive letter) or a padded URL of any other scheme keeps every byte. Closes
   round-25 code F1 (real).
7. **The credential boundary (round AA, this commit).** `provenance.url_has_userinfo` — an
   http/https URL whose authority carries `user:password@` is refused fail-closed at the hop-0
   gate (`shared_corpus_allowed` / `enforce_visibility`, reached by
   `tasks/ingest.py::shared_corpus_source_allowed`; no second policy implementation) and at the
   store boundary (`insert_chunk`, `chunk_exists`, `ingested_source_urls`) **before
   canonicalisation and before any SQL**; never stripped into another identity, never persisted,
   never logged (refusal warnings carry `_log_ref` only). Authenticated sources use out-of-band
   secret-backed request headers, not URL userinfo. Closes round-25 code F2 (real, pre-existing
   on `main`). Parameter-capture locks prove the literal username/password never enters any SQL
   bind or log across insert, dedup lookup, batch store and the ledger probe (mixed request →
   only safe values queried, refused spelling never answered; all-userinfo → no query).

Supporting: `tools/qa/security/knowledge_entries_read_allowlist.yml` re-keyed for the two unchanged
`store.py` reads (`121→173`, `412→488`; hashes unchanged); four pre-existing test fakes now yield
the bound id from `execute()` (the contract changed); two mock-SQL assertions rephrased so
Contract 13 (`tests/test_architecture.py`) does not read them as a new writer (no allowlist entry).

## 3. Gate 7 outcomes on this continuation (every artifact + stderr log tracked)

| Round | Head | Docs group | Code group |
|---|---|---|---|
| T (prior) | `4abb63d00` | PASS 3/3 | valid **BLOCK**: F2/F3 high sustained — the "handed to Gate 9" framing was withdrawn; root-fixed |
| U | `77b05c0c5` | BLOCK ×2 (slice artifact; mechanism sentence) → adjudication attempts 1–2 malformed (preserved) → attempt 3 **PASS 2/2** | BLOCK ×3 → adjudication **PASS 3/3**; F1(b) guard accepted at the boundary → round V |
| V | `99f18d8e9` | BLOCK ×1 (settled finding re-raised on a pre-mechanism row) → attempt 1 malformed → attempt 2 **PASS 1/1** | attempt 1 malformed (essay) → attempt 2 **BLOCK ×3**: F1/F2 **real** → root-fixed (round W); F3 false, locked; adjudication attempt 1 malformed, **not retried** (fix, don't adjudicate) |
| W | `fa3041680` | BLOCK ×1 (same settled finding, third time) → adjudication **PASS 1/1** | attempts 1–3 malformed (preserved) → attempt 4 **BLOCK ×2**: F1 **real** (`_log_ref` leaked userinfo) → root-fixed (round X); F2 **materially right** (kind from the PR file list, not the reviewed diff) → root-fixed (round Y); not adjudicated (fix, don't argue) |
| X | `8204059a4` | not reviewed — superseded before review by the round-23 F2 correction | F2 was materially right (kind from the PR file list, not the reviewed diff) → root-fixed in round Y |
| Y | `60c61870d` | BLOCK ×1 (fabricated `is_evidence_artifact` body) → adjudication **PASS 1/1** | attempts 1–3 malformed (preserved) → attempt 4 **BLOCK ×2**: F1 fabricated (no `dict(rulings)`; locked explicitly), F2 **real** (`_urls_in` whitespace) → root-fixed (round Z); not adjudicated |
| Z | `8db09c2ea` | BLOCK ×3, all false on the diff → adjudication attempt 1 structurally PASS but **substantively void** (reasons unrelated to the findings) — recorded as invalid, not GREEN; fresh docs review on the new head | attempt 1 malformed (preserved) → attempt 2 **valid BLOCK**: Z-C1 **real** (whitespace) and Z-C2 **real, pre-existing** (userinfo persisted) → both root-fixed (round AA); Z-C3 settled/re-raised; Z-C4/Z-C5 false, non-blocking |
| AA | `24f1db7ff` | BLOCK ×1 on a fabricated quotation → adjudication attempts 1–2 malformed (preserved) — **no docs verdict yet** | **nine malformed attempts** (preserved; one overwritten by a re-run after a shell crash) — **no code verdict yet**; retries stopped by budget, not by any cap |

CI: green on `77b05c0c5` (33 pass); **Architecture Check red on `99f18d8e9`** (Contract 13 on this
PR's own mock-SQL assertions — fixed in `fa3041680`, where CI went green again: 30 pass / 0 fail at
last poll); final-head CI in the final evidence commit.

## 4. Verification (exit codes captured directly, no pipelines)

```bash
# crawler CI slice (the exact file list .github/workflows/ci.yml runs)
(cd mira-crawler && PYTHONUTF8=1 py -3 -m pytest tests/test_write_path_visibility.py tests/test_store_verified.py tests/test_oem_trust.py tests/test_ingest.py tests/test_provenance_policy.py tests/test_ingest_lifecycle.py tests/test_conflict_and_packaging_contracts.py tests/test_manufacturer_normalize.py -q)   # 243 passed, 5 skipped (POSIX-only; run in Linux CI)
PYTHONUTF8=1 py -3 -m pytest tests/test_architecture.py tests/test_gate7_review.py tests/test_knowledge_entries_security_check.py -q   # 170 passed
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 py -3 tools/qa/security/check_knowledge_entries_filters.py     # ✅ all reads classified
py -3 -m ruff check mira-crawler/ingest/store.py mira-crawler/tests/test_conflict_and_packaging_contracts.py   # clean
```

Mutations (hand-applied to `store.py`, the `TestCanonicalSourceUrl` + `TestRefusalLogging` classes
run, file restored byte-identical after each): 14 exercised — **13 killed**: M1 empty default-port
table, M2 escape fold removed, M3 escapes decoded, M5 userinfo not folded, M6 any digit run drops
the port, M7 authority-less path not folded, M8 `int()` port conversion restored, M9 boundary
guard removed, M10 guard looks up even for canonical spellings, M11 a conflict returns the minted
id, M12 the minted id is returned instead of the DB's, M13 `_log_ref` back on `netloc`, M14 IPv6
unbracketed; **M4** (`\d+` port digits) is an **equivalent mutant** under the string comparison —
recorded, not claimed as a lock. (The driver's first pass filtered only the canonical class and so
never ran the refusal locks; widened and re-run — stated here, not hidden.)

Red-first evidence: 22 canonical-identity cases + 1 boundary lock + 4 `RETURNING` locks + 2
userinfo locks each failed against the head that preceded their fix (`006910b07`, `77b05c0c5`,
`99f18d8e9`, `fa3041680`) and pass after; the preserved-direction locks passed before and after.
Operational note: the previous session's process exited while the mutation driver was running and
left `_upper_escapes` mutated in the working tree; caught by the next slice run (13 red), restored
from the committed line, re-verified (245 passed) before anything was committed.

## 5. Residuals (stated, not hidden)

- **Historical rows** written before canonicalisation keep their stored spelling (casing, `:443`,
  lower-case escapes); found by the exact raw-spelling lookup when a caller supplies that spelling;
  **not migrated** — a one-off dedup migration is the follow-up on #3482.
- **Lane provider:** Cerebras (402) and Together (400) unavailable; Groq alone with backoff
  (#3483). gpt-oss holds the briefed shape on most calls but not all — every malformed attempt is
  preserved under `-attemptN-malformed`, and a valid outcome was reached on every round except
  the round-22 code adjudication (deliberately not retried: real findings are fixed, not argued).
- `test_write_path_visibility.py` is not `ruff format`-clean at HEAD (pre-existing); only its added
  lines are formatted.

## 6. What remains / human actions

1. **Status: PARTIAL at `24f1db7ff` — code complete and verified; Gate 7 verdicts owed.**
   Resume on this UNCHANGED head: (a) docs adjudication attempt 3+ with the existing
   `followup-3481-round26-docs-rebuttal.md` (`--adjudicate … --diff-cap 400000`, full diff);
   (b) code review attempt 10+ (same `--paths`/`--settled` list as attempts 1–9; preserve every
   malformed attempt as `-attemptN-malformed.*`). A valid code BLOCK ⇒ root fix + new head +
   fresh reviews; a false finding ⇒ one evidence-bound adjudication. The lane's shape failure
   rate on this ~167k-char code diff with ten settled rounds is the operative limitation (#3483) —
   do not widen the parser to fish a verdict.
2. **PR/issue comms** — PR #3481 body + comment, PR #3268 closure pointer, issues #3482/#3483:
   updated to the final head in the final commit.
3. **Human Gate 9 / merge = Mike.** This branch never merges itself, never marks the convergence
   backlog DONE, never cleans the worktree, never starts CU-04.
