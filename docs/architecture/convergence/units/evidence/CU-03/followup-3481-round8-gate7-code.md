# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `be9e41107e04b638148b76d1072c68249764eb81`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (63): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 65,352/65,352 (cap 80,000)
- reviewed-diff sha256 (sent bytes): `f7cbe0d5a0d3a3d21873bf77e5f8837282083fc9080f368b5a231b183d218f94`
- full scoped-diff sha256 (pre-cap): `f7cbe0d5a0d3a3d21873bf77e5f8837282083fc9080f368b5a231b183d218f94`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## VERDICT
BLOCK  

The change introduces several regressions that undermine the security and correctness guarantees of Gate 7. In particular, the `--paths` scoping mechanism is broken – out‑of‑scope changes are still sent to the language‑model reviewer – and the new evidence‑artifact filtering can silently hide legitimate changes. Additional issues include duplicated case‑insensitivity logic, a subtle canonical‑URL handling bug that can create duplicate rows for percent‑encoded hosts, and a risk that the platform now treats log files as documentation without revisiting downstream secret‑scanning expectations. These defects are high‑severity and must be fixed before the PR can be merged.

---  

## FINDINGS  

### 1. **[severity: high] Scoped diff not filtered before LLM review**  
**What breaks:** The `--paths` option is intended to restrict the reviewer (and the LLM) to only the files that match the supplied prefixes. The helper that performs the filtering, `filter_diff_paths`, is defined but never used when constructing the prompt that is sent to the model. Instead, the full diff – including out‑of‑scope changes – is passed unchanged to `build_prompt` and `build_adjudication_prompt`.  

**Evidence (diff):**  

```diff
+def filter_diff_paths(diff: str, prefixes: tuple[str, ...]) -> str:
+    """The b/ paths a --paths scope keeps. Pure."""
+    kept: list[str] = []
+    for line in diff.splitlines(keepends=True):
+        if line.startswith("diff --git "):
+            target = line.rsplit(" b/", 1)[-1].strip()
+            keep = any(target.startswith(pre) for pre in prefixes)
+        if keep:
+            kept.append(line)
+    return "".join(kept)
```

Later, in `main` the diff is *not* filtered:

```diff
-    level, reasons = escalation(paths, f"{title}\n{body}\n{diff}")
+    level, reasons = escalation(paths, f"{title}\n{body}\n{diff}")
...
-    receipts = receipts_block(head_sha, a.paths, excluded, diff, "high")
+    receipts = receipts_block(head_sha, a.paths, excluded, diff, "high", artifacts=artifacts)
...
-    kind = pr_kind(paths)
+    kind = pr_kind(scoped_paths(paths, tuple(a.paths)) if a.paths else paths)
```

Only `scoped_paths` is used to compute the *kind* for the brief, but the diff itself (`diff`) is never passed through `filter_diff_paths`. Consequently, a reviewer running `gate7_review.py --paths docs/` will still see all code changes, violating the isolation guarantee of scoped reviews and potentially leaking confidential source code to the LLM.

**Impact:**  
* Out‑of‑scope source code (including secrets, proprietary logic, or vulnerable patterns) can be exposed to the language‑model reviewer, breaking the tenant‑scoping and security‑boundary guarantees.  
* The escalation checks (`escalation(paths, …)`) also operate on the full path list, so security‑critical warnings may be raised or suppressed incorrectly.  

**Required fix:** Apply `filter_diff_paths` to the diff *before* it is handed to `build_prompt`/`build_adjudication_prompt`, and use the filtered list for escalation as well.  

---  

### 2. **[severity: high] Evidence‑artifact dropping can hide legitimate changes**  
**What breaks:** The new `drop_evidence_artifacts` routine automatically removes any diff sections whose target path is under `docs/architecture/convergence/units/evidence/` unless the file is `README.md` or contains “rebuttal”. This is performed unconditionally for every PR (`if not a.include_evidence:`).  

**Evidence (diff):**  

```diff
+def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
+    """Remove preserved evidence artifacts from a unified diff. Returns the
+    reduced diff and every dropped b/ path, so the receipts can name them —
+    an exclusion the record cannot see is exactly the silent-scope failure
+    the receipts exist to prevent. Pure."""
+    kept: list[str] = []
+    dropped: list[str] = []
+    keep = True
+    for line in diff.splitlines(keepends=True):
+        if line.startswith("diff --git "):
+            target = line.rsplit(" b/", 1)[-1].strip()
+            keep = not is_evidence_artifact(target)
+            if not keep:
+                dropped.append(target)
+        if keep:
+            kept.append(line)
+    return "".join(kept), dropped
```

and the invocation:

```diff
-    if not a.include_evidence:
-        diff, artifacts = drop_evidence_artifacts(diff)
-        if artifacts:
-            print(
-                f"Gate 7: {len(artifacts)} preserved evidence artifact(s) excluded from review "
-                "(raw reviewer output / logs under units/evidence/, not author claims; "
-                f"--include-evidence keeps them): {', '.join(artifacts)}",
-                file=sys.stderr,
-            )
-        if not diff.strip():
-            print(
-                "error: nothing left to review after excluding evidence artifacts", file=sys.stderr
-            )
-            return 1
```

**Problem:** The `evidence` directory is a *contractual* location for historical reviewer artefacts, but it is also a legitimate place for the development team to store **new documentation or data files** that are part of the PR. By dropping them silently, reviewers lose visibility into those changes, and the receipts only note that they were excluded – they do not force the author to move the files elsewhere. This violates the “no hidden scope” principle and can lead to accidental omission of required documentation or, worse, maliciously hidden code under the guise of an evidence file.

