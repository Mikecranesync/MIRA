# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, authorization, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Unpinned third‑party dependencies in CI workflow** — The CI step installs `celery` and `redis` without any version constraints:
- **[medium] Implicit side‑effects from module‑level Celery app import** — The same CI step’s comment notes that `tasks/ingest.py` and `tasks/_shared.py` import `celery_app` at module import time:

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Unpinned third‑party dependencies in CI workflow** — The CI step installs `celery` and `redis` without any version constraints:  

  ```yaml
  - name: knowledge_entries write-path visibility locks (CU-03)
    run: pip install celery redis && (cd mira-crawler && pytest tests/test_write_path_visibility.py tests/test_store_verified.py -q)
  ```  

  This opens the supply‑chain to accidental or malicious upgrades of those packages at merge time. A compromised release of either library could be pulled into the CI environment and potentially execute arbitrary code, affect test outcomes, or alter the build artefacts that later get promoted. In a security‑sensitive project, CI dependencies must be pinned (e.g., `celery==5.4.0`) and audited.

- **[severity: medium] Implicit side‑effects from module‑level Celery app import** — The same CI step’s comment notes that `tasks/ingest.py` and `tasks/_shared.py` import `celery_app` at module import time:  

  ```yaml
  # celery: tasks/ingest.py + tasks/_shared.py import celery_app at module
  # level; not in this job's requirements files.
  ```  

  Importing a Celery app typically creates a connection to the broker (Redis) and may start background threads or load configuration from the environment. Because the CI job does not provision a Redis broker or set the expected environment variables, the import could raise unexpected exceptions, cause flaky test runs, or silently fall back to defaults that contact external services. This hidden coupling makes the CI step brittle and can mask runtime failures in production where the same import occurs.

## NOT REVIEWED
- **Actual implementation of the `is_private` keyword‑only enforcement** – The diff fragment does not include the modified signatures in `store.py`, `tasks/_shared.py`, or the call‑site updates. We cannot verify that every call site was indeed updated, nor that the static call‑site scanner correctly enforces the contract across the whole repo.

- **Behaviour of `shared_corpus_source_allowed` for `file://` URLs** – The documentation claims the gate now restricts `file://` to a whitelisted directory, but the code performing the path resolution and containment check is not shown. We cannot confirm that the validation is race‑free, correctly handles symlinks, or is applied before any file read.

- **Database schema constraints for `is_private`** – The PR states “no schema change,” yet we have no visibility into the actual column definition (e.g., default value, NOT NULL constraint). If the column defaults to `false` at the DB level, legacy manual inserts could still create public rows.

- **Downstream read‑path enforcement** – Changes to write‑side visibility require corresponding read‑side permission checks. The diff does not show updates to any read‑path contracts or ACL logic; we cannot confirm that private rows are correctly filtered for tenants.

- **Potential TOCTOU between path validation and file open** – While the description mentions a “resolved‑then‑contain” check, the exact sequence of validation → `open()` is not visible. Without atomic open‑with‑O_NOFOLLOW (or platform‑specific equivalents), an attacker could replace a validated path with a symlink after validation but before the read.

- **Effect on external scripts or third‑party tools** – The change adds a required `is_private` argument to core writer functions. Any external scripts that invoke these functions (e.g., in `mira-core/scripts/` not listed) may now fail with `TypeError`. We cannot confirm that all such entry points have been updated.

- **Testing of the new CI step under Windows** – Earlier lane crashes were fixed for subprocess encoding and stdout handling, but this new step also runs `pip install` and `pytest`. We have no evidence that the step has been exercised on Windows runners; Windows‑specific path handling (e.g., case‑insensitivity) could affect the `file://` validation logic.

## Cascade attempts

- `groq: ok`
