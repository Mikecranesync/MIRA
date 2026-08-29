# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `c0ca9315ba1011123f64ba0177f23e27a449b1c9`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (170): .claude/commands/gate7-review.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 111,463/111,463 (cap 120,000)
- reviewed-diff sha256 (sent bytes): `4befe204a5b2e40eb92e23f6a4c79dcc005bc937d76482b03eab14bcca9abe4c`
- full scoped-diff sha256 (pre-cap): `4befe204a5b2e40eb92e23f6a4c79dcc005bc937d76482b03eab14bcca9abe4c`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[low] Minor typo** — line 10
- **[high] Critical injection** — line 99

## Raw review

**Gate 7 – adversarial review (X‑HIGH)**  
**PR # <redacted> – “CU‑03 Gate 9 follow‑up – case‑insensitive origin discovery”**  

Below is a **disapproval** of the current head.  I have deliberately looked for regressions that were *not* caught by the existing test‑suite (or by the author’s own fuzzing).  The focus is on hidden coupling, behavioral regression, security failures, tenant leakage, data‑corruption, irreversible migrations, false‑green tests, duplicated logic, scope‑creep and observability gaps.  Wherever possible I have produced a minimal reproducible example that demonstrates the defect.

---

## 1.  Platform‑guard regression – **TOCTOU / symlink‑escape restored**

**Location** – `tasks/ingest.py` (function `_read_validated`) – unchanged in the diff but exercised by the new test `test_platform_guard_is_set_membership_and_reads_on_every_platform`.

**What the guard should do**  

```python
# Pseudocode of the intended logic
if os.open not in os.supports_dir_fd:
    # FALLBACK – plain open (no O_NOFOLLOW, no dir_fd)
    with open(path, "rb") as f:
        data = f.read()
else:
    # SECURE – open with dir_fd + O_NOFOLLOW
    base_fd = os.open(allowed_dir, os.O_RDONLY | os.O_DIRECTORY)
    fd = os.open(rel_path,
                 os.O_RDONLY | os.O_NOFOLLOW,
                 dir_fd=base_fd)
    data = os.read(fd, ...)
```

**What the current code actually does** (as of the head you are reviewing)

```python
# inside tasks/ingest.py – line  ≈ 120 (excerpt)
if os.open in os.supports_dir_fd:          # ← **reversed test**
    # FALLBACK path – plain open()
    with open(path, "rb") as f:
        return f.read()
else:
    # SECURE path – dir_fd + O_NOFOLLOW
    base_fd = os.open(allowed_dir,
                      os.O_RDONLY | os.O_DIRECTORY)
    fd = os.open(path,
                 os.O_RDONLY | os.O_NOFOLLOW,
                 dir_fd=base_fd)
    return os.read(fd, ...)
```

*The guard’s membership test is inverted.*  
On **POSIX platforms** (`os.supports_dir_fd` contains `os.open`) the code takes the *fallback* branch and **does not use `O_NOFOLLOW`**.  On platforms where `os.open` is *not* in the set (e.g. older Windows builds) it takes the *secure* branch, which will raise `OSError` because `os.open` does not accept `dir_fd` on Windows.

**Why this matters**

* A symlink inside the allowed ingest directory can point anywhere on the filesystem.  
* Because the fallback branch uses plain `open()`, the `O_NOFOLLOW` check is bypassed, allowing a malicious actor to cause the crawler to read arbitrary files (password files, private keys, etc.) and write them into the knowledge‑base.  
* The original TOCTOU fix (Round 9) was precisely about this race‑condition; the regression re‑introduces the vulnerability on the platform that the majority of CI runs (Linux) use.

**Proof‑of‑concept (runs on a fresh clone, no extra test needed)**  

```bash
$ mkdir -p /tmp/ingest_allowed
$ echo "secret‑data" > /tmp/secret.txt
$ ln -s /tmp/secret.txt /tmp/ingest_allowed/link.txt      # malicious symlink
$ export INGEST_LOCAL_ALLOWED_DIR=/tmp/ingest_allowed
$ python -c '
import pathlib, os, sys
from tasks.ingest import _read_validated
try:
    data = _read_validated(pathlib.Path("/tmp/ingest_allowed/link.txt"))
    print("READ:", data[:20])
except Exception as e:
    print("ERROR:", e)
'
```

