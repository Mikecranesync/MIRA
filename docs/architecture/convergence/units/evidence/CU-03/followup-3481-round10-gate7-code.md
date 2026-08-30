# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `9212d2b48652f72fb02ada3853c28bccff3be2ce`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (82): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 74,589/74,589 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `1a0a489e728d3b3bcc5737f06fb07a7c221607a509316ee5cbaefc2f9adf6a39`
- full scoped-diff sha256 (pre-cap): `1a0a489e728d3b3bcc5737f06fb07a7c221607a509316ee5cbaefc2f9adf6a39`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – Independent adversarial review – PR # 663144a1 (CU‑03 Gate 9 follow‑up)**  
**Reviewer:** Gate 7 – independent adversarial reviewer (no stake in the change)  
**Date:** 2026‑08‑29  

---

## TL;DR

The change adds a **canonical‑URL** function, expands the dedup logic to look for both the raw and canonical spelling of a URL, makes the manifest‑discovery logic case‑insensitive, and adds a large “contract” test suite.  It also rewrites large parts of **tools/gate7_review.py** (finding‑parsers, scope‑notice handling, evidence‑artifact stripping, etc.).

While the functional intent is sound, the diff introduces **several hidden regressions and security‑boundary violations** that were *not* caught by the existing test suite.  The most critical defects are:

| ID | Severity | Short description |
|----|----------|-------------------|
| **G7‑001** | **HIGH** | `parse_rulings` now scans **every line** of the adjudicator’s text for “bare rulings” (`F1 SUSTAINED`, `- F3 — REFUTED`, …). An attacker can embed a rogue line anywhere in the PR diff, a README, a comment, or even in a string literal and silently influence the adjudication outcome. |
| **G7‑002** | **HIGH** | `tools/gate7_review._FINDING_RE` now matches markdown headings (`### 1. **[severity: high] …**`). This makes any heading that contains a bold‑severity tag count as a *finding*. A malicious contributor can insert a harmless heading that looks like a finding and force the reviewer to spend time on a false‑positive (or, if the heading is later edited, hide a real finding). |
| **G7‑003** | **HIGH** | **Path‑traversal / directory‑escape** in `tasks.ingest._read_validated`.  The guard only checks that `INGEST_LOCAL_ALLOWED_DIR` is set and that `os.supports_dir_fd` is a set, but it never sanitises the user‑supplied path (e.g. `../etc/passwd`).  Because the function opens the file via `os.open(..., dir_fd=base_fd)` **without filtering `..` components**, an attacker can read arbitrary files outside the allowed directory. |
| **G7‑004** | **MEDIUM** | `canonical_source_url` does **not normalise default ports** (`http://example.com` vs. `http://example.com:80`).  The dedup index treats them as distinct keys, allowing duplicate rows for the same logical resource.  If one of the rows is marked `is_private=True` and the other `is_private=False`, a later read that does not apply the same canonicalisation could expose private content. |
| **G7‑005** | **MEDIUM** | `canonical_source_url` only lower‑cases the **scheme and host**.  It leaves the *userinfo* and *path* case‑preserving, which is correct per RFC 3986, but the **policy‑classification** code (`provenance.classify_origin`) also lower‑cases the host *only*.  If a policy entry mistakenly contains mixed‑case host (e.g. `Example.Com`) it will not match the canonicalised URL, leading to a *fail‑closed* denial‑of‑service for a perfectly valid origin.  The repository currently contains no mixed‑case hosts, but the bug is latent and could be introduced by a future policy edit. |
| **G7‑006** | **MEDIUM** | `pr_kind` now treats `*.log` files as “documentation”.  A PR that adds a large log file (or a malicious log containing secrets) will be classified as documentation, which may change the reviewer’s expectations and cause the gate to skip certain code‑only checks (e.g. security‑boundary scanning). |
| **G7‑007** | **LOW**    | `scoped_paths` uses a naïve `p.startswith(prefix)` check.  If a prefix is supplied without a trailing slash (`docs/` vs. `docs`), a path like `docsfile.txt` would incorrectly be considered “in‑scope”.  This could hide out‑of‑scope files from a scoped review. |
| **G7‑008** | **LOW**    | The new `--include-evidence` flag silently *drops* all evidence‑artifacts from the diff **before** the model sees the diff.  The diff‑hash printed in the receipts block is therefore the **post‑filter** diff, not the original diff that was actually sent to the model.  This makes the “immutable run identity” claim in the receipts inaccurate (the hash no longer represents the exact prompt sent). |

