# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `2655e69863cb47dbc128dee1d5ea864cc40d5e50`
- scope (--paths): mira-crawler/tests/
- excluded by scope (51): .claude/commands/gate7-review.md, .github/workflows/ci.yml, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/BACKLOG.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-2-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-3-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-4-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-5-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-adjudication-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-review.md, mira-bots/tools/learning_ingester.py, mira-core/scripts/ingest_equipment_photos.py, mira-crawler/crawler/base_crawler.py, mira-crawler/ingest/store.py, mira-crawler/main.py, mira-crawler/tasks/_shared.py, mira-crawler/tasks/full_ingest_pipeline.py, mira-crawler/tasks/ingest.py, mira-crawler/tasks/manualslib_scraper.py, mira-crawler/tasks/patents.py, mira-crawler/tasks/playwright_crawler.py, mira-crawler/tasks/reddit.py, mira-crawler/tasks/youtube.py, mira-hub/scripts/verify-node-subtree-retrieval.ts, mira-hub/tests/e2e/folder-brain-proof.spec.ts, tests/test_architecture.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml, tools/vendor_coverage_ingest.py
- diff chars sent/total: 33,195/33,195 (cap 40,000)
- reviewed-diff sha256: `d11179acf9775f9bc8a9dbac28bdacb4c3a2e3fa91feb4093f60bd0a14ef3797`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Uncurated redirects may be followed because the HTTP client is not forced to disable auto‑redirects** — 
- **[high] Percent‑encoded “../” sequences can escape the allowed directory if the gate does not percent‑decode before containment checks** — 
- **[high] `_read_validated` likely validates only the final path component, allowing a parent‑directory symlink swap (TOCTOU) to bypass the allowed‑directory guard** — 
- **[medium] AST‑scanner test gives a false‑green guarantee – it does not detect `is_private` being supplied via `** — kwargs` forwarding**

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Uncurated redirects may be followed because the HTTP client is not forced to disable auto‑redirects**  
  *What breaks*: An attacker can host a curated URL that redirects to an uncurated domain; if the ingest client follows redirects automatically, the content from the uncurated host will be downloaded and stored, violating the curation gate.  
  *Concrete input/state*: `ingest_url.run(url="https://ibiblio.org/a.pdf")` where the response is `302` with `Location: https://evil-uncurated.example/b.pdf`. The test expects the client to be instantiated with `follow_redirects=False` and therefore never request the uncurated target.  
  *File:line evidence*: `mira-crawler/tests/test_write_path_visibility.py:102‑106`  

  ```diff
            def __init__(self, *a, **k):
                # Lock the contract: the ingest client must never auto-follow.
                assert k.get("follow_redirects") is False
  ```

  *Why this is a defect*: The production code must pass `follow_redirects=False` when constructing the `httpx.Client`. If it omits this flag (default is `True`), the client will automatically follow the redirect, causing the uncurated source to be fetched and ingested. This defeats the “uncurated redirect” protection and creates a high‑severity information‑leak vector.

- **[severity: high] Percent‑encoded “../” sequences can escape the allowed directory if the gate does not percent‑decode before containment checks**  
  *What breaks*: An operator could supply a `file://` URL that contains `%2e%2e` (percent‑encoded `..`) to traverse out of the allowed ingest directory, bypassing the `INGEST_LOCAL_ALLOWED_DIR` restriction.  
  *Concrete input/state*: `shared_corpus_source_allowed("file:///tmp/inbox/%2e%2e/etc-passwd")` with `INGEST_LOCAL_ALLOWED_DIR` set to `/tmp/inbox`.  
  *File:line evidence*: `mira-crawler/tests/test_write_path_visibility.py:207‑213`  

  ```diff
    def test_percent_encoded_traversal_cannot_escape(self, monkeypatch, tmp_path) -> None:
        # url2pathname percent-decodes BEFORE resolve-then-contain, so encoded
        # ../ sequences are normalized away like literal ones (Gate 7 claim
        # disproven by construction; locked here).
        inbox = tmp_path / "inbox"
        inbox.mkdir()
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(inbox))
        encoded = inbox.as_uri() + "/%2e%2e/etc-passwd"
        ok, _ = self._gate()(encoded)
        assert not ok
  ```

  *Why this is a defect*: If `shared_corpus_source_allowed` uses the raw URL path without `urllib.request.url2pathname` (or an equivalent percent‑decode step) before resolving, the encoded `..` will be treated as part of the filename and the containment check will incorrectly deem the path inside the allowed directory, permitting an out‑of‑bounds read. This is a high‑severity directory‑traversal vulnerability.

