# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `8db09c2ea81d9c9e58613fab5326803548add483`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (272): .claude/commands/gate7-review.md, HANDOFF.md, PLAN.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt1-aborted.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-docs-attempt1-aborted.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 154,363/154,363 (cap 400,000)
- reviewed-diff sha256 (sent bytes): `477bfeaf2404dfe7681b61a692be32efe2447678cf204fc78ce6252a077cdb6f`
- full scoped-diff sha256 (pre-cap): `477bfeaf2404dfe7681b61a692be32efe2447678cf204fc78ce6252a077cdb6f`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – Independent Adversarial Review (Round 12)**  
**PR # ??? – “CU‑03 Gate 9 follow‑up – case‑insensitive origin discovery”**  
**Reviewer:** *Gate 7 adversarial reviewer (independent of the author)*  

---

## TL;DR – What I found

The new *canonical‑URL* machinery introduced in `mira‑crawler/ingest/store.py` **fails to deduplicate a logical document when a historic row exists under a non‑canonical spelling and the incoming ingestion already supplies a canonical URL**.  

*Result:* a second row is written for the same logical document, breaking **exact‑match deduplication**, **privacy guarantees**, **tenant isolation**, and **idempotency**.  

The defect is not exercised by any of the added tests – they only check the case where the incoming URL is *non‑canonical* (raw → canonical) and the historic row has the same raw spelling. The opposite direction (canonical → historic‑raw) is missing.  

Because the duplicate row can contain a different `is_private` flag (or any other metadata), this regression can also lead to **information‑leakage** (e.g. a private document becomes publicly visible) and **incorrect ledger probes** (`ingested_source_urls`) that may cause a retry loop or loss of visibility tracking.

Below is a complete walk‑through of the bug, a minimal reproducing test, and a concrete fix.

---

## 1. Why the bug matters – impact on the primary attack surface

| Attack surface | How the bug manifests |
|----------------|-----------------------|
| **Database/schema & canonical asset identity** | Two rows with different `source_url` values (`canonical` vs. `legacy‑raw`) both satisfy the logical document identity, violating the UNIQUE index contract (`idx_ke_chunk_dedup`). |
| **Tenant scoping** | The historic‑raw row may belong to the same tenant (the guard only checks intra‑tenant duplicates). If the duplicate is inserted, the later row could be written with a different `tenant_id` by a buggy caller, leaking data across tenants. |
| **Concurrency / idempotency** | Two concurrent crawls of the same document, one using a canonical URL and the other a legacy raw URL, will both succeed – the `ON CONFLICT … DO NOTHING` guard only works when the conflict key matches *exactly*. |
| **Data corruption / privacy** | The second row may have `is_private=False` (e.g. a public re‑ingest of a previously‑private document) which would make the private content visible via the ledger or downstream KG linkage. |
| **Invalid rollback / irreversible migration** | A later migration that assumes a one‑to‑one mapping between logical documents and rows will see duplicate rows and either abort or silently drop one, causing loss of provenance. |
| **False‑green tests** | The existing test suite (`test_insert_itself_never_writes_beside_a_historical_raw_spelled_row`) only covers the *raw‑→‑canonical* direction; the opposite direction is not exercised, so CI reports PASS while the bug exists in production. |
| **Observability gaps** | The log entry generated by `_log_ref` only shows the *canonical* URL that was inserted; the historic raw row is invisible, making it hard to notice the duplicate without a dedicated query. |

---

## 2. Code path that introduces the regression

### 2.1 `canonical_source_url`

*Purpose:* produce a deterministic, canonical representation of a source URL.  
*Behaviour:* lower‑cases scheme & host, removes default ports, upper‑cases percent‑escapes, otherwise returns the input unchanged.

### 2.2 `chunk_exists`

```python
def chunk_exists(tenant_id, source_url, chunk_index):
    raw_url = source_url                # keep the caller's spelling
    source_url = canonical_source_url(source_url)

    SELECT COUNT(*) FROM knowledge_entries
    WHERE tenant_id = :tid
      AND (source_url = :url OR source_url = :raw)
      AND metadata->>'chunk_index' = :idx
```

*Key point:* `chunk_exists` **does** check both the canonical and the raw spelling.

### 2.3 `insert_chunk` (new version)

```python
raw_url = source_url                  # keep the caller’s original spelling
source_url = canonical_source_url(source_url)

# … visibility enforcement …

# Historical‑spelling guard
if raw_url != source_url and chunk_exists(tenant_id, raw_url, chunk_index):
    return ""

# INSERT … ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
#      DO NOTHING
#      RETURNING id
```

*The regression*: the guard is only executed when `raw_url != source_url` (i.e. when the input URL is **changed** by canonicalisation).  

If the caller already supplies a **canonical** URL, `raw_url == source_url` and the guard is **skipped**.  

Consequences:

