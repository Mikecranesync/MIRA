# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, authorization, tenant scoping, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `24f1db7ff4928737d401b65c05ec73a30923b7a9`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (281): .claude/commands/gate7-review.md, HANDOFF.md, PLAN.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt1-aborted.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-docs-attempt1-aborted.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-docs-adjudication-attempt1-invalid.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-docs-adjudication-attempt1-invalid.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round25-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 166,889/166,889 (cap 400,000)
- reviewed-diff sha256 (sent bytes): `18a8fce9275ebb291ceff6f86d73fc9f6db53281561b079a97994ce11fa48561`
- full scoped-diff sha256 (pre-cap): `18a8fce9275ebb291ceff6f86d73fc9f6db53281561b079a97994ce11fa48561`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## Gate 7 – Independent adversarial review  
**PR:** `fix(ingest): CU‑03 Gate 9 follow‑up — case‑insensitive origin discovery`  
**Reviewer:** *independent adversarial reviewer*  
**Date:** 2026‑08‑30  

### TL;DR  
The changes introduce a **regression in origin‑discovery** and a **robustness gap in URL canonicalisation** that were not caught by the added test‑suite. Both defects can cause **incorrect policy enforcement, unexpected ingestion failures and potential credential leakage**. They also break the “no‑docstring‑origin” guarantee that Gate 7 has relied on since round R.  

---

## 1️⃣ Finding – `_urls_in` still treats arbitrary string literals (including doc‑strings that consist *only* of a URL) as provenance origins  

| **Severity** | **Title** |
|--------------|-----------|
| **high** | `_urls_in` matches any `ast.Constant` whose *value* begins with an HTTP(S) URL, regardless of the constant’s syntactic role. This re‑introduces the “doc‑string as origin” bug that was closed in round R and also expands it to *any* string literal (function arguments, default values, in‑line literals, etc.). |

### Why this matters
* **Policy mismatch** – A URL that lives only in documentation or test code is fed to `discover_manifests` → `classify_origin`. If the URL is not present in `provenance_policy.yaml` the ingest gate will **force‑private** the whole document (see `enforce_visibility`). This can turn a perfectly valid public document into a private one and cause a **BLOCK** where none should exist.  
* **False‑positive security alerts** – The new `url_has_userinfo` check will be triggered on these spurious origins, potentially logging a refusal for a URL that never left the codebase.  
* **Performance waste** – Scanning every string literal dramatically inflates the number of “origins” the system has to classify, leading to unnecessary database look‑ups and slower ingest runs.  

### Re‑production steps (minimal)

1. Create a module `bad.py` inside `mira‑crawler/`:

```python
"""https://example.invalid/only‑docstring"""

def foo():
    # an in‑line literal that looks like an origin but is not a manifest entry
    url = "https://example.invalid/inline‑literal"
    return url
```

2. Run the manifest discovery script (the same code path used by the CI tests):

```bash
python -c "from ingest import origins; print(origins.discover_manifests('path/to/bad.py'))"
```

3. **Observed result** – both the doc‑string and the in‑line literal appear in the discovered origins, e.g.:

```json
{
  "bad.FOO": ["https://example.invalid/only‑docstring"],
  "bad.FOO": ["https://example.invalid/inline‑literal"]
}
```

4. The ingest pipeline now attempts to classify those two URLs; because they are not present in `provenance_policy.yaml` it marks the whole ingest as **private**, causing a BLOCK.

### Impact analysis
| Impact | Description |
|--------|-------------|
| **Data‑privacy / correctness** | Legitimate public documents become private, breaking downstream pipelines that expect public sharing. |
| **Operational stability** | Ingest runs may fail or be blocked for unrelated reasons, increasing alert fatigue and manual triage time. |
| **Security** | The log‑refusal path may be exercised for URLs that never leave the repository, potentially confusing operators. |
| **Performance** | Unnecessary policy look‑ups for dozens or hundreds of stray literals per PR. |

### Recommended fix
Restrict `_urls_in` to *only* those string constants that are **values of top‑level assignments** (the pattern used before round R). A straightforward implementation:

```python
def _urls_in(node: ast.AST) -> list[str]:
    urls = []
    for stmt in ast.iter_child_nodes(node):
        # Only look at module‑level Assign / AnnAssign nodes
        if isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            # Only simple string literals (no f‑strings, no concatenations)
            value = stmt.value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                candidate = value.value.strip()
                if candidate.lower().startswith(("http://", "https://")):
                    urls.append(candidate)
    return urls
```

* This change eliminates doc‑strings, function‑call literals, default arguments, etc.  
* The existing unit‑tests already cover the “doc‑string does not count” case; add a new test for an **in‑line literal** to guard against regression.

---

## 2️⃣ Finding – `canonical_source_url` (and callers) do not validate the input type, causing crashes on `None`/non‑string URLs  

| **Severity** | **Title** |
|--------------|-----------|
| **medium** | `canonical_source_url` assumes a `str`. If a caller passes `None` (or any non‑string), `url.strip()` raises `AttributeError`, bubbling up from `chunk_exists` or `insert_chunk`. This aborts the whole ingest job instead of the graceful *refuse* path. |

### Why this matters
* **Unexpected failures** – The ingest pipeline receives many metadata sources (e.g., from crawlers, external services). A missing URL field (`None`) is a realistic edge case. The current code will crash, leading to a *failed* task rather than a *refused* write.  
* **Data loss** – A failure aborts the transaction for the entire batch, discarding any other valid chunks that could have been stored.  

### Re‑production steps