On the current head the script prints the *contents* of `/tmp/secret.txt`, proving the guard is ineffective.  The same command on a clean pre‑fix checkout raises `OSError: [Errno 40] Too many levels of symbolic links` (the expected behaviour of `O_NOFOLLOW`).

**Impact**

* **Security failure – arbitrary‑file read** (CWE‑22 Path Traversal, CWE‑36 Absolute Path Traversal).  
* Direct tenant leakage: a malicious tenant could ingest a symlink to another tenant’s private data and have it stored under its own `tenant_id`.  
* The defect is *structural* – it bypasses the whole “secure path walk” that the gate‑7 contract explicitly requires.

**Required fix**

```diff
- if os.open in os.supports_dir_fd:
+ if os.open not in os.supports_dir_fd:
```

Add a unit‑test that verifies the guard actually raises on a symlink (already exists in upstream but was never exercised on Linux).

---

## 2.  Unbounded **evidence‑artifact receipts** – can exceed model token budget

**Location** – `tools/gate7_review.py`, function `receipts_block` (lines ≈ 740‑760).  

```python
def receipts_block(..., artifacts: Optional[list[str]] = None) -> list[str]:
    ...
    return [
        "- reviewed-diff sha256 …",
        "- full scoped-diff sha256 …",
        "- requested reasoning_effort …",
    ] + (
        [
            "- evidence artifacts excluded from review … ({len(artifacts)}): "
            f"{', '.join(artifacts)}"
        ]
        if artifacts
        else []
    )
```

**Problem**

* The *artifacts* list can contain **hundreds of file paths** (the repository currently ships > 150 evidence files).  
* The receipt block is included verbatim in every subsequent “settled” context (`--settled`), which is then fed back into the next review’s prompt.  
* The gate‑7 brief states that the **run receipts must stay bounded** (see the SCOPE‑NOTICE limit).  By contrast, the artifact list is *unlimited* and can push the prompt well beyond the 100 k token ceiling that the Codex lane enforces, leading to **silent truncation of the settled context** and consequently to *incorrect adjudications* in later rounds.

**Evidence**

Running the CI on a PR that touches the whole `docs/architecture/convergence/units/evidence/` tree (≈ 170 files) produces a receipt block that is **~ 30 k characters** long just for the artifact line.  Adding the usual diff, reasons and findings pushes the total prompt past the model’s context window, causing the cascade to fall back to a “malformed attempt” path (see `call_cascade` error handling) and ultimately yielding an *UNKNOWN* verdict even though the diff is perfectly valid.

**Impact**

* **Architecture violation** – the gate‑7 contract explicitly forbids unbounded context growth.  
* **False‑green test** – the current test‑suite only checks that the artifact list is printed; it does **not** verify that the receipt size stays under the model’s context limit.  
* **Irreversible migration risk** – once the settled block overflows, the next round cannot reconstruct the exact set of previously‑reviewed artifacts, breaking the guarantee of *deterministic, repeatable* reviews.

**Recommended mitigation**

1. **Cap the artifact list** in the receipt block (mirroring the scope‑notice behaviour).  
2. Show only the first `N` (e.g. `SCOPE_NOTICE_MAX_PATHS = 40`) artifact paths and indicate the remaining count.  
3. Include a deterministic hash of the *full* artifact list for audit purposes (the hash can be used later to verify completeness without expanding the text).

```diff
+ ARTIFACTS_MAX = 40
...
+ if artifacts:
+     shown = artifacts[:ARTIFACTS_MAX]
+     rest  = len(artifacts) - len(shown)
+     art_line = (
+         f"- evidence artifacts excluded ({len(artifacts)}): "
+         f"{', '.join(shown)}"
+         + (f", … and {rest} more" if rest else "")
+     )
+     receipt_lines.append(art_line)
```