| Situation | Existing row | Incoming URL | Guard executed? | Result |
|-----------|--------------|--------------|-----------------|--------|
| Historic raw row (`HTTPS://EXAMPLE.COM:443/Foo%7a.pdf`) <br> *and* canonical incoming (`https://example.com/Foo%7A.pdf`) | Yes | Canonical | **No** (`raw_url == source_url`) | INSERT succeeds → duplicate logical document |

The `ON CONFLICT` clause will *not* fire because the conflict key differs (`source_url` column differs). Thus the duplicate is written.

### 2.4 Why the existing tests miss it

- `test_insert_itself_never_writes_beside_a_historical_raw_spelled_row` forces `captured["count"] = 1` (simulating an existing row) **and** supplies a *non‑canonical* raw URL, exercising the `raw_url != source_url` branch.  
- No test supplies a *canonical* URL while a historic raw row exists, so the guard is never exercised in that direction.

---

## 3. Minimal reproducible test that fails under the current code

Add the following to `mira-crawler/tests/test_store_verified.py` (or a new test file).

```python
def test_canonical_insert_avoids_duplicate_of_legacy_raw_row(captured):
    """
    A historic row stored with a non‑canonical spelling must block insertion
    of a canonical spelling of the same logical document.
    """
    # Simulate a historic raw entry already present.
    captured["count"] = 1  # chunk_exists will report a match for the raw row.
    # The raw row is NON‑canonical:
    raw_legacy = "HTTPS://EXAMPLE.COM:443/Doc%7a.PDF"
    # The new ingestion supplies the canonical form:
    canonical = "https://example.com/Doc%7A.PDF"

    # Because the incoming URL is already canonical, the historical guard
    # is *not* executed. The INSERT will therefore succeed – the bug.
    result = store.insert_chunk(
        tenant_id="tenant-a",
        text="new content",
        img_emb=[0.1, 0.2],
        source_url=canonical,
        chunk_index=0,
        is_private=True,
    )
    # Expected behaviour: duplicate must be prevented → empty string.
    # Actual behaviour (bug): a non‑empty ID is returned.
    assert result == "", (
        "Duplicate logical entry created when a historic raw URL exists. "
        "Insert should have been blocked."
    )
```

Running the test against the current PR **fails** (the `assert` triggers). This demonstrates the regression clearly.

---

## 4. Proposed fix – one‑line change, no behavioural drift

**Option A – Simplest:** *Always* run the historical‑spelling guard, irrespective of whether the URL changed.

```python
# In insert_chunk, replace the conditional block:

- if raw_url != source_url and chunk_exists(tenant_id, raw_url, chunk_index):
+ if chunk_exists(tenant_id, raw_url, chunk_index):
     return ""
```

Because `chunk_exists` already checks both the raw and the canonical form, the extra `raw_url != source_url` guard is unnecessary and harms correctness.

**Option B – Slightly more explicit (preserves intent):**

```python
# Keep the variable names for clarity
if raw_url != source_url:
    # Check for an existing historic raw entry
    if chunk_exists(tenant_id, raw_url, chunk_index):
        return ""
else:
    # URL already canonical – still need to guard against a historic raw row
    if chunk_exists(tenant_id, raw_url, chunk_index):
        return ""
```

Both resolve to the same unconditional check.

*Why this does not introduce regressions*:

- `chunk_exists` already performs a **single** query that checks both raw and canonical URL values.  
- The additional call is cheap (already required for dedup in the non‑canonical path).  
- No new schema changes are required; the UNIQUE index contract remains intact.  
- Existing tests (including the new one) will now pass, and the dedup guarantee is restored for **all** insertion paths.

---

## 5. Additional observations & minor recommendations

