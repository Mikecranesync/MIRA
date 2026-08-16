# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, security boundaries, cross-repository contract, concurrency/idempotency/state, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Missing `is_private` bind parameter in `vendor_coverage_ingest.py:insert_chunk`** — 
- **[high] Call‑site breakage for the new `is_private` kw‑only argument** — 
- **[medium] Potential regression in FAQ visibility (`learning_ingester.py`)** — 
- **[low] Incomplete removal of read‑allowlist entries** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Missing `is_private` bind parameter in `vendor_coverage_ingest.py:insert_chunk`**  
  The function signature was changed to require a keyword‑only `is_private: bool` and the SQL statement now binds `:is_private`. However the parameter dictionary passed to `engine.execute` does **not** include an `"is_private"` key. This will raise a `sqlalchemy.exc.StatementError` at runtime (missing bind value) and abort any vendor‑coverage ingest job that reaches this path.  
  `tools/vendor_coverage_ingest.py` lines ~200‑215 show the SQL text with `:is_private` and the accompanying dict that lacks the key.

- **[severity: high] Call‑site breakage for the new `is_private` kw‑only argument**  
  The same `insert_chunk` function is used elsewhere in the repo (e.g., the main crawler code, `tasks/ingest.py`, etc.). The diff only updates a subset of call sites (the PR mentions 12 updates) but the file `tools/vendor_coverage_ingest.py` itself contains **no** updated call sites after the signature change. Any existing call that supplies positional arguments will now raise a `TypeError: insert_chunk() missing 1 required keyword‑only argument: 'is_private'`. This will crash the process before any database interaction. The missing updates are visible because the function definition now ends with `*, is_private: bool` while the surrounding code does not show a corresponding call.

- **[severity: medium] Potential regression in FAQ visibility (`learning_ingester.py`)**  
  The audit changed rows inserted by `learning_ingester.insert_faq` from `verified=True` to `verified=False` while also marking them `is_private=True`. Downstream services that display FAQs may filter on `verified=True` and now silently omit these rows, leading to a functional regression (FAQs no longer appear). The code change is explicit (`tools/mira-bots/tools/learning_ingester.py` lines 188‑194) but there is no accompanying test that validates the consumer behavior, so a hidden regression is possible.

- **[severity: low] Incomplete removal of read‑allowlist entries**  
  `tests/test_architecture.py` had entries that warned about default‑false `is_private` in the two Hub scripts. Those entries were removed, but the new scripts now write `TRUE`. The allowlist test (`tools/qa/security/knowledge_entries_read_allowlist.yml`) still contains entries for the old column positions (e.g., `mira-crawler/ingest/store.py:50`), and the hash values were updated, but there is no new entry asserting that the *TRUE* write is allowed. If the allowlist logic expects an exact query shape, this could cause a false‑negative “read‑allowlist violation” that is not exercised by the current test suite.

## NOT REVIEWED
- **Full call‑site coverage for the new `is_private` argument** – the diff is truncated after `tools/vendor_coverage_ingest.py`; we cannot see the rest of the file where `insert_chunk` might be called. It is possible that some call sites were correctly updated, but we cannot verify from the provided fragment.

- **Runtime behavior of the `shared_corpus_source_allowed` URL gate** – the implementation of the host‑matching and `file://` containment logic is not shown. We cannot assess whether it correctly handles edge‑cases such as IDN domains, Unicode normalisation, or TOCTOU race conditions on the resolved path.

- **Impact of changing `verified` to `false` on downstream FAQ consumers** – without executing the full integration test suite or inspecting the consumer code, we cannot confirm whether this change silently breaks any feature.

- **Potential schema migration requirements** – the `knowledge_entries` table already has an `is_private` column with a default, but we have not inspected the migration history. If the column were recently added without a `NOT NULL` constraint, inserting `TRUE` may be safe; otherwise, a migration might be required, which is not present in the PR.

## Cascade attempts

- `groq: ok`