- **[severity: high] `_read_validated` likely validates only the final path component, allowing a parent‑directory symlink swap (TOCTOU) to bypass the allowed‑directory guard**  
  *What breaks*: An attacker who can replace the parent directory of a validated file with a symlink to an arbitrary location can cause `_read_validated` to read attacker‑controlled data while the validator believes it is reading a safe file.  
  *Concrete input/state*:  
  1. Validate `validated = (base / "real" / "doc.pdf").resolve()` while `base/real` is a real directory.  
  2. Delete `base/real` and replace it with a symlink to `outside`.  
  3. Call `_read_validated(validated)`. The test expects an `OSError`.  
  *File:line evidence*: `mira-crawler/tests/test_write_path_visibility.py:88‑108`  

  ```diff
    def test_parent_component_symlink_swap_is_refused(self, tmp_path, monkeypatch):
        base = tmp_path / "inbox"
        (base / "real").mkdir(parents=True)
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "doc.pdf").write_bytes(b"%PDF-1.4 attacker payload")
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(base))

        (base / "real" / "doc.pdf").write_bytes(b"%PDF-1.4 legit")
        validated = (base / "real" / "doc.pdf").resolve()

        # Post-validation swap: the PARENT directory becomes a symlink out of base.
        shutil.rmtree(base / "real")
        (base / "real").symlink_to(outside)

        from tasks.ingest import _read_validated

        with pytest.raises(OSError):
            _read_validated(validated)
  ```

  *Why this is a defect*: The typical “open with `O_NOFOLLOW` on the final component” protects against a symlink at the leaf but not against a parent‑directory symlink that is swapped after validation. If `_read_validated` does not re‑stat the parent directories (or use `os.open` with `O_NOFOLLOW` on each component), the attacker can read arbitrary files. This is a classic TOCTOU race and constitutes a high‑severity confidentiality breach.

- **[severity: medium] AST‑scanner test gives a false‑green guarantee – it does not detect `is_private` being supplied via `**kwargs` forwarding**  
  *What breaks*: A caller could write `insert_chunk(**payload)` where `payload` contains `is_private=True`. The scanner marks this as missing an explicit `is_private` keyword (see the test), but the runtime call will succeed, meaning the repository could still contain call sites that *appear* compliant while actually relying on dynamic injection.  
  *Concrete input/state*:  

  ```python
  payload = {"tenant_id": "t", "content": "x", "embedding": [0.1], "source_url": "u", "is_private": True}
  insert_chunk(**payload)  # no explicit keyword in source
  ```  

  *File:line evidence*: `mira-crawler/tests/test_write_path_visibility.py:288‑295`  

  ```diff
    def test_scanner_rejects_bare_kwargs_forwarding(self) -> None:
        import ast

        src = "insert_chunk(**payload)\n"
        flagged = self._scan_tree(ast.parse(src), "synthetic.py")
        assert flagged == ["synthetic.py:1 insert_chunk("]
        # Explicit is_private alongside forwarding is fine.
        src_ok = "insert_chunk(is_private=False, **payload)\n"
        assert self._scan_tree(ast.parse(src_ok), "synthetic.py") == []
  ```

  *Why this is a defect*: The test’s static analysis assumes that the absence of an explicit `is_private=` keyword means the visibility decision is missing. However, the language permits the decision to be supplied via a forwarded dictionary. This creates a false‑green situation: the CI suite will pass even though the repository may still contain call sites that do not make the visibility decision obvious at the call site, undermining the security intent of the change. The risk is medium because it depends on a malicious caller controlling the forwarded dict, but the possibility exists in production code.

## NOT REVIEWED
- The actual implementation of `insert_chunk`, `store_chunks`, `ingest_text_inline`, and `shared_corpus_source_allowed` is not present in the diff, so we cannot verify whether the required `is_private` keyword‑only argument is truly enforced, whether SQL statements have been updated to bind `:is_private`, or whether the curation gate correctly parses `sources.yaml`.  
- Any other write paths to `knowledge_entries` that use raw SQL or bypass the `store` layer (e.g., migration scripts, admin tools, or ad‑hoc scripts) are not examined; they could still leak tenant data.  
- The behavior of the `MAX_REDIRECT_HOPS` limit and the exact error string returned when the limit is exceeded are not visible; we only have the test’s expectation. If the implementation returns a different error code, the test would fail, but the underlying security property (rejecting excessive redirects) would still hold.  
- The handling of Windows file URLs (`file://` on non‑POSIX platforms) is deliberately skipped in the symlink tests; potential vulnerabilities on Windows are not covered.  
- Observability (logging, metrics) around the new gating logic is not reviewed; missing logs could impede incident response.  
- Documentation updates (e.g., README, developer guides) that describe the new `is_private` requirement are not shown, so drift between code and docs is possible.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