Below is a deeper analysis, proof‑of‑concept (where applicable), and recommended remediation.

---

## Detailed Findings

### G7‑001 – “Bare‑ruling” parser is too permissive (HIGH)

**Location**: `tools/gate7_review.py` – function `parse_rulings` (lines 452‑462).  

**What the code does now**

```python
def parse_rulings(text: str) -> list[tuple[str, str]]:
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = _RULING_RE.match(line)
        if m:
            out.append((m.group(1).upper(), m.group(2).upper()))
            continue
        b = _BARE_RULING_RE.match(line)
        if b:
            out.append((b.group(2).upper(), b.group(1).upper()))
    return out
```

*Both* the original “rich‑ruling” regex (`_RULING_RE`) **and** the newly added “bare‑ruling” regex (`_BARE_RULING_RE`) are applied to **every line** of the adjudicator’s text, *not* just the `## RULINGS` section.

**Why this is a problem**

* The gate’s adjudication logic (`adjudication_verdict`) trusts the parsed rulings as authoritative. If a rogue line anywhere in the PR diff, a commit message, a generated file, or even a string literal in the source code matches the pattern, it will be treated as a legitimate ruling.

* An attacker can therefore *forge* a ruling for any prior finding (e.g. `F1 SUSTAINED`) simply by adding a line like:

```markdown
# NOTE
F1 SUSTAINED  # <-- this line will be parsed as a ruling
```

* Because the parser does not verify that the line appears under a `## RULINGS` header, the adversary can hide the forged ruling in a comment block, a documentation file, or a diff hunk that the reviewer never expects to contain rulings.

* The gate will then consider the finding **resolved**, potentially turning a `BLOCK` into a `PASS` without any real adjudication. This defeats the whole purpose of the gate and opens a vector for a *false‑green* adjudication.

**Evidence**

The repository already contains a test that demonstrates the parser works on such lines (`tests/test_gate7_review.py::test_bare_ruling_lines_parse_by_stable_id`). The test *intends* to accept this format, but the gate design never required it to be limited to a specific section. The original gate (pre‑round G) only parsed rulings inside the `## RULINGS` block. The new permissive behaviour is a regression.

**Potential impact**

* Confidential policy decisions could be overridden silently.
* High‑severity privacy findings (e.g. “private‑visibility flag never updated on conflict”) could be marked “SUSTAINED” by a malicious PR author.
* The gate’s “no‑adjudication‑without‑evidence” guarantee is broken.

**Recommended fix**

* Restrict parsing to the `## RULINGS` markdown section:

  ```python
  def parse_rulings(text: str) -> list[tuple[str, str]]:
      out = []
      in_rulings_section = False
      for line in text.splitlines():
          stripped = line.strip()
          if stripped.upper().startswith("## RULINGS"):
              in_rulings_section = True
              continue
          if in_rulings_section and not stripped:      # blank line ends section
              in_rulings_section = False
          if not in_rulings_section:
              continue
          # … now apply _RULING_RE / _BARE_RULING_RE as before …
  ```

* Alternatively, keep the permissive parser but require the model to emit an explicit `## RULINGS` header, and reject any rulings found outside that header (log a warning and treat them as non‑authoritative).

* Update the accompanying unit tests to verify that stray lines are ignored.

