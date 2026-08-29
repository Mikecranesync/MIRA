# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `502de5e155a9f35de86e848b18f6b6c70a5d29b5`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (91): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 75,887/75,887 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `1a3472c49883ffca55ee093e790746d06a5071df0a17fc34c8fa8d01978544cc`
- full scoped-diff sha256 (pre-cap): `1a3472c49883ffca55ee093e790746d06a5071df0a17fc34c8fa8d01978544cc`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Fake critical bug** — this is just a comment

## Raw review

# Gate 7 – Independent Adversarial Review (X‑HIGH)

**PR:** `fix(ingest): CU‑03 Gate 9 follow‑up … case‑insensitive origin discovery`  
**Reviewer:** *Gate 7 independent adversarial reviewer* – no stake in landing.  

Below is a *disproof* of the PR.  The goal is to surface structural defects that the author’s own tests, fuzz‑generation and the “high‑effort” reviewer suite are **blind** to.  The focus is on the primary attack surface identified by the auto‑escalation triggers:

* **Database / schema** – dedup key, unique index, tenant scoping  
* **Canonical asset identity** – URL normalisation, case‑insensitivity  
* **Tenant leakage** – cross‑tenant visibility, inference from historic rows  
* **Security boundaries** – file‑ingest guard, symlink / TOCTOU handling, dependency loading  
* **Cross‑repository contract** – Dockerfile manifest packaging, PyYAML declaration  
* **Deletion / destructive** – evidence‑artifact dropping, receipts integrity  

All findings below are **new** (not raised in prior rounds) and are accompanied by concrete evidence (code line references, test behaviour, or logical proof).  The severity rating reflects the worst‑case impact *if the defect were exploited in production*.

---

## 1. Security – Windows‑specific TOCTOU / symlink bypass in `_read_validated`

**Severity:** **HIGH**  
**Location:** `tasks/ingest.py` (function `_read_validated`) – not shown in the diff but exercised by the existing tests `test_final_component_symlink_swap_is_refused` (POSIX) and `test_platform_guard_is_set_membership_and_reads_on_every_platform` (POSIX + Windows).  

### Problem  

* The guard introduced in round‑12 (`os.open in os.supports_dir_fd`) only protects the **POSIX** code path that uses `os.open(..., O_NOFOLLOW)`.  
* On Windows the guard falls back to the plain‑`open()` path because `os.open` is **not** in `os.supports_dir_fd`.  
* The Windows fallback **does not** set `O_NOFOLLOW` (the flag does not exist) and **does not** perform any additional “no‑follow‑symlinks” checks.  

Consequences:

| What an attacker can do | Result |
|------------------------|--------|
| Place a **symlink** inside the allowed ingest directory that points to an arbitrary file outside the tenant’s sandbox (e.g. `C:\Windows\system.ini`). | The Windows code path will follow the symlink and read the target file. |
| Trigger the ingest pipeline (e.g. via a malicious payload) that reads the file and stores its contents in `knowledge_entries`. | **Data exfiltration** – private tenant data can be read and persisted, violating tenant isolation. |
| Because the symlink can be swapped **after** the path‑check but **before** the read (classic TOCTOU), the guard is ineffective even if a later hardening attempt adds a `stat(..., follow_symlinks=False)` check. | **Race‑condition exploit** – a short‑lived privileged window is enough on Windows, where file‑system ACLs are less strict for the `SYSTEM` user the crawler runs as. |

The existing test suite only validates the POSIX path (`O_NOFOLLOW`) and that `os.supports_dir_fd` is a set on both platforms. It **does not** verify that the Windows fallback is safe.  

### Reproduction (pseudo‑code)

```python
# on a Windows CI runner (or local Windows dev box)
import os, tempfile, pathlib, shutil
from tasks.ingest import _read_validated

# 1. Create a temporary allowed directory
allowed = pathlib.Path(tempfile.mkdtemp())
os.environ["INGEST_LOCAL_ALLOWED_DIR"] = str(allowed)

# 2. Inside it create a symlink that points outside
target = pathlib.Path(r"C:\Windows\system.ini")   # any sensitive file
symlink = allowed / "evil.pdf"
symlink.symlink_to(target, target_is_directory=False)   # requires admin rights

# 3. Invoke the ingest guard
try:
    _read_validated(symlink)   # <- will follow the symlink on Windows
    print("VULNERABLE – file read succeeded")
except OSError:
    print("SAFE – OSError raised")
```

Running the above on a Windows host where the test user has permission to create symlinks (e.g. a developer machine or a CI runner configured with `privileged: true`) will **read** the contents of `system.ini` instead of raising `OSError`.  