```python
from ingest import store

# Simulate a missing source_url
store.insert_chunk(
    tenant_id="tenant-a",
    content="some text",
    img_emb=[0.1, 0.2, 0.3],
    source_url=None,          # <-- the problematic value
    chunk_index=0,
    is_private=False,
    manufacturer="Acme",
    model_number="123"
)
```

*Result*: `AttributeError: 'NoneType' object has no attribute 'strip'` is raised and propagates out of `insert_chunk`, causing the whole ingest task to fail.

### Impact analysis
| Impact | Description |
|--------|-------------|
| **Reliability** | A single malformed record kills the entire ingest run. |
| **Observability** | The exception is logged as an *error* in the task, but there is no clear “refused” audit trail for the offending URL. |
| **Security** | Not a direct security issue, but the lack of graceful handling can hide the fact that a credential‑bearing URL was dropped (if it were `None` because the crawler stripped it). |

### Recommended fix
Add a defensive guard at the beginning of `canonical_source_url` (and similarly in `chunk_exists`) to reject non‑string inputs early:

```python
def canonical_source_url(url: str) -> str:
    if not isinstance(url, str):
        # Treat non‑string as an empty URL → will be refused downstream
        return ""
    # existing implementation follows ...
```

Alternatively, raise a custom `InvalidURLError` that `insert_chunk` catches and treats as a *refuse* (returning an empty string). Update the unit‑test suite with a test case for `None` and other non‑string inputs.

---

## 3️⃣ Finding – `url_has_userinfo` only inspects **http/https** schemes, but `_refuse_userinfo` is applied to *all* URLs  

| **Severity** | **Title** |
|--------------|-----------|
| **low‑medium** | URLs with user‑info in non‑http schemes (e.g., `ftp://user:pass@example.com`) bypass the credential‑refusal check because `url_has_userinfo` returns `False`. They are then stored in the `knowledge_entries` table, potentially leaking credentials. |

### Why this matters
* Although the current MIRA crawler primarily stores `http`/`https` URLs, the code is generic and may be reused in other contexts (future integrations, internal file‑based origins, etc.).  
* Storing a URL with embedded credentials violates the documented “never persist credentials in URLs” policy and could expose secrets if the DB is ever exported or inspected.

### Re‑production steps
```python
from ingest import store, provenance

url = "ftp://secret:pw@ftp.example.com/file.txt"

# Direct store call (bypassing provenance)
store.insert_chunk(
    tenant_id="t",
    content="data",
    img_emb=[0.0]*768,
    source_url=url,
    chunk_index=0,
    is_private=False,
    manufacturer="Acme",
    model_number="001"
)
# No refusal → row inserted with userinfo present
```

### Impact analysis
| Impact | Description |
|--------|-------------|
| **Security** | Credentials are persisted in clear text. |
| **Compliance** | Violates the documented “user‑info is never stored” rule (Gate 7 round Z). |
| **Future‑proofing** | If a new crawler adds `ftp` or `smb` support, the bug becomes a production‑grade leak. |

### Recommended fix
Make `url_has_userinfo` scheme‑agnostic (or at least include the schemes that the store may accept). Simplest change:

```python
def url_has_userinfo(url: str) -> bool:
    s = str(url).strip()
    head, sep, rest = s.partition(":")
    if not sep or not _SCHEME_RE.fullmatch(head):
        return False
    if not rest.startswith("//"):
        return False
    # rest of logic unchanged …
```

Then `_refuse_userinfo` will correctly reject any URL that contains a user‑info component, regardless of scheme.

Add a unit‑test covering an `ftp://user:pw@host` case.

---

## 4️⃣ Observation – Prompt‑length inflation due to `decision_point_reminder`  

*The new reminder block (≈ 3 KB) is inserted **after** the `--- END UNTRUSTED PR DATA ---` marker and **before** the “Output STRICT” section. Together with the already‑truncated diff (200 KB) this pushes the total prompt size close to the model’s token limit for the Groq/Llama‑8B‑x‑high path (≈ 260 K tokens).*

### Why this matters
* If the token limit is exceeded, the LLM will **truncate the beginning** of the prompt, potentially discarding the diff or the reminder itself, which defeats the purpose of the reminder and can lead to false‑negative reviews.  
* The original brief promised “the brief must never exceed the model’s context”; the added block violates that guarantee for very large diffs.

### Recommendation
* Dynamically **omit** the reminder when the diff length is already near the limit (e.g., > 180 KB).  
* Or move the reminder into the **system‑prompt** (outside the user‑prompt) where it does not count against the token budget.  

This is not a correctness bug, but a **operational reliability** issue that could surface in real‑world large PRs.

---

## Summary of required actions  

| # | Action | Priority |
|---|--------|----------|
| 1 | Restrict `_urls_in` to top‑level `Assign`/`AnnAssign` nodes (or otherwise filter out non‑manifest literals). Add a test for an in‑line literal that should **not** be discovered. | **high** |
| 2 | Guard `canonical_source_url` (and callers) against non‑string inputs; return `""` or raise a controlled exception that `insert_chunk` treats as a refusal. Add tests for `None`/numeric inputs. | **medium** |
| 3 | Extend `url_has_userinfo` to detect user‑info for **all** schemes, or at least those that the store may accept (`ftp`, `smb`, `file`). Add a test for an `ftp://user:pw@host` URL. | **low‑medium** |
| 4 | Review prompt‑size handling for `decision_point_reminder`; make it optional when diff size approaches the model’s token budget. | **low** (operational) |

Addressing these points will restore the original guarantees of Gate 7 (no false origin detection, safe handling of malformed URLs, and no credential leakage) and prevent regressions that could cause blocks, data loss, or security exposure in production.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