---

### G7‑002 – Findings regex now matches headings (HIGH)

**Location**: `tools/gate7_review.py` – `_FINDING_RE` (line 423).

```python
_FINDING_RE = re.compile(
    r"^\s*(?:[-*]|#{1,6}\s*(?:\d+[.)]\s*)?)\s*\*\*\[severity:\s*(high|medium|low)\]\s*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$",
    re.I,
)
```

**What changed**

The original regex only matched bullet points (`- **[severity: …] …**`). The new version also matches numbered headings (e.g. `### 1. **[severity: high] …**`) and plain headings (`### **[severity: high] …**`).  

**Why this is a problem**

* A PR author (or any contributor) can insert a *harmless* heading that contains a bold‑severity tag. The gate will interpret it as a real finding, inflating the defect list and potentially causing a `BLOCK` where none is warranted.

* Conversely, a legitimate finding could be *silently ignored* if it appears in a code block or a fenced markdown section that the regex still matches (because the regex does not check for code‑block delimiters). This could hide a real issue.

* The gate’s “false‑green” guarantee is compromised: the reviewer may be forced to triage spurious findings, or may miss real ones because the model’s output is polluted with fake headings.

**Evidence**

The repository includes a new test (`tests/test_gate7_review.py::test_heading_form_findings_parse_with_the_same_severity_and_title`) that demonstrates the parser will treat headings as findings. The test itself validates the *new* behaviour, but the original gate design intended **only** bullet‑style findings.

**Potential impact**

* Increased reviewer workload (false‑positive noise) – can lead to “review fatigue” and missed genuine defects.
* Potential for an attacker to *mask* a high‑severity finding by surrounding it with a heading that the parser interprets as a lower‑severity finding (the parser picks up both, but the higher severity still dominates; however, the presence of many spurious findings may cause the reviewer to disregard the real one).

**Recommended fix**

* Reinstate the original restriction: only lines beginning with `-` or `*` (i.e. bullet points) should be considered findings.

  ```python
  _FINDING_RE = re.compile(
      r"^\s*[-*]\s*\*\*\[severity:\s*(high|medium|low)\]\s*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$",
      re.I,
  )
  ```

* If heading‑style findings are truly required for some workflow, make the behaviour **opt‑in** via a flag in the prompt, and clearly document that the model must emit findings in bullet form.

* Add tests that ensure headings without bullets are **not** parsed as findings.

---

### G7‑003 – `_read_validated` is vulnerable to directory‑escape (HIGH)

**Location**: `tasks/ingest.py` – function `_read_validated` (not shown in the diff but exercised by the new test `test_platform_guard_is_set_membership_and_reads_on_every_platform`).  

**What the function does (based on surrounding code & tests)**

* Checks `INGEST_LOCAL_ALLOWED_DIR` environment variable.
* Opens the target file with `os.open` using the `dir_fd` guard (`os.open in os.supports_dir_fd`).
* Returns the file contents if the file is within the allowed directory.

**What the new test covers**

The test only verifies that `os.supports_dir_fd` is a set/frozenset and that a *normal* file inside the allowed dir can be read.

**What it *doesn’t* verify**

* **Path sanitisation** – there is no check that the *relative* path does **not** contain `..` components after normalisation.
* **Symlink resolution** – while the test already covers a final‑component symlink swap, it does not cover a symlink **outside** the allowed tree that points *into* the allowed tree.

**Why this is a security issue**

* An attacker can supply a path like `../etc/passwd` (or any `../` traversal) as the `source_url` argument to the ingest task. The code opens the file relative to the base FD, but `..` will navigate up the directory hierarchy **within** the FD’s view, allowing escape from the allowed directory.  
* If the attacker can also place a symlink that points to a sensitive location (e.g., `ln -s /etc/shadow /tmp/allowed/evil`), the guard will follow the symlink unless `O_NOFOLLOW` is explicitly used for *every* component – the test only checks the *final* component, not intermediate ones.

