# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Missing `is_private` argument in existing call sites** — The new signature for `insert_chunk` and `store_chunks` requires a keyword‑only `is_private` argument. The diff updates many call sites, but any caller outside the shown files (e.g., external services, older scripts, tests, or future contributors) will now raise a `TypeError` at runtime, breaking ingestion pipelines and potentially causing data loss.
- **[high] TOCTOU race on `file://` validation** — `_validated_local_path` resolves the path and checks containment, but the actual file is read **after** this validation (`local_path.read_bytes()`). An attacker who can replace the file or its symlink between validation and read could cause the crawler to ingest arbitrary local files, violating the intended “operator‑only” restriction.
- **[high] Potential tenant‑leak via missing DB constraint** — The new `is_private` column is stored, but the migration does not add any database‑level policy (e.g., row‑level security) to prevent a tenant from reading another tenant’s private rows. Existing query paths that filter only by `tenant_id` may inadvertently expose private data if they join on `knowledge_entries` without checking `is_private`. This is a classic tenant‑isolation regression.
- **[medium] Removal of pre‑flight PDF size check** — The original implementation performed a `HEAD` request to reject oversized PDFs before streaming. The new code streams the file and aborts only after exceeding `MAX_PDF_BYTES`. This can cause unnecessary bandwidth consumption and may still allow a malicious server to deliver a huge payload before the abort triggers, increasing DoS risk.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Missing `is_private` argument in existing call sites** — The new signature for `insert_chunk` and `store_chunks` requires a keyword‑only `is_private` argument. The diff updates many call sites, but any caller outside the shown files (e.g., external services, older scripts, tests, or future contributors) will now raise a `TypeError` at runtime, breaking ingestion pipelines and potentially causing data loss.  
  `mira-crawler/ingest/store.py`  
  ```diff
  def insert_chunk(
      ...
-    verified: bool = False,
+    verified: bool = False,
+    *,
+    is_private: bool,
  ) -> str:
  ```
  The same change appears for `store_chunks`. No compatibility shim is provided, and the PR does not audit the whole repository for remaining usages.

- **[severity: high] TOCTOU race on `file://` validation** — `_validated_local_path` resolves the path and checks containment, but the actual file is read **after** this validation (`local_path.read_bytes()`). An attacker who can replace the file or its symlink between validation and read could cause the crawler to ingest arbitrary local files, violating the intended “operator‑only” restriction.  
  `mira-crawler/tasks/_shared.py`  
  ```diff
  if is_file_url:
-        local_path = _validated_local_path(url)
-        if local_path is None:
+        local_path = _validated_local_path(url)
+        if local_path is None:
             logger.warning(
                 "Refusing shared-corpus ingest of %s: file:// outside allowed dir", url[:80]
             )
             return {"url": url, "inserted": 0, "error": "uncurated_source"}
         try:
-            # Open the exact resolved path validation returned — never a
-            # re-parse of the URL.
+            # Open the exact resolved path validation returned — never a
+            # re-parse of the URL.
             data = local_path.read_bytes()
  ```

- **[severity: high] Potential tenant‑leak via missing DB constraint** — The new `is_private` column is stored, but the migration does not add any database‑level policy (e.g., row‑level security) to prevent a tenant from reading another tenant’s private rows. Existing query paths that filter only by `tenant_id` may inadvertently expose private data if they join on `knowledge_entries` without checking `is_private`. This is a classic tenant‑isolation regression.  
  `mira-crawler/ingest/store.py` (insert statement)  
  ```diff
  VALUES
      (:id, :tenant_id, :source_type, :manufacturer, :model_number,
       :content, cast(:embedding AS vector), :source_url, :source_page,
-      cast(:metadata AS jsonb), false, :verified, :chunk_type,
+      cast(:metadata AS jsonb), :is_private, :verified, :chunk_type,
  ```

- **[severity: medium] Removal of pre‑flight PDF size check** — The original implementation performed a `HEAD` request to reject oversized PDFs before streaming. The new code streams the file and aborts only after exceeding `MAX_PDF_BYTES`. This can cause unnecessary bandwidth consumption and may still allow a malicious server to deliver a huge payload before the abort triggers, increasing DoS risk.  
  `mira-crawler/tasks/_shared.py` (removed block)  
  ```diff
-        # Pre-flight size check for PDFs — avoids OOM on very large files
-        if is_pdf_url:
-            try:
-                head = httpx.head(
-                    url,
-                    timeout=10,
-                    follow_redirects=True,
-                    headers={"User-Agent": "MIRA-IngestBot/1.0 (KB builder)"},
-                )
-                content_length = int(head.headers.get("content-length", 0))
-                if content_length > MAX_PDF_BYTES:
-                    logger.warning(
-                        "Skipping %s — too large (%d MB > %d MB limit)",
-                        url[:80], content_length // 1024 // 1024, MAX_PDF_BYTES // 1024 // 1024,
-                    )
-                    return {"url": url, "inserted": 0, "error": "file_too_large"}
-            except Exception:
-                pass
  ```

## NOT REVIEWED
- **Database migration scripts** – The diff does not show the actual schema migration that adds the `is_private` column or any accompanying row‑level security policies. Without reviewing those, we cannot confirm that the column is created with appropriate defaults or constraints.
- **External services / API gateways** – Callers outside the `mira-crawler` package (e.g., other micro‑services, third‑party integrations) may still invoke `insert_chunk`/`store_chunks` without the new argument. Their behavior is not visible in the diff.
- **Unit and integration test coverage** – The PR mentions new red‑first tests, but we have not inspected their contents. We cannot verify that they exercise the TOCTOU window, tenant‑isolation checks, or the removed PDF pre‑flight logic.
- **Runtime environment differences** – Path handling on Windows (`is_relative_to` availability, `url2pathname` behavior) and the handling of environment variables like `INGEST_LOCAL_ALLOWED_DIR` are not exercised in the diff and could surface platform‑specific bugs.

## Cascade attempts

- `groq: ok`
