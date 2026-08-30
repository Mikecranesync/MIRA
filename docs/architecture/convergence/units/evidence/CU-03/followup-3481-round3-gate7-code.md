# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `611705cc5116a07c672b6a8e5cdf4b039ad94015`
- scope (--paths): mira-crawler/, tests/, .github/
- excluded by scope (15): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 30,255/30,255 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `c8a1d958d298aa33be69d2ed70561e6e314b5af62956dff4b289482d75881904`
- full scoped-diff sha256 (pre-cap): `c8a1d958d298aa33be69d2ed70561e6e314b5af62956dff4b289482d75881904`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Missing‑dependency simulation does not exercise the intended ImportError path** — 
- **[high] Platform‑guard test does not verify the actual guard logic** — 
- **[medium] Case‑insensitive URL detection may create duplicate policy entries** — 
- **[medium] Dockerfile manifest‑inclusion test ignores `.dockerignore` negation rules** — 
- **[medium] Un‑mocked database write in a test can corrupt CI state** — 
- **[medium] UPDATE‑scanner only matches a narrow set of patterns** — 
- **[low] CI workflow change adds a very large test file, increasing run time** — 

## Raw review

## VERDICT
**BLOCK**

The change introduces several high‑severity regressions that are not caught by the new test suite and that could break security guarantees or cause data‑corruption in production.

## FINDINGS

- **[severity: high] Missing‑dependency simulation does not exercise the intended ImportError path**  
  *Why it matters:* The gate’s security guarantee is that a missing `PyYAML` must cause a *fail‑closed* refusal, not an uncaught exception that aborts the Celery task. The test tries to simulate a missing library by inserting `None` into `sys.modules`, which **does not raise `ImportError`** – the import succeeds (returning `None`) and subsequent attribute access (`yaml.safe_load`) raises `AttributeError`. If the production code only catches `ImportError`, the exception will bubble up, aborting the task instead of refusing the write. The test therefore gives a **false‑green** result and may let a regression slip through.  

  *Evidence (diff):*  

  ```diff
  +        monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
  ```

  *File:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (line ≈ 150)

- **[severity: high] Platform‑guard test does not verify the actual guard logic**  
  *Why it matters:* Gate 7’s hardening required the guard `os.open not in os.supports_dir_fd` to prevent a `TypeError` on platforms where `os.supports_dir_fd` is a boolean. The test only asserts that `os.supports_dir_fd` is a `set`/`frozenset`, **not** that the guard check exists in the production code. If a future refactor removes the guard, the test will still pass, re‑introducing the original vulnerability.  

  *Evidence (diff):*  

  ```diff
  +        assert isinstance(os.supports_dir_fd, (set, frozenset))
  ```

  *File:* `mira-crawler/tests/test_ingest.py` (function `test_platform_guard_is_set_membership_and_reads_on_every_platform`, line ≈ 220)

