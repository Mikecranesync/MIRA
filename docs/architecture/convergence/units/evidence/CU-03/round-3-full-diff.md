# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, security boundaries, cross-repository contract, concurrency/idempotency/state, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Unrestricted `file://` ingestion allows arbitrary local file reads** — `shared_corpus_source_allowed` in `mira-crawler/tasks/ingest.py` treats any URL beginning with `file://` as automatically allowed (`return True, "operator-initiated local ingest"`). The subsequent download logic (not shown) will read the file from the crawler host’s filesystem and write its contents into `knowledge_entries` as a shared‑corpus row (`is_private=False`). An attacker who can influence the URL argument (e.g., via a compromised feeder task) could cause the system to exfiltrate or publish arbitrary host files, violating tenant isolation and confidentiality. `file://` should be restricted to a whitelist of safe directories or disabled entirely.
- **[medium] Missing curation gate in `ingest_text_inline` leaves a parallel write path unchecked** — `mira-crawler/tasks/_shared.py` adds the `is_private` kwarg but does **not** invoke `shared_corpus_source_allowed` before storing. Any code that calls `ingest_text_inline` directly (outside the covered test suite) can write uncurated URLs into the shared corpus, reproducing the original I‑2 leak. This is acknowledged in the PR’s own “Discovery findings” (`#3269`), but the defect remains unfixed and untested.
- **[medium] Potential runtime TypeError for any missed call‑site** — The new required keyword‑only `is_private` argument is added to `store.insert_chunk`, `store.store_chunks`, and `tasks._shared.ingest_text_inline`. While the diff updates many known call sites, any undiscovered invocation (e.g., in scripts, external tools, or future modules) will raise a `TypeError` at runtime, causing a service outage. The existing tests only cover the updated paths; they cannot guarantee exhaustive coverage across the whole codebase.
- **[low] Non‑thread‑safe lazy initialization of `_CURATED_HOSTS`** — The module‑level cache in `ingest.py` is populated without a lock. In a multi‑threaded Celery worker (if configured to use threads) concurrent first accesses could race, potentially causing a partially‑initialized `frozenset` or duplicate parsing. The impact is minor (unlikely to corrupt data) but could lead to intermittent failures.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Unrestricted `file://` ingestion allows arbitrary local file reads** – `shared_corpus_source_allowed` in `mira-crawler/tasks/ingest.py` treats any URL beginning with `file://` as automatically allowed (`return True, "operator-initiated local ingest"`). The subsequent download logic (not shown) will read the file from the crawler host’s filesystem and write its contents into `knowledge_entries` as a shared‑corpus row (`is_private=False`). An attacker who can influence the URL argument (e.g., via a compromised feeder task) could cause the system to exfiltrate or publish arbitrary host files, violating tenant isolation and confidentiality. `file://` should be restricted to a whitelist of safe directories or disabled entirely.

- **[severity: medium] Missing curation gate in `ingest_text_inline` leaves a parallel write path unchecked** – `mira-crawler/tasks/_shared.py` adds the `is_private` kwarg but does **not** invoke `shared_corpus_source_allowed` before storing. Any code that calls `ingest_text_inline` directly (outside the covered test suite) can write uncurated URLs into the shared corpus, reproducing the original I‑2 leak. This is acknowledged in the PR’s own “Discovery findings” (`#3269`), but the defect remains unfixed and untested.

- **[severity: medium] Potential runtime TypeError for any missed call‑site** – The new required keyword‑only `is_private` argument is added to `store.insert_chunk`, `store.store_chunks`, and `tasks._shared.ingest_text_inline`. While the diff updates many known call sites, any undiscovered invocation (e.g., in scripts, external tools, or future modules) will raise a `TypeError` at runtime, causing a service outage. The existing tests only cover the updated paths; they cannot guarantee exhaustive coverage across the whole codebase.

- **[severity: low] Non‑thread‑safe lazy initialization of `_CURATED_HOSTS`** – The module‑level cache in `ingest.py` is populated without a lock. In a multi‑threaded Celery worker (if configured to use threads) concurrent first accesses could race, potentially causing a partially‑initialized `frozenset` or duplicate parsing. The impact is minor (unlikely to corrupt data) but could lead to intermittent failures.

## NOT REVIEWED
- **Full runtime behavior of the download path for `file://` URLs** – The actual file‑reading implementation (e.g., whether it uses `open`, `httpx` streaming, or another library) is not present in the diff, so we cannot verify path sanitisation, permission checks, or whether the file content is correctly bounded before insertion.

- **Interaction with external scripts or services that may still call the old signatures** – Without executing the full test suite or integration tests, we cannot confirm that all legacy entry points have been updated.

- **Database schema constraints for the `is_private` column** – The PR states “no schema change,” but we cannot see the actual DB definition. If the column is defined as `NOT NULL DEFAULT false`, existing rows inserted without the new parameter (e.g., via manual SQL) could still default to `false`, potentially re‑introducing the leak.

- **Effect of the new `is_private` flag on downstream read‑path contracts and permission checks** – We lack visibility into read‑side enforcement; the change may require updates elsewhere that are not covered by the diff.

## Cascade attempts

- `groq: ok`