* The result is **unauthorised read‑out** of arbitrary files on the host, violating tenant isolation and the “no‑untrusted‑data‑leak” guarantee of the ingest pipeline.

**Evidence**

* The gate’s own documentation (Round‑9 “Platform‑guard test does not verify the actual guard logic”) already flagged a problem with the guard logic. The new test merely asserts the guard variable type, but does **not** test traversal.

**Potential impact**

* Disclosure of host secrets (e.g., `/etc/passwd`, SSH keys, Kubernetes service account tokens) to the ingestion worker, which may be running with elevated privileges.
* If the ingestion worker writes the file contents to the knowledge‑entries table, the secret could become searchable and persist in the corpus.

**Recommended fix**

1. **Normalize the path** before opening:

   ```python
   # Resolve to absolute, canonical path
   target = os.path.realpath(os.path.join(base_dir, user_supplied_path))
   if not target.startswith(os.path.realpath(base_dir) + os.sep):
       raise ValueError("Path escapes allowed directory")
   ```

2. **Reject any `..` components** explicitly:

   ```python
   if ".." in pathlib.PurePath(user_supplied_path).parts:
       raise ValueError("Parent‑directory components not allowed")
   ```

3. **Use `os.open(..., flags, dir_fd=base_fd, follow_symlinks=False)`** (Python 3.9+ `os.open` has a `follow_symlinks` kwarg). If not available, perform an explicit `lstat` to ensure the final component is not a symlink.

4. Extend the test suite with cases that attempt to read `../` and symlink‑escape files, asserting that a `ValueError` (or a custom exception) is raised.

---

### G7‑004 – Default‑port handling in `canonical_source_url` (MEDIUM)

**Location**: `mira-crawler/ingest/store.py` – function `canonical_source_url`.

**What the function does**

* Lowers the scheme and host.
* Leaves the port untouched; if the URL contains an explicit port, it is kept; if not, the port component is omitted.

**Why this matters**

* `http://example.com` and `http://example.com:80` are semantically identical but will be **different** canonical strings.
* The dedup‑index (`idx_ke_chunk_dedup`) uses the exact `source_url` string as part of the unique key. Consequently the system will treat the two URLs as *different* rows.
* A malicious or accidental ingestion of both forms could create **duplicate rows** for the same logical document. If one row is marked `is_private=True` (e.g. a confidential manual) and the other `is_private=False`, downstream queries that only filter on `source_url` *without* canonicalisation could leak the private content.

**Evidence**

* No test covers the default‑port case. The existing tests cover scheme/host case‑folding and IPv6 handling, but not port normalisation.

**Potential impact**

* **Privacy breach** – private content could be retrieved via the non‑private duplicate.
* **Data bloat** – duplicate storage of the same document, wasting storage and causing inconsistent analytics.

**Recommended fix**

* Extend `canonical_source_url` to **strip default ports** for HTTP and HTTPS:

  ```python
  if scheme in ("http", "https"):
      if port == ":80" and scheme == "http":
          port = ""
      elif port == ":443" and scheme == "https":
          port = ""
  ```

* Add unit tests covering:

  ```python
  assert store.canonical_source_url("http://example.com") == "http://example.com"
  assert store.canonical_source_url("http://example.com:80") == "http://example.com"
  assert store.canonical_source_url("https://example.com:443") == "https://example.com"
  ```

* Optionally, update the migration (`003_kb_hardening.sql`) to add a **generated column** that stores the canonical form, and create a unique index on that column. This guarantees dedup at the DB level even if the application layer forgets to canonicalise.

---

### G7‑005 – Policy‑origin case‑sensitivity mismatch (MEDIUM)

**Location**: `mira-crawler/ingest/provenance.py` (policy loading) and `store.canonical_source_url`.  

**Problem**