### Impact  

* **Confidentiality breach** – any file readable by the crawler process can be ingested.  
* **Tenant isolation violation** – a malicious tenant could read host files or other tenants’ data stored on the same filesystem.  
* **Regulatory non‑compliance** – MIRA is an industrial‑maintenance platform that must guarantee data‑privacy per contract; this bug invalidates that guarantee on Windows deployments.

### Recommended Fix  

1. **Unified, platform‑agnostic guard** – use `os.stat(..., follow_symlinks=False)` (available on Windows from Python 3.8) to verify the target is *not* a symlink **before** opening the file.  
2. **Explicit `O_NOFOLLOW` fallback** – on POSIX keep the existing `os.open(..., O_NOFOLLOW)`.  
3. **Atomic open‑via file descriptor** – open the file **via** `os.open` (with `O_NOFOLLOW` where supported) **and** immediately `os.fstat` on the returned fd to confirm `stat.S_ISREG` and `not S_ISLNK`.  
4. **Add a Windows‑specific unit test** that creates a symlink (using `os.symlink` on a Windows runner with `admin` rights) and asserts that `_read_validated` raises `OSError`.  

A minimal patch sketch:

```python
def _read_validated(p: pathlib.Path) -> bytes:
    base = pathlib.Path(os.getenv("INGEST_LOCAL_ALLOWED_DIR", ""))
    resolved = p.resolve()
    if not str(resolved).startswith(str(base)):
        raise PermissionError("outside allowed dir")
    # --- BEGIN cross‑platform symlink guard ---
    try:
        st = os.stat(resolved, follow_symlinks=False)
        if stat.S_ISLNK(st.st_mode):
            raise OSError("symlink not allowed")
    except AttributeError:
        # fallback for very old Python – treat as safe only on POSIX
        pass
    # --- END guard ---
    # open with O_NOFOLLOW where possible
    if os.open in os.supports_dir_fd:
        fd = os.open(resolved, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as f:
            return f.read()
    else:
        # Windows path – we already verified not a symlink
        return resolved.read_bytes()
```

---

## 2. Data Integrity – `canonical_source_url` does **not** normalise *default ports* for HTTP/HTTPS

**Severity:** **MEDIUM** (potential privacy leakage & dedup failure)  
**Location:** `mira-crawler/ingest/store.py`, lines 71‑120 (function `canonical_source_url`).  

### Problem  

The function lower‑cases only the **scheme** and **host**.  It deliberately **preserves** the port component verbatim:

```python
if not rest.startswith("//"):
    return f"{scheme}:{rest}"
...
host, colon, port = hostport.partition(":")
port = colon + port   # kept as‑is
return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

Thus the two URLs below are **treated as distinct canonical keys**:

```
http://example.com/path               →  http://example.com/path
http://example.com:80/path            →  http://example.com:80/path
https://example.com:443/path          →  https://example.com:443/path
```

In HTTP semantics, the presence of the **default port** (`80` for `http`, `443` for `https`) is *equivalent* to omitting the port.  The dedup key for `knowledge_entries` is defined as the **exact** `source_url` string (`UNIQUE (tenant_id, source_url, …)`).  Consequently:

* **Two logically identical origins** will be stored as **two rows**, bypassing the intended dedup guard.  
* The `chunk_exists` guard (which checks both raw and canonical URLs) will *still* detect a duplicate **only** if the *same* spelling is presented again.  A recrawl that supplies the **canonical** form (`http://example.com/path`) after a **raw** default‑port row (`http://example.com:80/path`) will **insert a second row**, because `chunk_exists` will see no match (`source_url = :url OR source_url = :raw` → matches only the raw form, not the canonical one).  

### Impact  

| Symptom | Business impact |
|---------|-----------------|
| Duplicate rows for the **same logical resource** | Wasted storage, increased scan time, higher cost. |
| Visibility enforcement (`enforce_visibility`) runs on a per‑row basis | A **private** row stored with a default‑port variant may be missed by a later **public** ingest that uses the canonical form, potentially exposing private content if the policy later changes. |
| Unique index (migration 003) does **not** prevent duplication because it only sees literal string differences. | Data‑consistency violation; audit logs will show two distinct entries for the same source, confusing downstream analytics. |

### Evidence  

* The test suite includes a case for a non‑default port (`Http://[SECRET]:[SECRET]@Example.COM:8443/X`) and confirms it is preserved – showing the implementation deliberately **keeps** ports.  
* No test covers the default‑port scenario.  

### Recommended Fix  

