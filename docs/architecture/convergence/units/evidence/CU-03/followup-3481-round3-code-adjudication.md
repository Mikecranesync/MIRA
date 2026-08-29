# Gate 7 adjudication — PR #3481

**Verdict:** PASS · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 7 · **Rulings:** 7 (sustained: 2)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `611705cc5116a07c672b6a8e5cdf4b039ad94015`
- scope (--paths): mira-crawler/, tests/, .github/
- excluded by scope (15): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 30,255/30,255 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `c8a1d958d298aa33be69d2ed70561e6e314b5af62956dff4b289482d75881904`
- full scoped-diff sha256 (pre-cap): `c8a1d958d298aa33be69d2ed70561e6e314b5af62956dff4b289482d75881904`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] Missing‑dependency simulation does not exercise the intended ImportError path
- F2 [high] Platform‑guard test does not verify the actual guard logic
- F3 [medium] Case‑insensitive URL detection may create duplicate policy entries
- F4 [medium] Dockerfile manifest‑inclusion test ignores `.dockerignore` negation rules
- F5 [medium] Un‑mocked database write in a test can corrupt CI state
- F6 [medium] UPDATE‑scanner only matches a narrow set of patterns
- F7 [low] CI workflow change adds a very large test file, increasing run time

## Rulings

- **[REFUTED] F1** [high] Missing‑dependency simulation does not exercise the intended ImportError path
- **[REFUTED] F2** [high] Platform‑guard test does not verify the actual guard logic
- **[REFUTED] F3** [medium] Case‑insensitive URL detection may create duplicate policy entries
- **[SUSTAINED] F4** [medium] Dockerfile manifest‑inclusion test ignores `.dockerignore` negation rules
- **[REFUTED] F5** [medium] Un‑mocked database write in a test can corrupt CI state
- **[REFUTED] F6** [medium] UPDATE‑scanner only matches a narrow set of patterns
- **[SUSTAINED] F7** [low] CI workflow change adds a very large test file, increasing run time

## Raw adjudication

## RULINGS
- **[ruling: REFUTED] [id: F1]** — the diff includes `monkeypatch.setitem(sys.modules, "yaml", None)` which raises `ImportError`, directly disproving the claim that the test does not exercise the ImportError path.  
- **[ruling: REFUTED] [id: F2]** — the added test `test_platform_guard_is_set_membership_and_reads_on_every_platform` asserts both the type of `os.supports_dir_fd` and that `_read_validated` succeeds on all platforms, thereby verifying the guard logic.  
- **[ruling: REFUTED] [id: F3]** — the case‑insensitive URL detection change is paired with `test_discovery_matches_url_constants_case_insensitively`, which confirms no duplicate policy entries are created.  
- **[ruling: SUSTAINED] [id: F4]** — the manifest‑inclusion test still checks patterns without handling `.dockerignore` negation (`!`), as evident from its simple `fnmatch` loop, so the finding remains valid.  
- **[ruling: REFUTED] [id: F5]** — the `captured` fixture monkey‑patches `store._engine` to a fake engine, preventing any real database write, as shown in the diff.  
- **[ruling: REFUTED] [id: F6]** — the updated `_update_set_clauses` scanner and its comprehensive tests cover aliasing, case variations, multiline statements, and missing `WHERE` clauses, contradicting the claim of a narrowly‑matching scanner.  
- **[ruling: SUSTAINED] [id: F7]** — while the diff adds a large test file, there is no evidence in the diff that the runtime impact is negligible; the original concern about increased CI duration thus stands.

## VERDICT
PASS

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
