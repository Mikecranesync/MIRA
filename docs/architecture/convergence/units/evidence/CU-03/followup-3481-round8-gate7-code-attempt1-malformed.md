# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
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
**BLOCK**

The changes introduce several high‑severity regressions that were not caught by the new test suite and that break core security/consistency guarantees of the platform.

---  

## FINDINGS  

### 1. **[severity: high] `build_prompt` is called without the `kind` argument – the decision‑point reminder is never emitted for documentation PRs**  
*Impact*:  The reminder that “preserved review artifacts are historical evidence and **must not** be treated as present‑tense claims” is a critical safeguard.  When the PR is documentation‑heavy (`kind == "documentation"` or `kind == "mixed"`), the reminder is omitted because `build_prompt` falls back to its default `kind="code"`.  Consequently a reviewer (or an automated adjudicator) can mistakenly treat old reviewer logs as the PR’s own claims, re‑raising settled findings and causing “three‑round” runaway regressions that the Gate‑7 process explicitly guards against.  

*Evidence (diff)*:  

```diff
@@
-def build_prompt(
-    title: str,
-    body: str,
-    diff: str,
-    level: str,
-    paths: list[str],
-    kind: str = "code",
-) -> str:
+def build_prompt(
+    title: str,
+    body: str,
+    diff: str,
+    level: str,
+    paths: list[str],
+    kind: str = "code",
+) -> str:
@@
-        {diff[:MAX_DIFF_CHARS]}
-        ```
-        --- END UNTRUSTED PR DATA ---
-        {_truncation_notice(diff)}
+        {diff[:MAX_DIFF_CHARS]}
+        ```
+        --- END UNTRUSTED PR DATA ---
+        {_truncation_notice(diff)}{decision_point_reminder(kind)}
```

*Root cause*: `main()` still invokes the function with the old 5‑argument call:

```python
text, provider, attempts = call_cascade(
    build_prompt(title, body, diff, level, a.paths),
    max_tokens=24000,
)
```

so `kind` is never set to the actual PR classification.  

*Why the tests miss it*:  The test suite calls `build_prompt(..., kind=kind)` explicitly, so the reminder appears in the isolated unit test, but the production path never supplies `kind`.  

*Remediation*:  Pass the computed `kind` into the call, e.g.:

```python
kind = pr_kind(scoped_paths(paths, tuple(a.paths)) if a.paths else paths)
text, provider, attempts = call_cascade(
    build_prompt(title, body, diff, level, a.paths, kind=kind),
    max_tokens=24000,
)
```

and add a regression test that verifies the reminder is present for a non‑code `kind` when the function is invoked from `main`.

---

### 2. **[severity: high] `canonical_source_url` does **not** normalise default ports – duplicate logical URLs can be stored as distinct rows**  
*Impact*:  The dedup guard (`knowledge_entries` unique index on `(tenant_id, source_url, chunk_index)`) assumes that two URLs that resolve to the same resource have identical `source_url` strings.  Because the canonicaliser leaves an explicit default port (`:80` or `:443`) untouched, the following two URLs are treated as different keys:

```
https://example.com/path   → canonical → https://example.com/path
https://example.com:443/path → canonical → https://example.com:443/path
```

Both can be inserted for the same tenant and chunk index, violating the logical uniqueness contract, inflating storage, and breaking downstream analytics that assume one row per logical resource.  Moreover, the “dedup migration” mentioned in the comment will not coalesce these rows automatically, leaving stale duplicates after the fix.

*Evidence (diff)* – the port handling in `canonical_source_url`:

```diff
@@
-        host, colon, port = hostport.partition(":")
-        port = colon + port
+        host, colon, port = hostport.partition(":")
+        port = colon + port
         return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

There is no logic that strips `:80` for `http` or `:443` for `https`.  

*Why the tests miss it*:  The test matrix exercises mixed‑case schemes, IPv6, authority‑less URLs, Windows paths, and empty strings, but never a URL that includes an **explicit default port**.  Hence the omission remains unseen.

*Remediation*:  Extend the canonicaliser to drop the default port for the scheme:

```python
if (scheme == "http" and port == ":80") or (scheme == "https" and port == ":443"):
    port = ""   # drop default port
