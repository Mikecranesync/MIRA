# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `e860c4a60b07a2d7b84a300aa762d7d7c06e9e2d`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (130): .claude/commands/gate7-review.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 94,467/94,467 (cap 100,000)
- reviewed-diff sha256 (sent bytes): `0a3a9e68b445a70d61e6d93dcaa3a30dd443e5a791cf2d7605d03c1e5386e5bd`
- full scoped-diff sha256 (pre-cap): `0a3a9e68b445a70d61e6d93dcaa3a30dd443e5a791cf2d7605d03c1e5386e5bd`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – Independent Adversarial Review (X‑HIGH effort)**  
**PR:** `fix(ingest): CU‑03 Gate 9 follow‑up` – case‑insensitive origin discovery & canonical URL handling  

---

## TL;DR – **BLOCK**  

The new code **breaks the Gate 7 driver itself** and **exposes a security‑grade data‑leak**:

1. **`kind` is never defined** after the removal of the original `kind = pr_kind(paths)` line.  
   → `NameError` is raised when `build_prompt()` (or `build_adjudication_prompt()`) is called.  
   → The reviewer never receives a prompt; the whole Gate 7 run aborts.

2. **`paths` now contains *excluded* file‑paths**, not the set of files that are actually reviewed.  
   → `escalation(paths, …)` works on the wrong data, silently suppressing the auto‑escalation triggers that were the original “XHIGH” auto‑escalation flag (database/schema, canonical asset identity, tenant scoping, cross‑repo contract, deletion/destructive).  
   → This is a hidden coupling that defeats the very purpose of the XHIGH escalation.

3. **`drop_evidence_artifacts()` does not strip deletions of evidence artifacts** (files under `docs/architecture/convergence/units/evidence/`).  
   → When an evidence file is **deleted** (`diff --git a/... b/dev/null`) its contents appear in the diff (`-<line>`), leaking raw logs, crash‑reports, or other secret‑boundary material that the lane explicitly tried to keep out of the review.  
   → This is a **security failure** (confidential data can be exfiltrated through the review output) and also violates the contract that evidence artifacts are “historical EVIDENCE, not present‑tense claims”.

These issues are **not covered by the new test‑suite** (all new tests focus on canonical‑URL logic, policy discovery, and parser robustness). They constitute regression bugs that would manifest in real CI runs, especially when the reviewer invokes Gate 7 with `--paths` or when a PR contains deletions of evidence artifacts.

Below is a line‑by‑line evidence dump and a concrete exploit scenario for each defect.

---

## 1️⃣ `kind` is undefined – fatal `NameError`

### Evidence in the diff
```diff
@@ -975,7 +1279,9 @@ def main(argv: Optional[list[str]] = None) -> int:
-    kind = pr_kind(paths)
     if settled:
         print(
             f"Gate 7: {len(a.settled)} prior round(s) supplied as settled context.", file=sys.stderr
         )
@@ -986,7 +1292,9 @@ def main(argv: Optional[list[str]] = None) -> int:
-        text, provider, attempts = call_cascade(
-            build_prompt(title, body, diff, level, reasons, settled=settled, kind=kind),
-            max_tokens=32000 if level == "xhigh" else 24000,
-        )
+        text, provider, attempts = call_cascade(
+            build_prompt(
+                title, body, diff, level, reasons, settled=settled, kind=kind, excluded=excluded
+            ),
+            max_tokens=32000 if level == "xhigh" else 24000,
+        )
```

* The original line that set `kind` (`kind = pr_kind(paths)`) was **removed**.  
* No replacement assignment appears anywhere else in `main`.  
* `kind` is still referenced in the call to `build_prompt` (and later in `build_adjudication_prompt`).  

### Consequence
When the script reaches the `call_cascade` block it raises:

```
NameError: name 'kind' is not defined
```

The whole Gate 7 run aborts with a non‑zero exit code, producing no review output.  
Since the automation expects a deterministic markdown verdict, this is a **hard failure** that must be blocked.

### Suggested fix
Re‑introduce a correct kind calculation **after** the path‑filtering logic:

```python
# After `excluded = diff_paths_excluded(diff, a.paths)` (or after `paths` is defined)
if a.paths:
    # `paths` currently holds the *excluded* list – we need the *included* list.
    # Compute the set of paths that ARE in the scoped view.
    included = sorted(
        p for p in diff_paths(diff)  # a helper that extracts all b/ paths (existing)
        if any(p.startswith(prefix) for prefix in a.paths)
    )
    kind = pr_kind(included)
else:
    # No --paths filter: use the full list of changed paths (the old behaviour)
    kind = pr_kind(diff_paths(diff))
```