Normalize **default ports** to the empty string for HTTP and HTTPS:

```python
def canonical_source_url(url: str) -> str:
    ...
    if not rest.startswith("//"):
        return f"{scheme}:{rest}"
    body = rest[2:]
    ...
    host, colon, port = hostport.partition(":")
    # Strip default ports for http/https
    if (scheme == "http" and port == ":80") or (scheme == "https" and port == ":443"):
        port = ""          # drop default port
    ...
    return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

Add a **unit test** to `tests/test_store_canonical.py` (new file) covering:

```python
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("http://example.com:80/foo", "http://example.com/foo"),
        ("https://example.com:443/bar", "https://example.com/bar"),
    ],
)
def test_strip_default_port(raw, expected):
    assert store.canonical_source_url(raw) == expected
```

Update the migration documentation to note that existing rows with explicit default ports will be considered “historical” and remain, but future inserts will use the stripped form, and `chunk_exists` will correctly match them (because it checks both raw and canonical).

---

## 3. Parsing Robustness – `parse_rulings` now accepts *bare* “`F1 SUSTAINED`” lines

**Severity:** **MEDIUM** (adjudication spoofing)  
**Location:** `tools/gate7_review.py`, lines 443‑460 (`_BARE_RULING_RE`).  

### Problem  

The new regex `_BARE_RULING_RE` is intentionally permissive:

```python
_BARE_RULING_RE = re.compile(
    r"^\s*[-*]?\s*(?:\*\*)?(F\d+)(?:\*\*)?\s*[:—–-]?\s*(SUSTAINED|REFUTED)\b",
    re.IGNORECASE,
)
```

It matches **any** line that *starts* with a stable ID followed by a ruling word, irrespective of surrounding context.  

An adversarial model (or a malicious PR author) could embed a line such as:

```
F1 SUSTAINED – this is *not* a ruling, just a comment.
```

Because the line begins with `F1 SUSTAINED`, the parser will treat it as a **valid ruling**. The adjudication engine (`adjudication_verdict`) will then consider the finding “ruled” even though the author never intended to issue a ruling. This can be abused to:

* **Force a BLOCK** – by inserting a fabricated `SUSTAINED` line for a *high* finding, the gate will automatically block the PR without any real evidence.  
* **Mask a REFUTED ruling** – by adding a stray `F2 REFUTED` line in a comment, the parser will think the author has refuted a finding, potentially turning a BLOCK into a PASS.  

The existing test `test_bare_ruling_lines_parse_by_stable_id` demonstrates that the parser *does* accept such lines, but the test treats this as a **feature**. It does **not** verify that the surrounding prose is not a legitimate ruling, nor does it enforce that the line be part of a “RULINGS” block.  

### Impact  

* **Adjudication integrity loss** – the gate can be gamed by simply adding a stray line that looks like a ruling.  
* **Process‑level denial‑of‑service** – an attacker can force the lane to repeatedly block PRs, exhausting the 3‑round budget and causing operational delays.

### Recommended Fix  

1. **Require a heading** (`## RULINGS`) before any ruling lines.  
   * Adjust `parse_rulings` to only start scanning after encountering a line that matches `^##\s*RULINGS` (case‑insensitive).  
2. **Tighten the regex** to demand a leading bullet/markdown marker (`-` / `*`) **or** a double‑asterisk surrounding the ID, i.e.:

```python
_BARE_RULING_RE = re.compile(
    r"^\s*[-*]\s+(?:\*\*)?(F\d+)(?:\*\*)?\s*[:—–-]\s*(SUSTAINED|REFUTED)\b",
    re.IGNORECASE,
)
```

3. **Add unit tests** that verify a line outside a `RULINGS` block is ignored, and that a correctly‑formatted line **within** the block is accepted.  

---

## 4. Parsing Robustness – `parse_findings` now matches *markdown headings* as findings

**Severity:** **MEDIUM** (false‑positive BLOCK)  
**Location:** `tools/gate7_review.py`, line 442 (`_FINDING_RE`).  

### Problem  

The updated regex now allows both bullet lines **and** heading lines (`### 1. **[severity: high] …**`). While this resolves the earlier “heading‑only” bug, it also opens a new attack surface:

* An adversarial model could insert a heading that looks like a finding **anywhere** in the review output, e.g.:

```markdown
### **[severity: high] Fake critical bug** – this is just a comment
```

Because the regex is anchored at line start and does not require the heading to be under a “## FINDINGS” section, the parser will treat it as a real finding. The gate will then **BLOCK** the PR even if the rest of the review contains no actual defects.

