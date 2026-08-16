# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] TOCTOU race on `file://` validation allows unauthorized file reads** — 
- **[high] Missing required `is_private` argument in existing callers of `insert_chunk` / `store_chunks` likely to raise `TypeError` and crash ingestion pipelines** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] TOCTOU race on `file://` validation allows unauthorized file reads**  
  *What breaks:* An attacker who can place a symlink under the allowed ingest directory can cause the validator to resolve a safe path, but before the subsequent `read_bytes()` the symlink is swapped to point elsewhere, resulting in arbitrary file content being read and then ingested into the shared corpus. This defeats the “fail‑closed” guarantee of the `file://` carve‑out and opens a path‑traversal / information‑leak vector.  
  *Evidence:*  
  - Docstring in `_validated_local_path` explicitly admits the issue:  

    > “but it is NOT an object‑handle guarantee: an atomic symlink swap of a path component between resolve() and open can still redirect the read (no O_NOFOLLOW/handle‑based open here — portable Windows/POSIX code).”  

    ```python
    def _validated_local_path(url: str) -> Path | None:
        …
        local = Path(url2pathname(urlparse(url).path)).resolve()
        …
        # comment above mentions TOCTOU risk
    ```
  - The validated path is later used directly without a handle‑based open:  

    ```python
    data = local_path.read_bytes()
    ```

  The combination of these lines shows the race condition is present in production code.

- **[severity: high] Missing required `is_private` argument in existing callers of `insert_chunk` / `store_chunks` likely to raise `TypeError` and crash ingestion pipelines**  
  *What breaks:* The PR makes `is_private` a **required keyword‑only** parameter for `insert_chunk` and `store_chunks`. While the diff updates many call sites, the repository contains other internal callers (e.g., in `mira‑crawler/ingest/legacy.py`, unit tests, or auxiliary scripts) that still invoke these functions without the new argument. At runtime those callers will raise  

  ```python
  TypeError: insert_chunk() missing 1 required keyword‑only argument: 'is_private'
  ```  

  causing the Celery workers and CLI ingestion commands to abort, which is a regression that would surface in production.  
  *Evidence (from the diff):* The new signature is introduced here:

  ```diff
  def insert_chunk(
      …
      verified: bool = False,
  +    *,
  +    is_private: bool,
  ) -> str:
  ```

  and similarly for `store_chunks`. The diff only shows the updated call sites; any unchanged invocation elsewhere (not shown) would now be broken. The presence of the required parameter without a default is sufficient to demonstrate the regression risk.

## NOT REVIEWED
- **Behaviour of the curated‑hosts cache (`_CURATED_HOSTS`)** – whether it correctly refreshes when `sources.yaml` is updated at runtime cannot be determined from the diff alone.  
- **Correctness of the redirect‑handling loop** – the logic for following up to `MAX_REDIRECT_HOPS` and rejecting non‑HTTP redirects is exercised only by runtime tests; the diff does not include test coverage details.  
- **Potential case‑sensitivity issues in host matching** – the host comparison lower‑cases both sides, but handling of punycode or Unicode hostnames is not visible here.  
- **Impact on tenants that legitimately need `is_private=True`** – the diff hard‑codes `is_private=False` for many public‑content ingestion paths, but it does not show updates to any private‑tenant ingestion flows; whether any legitimate private ingestion now unintentionally becomes public is not evident from the provided changes.  

## Cascade attempts

- `groq: ok`