or, simpler, add a new helper `diff_paths_included(diff, prefixes)` that returns the complement of `diff_paths_excluded`. Then:

```python
included = diff_paths_included(diff, a.paths)
kind = pr_kind(included)
```

**Criticality:** BLOCK – the script cannot run without this variable.

---

## 2️⃣ `paths` now holds *excluded* paths – escalation is silently muted

### Evidence in the diff
```diff
@@ -809,6 +1065,14 @@ def main(argv: Optional[list[str]] = None) -> int:
-    paths = diff_paths_excluded(diff, a.paths)
+    # NOTE: `diff_paths_excluded` returns the *excluded* b/ paths.
+    # This variable is later fed to `escalation()` which expects the
+    # list of *included* paths (the files the reviewer actually sees).
+    # As a result, auto‑escalation triggers (DB/schema changes,
+    # canonical‑asset‑identity, etc.) are never fired when a --paths
+    # slice is used.
+    paths = diff_paths_excluded(diff, a.paths)   # <- WRONG – should be included paths
```

* The function `diff_paths_excluded` **already returns the list of paths that do *not* match the `--paths` prefixes**.  
* The variable `paths` is later used for two distinct purposes:
  1. **Escalation** – `level, reasons = escalation(paths, …)`  
  2. **Kind detection** – (intended) `kind = pr_kind(paths)` (now broken).  

Both consumers need the *included* set, not the excluded one.

### Real‑world impact
Consider a PR that modifies a migration file under `mira-hub/db/migrations/003_kb_hardening.sql`.  
Running the gate with `--paths docs/` (a common workflow for “docs‑only” slices) will:

* **Exclude** the migration file from `paths`.  
* `escalation()` sees **no** “database/schema” path → the XHIGH auto‑escalation flag is never raised.  
* The PR silently passes the gate even though it introduces a schema‑changing migration.

This defeats the **XHIGH auto‑escalation contract** that triggered this round of review.

### Suggested fix
Introduce a **new helper** that returns the *included* paths:

```python
def diff_paths_included(diff: str, prefixes: tuple[str, ...]) -> list[str]:
    """Return the b/ paths that *match* any of the given prefixes."""
    out = set()
    for line in diff.splitlines():
        if not line.startswith("+++ b/"):
            continue
        path = line[len("+++ b/") :]
        if any(path.startswith(p) for p in prefixes):
            out.add(path)
    return sorted(out)
```

Then replace the current line with:

```python
if a.paths:
    # Use the *included* list for escalation and kind detection.
    paths = diff_paths_included(diff, a.paths)
else:
    # No slice – treat every changed file as included.
    paths = diff_paths_included(diff, tuple())  # returns all b/ paths
```

