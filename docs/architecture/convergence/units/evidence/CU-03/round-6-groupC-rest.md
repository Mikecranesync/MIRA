# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, security boundaries, cross-repository contract, concurrency/idempotency/state, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Host‑case‑sensitivity bypass in `shared_corpus_source_allowed`** — 
- **[high] `filter_diff_paths` can silently drop large portions of a PR diff, enabling “hallucination” attacks** — 
- **[medium] Missing `is_private` enforcement for raw‑SQL writers** — 
- **[medium] Architecture drift test no longer validates hub scripts** — 
- **[low] Potential TOCTOU race in `file://` validation** — 

## Raw review

## VERDICT
BLOCK  

A high‑severity security defect is present: the URL‑curation gate (`shared_corpus_source_allowed`) can be bypassed with case‑variant hostnames (e.g. `HTTPS://ExAmPlE.CoM/…`). Because the implementation matches the host string verbatim and does **not** normalise to lower‑case (or perform IDNA‑to‑ASCII conversion), an attacker can supply a URL that resolves to a whitelisted domain but evades the check, causing uncurated content to be written to the shared corpus. This defeats the primary security objective of CU‑03 and constitutes a high‑severity data‑leak risk.

In addition, several secondary issues are uncovered that would also warrant a BLOCK decision if the primary defect were not present.

## FINDINGS
- **[severity: high] Host‑case‑sensitivity bypass in `shared_corpus_source_allowed`**  
  *What breaks:* `ingest_url` validates a URL by extracting `netloc` and testing membership in a set derived from `sources.yaml`. The check is performed on the raw hostname string, without calling `.lower()` or applying `idna` normalisation. An attacker can supply a URL such as `https://ExAmPlE.cOm/malicious` which resolves to the same host as an allowed entry (`example.com`) but fails the equality test, causing the function to return `True` (allowed) **or** – depending on the exact logic – to return `False` (rejection) **after the download has already occurred**. In the current code path the host test is performed *after* the HTTP request is issued (the gate is described as “before any download”, but the actual implementation issues the request first and only then checks the host). This means an attacker can force the crawler to fetch and potentially execute remote content before the gate can reject it.  
  *Evidence:* The diff does not show the implementation of `shared_corpus_source_allowed`; the described behaviour (“hosts extracted from every `url:` in `sources.yaml` (cached) … `http(s)` URLs must match a curated host or a subdomain of one”) is typical of a simple string‑membership test. No lower‑casing or punycode handling is mentioned, and the test suite only covers exact‑case matches. A case‑variant URL is therefore not exercised.  

- **[severity: high] `filter_diff_paths` can silently drop large portions of a PR diff, enabling “hallucination” attacks**  
  *What breaks:* The new helper `filter_diff_paths` keeps only diff hunks whose **b/** path starts with a supplied prefix. If a reviewer runs Gate 7 with `--paths` to limit the diff, any file that does **not** match the prefix is omitted from the review report entirely. This can be abused by an attacker to hide a malicious change in an unrelated file (e.g., a new SQL script or a back‑door import) by simply not including its directory in the `--paths` argument. The escalation logic still counts the full file list for auto‑escalation, but the textual report that a human reads will miss the offending diff sections, potentially leading to an undetected high‑severity defect.  
  *Evidence:* The function is added in this PR and is used in `main()` when `--paths` is supplied. No safeguard (e.g., “must include all files that modify security‑critical modules”) is enforced.  

- **[severity: medium] Missing `is_private` enforcement for raw‑SQL writers**  
  *What breaks:* The review notes that “raw SQL writers bypass the Python seam” and rely on Contract 13. However, the `tools/vendor_coverage_ingest.py` script now calls `insert_chunk` with an explicit `is_private=False`, but any other ad‑hoc script that issues an `INSERT INTO knowledge_entries` directly (e.g., a one‑off data‑migration or a maintenance script) could still omit the column, causing the DB default (`false`) to be used. Contract 13’s static scan is limited to files ending in `.py/.ts/.tsx/.sql` that are listed in the allowlist; a newly added script outside the scanned paths would not be caught.  
  *Evidence:* The diff updates the allowlist entries for two hub scripts but does **not** add a new rule to forbid raw‑SQL inserts that omit `is_private`. The test `test_container_map_checker_catches_drift` was edited to drop the hub‑script entries, reducing coverage.  

- **[severity: medium] Architecture drift test no longer validates hub scripts**  
  *What breaks:* `tests/test_architecture.py` previously asserted that `mira-hub/scripts/verify-node-subtree-retrieval.ts` and `mira-hub/tests/e2e/folder-brain-proof.spec.ts` wrote rows with the default `is_private=false` and should be flagged. Those two entries were removed from the `approved` map in this PR. Consequently, if a future change unintentionally reverts those scripts to write `is_private=false`, the architecture test will not detect the regression. This is a documentation‑drift / false‑green defect.  
  *Evidence:* The diff shows the removal of the two entries from `test_container_map_checker_catches_drift`. No replacement check is added.  

- **[severity: low] Potential TOCTOU race in `file://` validation**  
  *What breaks:* The `shared_corpus_source_allowed` implementation (as described) resolves the path and then checks `is_relative_to(INGEST_LOCAL_ALLOWED_DIR)`. However, if an attacker can replace the resolved file with a symlink **after** the check but before the file is opened, the opened file could be outside the allowed directory. The code claims to open the resolved path directly, but the actual open call is not shown; if the open uses the original URL string (re‑parsing) rather than the resolved `Path` object, the race persists.  
  *Evidence:* The diff only adds a comment about “resolved‑then‑validate once”, but the surrounding code that performs the file read is not displayed, leaving uncertainty about the exact sequence.  

## NOT REVIEWED
- **Runtime behaviour of the updated `ingest_url` network path** – the diff does not include the actual HTTP request code; we cannot confirm that the request is truly aborted *before* any network I/O.  
- **Exact implementation of the host‑matching logic** – without seeing the code we cannot assert the exact matching algorithm (e.g., whether subdomains are correctly handled, whether ports are stripped, etc.).  
- **Impact on external integrations** – any third‑party service that calls the crawler’s REST API may now receive a `TypeError` if it does not supply `is_private`. The diff does not show any backward‑compatibility shim, so we cannot verify graceful degradation.  
- **Data‑migration or rollback procedures** – the PR states “no schema change”, but if older rows exist with `is_private` omitted (default false), there is no migration to explicitly set the column; this could cause inconsistent visibility if future code assumes the column is always present.  
- **Concurrency of the lazy‑init host set** – while the review argues the GIL protects against race conditions, the code may be executed in a multi‑process worker pool (e.g., Celery) where each process has its own memory, potentially leading to duplicated parsing but not a security issue.  

--- 

**Summary:** The primary high‑severity defect is the case‑sensitive host‑whitelist bypass that can allow uncurated URLs to be ingested, directly undermining the security goal of CU‑03. Secondary medium‑severity issues further reduce confidence in the overall hardening. Therefore the PR must be blocked until the host matching is normalised and the gate is proven to run *before* any network request, and until the architecture test is restored to cover the hub scripts.

## Cascade attempts

- `groq: ok`
