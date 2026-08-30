# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `edb71a6245a849731a616074fb142145ff38d8ff`
- scope (--paths): mira-crawler/, tests/, .github/
- excluded by scope (11): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 26,364/26,364 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `aac56dafe1783f9face796a303d8ae62a4c32d343ba7178c9f157190416fe652`
- full scoped-diff sha256 (pre-cap): `aac56dafe1783f9face796a303d8ae62a4c32d343ba7178c9f157190416fe652`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Over‑broad case‑insensitive URL detection in `_urls_in`** — 
- **[high] False‑green test: `test_no_crawler_update_statement_assigns_is_private` misses aliased UPDATE statements** — 
- **[high] Dockerfile copy‑path test is overly strict and can block legitimate image builds** — 
- **[high] PyYAML requirement detection regex is too narrow** — 
- **[medium] Manifest discovery test assumes a specific order of URLs** — 
- **[high] Missing enforcement test for uppercase‑scheme origins** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Over‑broad case‑insensitive URL detection in `_urls_in`** —  
  The change makes *any* string constant whose lower‑cased value starts with `http://` or `https://` be treated as a configured origin. This widens the discovery surface to include literals that are not real feed origins (e.g., log messages, documentation examples). As a result the policy‑consistency test will demand entries for spurious URLs, and an ingest path may incorrectly treat such strings as origins, potentially causing unintended rejections or, if the downstream policy lookup is case‑sensitive on the full URL, accidental acceptance of untrusted sources.  
  ```diff
  -        and n.value.startswith(("http://", "https://"))
  +        # Scheme match is case-insensitive (Gate 7 round-12 group A on #3268):
  +        # a constant written `HTTPS://...` is still a configured origin, and a
  +        # manifest discovery that missed it would leave the policy consistency
  +        # test vacuous for that origin.
  +        and n.value.lower().startswith(("http://", "https://"))
  ```

- **[severity: high] False‑green test: `test_no_crawler_update_statement_assigns_is_private` misses aliased UPDATE statements** —  
  The test scans source files for `UPDATE knowledge_entries …` but the regular expression does not allow an alias (`AS ke`). If a future change uses an aliased table (e.g., `UPDATE knowledge_entries AS ke SET is_private=TRUE`), the test will not see the assignment and will incorrectly report that `is_private` is never written. This hides a potential security regression where private data could be made public.  
  ```python
  for m in re.finditer(
      r"UPDATE\s+knowledge_entries\b(.*?)(?:\bWHERE\b|\Z)", text, re.I | re.S
  ):
      updates.setdefault(path.relative_to(CRAWLER_DIR).as_posix(), []).append(m.group(1))
  ...
  offenders = {
      f: s
      for f, sets in updates.items()
      for s in sets
      if re.search(r"\bis_private\b", s, re.I)
  }
  assert not offenders, f"an UPDATE assigns is_private: {offenders}"
  ```

- **[severity: high] Dockerfile copy‑path test is overly strict and can block legitimate image builds** —  
  The test `test_every_crawler_image_copies_the_whole_directory_onto_the_import_path` expects a Dockerfile line that matches exactly `COPY mira-crawler/ <dest>`. Real Dockerfiles may use alternative syntax (`COPY ./mira-crawler ./app`, multi‑stage builds, JSON‑array form, etc.) which are valid but will cause the test to fail, preventing legitimate changes.  
  ```python
  def _whole_dir_copy_dest(dockerfile_text: str) -> str | None:
      for line in dockerfile_text.splitlines():
          m = re.match(r"\s*COPY\s+mira-crawler/?\s+(\S+)\s*$", line)
          if m:
              return m.group(1).rstrip("/")
      return None
  ...
  assert dest, (
      f"{dockerfile.name}: no whole-directory `COPY mira-crawler/ <dest>` — the manifest would not ship"
  )
  ```

- **[severity: high] PyYAML requirement detection regex is too narrow** —  
  The test that verifies every `import yaml` is backed by a declared requirement uses a regex that only matches simple version specifiers (`PyYAML==6.0`, `PyYAML>=6.0`). It fails to recognise valid declarations that include extras, environment markers, or comments (e.g., `PyYAML[libyaml]>=5.4`, `PyYAML==6.0 ; python_version < "3.8"`). Consequently the test could either falsely flag a missing requirement when one exists, or miss a missing requirement, allowing a runtime `ImportError` to slip into production.  
  ```python
  req = REQUIREMENTS.read_text(encoding="utf-8")
  assert re.search(r"^PyYAML\s*(==|>=|~=)\s*\d", req, re.I | re.M), (
      f"{len(importers)} production modules import yaml ({importers}) but "
      f"requirements-celery.txt declares no versioned PyYAML"
  )
  ```

- **[severity: medium] Manifest discovery test assumes a specific order of URLs** —  
  `test_discovery_matches_url_constants_case_insensitively` asserts that the list of discovered URLs appears in the exact order they are written in the source file. If `discover_manifests` later normalises or sorts the list, the test will fail despite correct behaviour, making the test brittle.  
  ```python
  assert found == {"shouty.FEEDS": ["HTTPS://Example.COM/feed.xml", "Http://mixed.example.com/x"]}
  ```

- **[severity: high] Missing enforcement test for uppercase‑scheme origins** —  
  The PR’s narrative claims that making scheme matching case‑insensitive “ensures … the gate lowercases scheme and host and REFUSES an unclassified origin”. However, no test verifies that an uppercase‑scheme URL **without** a policy entry is rejected (fail‑closed). Without this check, a regression could allow such URLs to bypass the policy gate, opening a security hole. The added comment in `origins.py` documents the intention, but no corresponding assertion exists.  
  ```diff
  +        # Scheme match is case-insensitive (Gate 7 round-12 group A on #3268):
  +        # a constant written `HTTPS://...` is still a configured origin, and a
  +        # manifest discovery that missed it would leave the policy consistency
  +        # test vacuous for that origin.
  ```

## NOT REVIEWED
- **Runtime behaviour of the ingest gate with uppercase‑scheme URLs** – The review cannot observe the actual policy‑lookup implementation (`enforce_visibility` / `shared_corpus_source_allowed`) to confirm that the case‑insensitive detection does not inadvertently permit untrusted origins. A full integration test would be required.  
- **Interaction with downstream services (e.g., Celery workers, DB migrations)** – The added tests mock the DB engine but do not exercise the real database or migration system; any side‑effects in a live environment remain unverified.  
- **Effect of the new `test_platform_guard_is_set_membership_and_reads_on_every_platform` on non‑POSIX platforms** – The test imports `_read_validated` from `tasks.ingest` under the assumption that the guard works on all platforms, but the actual guard implementation is not examined; its behaviour on obscure platforms (e.g., Alpine, Windows with limited `os.supports_dir_fd`) is untested.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
