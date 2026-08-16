# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Uncurated redirects may be followed because the client is not forced to disable auto‑redirects** — 
- **[high] Path‑traversal bypass for `file://` URLs** — 
- **[high] Environment‑variable‑at‑import bug – tests set `INGEST_LOCAL_ALLOWED_DIR` after the module is imported** — 
- **[medium] Upper‑case scheme handling may be inconsistent** — 
- **[medium] AST scanner may miss `is_private` passed via a variable‑expanded `** — kwargs` that does not contain the key**

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Uncurated redirects may be followed because the client is not forced to disable auto‑redirects**  
  *Trigger:* `TestRedirectHopValidation._run` creates a fake `httpx.Client` that asserts the constructor receives `follow_redirects=False` (line `assert k.get("follow_redirects") is False`). The production code that creates the `httpx.Client` does **not** pass this argument (the real `httpx.Client` API does not have a `follow_redirects` keyword – redirects are controlled per‑request). Consequently the assertion will fail, the test will raise an `AssertionError`, and the real implementation will continue to follow redirects. An uncurated redirect would therefore be fetched before the curation gate runs, violating the security contract described in the PR description.  
  *Evidence:*  
  ```python
  class _Client:
      def __init__(self, *a, **k):
          # Lock the contract: the ingest client must never auto-follow.
          assert k.get("follow_redirects") is False
  ```

- **[severity: high] Path‑traversal bypass for `file://` URLs**  
  *Trigger:* `TestCurationGate.test_file_scheme_traversal_cannot_escape` constructs a URI that contains a `..` segment **before** resolution (`escape = (inbox / ".." / "etc-passwd").as_uri()`) and expects the gate to reject it. If the implementation merely checks that the URI string starts with the allowed directory string, the `..` will be stripped only after the check, allowing the escape. The same issue exists for percent‑encoded traversal in `test_percent_encoded_traversal_cannot_escape`. Both tests would pass only if the code performs a real path resolution (`Path(...).resolve()`) **after** percent‑decoding. The diff does not show such logic, so a regression is possible.  
  *Evidence:*  
  ```python
  escape = (inbox / ".." / "etc-passwd").as_uri()
  ok, _ = self._gate()(escape)
  assert not ok
  ```

- **[severity: high] Environment‑variable‑at‑import bug – tests set `INGEST_LOCAL_ALLOWED_DIR` after the module is imported**  
  *Trigger:* Several tests (e.g., `test_file_scheme_reads_local_pdf`, `test_file_scheme_missing_file_returns_error`) set `INGEST_LOCAL_ALLOWED_DIR` via `monkeypatch.setenv` **after** importing `tasks.ingest` (or its sub‑modules). If the production code reads `os.getenv("INGEST_LOCAL_ALLOWED_DIR")` at import time, the tests will not actually affect the gate’s behavior, giving a false‑green result. The diff shows the environment is set **inside the test function**, not before the import, which is a classic source of hidden coupling.  
  *Evidence:*  
  ```python
  def test_file_scheme_reads_local_pdf(self, tmp_path, monkeypatch):
      monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
      monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(tmp_path))
      ...
      from tasks.ingest import ingest_url
  ```

- **[severity: medium] Upper‑case scheme handling may be inconsistent**  
  *Trigger:* `TestSchemeCaseNormalization.test_uppercase_file_scheme_validated_as_file` upper‑cases the `file://` scheme (`replace("file://", "FILE://", 1)`) and expects the gate to treat it as a valid file scheme. If the implementation uses `url.startswith("file://")` without normalising the scheme case, the uppercase URI will be rejected, breaking legitimate operator‑initiated ingestion. The same applies to the `HTTPS://` case.  
  *Evidence:*  
  ```python
  uri = (tmp_path / "m.pdf").as_uri().replace("file://", "FILE://", 1)
  ok, reason = self._gate()(uri)
  assert ok
  ```

- **[severity: medium] AST scanner may miss `is_private` passed via a variable‑expanded `**kwargs` that does not contain the key**  
  *Trigger:* The scanner in `TestCallerPopulationExplicit._scan_tree` flags a call as missing `is_private` when the keyword is absent in the call node, even if the call does `insert_chunk(**payload)` where `payload` may contain `is_private` at runtime. The test `test_scanner_rejects_bare_kwargs_forwarding` expects this to be flagged, but the scanner cannot guarantee the runtime content of `payload`. This creates a false‑positive safety net that could allow a developer to think the repository is fully protected while a call actually supplies `is_private` only via a dict that may be missing it in some code paths.  
  *Evidence:*  
  ```python
  src = "insert_chunk(**payload)\n"
  flagged = self._scan_tree(ast.parse(src), "synthetic.py")
  assert flagged == ["synthetic.py:1 insert_chunk("]
  ```

## NOT REVIEWED
- Actual implementation of `shared_corpus_source_allowed`, `ingest_url`, and the `store` layer – the diff only contains tests. Without seeing the production code we cannot confirm whether the functions correctly enforce the new `is_private` keyword, perform case‑insensitive scheme handling, resolve paths safely, or enforce the `follow_redirects=False` contract.
- Runtime behavior of the mocked `httpx.Client` versus the real client, especially concerning redirect handling and streaming download logic.
- Interaction with the database transaction layer (e.g., whether the `is_private` bound parameter is truly used in the generated SQL) – the test `test_sql_no_longer_hardcodes_visibility` only inspects source code via `inspect.getsource`, which could be fooled by a wrapper that still emits a literal in the final SQL.
- Whether the environment variable `INGEST_LOCAL_ALLOWED_DIR` is read lazily at each gate invocation or cached at import; this affects the validity of the environment‑setting tests.

## Cascade attempts

- `groq: ok`