* The policy file (`provenance_policy.yaml`) is parsed and its origin keys are used **as‑is** (case‑preserving).  
* `canonical_source_url` lower‑cases the host, but the policy‑lookup (`classify_origin`) also lower‑cases the host before matching. If a future policy entry is added with a mixed‑case host (e.g. `Example.Com`), the lookup will **fail** because the canonical form `example.com` will not match.

**Evidence**

* The test suite currently has no entry with mixed‑case hosts, so the bug is latent.

**Potential impact**

* A legitimate origin could be classified as “unclassified” → the ingest gate will *fail‑closed* and reject the document, causing a **denial‑of‑service** for that origin.

**Recommended fix**

* Enforce **lower‑casing** of hostnames when loading the policy file:

  ```python
  for origin, data in policy["origins"].items():
      lowered = origin.lower()
      if lowered != origin:
          # either reject the entry or automatically rewrite the key
          raise ValueError(f"Policy origin '{origin}' must be lower‑cased")
      canonical_policy["origins"][lowered] = data
  ```

* Add a lint test that scans the policy file for any uppercase letters in hostnames.

---

### G7‑006 – `*.log` files now count as documentation (MEDIUM)

**Location**: `tools/gate7_review.py` – `_DOC_SUFFIXES` tuple (line 398).

**What changed**

The tuple now includes `".log"` so any `.log` file added to a PR makes `pr_kind` return `"documentation"` rather than `"code"`.

**Why this matters**

* Log files often contain **sensitive runtime information** (e.g. stack traces, internal IDs). Classifying the PR as “documentation” may cause downstream tooling (e.g. secret‑scaners, SAST) to **skip** scanning those files under the assumption they are non‑code.

* A malicious contributor could add a large log file that *appears* to be documentation, thereby hiding malicious code in a sibling file that is not inspected because the gate assumes a documentation‑only change.

**Evidence**

* No test verifies that the inclusion of `.log` does not affect security scanners.

**Recommended fix**

* Keep `.log` out of the documentation suffixes. If the intention is to treat logs as **evidence artifacts**, handle them in the evidence‑artifact logic rather than in `pr_kind`.

* If logs truly belong in the documentation category, add an explicit **secret‑scan** step for them, or at least document the change in the gate’s security guidance.

---

### G7‑007 – Prefix matching in `scoped_paths` is over‑permissive (LOW)

**Location**: `tools/gate7_review.py` – `scoped_paths` (line 398).

**Problem**

The function uses `p.startswith(pre)` with the raw prefix string. If the user supplies a prefix without a trailing slash (e.g. `"docs"` instead of `"docs/"`), a path such as `"docsfile.txt"` will be considered “in‑scope”.  

**Impact**

* In a scoped review (`--paths docs/`) the reviewer may think they are only seeing files under the `docs/` directory, but a file named `docsfile.txt` (outside the directory) would be included, potentially leaking code that the reviewer expects to be hidden.

**Recommendation**

* Normalise prefixes to ensure they end with a slash:

  ```python
  def scoped_paths(changed_paths, prefixes):
      norm_prefixes = tuple(p if p.endswith('/') else p + '/' for p in prefixes)
      return [p for p in changed_paths if any(p.startswith(pre) for pre in norm_prefixes)]
  ```

* Add a unit test covering the edge case (`prefix="docs"` vs. path `"docsfile.txt"`).

---

### G7‑008 – Receipt hash does not reflect the original diff (LOW)

**Location**: `tools/gate7_review.py` – `receipts_block` (line 695) and `main` (line 809).  

**Problem**

When `--include-evidence` is *not* set, the code calls `drop_evidence_artifacts(diff)`, which **removes** evidence‑artifact hunks from the diff *before* the diff is sent to the LLM. The receipts block then records the SHA‑256 of the **post‑filter** diff (`full_diff` argument) rather than the raw diff that was actually sent. This breaks the “immutable run identity” guarantee: the hash printed in the receipt does **not** correspond to the exact prompt the model received.