**Impact:**  
* Legitimate documentation or data changes can go unreviewed, causing documentation drift.  
* An attacker could place malicious code inside the evidence tree (e.g., a script named `run.sh`) and the review would never see it unless `--include-evidence` is used.  

**Required fix:**  
* Require an explicit `--include-evidence` flag for *any* PR that modifies files under the evidence directory, failing the review otherwise.  
* Or, better, treat the evidence directory as **read‑only** for the PR author and reject any modifications to it outright, emitting a clear error rather than silently dropping them.  

---  

### 3. **[severity: medium] Duplicate case‑insensitivity handling (DRY violation)**  
**What breaks:** Two separate pieces of logic perform case‑insensitive handling of URLs:

* `_urls_in` in `mira-crawler/ingest/origins.py` lower‑cases the *scheme* only for detection:

  ```diff
-        and n.value.startswith(("http://", "https://"))
+        and n.value.lower().startswith(("http://", "https://"))
  ```

* `canonical_source_url` in `mira-crawler/ingest/store.py` lower‑cases *both* scheme and host for storage.

Both functions aim to make origin handling case‑insensitive, but they are implemented independently. If a future change adjusts the case‑insensitivity rules (e.g., adding support for a new custom scheme), the logic must be updated in two places, raising the risk of divergence.

**Impact:**  
* Future regressions where one function is updated but the other is not, leading to mismatched detection vs. storage (e.g., a constant `HTTPS://` could be discovered but stored with a different canonical form).  

**Required fix:** Extract a shared utility (e.g., `def scheme_and_host_lower(url: str) -> str`) and reuse it in both modules, ensuring a single source of truth for case handling.

---  

### 4. **[severity: medium] Canonical‑URL handling may create duplicate rows for percent‑encoded hosts**  
**What breaks:** `canonical_source_url` lower‑cases the entire host string, including any percent‑encoded characters. Percent‑encoding is case‑insensitive, but the database stores the literal string. Consequently, a URL with a host like `https://EXAMPLE.COM/%7A` (uppercase `%7A`) will be canonicalised to `https://example.com/%7a`. If the original (uppercase) form already exists in `knowledge_entries`, the dedup guard will treat the canonicalised version as a *different* key, inserting a duplicate row.

**Evidence (implementation):**

```diff
+    host, colon, port = hostport.partition(":")
+    port = colon + port
+    return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

`host.lower()` lower‑cases the entire host, including any `%XX` sequences.

**Impact:**  
* Duplicate `knowledge_entries` rows for the same logical origin, breaking the uniqueness guarantee of `idx_ke_chunk_dedup`.  
* Over‑time this can bloat the table and cause the “conflict‑on‑insert” guard to miss true duplicates, potentially allowing private content to be re‑ingested as public.

**Required fix:** Preserve the original case of percent‑encoded octets when lower‑casing the host, e.g.:

```python
host = re.sub(r"%[0-9A-Fa-f]{2}", lambda m: m.group(0).lower(), host.lower())
```

or explicitly decode then re‑encode the host using `idna`/`urllib.parse` to a canonical form that normalises percent‑encoding.

---  

### 5. **[severity: medium] `--paths` scoping only influences PR‑kind, not escalation or receipts**  
**What breaks:** The code correctly uses `scoped_paths` to decide whether the PR is “code”, “documentation”, or “mixed”, but the escalation logic (`escalation(paths, …)`) and the receipts’ list of excluded paths both operate on the *full* `paths` list. This inconsistency means a scoped run could still trigger escalation warnings for out‑of‑scope files, or the receipts could claim “no excluded paths” while the model actually saw them.

**Evidence (diff):**  

```diff
-    level, reasons = escalation(paths, f"{title}\n{body}\n{diff}")
+    level, reasons = escalation(paths, f"{title}\n{body}\n{diff}")
...
-    receipts = receipts_block(head_sha, a.paths, excluded, diff, "high", artifacts=artifacts)
+    receipts = receipts_block(head_sha, a.paths, excluded, diff, "high", artifacts=artifacts)
```

`paths` is the full set; there is no filtering step before escalation or receipt generation.

**Impact:**  
* False‑positive escalation (e.g., “secret found in out‑of‑scope file”) that forces a reviewer to investigate unrelated code.  
* Inconsistent audit trail: receipts claim certain paths were excluded while the model actually processed them.

**Required fix:** Apply the same scoped filter (`filter_diff_paths`) to the list of paths passed to `escalation` and to the `excluded` calculation for receipts.

---  

### 6. **[severity: low] `.log` files now classified as documentation**  
**What breaks:** The change to `_DOC_SUFFIXES` adds `".log"`:

```diff
+_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
```

Log files often contain secrets (e.g., API keys) that secret‑scanning tools treat as code artefacts. By classifying them as documentation, downstream tooling that skips secret scans on documentation‑only PRs may inadvertently ignore dangerous leaks.

**Impact:** Potential secret exposure if a PR adds a new log file containing credentials.  

**Required fix:** Keep `.log` in the *code* suffix list or explicitly retain secret‑scanning on log files regardless of classification.

---  

## NOT REVIEWED  
* Runtime behaviour of the ingest pipeline beyond the unit‑test suite (e.g., handling of extremely large files, network errors, or concurrent writes).  
* Interaction of the new canonicalisation logic with any external services that ingest URLs (e.g., downstream analytics pipelines).  
* Performance impact of the extra `canonical_source_url` call on high‑throughput ingestion workloads.  

These gaps are outside the scope of the static code review but would need integration‑level testing before the change can be safely merged.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