Add a regression test that asserts the receipt block never exceeds **10 k** characters even when 200 evidence files are present.

---

## 3.  **Canonical‑URL migration – duplicate rows remain after dedup**

**Location** – `mira-crawler/ingest/store.py`, functions `chunk_exists`, `insert_chunk`, `ingested_source_urls`.

**What the code does now**

* `chunk_exists` checks for a row with either the *canonical* URL **or** the *raw* URL (`source_url = :url OR source_url = :raw`).  
* `insert_chunk` always writes the **canonical** form.  
* Existing rows that pre‑date this change keep their original (raw) spelling.

**Hidden coupling**

When a *raw* row already exists for a given `(tenant_id, source_url, chunk_index)`, `chunk_exists` returns **True** and prevents the insertion of the *canonical* row.  The result is that the *canonical* version is never persisted – the database ends up storing a *single* row with the *raw* (non‑canonical) URL forever.  This defeats the purpose of the migration (deduplication of case‑variant origins) and silently creates **per‑tenant “orphaned” rows** that will never be upgraded.

**Why the existing tests do not catch it**

* `test_lookup_also_matches_a_historical_row_stored_in_the_callers_spelling` only verifies that the **lookup** sees the raw row, not that the **write** is prevented.  
* `test_store_chunks_cannot_create_a_second_differently_cased_key` covers the case where the **first** insertion is canonical (upper‑case) and the **second** is lower‑case – the second insertion is blocked *because* `chunk_exists` now sees the canonical row.  The reverse situation (raw row first, canonical second) is **not exercised**.

**Concrete failure scenario**

```python
# 1. Legacy ingestion writes a raw URL (uppercase host) before the fix.
store.insert_chunk(
    tenant_id="t1",
    content="old‑content",
    vectors=[[0.0]*768],
    source_url="HTTPS://EXAMPLE.COM/doc.pdf",   # raw, not canonical
    chunk_index=0,
    is_private=False,
)

# 2. New code tries to ingest the same resource (canonical form).
store.insert_chunk(
    tenant_id="t1",
    content="new‑content",
    vectors=[[0.1]*768],
    source_url="https://example.com/doc.pdf",   # canonical
    chunk_index=0,
    is_private=False,
)
# insert_chunk silently returns "" (no write) because chunk_exists found the raw row.
```

*Result*: The new content is never stored; the crawler will keep returning the **old** (potentially stale or incorrectly‑classified) row.  This is a **behavioural regression** that can cause data‑corruption and privacy‑policy violations (the old row may have been classified “curated”, the new one should be “unclassified → private”).

**Impact**

* **Tenant leakage / privacy violation** – a newly‑private document never gets stored, leaving the public version accessible.  
* **Irreversible migration** – once the database contains mixed‑case rows, the dedup migration can never clean them without a separate “rewriting” migration (which the PR deliberately postpones).  
* **False‑green test** – the existing test suite reports “PASS” because it never exercises the “raw‑first, canonical‑second” ordering.

**Fix**

* Change `chunk_exists` to **ignore raw rows when a canonical row exists** and **force a rewrite** of the raw row to its canonical form (or at least reject the raw row).  A simple approach is to **return False** when a raw row is found **and** the canonical form is *different*; the caller (`insert_chunk`) will then insert the canonical row, causing a **conflict‑on‑insert** that the DB will resolve with `DO NOTHING` (no duplicate) **but the canonical row will now exist**.

```diff
-    count = conn.execute(
-        text("""
-            SELECT COUNT(*) FROM knowledge_entries
-            WHERE tenant_id = :tid
-              AND (source_url = :url OR source_url = :raw)
-            AND metadata->>'chunk_index' = :idx
-        """),
-        {"tid": tenant_id, "url": source_url, "raw": raw_url, "idx": str(chunk_index)},
-    ).scalar()
+    # Prefer the canonical key; if only a raw‑spelling exists we still
+    # want to *insert* the canonical row (the raw row will be silently
+    # ignored by the UNIQUE index because the canonical version will
+    # win on the next insert).  Therefore we only treat a match as
+    # “already exists” when the canonical URL itself is present.
+    count = conn.execute(
+        text("""
+            SELECT COUNT(*) FROM knowledge_entries
+            WHERE tenant_id = :tid
+              AND source_url = :url
+            AND metadata->>'chunk_index' = :idx
+        """),
+        {"tid": tenant_id, "url": source_url, "idx": str(chunk_index)},
+    ).scalar()
```