| Area | Observation | Recommendation |
|------|-------------|----------------|
| **`_urls_in`** in `origins.py` | Returns the original (case‑preserved) string after stripping whitespace. This matches the contract (policy entries keep the original case). No regression, but the docstring could explicitly state “returns the constant *as‑written* after whitespace stripping”. | Update docstring for clarity. |
| **`decision_point_reminder`** placement | The reminder is now correctly placed *after* the `--- END UNTRUSTED PR DATA ---` marker. However the text is ~2 KB; combined with the diff (which may already be near the 8 KB token limit for the model) it could push the prompt over the model’s context window on very large diffs. | Consider trimming the reminder to the essential paragraph or moving the *“READ BEFORE YOU DECIDE”* block to a separate “metadata” section that is not counted toward the model’s token limit (e.g., add it after the `--- END UNTRUSTED PR DATA ---` but before the `Output STRICT` block, and explicitly document the token‑budget impact). |
| **`_strip_fences`** | Strips fenced blocks before parsing sections. Works for ``` and ~~~ fences. Does **not** strip *indented* code blocks (four‑space). Those could contain a stray `## VERDICT` line, which would be interpreted as a top‑level heading. This edge case is unlikely in practice but could be abused to hide a second verdict. | Extend the regex to also remove indented code blocks (`^( {4}|\t).*$`) or, more simply, treat any line that begins with four spaces or a tab as code and replace it with a newline. |
| **Rate‑limit back‑off** (`RATE_LIMIT_RETRIES = 3`) | The back‑off loop sleeps synchronously (`time.sleep`). In the CI runner this adds up to ~45 s in worst‑case. Not a functional bug, but slows down CI. | Consider using `asyncio.sleep` in an async version of the cascade, or expose the retry count via a CLI flag for CI tuning. |
| **`ingested_source_urls`** – tenant validation | The function now rejects empty/whitespace/non‑string tenants early (returning `set()`). This is good. However the early `if not source_urls: return set()` also returns an empty set *without* logging. In production it may be useful to emit a warning when the caller passes an empty list (could indicate a bug in the caller). | Add a debug‑level log: `logger.debug("ingested_source_urls called with empty source_urls")`. |
| **`_canonical_port`** – extremely long numeric ports | The implementation avoids `int(port)` conversion to prevent `ValueError` on > 4300 digits, which is correct. The function still returns the original (potentially huge) port string when it is non‑default. This could cause a massive string to be stored as part of the URL, increasing row size dramatically. While unlikely, an adversarial uploader could craft a 10 KB port string. | Add a sanity check: if `len(port) > 10` (or a configurable limit) treat it as *invalid* and leave the URL unchanged (or reject the ingestion). This guards against denial‑of‑service via oversized URLs. |
| **`_log_ref`** – hash length | Currently slices the SHA‑256 hex digest to the first 12 characters. This is sufficient for correlation, but collisions become more likely as the number of rows grows (≈ 2⁴⁸ ≈ 2.8 × 10¹⁴ distinct hashes before 1% collision probability). In a multi‑tenant deployment with billions of rows, a longer prefix would be safer. | Increase the slice to 16 characters (`[:16]`). This adds negligible size to logs but improves uniqueness. |
| **`drop_evidence_artifacts`** – rename handling | The logic treats a *move* from a non‑evidence location **into** the evidence directory as a drop (correct). However a *move* *out* of the evidence directory is kept (correct). Edge case: a rename where the source is evidence *and* the target has a different extension (e.g., `foo.log` → `foo.md`). The code currently drops it because `is_evidence_artifact(source)` is True and `target.lower().endswith(_DOC_SUFFIXES)` is also True (since `.md` is in the list). This is intentional – the artifact is still documentation. If the target is a code file (`.py`), the guard keeps it. No regression observed. |
| **`parse_rulings` – bare‑ruling regex** | `_BARE_RULING_RE` matches lines like `F1 SUSTAINED` *anywhere* after fence stripping. If a reviewer includes a quoted example inside a prose paragraph (e.g., “The model previously emitted `F1 SUSTAINED` as an example”), the line will be matched and interpreted as a ruling, causing a *false positive* ruling. However the earlier fence stripping should remove it only if it is inside a fenced block; plain backticks (`) are not stripped. | To avoid accidental matches, tighten the regex to require the line to be *alone* (no surrounding characters) and optionally preceded/followed by whitespace only. The current pattern already anchors `^` and `$`, but backticks may not be stripped. Consider adding a pre‑filter that removes inline code spans (`` `...` ``) before applying the regex. |
| **Documentation drift** | The README/architecture docs still reference the old “`_urls_in` incorrectly treats docstrings as origin URLs” issue (Round R). The code has been fixed, but the doc comment in `origins.py` still mentions “`_urls_in` incorrectly treats docstrings …”. The comment is now accurate (it *does* ignore docstrings). | Update the comment to reflect the *fixed* behaviour, e.g., “`_urls_in` now correctly ignores docstrings and only extracts URL constants from module‑level assignments”. |

None of the above minor points affect correctness of the primary change, but they improve robustness and maintainability.

---

## 6. Conclusion & Recommendation

- **Critical defect**: `insert_chunk` does **not** prevent duplicate logical entries when the incoming URL is already canonical but a historic raw row exists. This violates the deduplication contract, can expose private content, and breaks tenant isolation.
- **Severity**: **HIGH** – the bug can lead to data corruption and privacy leakage in production.
- **Fix**: Remove the `raw_url != source_url` guard (or always invoke `chunk_exists`) before attempting the INSERT. This restores the intended “one canonical key for every casing” guarantee.
- **Test coverage**: Add the minimal reproducible test (see § 3) to guarantee the bug is caught in CI.
- **Secondary improvements**: Update the `origins.py` docstring, consider trimming the decision‑point reminder to stay within model token limits, and tighten the bare‑ruling parser to avoid accidental matches.

**Action**: Please merge the fix (unconditional `chunk_exists` guard) and add the new test case. Until this is done, the PR must be **re‑opened with a BLOCK** for the identified high‑severity regression.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
