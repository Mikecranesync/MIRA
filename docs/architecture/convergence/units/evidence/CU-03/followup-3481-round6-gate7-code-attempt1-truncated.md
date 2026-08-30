# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `d8b000663bbf6e1470c0956226e851041a91128f`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (43): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 40,000/55,931 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `0cffe7eeef5179786109041ab6574cee700d3a2be4db4a61fc08468c49274eab`
- full scoped-diff sha256 (pre-cap): `00884a28ad6e0d691195dd9b166f9b227cfdd73d6f2cac44d8db080449909ea4`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Chunk‑existence API parameter name mismatch** — 
- **[medium] Historical rows bypass canonicalisation, breaking deduplication guarantee** — 
- **[medium] Over‑broad canonicalisation of arbitrary colon‑separated strings** — 
- **[low] Dockerfile whole‑directory copy matcher too strict** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Chunk‑existence API parameter name mismatch** —  
  `store.chunk_exists` builds its SQL statement with a bound parameter called **`source_url`**:

  ```diff
  -    count = conn.execute(
  -        text(
  -            "SELECT COUNT(*) FROM knowledge_entries "
  -            "WHERE tenant_id = :tenant_id AND source_url = :source_url AND ((metadata->>'chunk_index')::int) = :chunk_index"
  -        ),
  -        {"tenant_id": tenant_id, "source_url": source_url, "chunk_index": chunk_index},
  -    ).scalar()
  ```

  The new test `test_lookup_queries_the_same_canonical_key_as_the_write` expects the captured parameter dictionary to contain a key **`url`**:

  ```diff
  -        looked_up = captured["params"]["url"]
  +        # test expects a 'url' key, but the implementation provides 'source_url'
  ```

  Because the implementation never supplies a `url` key, the test raises a `KeyError`, breaking CI and exposing an API inconsistency between the production code and its verification harness. This regression blocks the PR from merging and signals a contract violation in the data‑access layer.

- **[severity: medium] Historical rows bypass canonicalisation, breaking deduplication guarantee** —  
  The newly added `canonical_source_url` function is applied **only** at write time (`insert_chunk` and `chunk_exists`). Existing rows that were written before this change keep their original, case‑variant URLs, as the comment explicitly acknowledges:

  ```diff
  +def canonical_source_url(url: str) -> str:
  +    """Lower‑case ONLY the scheme and the host of ``url``; every other byte —
  +    userinfo, port, path, query, fragment — is preserved exactly as given.
  +
  +    The dedup key ``(tenant_id, source_url, chunk_index)`` is an exact‑match
  +    UNIQUE index (migration 003), while origin classification lower‑cases the
  +    host — so two casings of one origin were stored as two rows (Gate 7 on
  +    PR #3481, code F1, SUSTAINED). BOTH constructors of the key — chunk_exists
  +    and insert_chunk — apply this, so lookup and write can never disagree.
  +    Bare filesystem paths (no scheme, or a one‑letter Windows drive) and
  +    authority‑less URLs (``file:/x``) get at most a lower‑cased scheme.
  +
  +    Historical residual, documented not migrated: rows written before this
  +    function keep their stored casing; a recrawl of such a row writes the
  +    canonical key beside it (one extra row per historical mixed‑case URL) —
  +    a one‑off dedup migration is the follow‑up, never a silent rewrite here.
  +    """
  ```

  Consequently, the unique index on `(tenant_id, source_url, chunk_index)` can contain **multiple rows that logically refer to the same URL** (different scheme/host case). This defeats the intended deduplication invariant, can cause storage bloat, and may lead to inconsistent visibility decisions when older rows are read.

- **[severity: medium] Over‑broad canonicalisation of arbitrary colon‑separated strings** —  
  `canonical_source_url` treats *any* string containing a colon whose prefix matches the scheme regex as a URL and lower‑cases that prefix:

  ```diff
  +def canonical_source_url(url: str) -> str:
  +    if not url:
  +        return url
  +    head, sep, rest = url.partition(":")
  +    if not sep or len(head) < 2 or not _SCHEME_RE.fullmatch(head):
  +        return url  # not a URL (bare path, Windows drive letter) — untouched
  +    scheme = head.lower()
  ```

  This means non‑URL identifiers such as `"myfile:2023.txt"` or `"example.com:443/file"` will be silently mutated (scheme lower‑cased) and then stored in the dedup key. An attacker could craft a malicious identifier that collides with a legitimate URL after this transformation, causing an unintended write conflict or denial‑of‑ingest for the legitimate resource.

- **[severity: low] Dockerfile whole‑directory copy matcher too strict** —  
  The helper used by `TestManifestPackaging` to verify that every crawler image copies the whole `mira-crawler/` directory is implemented with a very narrow regular expression:

  ```diff
  +def _whole_dir_copy_dest(dockerfile_text: str) -> str | None:
  +    """The destination of a whole‑directory copy of ``mira-crawler`` — shell form
  +    (`COPY mira-crawler/ /app/x/`, `COPY ./mira-crawler /app/x`) or JSON form
  +    (`COPY ["mira-crawler/", "/app/x/"]`). A subset copy (`COPY mira-crawler/tasks/`)
  +    deliberately does NOT match: it would not ship the manifest."""
  +    for line in dockerfile_text.splitlines():
  +        m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
  +        if m:
  +            return m.group(1).rstrip("/")
  +        m = re.match(
  +            r'\s*COPY\s+(?:--\S+\s+)*\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line
  +        )
  +        if m:
  +            return m.group(1).rstrip("/")
  +    return None
  ```

  It fails to recognise legitimate `COPY` statements that use line continuations, extra whitespace, or the JSON array form with spaces around commas. A Dockerfile that correctly packages the manifest but uses any of those syntactic variations would cause the test to fail, producing a false‑negative CI failure unrelated to actual security or functional regression.

## NOT REVIEWED
- Implementation of `scoped_paths` and `pr_kind` (used in `test_scoped_paths_keeps_only_the_scope_and_kind_follows_it`) is not visible in the diff; we cannot confirm they correctly handle edge‑case path patterns or mixed‑type file lists.
- The internal logic of `provenance.load_policy`, `enforce_visibility`, and the Celery ingest task (`tasks.ingest._read_validated`) is outside the shown changes; we rely on the existing test suite for coverage. Any regressions in those modules that are not exercised by the added tests remain unexamined.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