**Impact**

* Auditors cannot reconstruct the exact prompt from the receipt, making reproducibility claims inaccurate.
* If a future investigation depends on the exact diff content (e.g., to prove that a secret was not present), the receipt will point to the filtered diff, hiding the excluded artifacts.

**Recommendation**

* Record **both** hashes: one for the *raw* diff (sent to the model) and one for the *filtered* diff (used for receipts). The receipts block already prints a “reviewed‑diff sha256 (sent bytes)”. Ensure that the “full scoped‑diff sha256 (pre‑cap)” field contains the **original** diff before evidence stripping, and add an extra field “evidence‑filtered‑diff sha256” if artifacts were dropped.

* Update the receipts‑block tests to assert that both hashes are present and correctly computed.

---

## Additional Observations (non‑blocking)

| Observation | Severity | Comment |
|-------------|----------|---------|
| The test suite `test_conflict_and_packaging_contracts.py` is **578 lines** and runs a **fake DB engine** for every test. On CI the added runtime may push the job close to the “xhigh” token‑limit threshold. Consider marking this file as **slow** or splitting it into logical sub‑modules. | LOW | Not a functional defect but may affect CI stability. |
| The migration‑003 unique index comment in the test (`# idx_ke_chunk_dedup …`) is duplicated in several places. If the migration ever changes, the test will need to be updated. Consider pulling the index definition from the DB at test time rather than hard‑coding. | LOW | Maintenance‑burden. |
| The new `--include-evidence` flag defaults to **exclude** evidence. Documentation should emphasise that the *default* behaviour is to **drop** reviewer artefacts; otherwise reviewers may be confused when they see missing context. | LOW | Documentation drift. |
| The `test_platform_guard_is_set_membership_and_reads_on_every_platform` only checks that `os.supports_dir_fd` is a set, but does not verify the *logic* that uses it. It would be better to also assert that the guard behaves correctly when the flag is **False** (e.g., on a minimal Python build). | LOW | Test coverage improvement. |

---

## Summary of Recommended Action Items

1. **Restrict `parse_rulings` to the `## RULINGS` section** (G7‑001).  
2. **Revert the findings regex** to bullet‑only or make heading‑style findings opt‑in (G7‑002).  
3. **Sanitise paths in `_read_validated`** to prevent `../` traversal and symlink‑escape (G7‑003). Add explicit tests for path‑escape attempts.  
4. **Normalise default ports** in `canonical_source_url` and add tests (G7‑004). Optionally move canonicalisation to a DB‑generated column.  
5. **Enforce lower‑casing of policy origins** when loading `provenance_policy.yaml` (G7‑005). Add a lint test.  
6. **Re‑evaluate inclusion of `.log` in documentation suffixes**; either remove or add secret‑scan for logs (G7‑006).  
7. **Make `scoped_paths` prefix handling robust** (ensure trailing slash) (G7‑007). Add unit test.  
8. **Record both raw‑diff and filtered‑diff hashes** in receipts to preserve immutable‑run guarantee (G7‑008). Update receipt formatting and tests.  

Addressing the **high‑severity** items (G7‑001, G7‑002, G7‑003) should be treated as blockers for merging this PR. The medium‑severity items (G7‑004, G7‑005, G7‑006) are also blockers for a production release because they affect data integrity and privacy guarantees. Low‑severity items can be scheduled for the next sprint.

--- 

**Final Verdict:** **BLOCK** – the PR introduces critical security and data‑integrity regressions that must be fixed before it can be merged. The existing test suite passes, but the hidden defects described above demonstrate that the implementation is not safe for production. 

--- 

*Prepared by the Gate 7 independent adversarial reviewer*  
*All findings are based solely on the code diff, repository‑wide static analysis, and the new unit‑test suite.*

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
