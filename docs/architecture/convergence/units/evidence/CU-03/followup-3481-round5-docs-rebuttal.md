# #3481 round E (docs group, evidence-complete run) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round5-gate7-docs.md` — head `92f25b438645b9e100eb3f5b47ca6beb68f5afa7`,
scope `docs/` briefed as *documentation*, **170,702/170,702** chars (untruncated; sent-bytes sha256 =
full scoped-diff sha256 = `f432ffe49d56dd7ff76e779066ee3cfa5b339e8bcac6208cd4f3c35bbfe71230`).
The earlier 170,000/170,702 attempt is preserved as `-attempt1-truncated` and is not the prior here.

Every finding names as its **File** a preserved evidence artifact — the verbatim raw output of an
EARLIER review (`followup-3481-gate7-docs.md`, round A) or the lane's own stderr log — and quotes
that artifact's text as if it were a present-tense claim of this PR. Those files are committed
history of what a previous reviewer said; the PR's own claims live in `units/CU-03.md` and the
evidence `README.md`, which say the opposite. This adjudication runs on the **full** PR diff, so
every line below is visible as a `+` line.

## F1 / F2 / F4 — "False claim that `_read_validated` / `ingest_text_inline` / deduplication was fixed"

The record does not claim a fix for any of the three; it records them as REFUTED with no production
change made or claimed:

```diff
+  the reviewed code was already correct at `fc00074c6` and no production change was made or is
```
```diff
+  **R12-F1 REFUTED** — `os.supports_dir_fd` is a `set` (measured: Linux 3.12.3 `os.open in
```
```diff
+  **R12-F2 REFUTED** — `_shared.py` forwards `is_private=is_private` (a `+` line), all seven
```
```diff
+  on `final_url`. **R12-F3 SUSTAINED — accepted.** `_urls_in` matched only lowercase schemes, so the
```

(the `on \`final_url\`.` fragment closes the **R12-F4 REFUTED** sentence). The "documentation" each
finding cites is the round-A reviewer's own finding text, preserved verbatim in
`followup-3481-gate7-docs.md`.

## F3 — "False claim that case-sensitive URL discovery was fixed"

The fix and its test are in this PR:

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```
```diff
+++ b/mira-crawler/tests/test_conflict_and_packaging_contracts.py
```

## F5 — "Claim that `provenance_policy.yaml` was added" (medium)

The record states the file was added by #3268 and is untouched here:

```diff
+(a file #3268 itself added — nothing in the follow-up adds or changes it), **untruncated**
```

## F6 — "Claim that new contract tests were added and wired into CI"

Both are in this diff — the new test file (F3 above) and the CI slice line, which ends with
`tests/test_conflict_and_packaging_contracts.py -q)`:

```diff
+        run: pip install -r mira-crawler/requirements-celery.txt && (cd mira-crawler && pytest tests/test_write_path_visibility.py tests/test_store_verified.py tests/test_oem_trust.py tests/test_ingest.py tests/test_provenance_policy.py tests/test_ingest_lifecycle.py tests/test_conflict_and_packaging_contracts.py -q)
```

## F7 — "Security policy violation: full repository diff sent to an external LLM provider"

The cited line is the lane's own stderr log, preserved as evidence, and it records that the payload
was **redacted** and **capped** before leaving the machine:

```diff
+Gate 7: sending 78,857/78,857 diff chars to a third-party provider (redacted: IP/MAC/SN)
```

*Outside the diff, for the human reader:* this is the sanctioned Gate 7 design
(`.claude/commands/gate7-review.md`; the `tools/gate7_review.py` header: the same free-tier cascade
has received every PR diff via `.github/workflows/code-review.yml` since 2026-04-20; redaction reuses
the canonical sanitizer and refuses to send if it is unavailable). The lane reviewing this PR is the
process, not a defect the PR introduces.
