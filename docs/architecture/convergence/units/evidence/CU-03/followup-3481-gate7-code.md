# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `0ee07b3f2b5197737e728ca977f0927c560ec03a`
- scope (--paths): mira-crawler/, tests/, .github/
- excluded by scope (7): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 26,151/26,151 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `2abe1c470653f614d579e4f0a0e94f0cc09fbd438dc5a372ddbf76bad08d56cc`
- full scoped-diff sha256 (pre-cap): `2abe1c470653f614d579e4f0a0e94f0cc09fbd438dc5a372ddbf76bad08d56cc`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Test `test_platform_guard_is_set_membership_and_reads_on_every_platform` makes an incorrect assumption about `os.supports_dir_fd`.** — 
- **[high] `test_conflict_and_packaging_contracts.py` imposes overly strict Dockerfile constraints.** — 
- **[medium] Case‑insensitive URL detection in `origins._urls_in` may over‑match non‑URL literals.** — 

## Raw review

## VERDICT
**BLOCK**

The PR introduces regressions that will cause the CI pipeline to fail and potentially hide a real runtime bug. The defects are high‑severity because they prevent any merge from succeeding and mask the original security‑related finding.

## FINDINGS
- **[severity: high] Test `test_platform_guard_is_set_membership_and_reads_on_every_platform` makes an incorrect assumption about `os.supports_dir_fd`.**  
  - The test asserts that `os.supports_dir_fd` is a `set` or `frozenset`:  
    ```python
    assert isinstance(os.supports_dir_fd, (set, frozenset))
    ```  
    In the standard library `os.supports_dir_fd` is a **boolean** (`True` on POSIX, `False` on Windows). The assertion will always fail, causing the entire test suite (and thus the CI job) to error out on any supported Python runtime. This defeats the purpose of the test, hides the original TOCTOU guard bug, and blocks merges.  
  - The offending diff lines are:
    ```diff
    +    def test_platform_guard_is_set_membership_and_reads_on_every_platform(
    +        self, tmp_path, monkeypatch
    +    ):
    +        """Gate 7 round-12 group A finding on #3268 claimed `os.supports_dir_fd` is
    +        a *boolean*, so `os.open not in os.supports_dir_fd` would raise TypeError
    +        and abort every local-file ingest. It is a set (the documented idiom is
    +        `os.stat in os.supports_dir_fd`). This test is deliberately NOT POSIX-only:
    +        the guard line executes here on Windows (plain-open branch) and on Linux
    +        CI (dir_fd walk), so a TypeError on either platform is a red test."""
    +        assert isinstance(os.supports_dir_fd, (set, frozenset))
    +        base = tmp_path / "inbox"
    +        base.mkdir()
    +        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(base))
    +        (base / "doc.pdf").write_bytes(b"%PDF-1.4 legit")
    +
    +        from tasks.ingest import _read_validated
    +
    +        assert _read_validated((base / "doc.pdf").resolve()) == b"%PDF-1.4 legit"
    ```
  - **Impact:** The CI job aborts before any production code is exercised, effectively a denial‑of‑service on the development pipeline. This is a regression of the original security finding (the guard could raise `TypeError` on some platforms) but the test itself now *always* raises an `AssertionError`, making the fix invisible.

- **[severity: high] `test_conflict_and_packaging_contracts.py` imposes overly strict Dockerfile constraints.**  
  - The test requires **every** Dockerfile under `mira-crawler/` to contain a `COPY mira-crawler/ <dest>` line **and** to expose that `<dest>` in a quoted `PYTHONPATH` environment variable. The relevant diff excerpt:
    ```diff
    +    @pytest.mark.parametrize("dockerfile", DOCKERFILES, ids=lambda p: p.name)
    +    def test_every_crawler_image_copies_the_whole_directory_onto_the_import_path(self, dockerfile):
    +        """Each image does ``COPY mira-crawler/ <dest>`` (the manifest rides along
    +        at ``<dest>/provenance_policy.yaml``) and puts ``<dest>`` on PYTHONPATH,
    +        so ``ingest/provenance.py`` in the image resolves parents[1] == <dest>."""
    +        text = dockerfile.read_text(encoding="utf-8")
    +        dest = _whole_dir_copy_dest(text)
    +        assert dest, (
    +            f"{dockerfile.name}: no whole-directory `COPY mira-crawler/ <dest>` — the manifest would not ship"
    +        )
    +        env = re.search(r'PYTHONPATH="([^"]+)"', text)
    +        assert env, f"{dockerfile.name}: no PYTHONPATH"
    +        assert dest in env.group(1).split(":"), (
    +            f"{dockerfile.name}: {dest} not on PYTHONPATH {env.group(1)}"
    +        )
    ```
  - Many legitimate Dockerfiles may set `PYTHONPATH` without quotes, use a multi‑stage build that copies only a subset of the source, or rely on `ENV PYTHONPATH=$PYTHONPATH:/app` syntax. The test will **fail** for such valid images, again breaking CI for reasons unrelated to the functional changes.  
  - **Impact:** False‑positive failures in CI can cause developers to ignore genuine security regressions, and the strict contract may unintentionally enforce a non‑existent architectural requirement.

- **[severity: medium] Case‑insensitive URL detection in `origins._urls_in` may over‑match non‑URL literals.**  
  - The change replaces a strict scheme check with a case‑insensitive one:
    ```diff
    -        and n.value.startswith(("http://", "https://"))
    +        # Scheme match is case-insensitive (Gate 7 round-12 group A on #3268):
    +        # a constant written `HTTPS://...` is still a configured origin, and a
    +        # manifest discovery that missed it would leave the policy consistency
    +        # test vacuous for that origin.
    +        and n.value.lower().startswith(("http://", "https://"))
    ```
  - While the intention is correct, the implementation lower‑cases the **entire** string before checking the prefix. This can cause a constant like `"   HTTPS://example.com"` (leading whitespace) or a multiline string containing a URL fragment to be mis‑identified as a manifest origin, potentially inflating the set of discovered origins and causing false‑positive policy violations.  
  - **Impact:** In production, spurious URLs may be added to the provenance policy, leading to unnecessary ingest rejections or policy bloat.

## NOT REVIEWED
- Runtime performance impact of the new static‑analysis heavy tests (e.g., scanning the entire `mira-crawler` tree for UPDATE statements).  
- Interaction of `store.insert_chunk` with the real database schema (e.g., whether the `is_private` column truly stores a boolean vs. integer) – the tests assume a boolean param name `is_private`.  
- Behavior of the manifest packaging tests on Windows where Dockerfile line endings differ (`\r\n`).  
- Any side‑effects of the new CI command on resource usage (memory, time) that could cause flaky builds.  
- The correctness of the regex used to parse the migration file (`003_kb_hardening.sql`) – if the migration format changes, the test will raise, but this is a test‑maintenance issue rather than a functional bug.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