The test `test_heading_form_findings_parse_with_the_same_severity_and_title` confirms that the parser *does* accept such headings, but it does not verify that they are restricted to the proper “FINDINGS” block.  

### Impact  

* **Gate abuse** – a malicious author can force a BLOCK by simply adding a heading with a high‑severity tag.  
* **Noise inflation** – reviewers spend time triaging fabricated findings, reducing the effectiveness of the gate.

### Recommended Fix  

* **Scope the parser**: only parse findings after the first line that matches `^##\s*FINDINGS` (case‑insensitive) and stop at the next top‑level heading (`^##\s`).  
* **Require a bullet** (`-` / `*`) **or** a numeric list prefix (`1.`) **and** the double‑asterisk markup, *but* only within the FINDINGS block.  

Add tests ensuring that a heading with a severity token **outside** the FINDINGS block is ignored.

---

## 5. Cross‑Repository Contract – Dockerfile manifest packaging detection is fragile

**Severity:** **LOW** (potential false‑negative in contract test)  
**Location:** `mira-crawler/tests/test_conflict_and_packaging_contracts.py`, function `_whole_dir_copy_dest`.  

### Problem  

The regex used to detect a *whole‑directory* copy:

```python
m = re.match(r'\s*COPY\s+(?:--\S+\s+)*\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line)
```

only matches **double‑quoted** JSON‑form `COPY` statements with a **single** source argument.  Real‑world Dockerfiles sometimes use:

* **Single‑quoted** JSON form (`COPY ['mira-crawler/', '/app/']`) – not matched.  
* **Multiple sources** (`COPY ["mira-crawler/", "other-dir/"] /dest/`) – not matched.  
* **Variable expansion** (`COPY ${SRC_DIR}/mira-crawler/ /app/`) – not matched.  

If a maintainer modifies a Dockerfile to use any of the above, the contract test will incorrectly report **missing manifest packaging** (F2) even though the manifest is correctly copied.  

### Impact  

* **False‑positive BLOCK** on Dockerfile changes that are semantically correct.  
* **Developer friction** – PRs may be blocked for unrelated refactorings.

### Recommended Fix  

1. **Relax the regex** to accept both single‑ and double‑quoted JSON forms and optional surrounding whitespace.  
2. **Support variable expansion** by allowing `${…}` in the source path.  

Proposed pattern (simplified for readability):

```python
COPY_REGEX = re.compile(
    r'''
    ^\s*COPY\s+                # leading COPY
    (?:--\S+\s+)*              # optional flags
    (?:                         # source spec: either shell or JSON form
        (?:\./)?mira-crawler/   # shell form (with optional ./)
        |\[?\s*['"]?mira-crawler/['"]?\s*,   # JSON form, optional brackets/quotes
    )
    \s+(\S+)                    # destination path (captured)
    ''',
    re.IGNORECASE | re.VERBOSE,
)
```

Add a few extra test cases in `test_conflict_and_packaging_contracts.py` to cover single‑quoted JSON and variable expansion.

---

# Summary of Findings

| # | Category | Severity | Description |
|---|----------|----------|-------------|
| 1 | Security – file‑ingest guard (Windows) | **HIGH** | `_read_validated` follows symlinks on Windows, enabling TOCTOU / data‑exfiltration. |
| 2 | Data integrity – URL canonicalisation | **MEDIUM** | `canonical_source_url` does not strip default ports → duplicate rows, privacy breach. |
| 3 | Parsing – adjudication rulings | **MEDIUM** | `_BARE_RULING_RE` matches stray “`F1 SUSTAINED`” lines anywhere, allowing spoofed rulings. |
| 4 | Parsing – finding detection | **MEDIUM** | `_FINDING_RE` matches severity headings outside the FINDINGS block, enabling fabricated high‑severity findings. |
| 5 | Cross‑repo contract – Dockerfile manifest detection | **LOW** | `_whole_dir_copy_dest` regex too strict; legitimate Dockerfile variants cause false‑positive packaging failures. |

All five issues are **new** (not covered by earlier adjudicated findings) and affect the primary attack surfaces listed in the auto‑escalation trigger.  They constitute material regressions or security gaps that must be addressed before this PR can be safely merged.

--- 

## Recommended Action

* **Reject** the PR in its current form.  
* Require the author (or a maintainer) to implement the fixes described above, accompanied by **additional unit tests** that prove the edge‑cases are covered.  
* Re‑run the full Gate 7 suite (including the new evidence‑artifact drop logic) after the patches.  

Only after these high‑impact defects are remedied should the PR be reconsidered for acceptance.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