- **[severity: medium] Case‑insensitive URL detection may create duplicate policy entries**  
  *Why it matters:* Changing `_urls_in` to `n.value.lower().startswith(("http://", "https://"))` makes the discovery step accept both `http://example.com` and `HTTPS://example.com`. The function returns the **original string**, so the same URL differing only by case will be recorded twice. Duplicate entries can cause ambiguous classification or policy‑merge conflicts, potentially opening a path for a malicious actor to insert an uppercase‑scheme constant that bypasses later checks.  

  *Evidence (diff):*  

  ```diff
  -        and n.value.startswith(("http://", "https://"))
  +        # Scheme match is case-insensitive (Gate 7 round-12 group A on #3268):
  +        # a constant written `HTTPS://...` is still a configured origin, and a
  +        # manifest discovery that missed it would leave the policy consistency
  +        # test vacuous for that origin.
  +        and n.value.lower().startswith(("http://", "https://"))
  ```

  *File:* `mira-crawler/ingest/origins.py` (around line 38)

- **[severity: medium] Dockerfile manifest‑inclusion test ignores `.dockerignore` negation rules**  
  *Why it matters:* The test `_whole_dir_copy_dest` and the subsequent `.dockerignore` scan treat any pattern that matches the manifest as a failure, **even when the file is later re‑included with a negation (`!mira-crawler/provenance_policy.yaml`)**. This can cause false CI failures (blocking legitimate changes) or, conversely, miss a real omission if the negation is omitted. The test’s logic therefore does not faithfully enforce the contract it claims to verify.  

  *Evidence (diff):*  

  ```diff
  +def _whole_dir_copy_dest(dockerfile_text: str) -> str | None:
  +    """The destination of a whole-directory copy of ``mira-crawler`` — shell form
  +    (`COPY mira-crawler/ /app/x/`, `COPY ./mira-crawler /app/x`) or JSON form
  +    (`COPY ["mira-crawler/", "/app/x/"]`). A subset copy (`COPY mira-crawler/tasks/`)
  +    deliberately does NOT match: it would not ship the manifest."""
  +    for line in dockerfile_text.splitlines():
  +        m = re.match(r"\s*COPY\s+(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
  +        if m:
  +            return m.group(1).rstrip("/")
  +        m = re.match(r'\s*COPY\s+\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line)
  +        if m:
  +            return m.group(1).rstrip("/")
  +    return None
  ```

  *File:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (function `_whole_dir_copy_dest`, line ≈ 380)

- **[severity: medium] Un‑mocked database write in a test can corrupt CI state**  
  *Why it matters:* The test `test_uppercase_scheme_unclassified_origin_is_refused_and_forced_private` calls `_insert(False, url)` **without monkey‑patching `store._engine`**, causing a real DB write (or at least a connection attempt) during CI. If the CI environment runs against a shared test database, this can leave stray rows, affect other tests, or even fail when no DB is reachable.  

  *Evidence (diff):*  

  ```diff
  +        _insert(False, url)
  ```

  *File:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (function `test_uppercase_scheme_unclassified_origin_is_refused_and_forced_private`, line ≈ 260)

- **[severity: medium] UPDATE‑scanner only matches a narrow set of patterns**  
  *Why it matters:* The scanner used to enforce “no UPDATE may assign `is_private`” looks for `UPDATE knowledge_entries … SET … is_private …`. It will miss more complex updates (e.g., using a CTE, a sub‑query, or a function that mutates `is_private` indirectly). Consequently, a future code change could introduce a privacy‑leak UPDATE that the test would not flag.  

  *Evidence (diff):*  

  ```diff
  +def _update_set_clauses(text: str) -> list[str]:
  +    """Everything between `UPDATE knowledge_entries` and its WHERE (or the end of
  +    the text) — alias, SET list and all — for every UPDATE in ``text``."""
  +    return [
  +        m.group(1)
  +        for m in re.finditer(
  +            r"UPDATE\s+knowledge_entries\b(.*?)(?:\bWHERE\b|\Z)", text, re.I | re.S
  +        )
  +    ]
  +
  +def _assigns_is_private(set_clause: str) -> bool:
  +    return re.search(r"\bis_private\b", set_clause, re.I) is not None
  ```

  *File:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (lines ≈ 140‑155)

- **[severity: low] CI workflow change adds a very large test file, increasing run time**  
  *Why it matters:* The new `test_conflict_and_packaging_contracts.py` adds ~400 lines of tests to every CI run. On limited runners this can push the total test duration past timeout thresholds, resulting in aborted runs and incomplete coverage. While not a functional defect, it poses a reliability risk.  

  *Evidence (diff):*  

  ```diff
  ++++ b/mira-crawler/tests/test_conflict_and_packaging_contracts.py
  +@@ -0,0 +1,417 @@
  +"""Repository-visible contracts for the CU-03 round-10 group A findings.
  +...
  +"""
  ```

  *File:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (entire new file)

## NOT REVIEWED
- Runtime behavior of `provenance.enforce_visibility` for edge‑case URLs (e.g., URLs containing Unicode characters or IPv6 literals).  
- Interaction of the new case‑insensitive URL detection with any downstream components that may perform exact‑string matching on the original constant (outside of the manifest discovery path).  
- Potential side‑effects of the large test suite on CI resource limits (e.g., memory pressure) that were not measured.  
- Whether the added Dockerfile checks cover all possible Dockerfile syntaxes (multi‑stage builds, `ARG`‑based destinations, etc.).  

These items require execution of the full application or additional integration testing beyond the diff.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