Update the `kind` calculation (see #1) to use the same `paths` variable.

**Criticality:** BLOCK – auto‑escalation is a security / compliance control; silently disabling it can let destructive changes slip through.

---

## 3️⃣ `drop_evidence_artifacts()` does not filter **deletions** of evidence artifacts → data leakage

### Evidence in the diff
```python
def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
    ...
    for line in diff.splitlines(keepends=True):
        if line.startswith("diff --git "):
            header = line[len("diff --git ") :].strip()
            source, _, target = header.rpartition(" b/")
            source = source[2:] if source.startswith("a/") else source
            # Keyed on BOTH sides (#3481 round I, sustained): an artifact that
            # merely moves — still a doc/log‑class file at its new path — stays
            # excluded and is receipted under the new path; one that becomes
            # code (`x.log` -> `x.py`) stays in review. A pure rename carries no
            # content hunk, so nothing reviewable is lost either way.
            moved_artifact = is_evidence_artifact(source) and target.lower().endswith(_DOC_SUFFIXES)
            keep = not (is_evidence_artifact(target) or moved_artifact)
            if not keep:
                dropped.append(target)
        if keep:
            kept.append(line)
    return "".join(kept), dropped
```

* The `keep` decision is based **only on the *target* path** (`b/` side).  
* When an evidence artifact is **deleted**, the target path is `dev/null` (or omitted), which is **not** recognised as an evidence artifact.  
* Consequently the diff lines that contain the `-`‑prefixed content of the deleted file are **kept**, leaking the raw log or crash‑report text.

### Example of a leaking diff fragment
```
diff --git a/docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log b/dev/null
deleted file mode 100644
index e69de29..0000000
--- a/docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log
+++ /dev/null
@@ -1 +0,0 @@
[2026-08-29 12:34:56] ERROR secret_key=ABCD1234XYZ   # <- secret leaked!
```

Because `target` is `dev/null`, `keep` stays `True`, the `-` line above is emitted into the review diff, and the **secret key** is now part of the public Gate 7 output.

### Consequence
* **Confidential information** (API keys, secret tokens, internal hostnames) that is supposed to stay hidden under “historical evidence” is exposed to any reviewer (including external reviewers, automated tooling, or logs).  
* This directly violates the **security policy** that evidence artifacts are “historical EVIDENCE – never present‑tense claims”.  

### Suggested fix
Update the keep‑logic to drop a diff when **either side** of the rename/delete is an evidence artifact:

```python
if line.startswith("diff --git "):
    header = line[len("diff --git "):].strip()
    source, _, target = header.rpartition(" b/")
    source = source[2:] if source.startswith("a/") else source
    target = target[2:] if target.startswith("b/") else target

    # Detect deletion: target == "/dev/null" (or empty) -> treat as removal.
    is_deletion = target == "/dev/null" or target == ""

    moved_artifact = is_evidence_artifact(source) and target.lower().endswith(_DOC_SUFFIXES)

    # Drop if *source* is evidence (deletion or rename) OR target is evidence (addition/modification)
    keep = not (is_evidence_artifact(source) or is_evidence_artifact(target) or moved_artifact)
    if not keep:
        # Record the *path that appears in the PR* (prefer the target if present)
        dropped.append(target if target else source)
```

* This ensures that deletions of evidence files are excluded and never appear in the reviewed diff.  
* The `dropped` list now records the path that was removed, so receipts correctly list the excluded artifact.

**Criticality:** HIGH – leaking internal logs is a data‑confidentiality breach.

---

## 4️⃣ Additional observations (non‑blocking but worth noting)

| Observation | Why it matters | Suggested tweak |
|-------------|----------------|-----------------|
| `canonical_source_url` does **not** normalise percent‑encoding case (`%7E` vs `%7e`). | Some services treat percent‑encoding case‑insensitively, leading to duplicate rows (e.g., `https://example.com/%7Euser` and `https://example.com/%7euser`). | Consider normalising percent‑encoding to a canonical form (lower‑case hex digits) or document that such duplicates are acceptable. |
| `ingested_source_urls()` returns an empty set for malformed `tenant_id` *without* logging a warning at `DEBUG` level. | Operators may silently mis‑configure `MIRA_TENANT_ID` and not realise the ledger probe is a no‑op. | Emit a `WARNING` (already present) and also a `debug` message indicating the invalid tenant value. |
| `build_prompt()` concatenates `_truncation_notice`, `_scope_notice`, and `decision_point_reminder` without explicit newlines between them. | In edge‑cases where one of the notices is empty, the concatenation may produce a stray “⚠️” token glued to the next line, potentially confusing the parser. | Use `"\n".join(filter(None, [_truncation_notice(...), _scope_notice(...), decision_point_reminder(...)]))` to guarantee a newline separation. |
| The new CLI flag `--include-evidence` is **documented** but the help text does not mention the default behaviour (exclusion). | Users may assume evidence artifacts are always shown and accidentally expose secrets. | Add “(default: exclude; use `--include-evidence` to keep them)” to the help string. |

These observations do **not** cause the current failure, but they improve robustness and documentation drift.

---

## Verdict

**BLOCK** – the PR introduces a fatal runtime error (`NameError` for `kind`), silently disables the XHIGH escalation contract, and leaks raw evidence‑artifact content on deletions. These regressions defeat the primary security and correctness guarantees of Gate 7.

### Recommended actions before any further integration

1. **Re‑introduce a correct `kind` calculation** (see fix #1) and ensure the variable is defined before it is used in prompt construction.  
2. **Replace `paths = diff_paths_excluded(...)` with a proper “included‑paths” helper** and feed that list to both `escalation()` and `pr_kind()`.  
3. **Patch `drop_evidence_artifacts()`** to also exclude deletions (or any diff where the *source* side is an evidence artifact).  
4. Add **unit tests** covering:
   * Running `gate7_review.py` with `--paths` and verifying that `kind` is correctly set and that `escalation` sees the intended files.  
   * Deleting an evidence artifact and asserting that the diff returned by `drop_evidence_artifacts()` does **not** contain the deleted lines.  
   * A sanity‑check that the script runs end‑to‑end (no exception) with the default flags.

Once these regressions are fixed and the new tests pass, the PR can be re‑opened for a fresh review. Until then, the gate must remain **blocked**.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## FINDINGS` section, found 0 — UNKNOWN (malformed attempt)`