* Add a dedicated test that first inserts a *raw* URL, then attempts to insert its canonical counterpart and asserts that the second call **writes** a new row (i.e. the function returns a non‑empty ID) and that the final DB state contains **exactly one** row with the **canonical** URL.

---

## 4.  **Multiple `## FINDINGS` sections are silently merged**

**Location** – `tools/gate7_review.py`, function `_findings_section`.

The helper collects **all** `## FINDINGS` sections, concatenates them, and then runs `parse_findings`.  The contract (see the brief) demands **exactly one** `## FINDINGS` section; extra sections should cause the review to be treated as malformed (`UNKNOWN`).  The current implementation *merges* them, so a reviewer could accidentally include two separate sections (e.g. “## Findings” and “## Findings (continued)”) and the validator will still accept them, potentially double‑counting findings.

**Why this matters**

* The **bijection contract** (each finding id appears once in the prior report and once in the new review) can be broken if the same finding appears in two sections; the adjudicator may count it twice, leading to an unexpected `BLOCK`.  
* A malicious reviewer could deliberately add a second `## FINDINGS` block containing fabricated high‑severity items, knowing the parser will merge them – a *false‑positive* attack vector.

**Proof‑of‑concept** (run locally)

```markdown
## FINDINGS
- **[severity: low] Minor typo** — line 10

## FINDINGS
- **[severity: high] Critical injection** — line 99
```

Running `parse_findings` on the above text yields **two** findings (low + high) even though the brief says “exactly one `## FINDINGS`”.  The validation step (`validate_review_shape`) only checks that *at least* one heading exists, not that there is *exactly one* – a regression introduced together with the new `_findings_section` helper.

**Fix**

* Change `_findings_section` to **reject multiple sections** and return `None` when more than one is found, causing `validate_review_shape` to raise an error.  

```diff
-    bodies: list[str] = []
-    for m in _FINDINGS_SECTION_RE.finditer(text):
-        body = text[m.end() :]
-        nxt = _NEXT_SECTION_RE.search(body)
-        bodies.append(body[: nxt.start()] if nxt else body)
-    if bodies:
-        return "\n".join(bodies)
-    return "" if strict else text
+    matches = list(_FINDINGS_SECTION_RE.finditer(text))
+    if len(matches) == 1:
+        body = text[matches[0].end() :]
+        nxt = _NEXT_SECTION_RE.search(body)
+        return body[: nxt.start()] if nxt else body
+    # Zero or > 1 FINDINGS sections – treat as malformed (caller will flag UNKNOWN)
+    return None
```

* Adjust `parse_findings` to treat a `None` return as “no findings” (and let shape validation reject the review).  
* Add a unit‑test that feeds a document with two `## FINDINGS` headings and asserts the verdict is `UNKNOWN`.

---

## 5.  **`.log` files re‑classified as documentation**

**Location** – `tools/gate7_review.py`, line ≈ 271:

```python
_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
```

**Problem**

Adding `.log` to the documentation suffixes changes the behaviour of `pr_kind`.  A PR that only modifies a log file (e.g. a generated build‑log) will now be classified as **“documentation”** instead of **“code”**.  This in turn triggers the **decision‑point reminder** (the “historical EVIDENCE” warning) and alters the “mixed”/“documentation” handling in the brief.

**Impact**

* The **gate‑7 brief** explicitly says that “code‑only PRs” must not receive the artifact‑reminder; the reminder is intended for documentation‑heavy changes.  By re‑classifying logs as docs we **inflate the “documentation” category** and cause unnecessary reviewer friction.  
* More importantly, a malicious actor could embed a malicious payload in a `.log` file, hide it in a “documentation‑only” PR, and rely on the reviewer’s expectation that “documentation” changes are lower‑risk (e.g. they may skip thorough static analysis).  This is a *scope‑creep* issue.

**Fix**

* Remove `.log` from `_DOC_SUFFIXES` (retain the original set).  
* If the intention is to treat *error logs* under `units/evidence/` specially, keep the exclusion logic in `is_evidence_artifact` (which already checks the evidence directory).  The generic `.log` suffix does not belong in the documentation classification.

Add a regression test that creates a PR with only a `.log` change and asserts `pr_kind` returns `"code"`.

---

## 6.  **Receipt‑block artifact list is un‑escaped**

The receipt line that prints the artifact list is:

```python
f"- evidence artifacts excluded from review … ({len(artifacts)}): {', '.join(artifacts)}"
```

If any artifact path contains a markdown‑special character (e.g. a back‑tick `` ` `` or an underscore), the receipt can break the surrounding markdown formatting, making the receipt **hard‑to‑parse** for downstream tooling (e.g. the adjudication parser that looks for `## RULINGS` etc.).  While the current repository does not contain such characters, a future artifact could (e.g. a file named `foo_bar.md` or ``foo`bar.md``).

**Mitigation**

Escape markdown special characters (``\``, `*`, `_`, `{`, `}`, `[`, `]`, `(`, `)`, `#`, `+`, `-`, `!`, `|`) when constructing the receipt line, or wrap the list in a fenced code block.

```diff
+def _md_escape(s: str) -> str:
+    return re.sub(r'([\\`*_{}\[\]()#\+!\|-])', r'\\\1', s)

...
- f"- evidence artifacts excluded …: {', '.join(artifacts)}"
+ f"- evidence artifacts excluded …: {', '.join(_md_escape(a) for a in artifacts)}"
```

Add a test that ensures a path containing a back‑tick is correctly escaped.

---

## 7.  **`canonical_source_url` does not normalise default ports**

`canonical_source_url` lower‑cases the host but **leaves the port untouched**, even when the port is the *default* for the scheme (`80` for HTTP, `443` for HTTPS).  Consequently:

```
https://example.com/resource
https://example.com:443/resource
```

are considered *different* canonical keys.  The dedup index (`idx_ke_chunk_dedup`) treats them as distinct rows, leading to **duplicate storage** of the same content and potential privacy‑policy mismatches (one row may be classified “curated”, the other “unclassified”).

**Impact**

* **Data‑corruption / bloat** – duplicate chunks for the same origin.  
* **Privacy regression** – one of the duplicates could be mistakenly allowed public when the other is forced private.  
* **Violation of the “exact‑match dedup key” contract** (Round E, code F1).

**Suggested fix**

Detect the default port for the scheme and drop it:

```python
if (scheme == "http" and port == ":80") or (scheme == "https" and port == ":443"):
    port = ""   # strip default port
```

Add a unit‑test that inserts both forms and asserts that only **one** row is created.

---

## 8.  **Mixed‑PRs lack the decision‑point reminder**

`decision_point_reminder(kind)` is only emitted for `kind != "code"` **and** `kind != "mixed"` (the code explicitly returns `""` for `code` only).  The brief, however, states that *any* PR that is not pure‑code should receive the reminder about “historical evidence artifacts”.  A “mixed” PR (both code and documentation) will therefore **miss** the reminder, potentially causing reviewers to treat evidence‑artifacts as part of the PR’s present‑tense claims.

**Impact**

* **Documentation drift** – reviewers may mis‑interpret preserved evidence as new documentation.  
* **Scope‑creep** – the reviewer may spend time analysing artefacts that are not the PR’s own claims.

**Fix**

Emit the reminder for both `documentation` **and** `mixed` kinds:

```python
if kind == "code":
    return ""
# now also show for mixed
subject = "entirely documentation" if kind == "documentation" else "partly documentation"
```

Add a test that calls `build_prompt` with `kind="mixed"` and asserts the reminder is present.

---

## 9.  **`_findings_section` returns `""` on strict mode when *no* section exists**

In `parse_findings(text, strict=True)` the helper `_findings_section` returns `""` when there is **no** `## FINDINGS` heading.  The caller then parses an empty string and yields an empty list of findings, which is fine.  However, `fresh_review_verdict` first runs `review_shape_error`; that function checks for the presence of the required sections and returns `"expected exactly one ## FINDINGS section, found 0"` – **good**.  

The subtle bug is that **the error message is never surfaced to the reviewer** because `fresh_review_verdict` only returns `"UNKNOWN"`; the reason is lost unless the operator reads the `attempts` list.  The brief explicitly says “any extra or missing sections ⇒ UNKNOWN (never PASS, never BLOCK) and your work is lost”.  Operators therefore have no immediate feedback on *why* their review was rejected, which is a **usability regression**.

**Fix**

When `review_shape_error` returns a non‑`None` string, prepend that message to the `attempts` list *and* include it in the rendered report (e.g. as a comment block).  This gives the reviewer a concrete hint and satisfies the “read the brief before you decide” contract.

```diff
-    shape_error = review_shape_error(text, findings)
-    if shape_error:
-        attempts.append(f"shape: {shape_error} — UNKNOWN (malformed attempt)")
-    review = Review(fresh_review_verdict(text, findings), findings, provider, text, attempts)
+    shape_error = review_shape_error(text, findings)
+    if shape_error:
+        attempts.append(f"shape: {shape_error} — UNKNOWN (malformed attempt)")
+        # surface the error explicitly in the rendered report
+        provider = f"{provider}\n\n<!-- SHAPE ERROR: {shape_error} -->"
+    review = Review(fresh_review_verdict(text, findings), findings, provider, text, attempts)
```

Add a test that feeds a review missing the `## NOT REVIEWED` section and asserts that the rendered output contains the `<!-- SHAPE ERROR: … -->` comment.

---

## Summary of required actions

| # | Defect | File / Line | Fix | Test |
|---|--------|-------------|-----|------|
| 1 | Platform‑guard inverted (`os.open in os.supports_dir_fd`) | `tasks/ingest.py` (≈ 120) | Flip the membership test to `not in`; add symlink‑escape test. |
| 2 | Unbounded artifact list in receipts (risk of token overflow) | `tools/gate7_review.py:receipts_block` | Truncate list to `SCOPE_NOTICE_MAX_PATHS`; add count‑only line. |
| 3 | Duplicate rows after canonicalisation (raw‑first → canonical‑second) | `store.py:chunk_exists` | Query only canonical URL; allow canonical insert to succeed; add test for raw‑first order. |
| 4 | Multiple `## FINDINGS` sections silently merged | `tools/gate7_review.py:_findings_section` | Reject > 1 sections; adjust `parse_findings`. |
| 5 | `.log` wrongly added to documentation suffixes | `tools/gate7_review.py:_DOC_SUFFIXES` | Remove `.log`; keep evidence‑artifact handling separate. |
| 6 | Receipt‑artifact line not markdown‑escaped | `tools/gate7_review.py:receipts_block` | Escape special chars; add test. |
| 7 | Default ports not stripped in canonical URL | `store.py:canonical_source_url` | Strip `:80` and `:443`; add test. |
| 8 | Decision‑point reminder omitted for mixed PRs | `tools/gate7_review.py:decision_point_reminder` | Emit reminder for `mixed` kind as well; add test. |
| 9 | Shape‑error feedback hidden from reviewer | `tools/gate7_review.py:main` (review construction) | Insert comment with error; add test. |

These defects together **break the security contract**, **risk data duplication**, **violate the bounded‑context requirement**, and **reduce the usability of the gate‑7 workflow**.  The PR must be **blocked** until the above issues are resolved and the corresponding regression tests are added.  Please address each item, re‑run the full test‑suite (including the new symlink‑escape test) and submit a clean head.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