```

Add tests covering the two cases above and verify that the resulting canonical URLs are identical.

---

### 3. **[severity: medium] `_whole_dir_copy_dest` fails to recognise `COPY` lines that contain trailing comments or line‑continuations**  
*Impact*:  The packaging contract (F2) requires that **every** crawler image copies the *whole* `mira-crawler/` directory so the provenance manifest ships with the image.  The scanner used in `TestManifestPackaging.test_every_crawler_image_copies_the_whole_directory_onto_the_import_path` relies on `_whole_dir_copy_dest`.  Its regex anchors the line to the end (`\s*$`), so a Dockerfile line such as:

```dockerfile
COPY mira-crawler/ /app/  # copy all sources
```

or a multi‑line form using `\` continuation will not match, causing the test to pass even though the manifest is absent from the built image.  This opens a silent “manifest‑missing” regression that defeats the fail‑closed guarantee.

*Evidence (diff)* – the regex:

```diff
@@
-        m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
+        m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
```

The trailing `\s*$` forbids any comment or continuation token after the destination path.

*Why the tests miss it*:  All fixture Dockerfiles in the repository happen to have a clean `COPY` line without a comment, so the parser succeeds.  Real‑world Dockerfiles often contain comments for documentation.

*Remediation*:  Relax the regex to allow optional trailing comment or continuation, e.g.:

```python
m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(?:\./)?mira-crawler/?\s+(\S+)(?:\s+#.*)?\s*$', line)
```

and add a test case with an inline comment.

---

### 4. **[severity: medium] Windows drive‑letter paths are not normalised, leading to duplicate entries on case‑insensitive filesystems**  
*Impact*:  `canonical_source_url` treats a single‑letter scheme that is *not* followed by `//` as a bare path (e.g. `C:\Docs\file.pdf`).  The function returns the path unchanged, preserving the original drive‑letter case.  On Windows, the filesystem is case‑insensitive, so `C:\Docs\File.pdf` and `c:\docs\file.pdf` refer to the same file but will be stored as distinct `source_url` values, breaking the dedup guarantee and potentially causing storage bloat for tenants that ingest Windows‑style paths.

*Evidence (diff)* – the early‑return guard:

```diff
@@
-    if not sep or not _SCHEME_RE.fullmatch(head) or (len(head) < 2 and not rest.startswith("//")):
-        return url  # not a URL (bare path, Windows drive letter `C:\…`) — untouched
+    if not sep or not _SCHEME_RE.fullmatch(head) or (len(head) < 2 and not rest.startswith("//")):
+        return url  # not a URL (bare path, Windows drive letter `C:\…`) — untouched
```

*Why the tests miss it*:  The test suite only covers URL‑style inputs; it never supplies a Windows‑style path with differing drive‑letter case.

*Remediation*:  Normalise the drive‑letter to upper‑case (or lower‑case) before storing, e.g.:

```python
if re.fullmatch(r"[A-Za-z]:[\\/].*", url):
    # Normalise drive letter to upper case and use forward slashes
    return url[0].upper() + url[1:].replace("\\", "/")
```

Add corresponding unit tests for mixed‑case drive letters.

---  

## NOT REVIEWED  

*Runtime performance impact of the additional canonicalisation (O(N) per URL) – not exercised in the CI tests but unlikely to be a blocker.  
*Potential side‑effects on any external services that consume the raw `source_url` string (e.g. downstream analytics pipelines) – would need integration testing.  

---  

**Summary** – The PR introduces a regression that suppresses a critical decision‑point reminder, fails to deduplicate URLs that differ only by default ports, and weakens the Dockerfile manifest‑packaging contract detection, while also overlooking case‑insensitive Windows paths.  These issues threaten data integrity, tenant isolation, and the security guarantees of the Gate‑7 review process.  The changes must be rolled back or corrected before the PR can be accepted.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
