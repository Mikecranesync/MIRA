# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Tests depend on an external `sources.yaml` that is not version‑controlled** — the new curation gate (`shared_corpus_source_allowed`) is exercised only with URLs to `ibiblio.org`, which the tests assume are present in the curated‑hosts list. No fixture, mock, or repository‑included `sources.yaml` is added or patched in the PR, and the tests never load a controlled copy of that file.
- **[high] Potential bypass of the `is_private` requirement via `** — kwargs` forwarding** — the repository‑wide AST scanner in `TestCallerPopulationExplicit` treats a call that forwards `**kwargs` (i.e. a `None` keyword name) as “explicit” and therefore does **not** flag it. A caller could invoke `store.insert_chunk(**payload)` where `payload` lacks the mandatory `is_private` key, causing a runtime `TypeError` that would surface only in production code paths not covered by the test suite.
- **[medium] Incomplete case‑normalisation for URL schemes** — the new test `test_uppercase_file_scheme_validated_as_file` checks that an uppercase `FILE://` URI is accepted, but the implementation may only lower‑case the **scheme** after parsing, while later path‑handling logic (e.g. `os.path.normpath` or `Path.resolve()`) could be case‑sensitive on Windows, potentially allowing a malformed `FILE://` path to bypass the containment check. The test does not verify the path‑resolution step on case‑sensitive filesystems, leaving a gap.
- **[medium] Missing enforcement of maximum redirect hop limit for mixed‑scheme redirects** — the redirect‑handling tests cover pure HTTP→HTTP and HTTP→file redirects, but they do not verify that a **curated HTTP** hop followed by a **non‑HTTP** (e.g., `data:` or `ftp:`) hop is rejected *before* the second request is made. If the implementation only checks the scheme after following the redirect, an attacker could embed a malicious `data:` URI as the final hop, bypassing the curation gate.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Tests depend on an external `sources.yaml` that is not version‑controlled** — the new curation gate (`shared_corpus_source_allowed`) is exercised only with URLs to `ibiblio.org`, which the tests assume are present in the curated‑hosts list. No fixture, mock, or repository‑included `sources.yaml` is added or patched in the PR, and the tests never load a controlled copy of that file.  
  - *Concrete trigger*: `test_full_pipeline` in `mira-crawler/tests/test_celery_tasks.py` calls `ingest_url("https://ibiblio.org/manual.pdf", ...)` and asserts success, while the test does **not** set up `sources.yaml` or monkey‑patch the host‑allow list.  
  - `test_curated_host_allowed` in `mira-crawler/tests/test_write_path_visibility.py` also calls `shared_corpus_source_allowed("https://ibiblio.org/kuphaldt/...")` and expects `ok` to be `True`.  
  - **Diff evidence**:  
    ```diff
    -        result = ingest_url("https://example.com/manual.pdf", "ABB", "ACS580")
    +        result = ingest_url("https://ibiblio.org/manual.pdf", "ABB", "ACS580")
    ```  
    ```diff
    -        result = ingest_url("https://example.com/test.pdf")
    +        result = ingest_url("https://ibiblio.org/test.pdf")
    ```  
  Because the curated‑hosts list is loaded from an external file at runtime, these tests will pass on a developer machine that has `ibiblio.org` present in their local `sources.yaml`, but will fail in a clean CI environment or in production where the file may differ. This creates a **false‑green** scenario that defeats the security guarantee of the gate.

- **[severity: high] Potential bypass of the `is_private` requirement via `**kwargs` forwarding** — the repository‑wide AST scanner in `TestCallerPopulationExplicit` treats a call that forwards `**kwargs` (i.e. a `None` keyword name) as “explicit” and therefore does **not** flag it. A caller could invoke `store.insert_chunk(**payload)` where `payload` lacks the mandatory `is_private` key, causing a runtime `TypeError` that would surface only in production code paths not covered by the test suite.  
  - *Concrete trigger*: Any function that builds a dict of parameters and forwards it without guaranteeing the presence of `is_private`. The scanner’s exemption logic is the line:  
    ```python
    if "is_private" in kwarg_names or None in kwarg_names:
        continue  # explicit, or **kwargs forwarding
    ```  
  This logic silently accepts forwards, opening the possibility of a missing required argument slipping through static checks, which defeats the purpose of the gate and could re‑introduce the original #1833 leak.

- **[severity: medium] Incomplete case‑normalisation for URL schemes** — the new test `test_uppercase_file_scheme_validated_as_file` checks that an uppercase `FILE://` URI is accepted, but the implementation may only lower‑case the **scheme** after parsing, while later path‑handling logic (e.g. `os.path.normpath` or `Path.resolve()`) could be case‑sensitive on Windows, potentially allowing a malformed `FILE://` path to bypass the containment check. The test does not verify the path‑resolution step on case‑sensitive filesystems, leaving a gap.  
  - *Concrete trigger*: The test line:  
    ```diff
    +        uri = (tmp_path / "m.pdf").as_uri().replace("file://", "FILE://", 1)
    ```  
  If the implementation performs a naïve `uri.lower().startswith("file://")` and then passes the original `uri` to the containment logic without normalising the scheme, Windows could treat the path differently, leading to a possible directory‑escape. This is a **medium** risk because it would require a specific OS environment to manifest.

- **[severity: medium] Missing enforcement of maximum redirect hop limit for mixed‑scheme redirects** — the redirect‑handling tests cover pure HTTP→HTTP and HTTP→file redirects, but they do not verify that a **curated HTTP** hop followed by a **non‑HTTP** (e.g., `data:` or `ftp:`) hop is rejected *before* the second request is made. If the implementation only checks the scheme after following the redirect, an attacker could embed a malicious `data:` URI as the final hop, bypassing the curation gate.  
  - *Concrete trigger*: The test `test_non_http_redirect_refused` uses a single HTTP→file redirect, but does not combine a curated HTTP hop with a non‑HTTP final hop. The implementation could mistakenly allow the second hop after the first is validated.  
  - **Diff evidence** (showing the existing test, not the missing case):  
    ```diff
    -        start = "https://ibiblio.org/a.pdf"
    -        result, requested, _ = self._run(
    -            monkeypatch,
    -            start,
    -            {start: (302, {"location": "file:///etc/passwd"})},
    -        )
    ```

## NOT REVIEWED
- The actual implementation of `shared_corpus_source_allowed`, `insert_chunk`, `store_chunks`, and the redirect‑handling client is not visible in the diff, so we cannot confirm whether the described logic (e.g., scheme normalisation, hop validation, containment checks) is correctly coded.  
- Runtime behavior of the production environment (e.g., actual contents of `sources.yaml`, OS‑specific path handling, interaction with the real database) is not exercised by the provided tests.  
- Potential side‑effects of the new `is_private` column on existing migration scripts, backup/restore procedures, or roll‑back paths are not examined.  
- Observability (logging, metrics) for the new gate decisions is not verified in the diff.  

These gaps mean the PR could still introduce security regressions despite passing the current test suite.

## Cascade attempts

- `groq: ok`
