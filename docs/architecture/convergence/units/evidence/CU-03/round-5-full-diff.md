# Gate 7 adversarial review — PR #3268

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, security boundaries, cross-repository contract, concurrency/idempotency/state, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## VERDICT
**BLOCK**

The changes introduce a new security boundary (the *curated‑source gate*) and a required `is_private` argument that are only partially enforced. Several high‑severity regressions are visible in the diff, and the test suite cannot guarantee that every write path respects the new contract.

---

## FINDINGS

- **[high] Missing `is_private` on some `insert_chunk`/`store_chunks` callers**  
  *What breaks:* The signature of `insert_chunk` ( `store.py:75‑85` ) was changed to require a keyword‑only `is_private: bool`. Any existing call that does **not** pass this argument will raise a `TypeError` at runtime, aborting the whole ingest task and silently dropping data.  
  *Evidence:* The diff shows the signature change, and a comment that “every call site (12 across …) now carries an explicit value”. The list of updated call sites is long, but the repository also contains other entry points (e.g., raw‑SQL helpers, external scripts, or future plugins) that are not shown in the fragment. Because the required argument has **no default**, the failure is immediate and would appear only in production logs, not in the current unit tests.  

- **[high] Redirect‑bypass of the curated‑source gate**  
  *What breaks:* `ingest_url` performs the curated‑source check **before** any network request (`shared_corpus_source_allowed(url)` at line ~70). The HTTP client is configured with `follow_redirects=False`, and the code (cut off) will manually follow redirects. However, there is **no re‑validation of each hop** after a redirect. An attacker can host a URL that redirects to an uncurated domain; the initial URL passes the gate, the redirect is followed, and the final content is ingested into the shared corpus. This defeats the primary security intent of CU‑03 I‑2.  
  *Evidence:* The gate is applied only to the original `url` (pre‑redirect) and the comment explicitly says “Redirects are followed MANUALLY … every hop is scheme‑checked and curation‑gated BEFORE its request is sent”, yet the visible code does **not** call `shared_corpus_source_allowed` again after a redirect. The missing re‑check is a structural gap that the existing “behavior‑lock” tests (which only hit direct URLs) cannot detect.  

- **[medium] Potential “raw‑SQL bypass” of the `is_private` contract**  
  *What breaks:* Contract 13’s “honesty test” covers raw `INSERT INTO knowledge_entries` statements, but the diff does **not** show any updates to those raw‑SQL files. If any raw‑SQL writer still relies on the DB default (`false`) for `is_private`, it will continue to create public rows outside the new seam, re‑introducing the #1833 leak.  
  *Evidence:* The PR description claims “vendor_coverage_ingest.py … now threads the required parameter into its own SQL”, but the diff does not contain that file, so the claim cannot be verified. Without an explicit change, the risk remains.  

- **[low] Host‑matching case‑sensitivity edge‑case**  
  *What breaks:* `shared_corpus_source_allowed` lower‑cases the hostname from the URL and compares it to a lower‑cased host set built from `sources.yaml`. This is correct for typical ASCII hosts, but IDN (punycode) or Unicode hostnames could bypass the check if the YAML entry uses a Unicode form while the URL presents the punycode representation (or vice‑versa). The comparison would treat them as different strings, allowing an uncurated source.  
  *Evidence:* Host extraction uses `urlparse(url).hostname.lower()`. No IDN normalization (`idna` encoding) is performed before the set membership test.  

---

## NOT REVIEWED

- **Full runtime behavior of the manual redirect loop** (code after the truncation point). We cannot see whether the author actually re‑validates each redirected URL; the finding above assumes it is not. A reviewer would need the rest of `ingest.py` to confirm.  
- **Coverage of all dynamic call patterns** (e.g., `**kwargs` forwarding, reflection, or import‑time monkey‑patches) that might invoke `insert_chunk`/`store_chunks` without the new kw‑arg. The static AST scan described in the PR may miss such dynamic uses.  
- **Effect of changing `learning_ingester` rows to `verified=False`** on downstream analytics or reporting pipelines that expect `verified=True`. The PR states “no live consumer”, but that cannot be proven from the diff alone.  
- **Behavior of the new `file://` validation on Windows** where path handling (`Path.is_relative_to`) may differ, especially with drive letters and UNC paths.  
- **Potential race conditions around the lazy‑init of `_CURATED_HOSTS`** in a multi‑process Celery worker pool (each process will load the module separately, but a forked worker that imports after the cache is populated could see a partially‑initialized set in very rare edge cases).  

These gaps are noted for the author but do not change the overall BLOCK verdict.

## Cascade attempts

- `groq: ok`
