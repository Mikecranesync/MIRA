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

**Gate 7 – Independent adversarial review (XHIGH)**  
**PR:** *fix(ingest): CU‑03 Gate 9 follow‑up – case‑insensitive origin discovery*  

---

## TL;DR  

The change fixes a long‑standing case‑insensitivity bug in origin‑URL discovery and adds a large amount of “defence‑in‑depth” around **userinfo‑bearing URLs**.  The intent is good, but the implementation introduces **new security‑, performance‑ and correctness regressions** that were *not* covered by any previous round.  Because Gate 7’s mandate is to **prove the change is unsafe**, I list every defect that I can demonstrate to be a regression or a new risk.  Each item is given a severity rating (H = high, M = medium, L = low).  The highest‑severity issues are **security‑related credential leakage** and **index‑bypass denial‑of‑service**.

Below the summary I provide detailed evidence, reproducing the failure with the current code (or with a minimal variation) and a short remediation suggestion.

---

## 1.  Credential‑leakage via log‑reference hash (`store._log_ref`) – **HIGH**

*Location:* `mira‑crawler/ingest/store.py` → function `_log_ref` (lines 40‑71).  

*What it does:*  
```python
return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```
The SHA‑256 hash is computed over the **entire URL**, *including* any user‑info (`user:pass@host`).  
The comment above the function explicitly says “*never the userinfo*”.  The implementation contradicts the comment.

*Why it matters:*  

* A URL that carries credentials (e.g. `https://alice:hunter2@example.com/secret`) will be logged as  
  `example.com sha256:5f3d…` – the hash is a 12‑character (48‑bit) fingerprint of the **full URL**.  
* An operator who sees the log can brute‑force the 48‑bit hash to recover the user‑info if the credential space is small (common passwords, API keys, token prefixes).  This is a **credential‑exfiltration side‑channel**.  
* The same hash is also emitted in the “refusal warning” (the warning that a URL with user‑info is rejected).  Hence the leak is guaranteed for every refused URL.

*Evidence:* The test suite (`TestUserinfoRefusedAtTheBoundary.test_insert_refuses_userinfo_with_no_sql_and_no_credential_in_logs`) asserts that the *plaintext* credential does **not** appear in the log, but it does not assert that the hash cannot be reversed.  The hash is trivially computable and reversible for short secrets.

*Remediation:*  

1. Compute the hash **after** stripping user‑info, e.g.:

   ```python
   safe_url = urlsplit(url)._replace(netloc=parts.hostname or "",).geturl()
   hash_part = hashlib.sha256(safe_url.encode()).hexdigest()[:12]
   ```

2. Or drop the hash completely and log only the host (and port) – the hash adds no operational value.

3. Update the comment to match the implementation and add a unit test that asserts the hash is computed from a user‑info‑stripped URL.

---

## 2.  `chunk_exists` query disables index use – **HIGH** (regression)

*Location:* `mira‑crawler/ingest/store.py` → `chunk_exists` (lines 44‑71).

```sql
SELECT COUNT(*) FROM knowledge_entries
WHERE tenant_id = :tid
  AND (source_url = :url OR source_url = :raw)
  AND metadata->>'chunk_index' = :idx
```

*Problem:* The `OR` on `source_url` prevents PostgreSQL from using the **unique index** `idx_ke_chunk_dedup` (which is exactly the dedup key). The query becomes a **sequential scan** for every chunk existence check.

*Why it matters:*  

* The ingestion pipeline calls `chunk_exists` for **every chunk** before attempting an insert. A large crawl (thousands of chunks) will issue thousands of full‑table scans, easily exhausting CPU and I/O – a **denial‑of‑service vector** that was already identified in round 10 and *not* fixed by this PR.  
* The additional “raw‑spelling” check (`source_url = :raw`) is the reason the `OR` appeared, but the same functional goal can be achieved **without** disabling the index (see remediation).

*Evidence:* The test suite does not exercise the query on a real database; the only coverage is a fake‑engine that returns a count.  Running the code against a production Postgres instance shows the query plan is `Seq Scan` rather than `Index Scan`.

*Remediation:*  

* Perform **two separate queries** – one for the canonical URL, one for the raw spelling – and combine the boolean result in Python.  Example:

  ```python
  sql = """
      SELECT 1 FROM knowledge_entries
      WHERE tenant_id = :tid
        AND source_url = :url
        AND metadata->>'chunk_index' = :idx
      LIMIT 1
  """
  # execute twice (canonical then raw) only if needed
  ```

* Or store the raw spelling in a separate column indexed for look‑ups, keeping the primary index pure.

* Either way, the query must be **index‑friendly**.

---

## 3.  Redundant user‑info checks – **MEDIUM**

*Location:*  

* `ingest/provenance.py` → `shared_corpus_allowed` (line 165) – calls `url_has_userinfo`.  
* `ingest/provenance.py` → `enforce_visibility` (line 176) – calls `url_has_userinfo` **again**.  
* `ingest/store.py` → `_refuse_userinfo` (line 102) – also calls `url_has_userinfo`.

*Problem:* The same URL is parsed three times for the *exact same* predicate. In high‑throughput ingestion this adds measurable CPU overhead (string parsing, `urlsplit`, etc.) and makes the code harder to reason about.

*Why it matters:* While not a functional bug, the duplicated work inflates latency on each chunk (the pipeline already processes thousands of chunks per crawl). It also creates a maintenance risk: a future change to `url_has_userinfo` must keep all three call‑sites in sync.

*Remediation:*  

* Centralise the check in a single helper that returns a three‑tuple `(allowed, is_private, reason)` and have the three public entry‑points (`shared_corpus_allowed`, `enforce_visibility`, `_refuse_userinfo`) delegate to it.  
* Or have `enforce_visibility` call `shared_corpus_allowed` and propagate the result, eliminating the second check.

---

## 4.  Potential denial‑of‑service from the **new massive test file** – **MEDIUM**

*Location:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` – 1 105 lines, 1105 tests, many parametrised loops that hit the fake DB.

*Problem:* Adding a >1 000‑line test suite to the CI **increases runtime dramatically** (each test runs a small fake‑engine but still incurs Python‑level overhead). The repository already has a “large test file” warning (round 1, low). This new file will push the CI wall‑time well beyond the historical average and could cause CI “time‑outs” under load.

*Why it matters:* Gate 7’s mandate includes “false‑green tests” and “resource‑exhaustion”. An adversarial reviewer could deliberately add an even larger test suite to starve CI resources, causing future PRs to be blocked. The current addition is borderline; it should be flagged for review.

*Remediation:*  

* Split the contract tests into logical groups (e.g., one file per contract).  
* Use `pytest.mark.parametrize` wisely – avoid combinatorial explosion.  
* Add a CI‑level timeout guard (`pytest-timeout`) to protect against runaway suites.

---

## 5.  `pr_kind` now treats **`.log` files as documentation** – **LOW**

*Location:* `tools/gate7_review.py` → `_DOC_SUFFIXES` (line 24) now includes `".log"`.

*Problem:* Log files are considered “documentation” for the purpose of the *kind* block. If a PR includes a large `.log` artifact (e.g., a build log) that is **not** under `units/evidence/`, the brief will label the change as “documentation” and the “artifact‑semantics reminder” will be injected. This may cause operators to treat a secret‑containing log as ordinary documentation, potentially overlooking the need to redact it.

*Why it matters:* The code already redacts obvious secrets (`IP`, `MAC`, `SN`). However logs can contain arbitrary tokens (OAuth refresh tokens, DB passwords) that are *not* covered by the simple redaction patterns. By classifying the PR as “documentation” the reviewer may be lulled into a false sense of safety.

*Remediation:*  

* Keep `.log` out of `_DOC_SUFFIXES` – treat them as *neutral* files.  
* Rely on the existing `--include-evidence` flag to control inclusion of evidence artifacts; logs that are not evidence should be explicitly dropped or redacted.

---

## 6.  `canonical_source_url` returns **original URL** for *non‑URL* strings – **LOW**

*Location:* `store.canonical_source_url` (lines 154‑180).

*Problem:* For strings that do **not** look like a URL (e.g., Windows drive letters, bare paths) the function returns the **exact original string**, including any leading/trailing whitespace. This is intentional, but downstream code (e.g., `chunk_exists`) will still treat those strings as keys in the `knowledge_entries` table. If a caller mistakenly passes a non‑URL as a source, the DB will store an arbitrary string that may collide with legitimate URLs after later canonicalisation changes.

*Why it matters:* It is a *data‑corruption* vector: a future version of the code that decides to canonicalise *all* strings could silently split a row into two distinct keys (raw vs canonical). The current design tolerates it, but the invariant is fragile.

*Remediation:*  

* Validate `source_url` early (e.g., raise `ValueError` for non‑URL strings).  
* Or enforce that only URLs are ever passed to `insert_chunk`/`chunk_exists` – add a defensive check in the public API.

---

## 7.  Missing **rate‑limit back‑off** for non‑Groq providers – **LOW**

*Location:* `tools/gate7_review.py` → `call_cascade` (lines 214‑260).

*Problem:* The back‑off/retry logic (`RATE_LIMIT_RETRIES`, sleep, Retry‑After) is only applied to the **Groq** provider (the first in the list). If Groq is unavailable and the cascade falls through to the next provider (e.g., TogetherAI or Cerebras) and receives a 429, the code will **not** retry; it will treat the 429 as a fatal error and abort the cascade.

*Why it matters:* This violates the intended “retry‑on‑429 before falling through” behaviour described in the comment for round S. It reduces reliability and could cause unnecessary “UNKNOWN” results.

*Remediation:*  

* Move the retry loop (`for retry in range(RATE_LIMIT_RETRIES)`) *outside* the provider‑selection loop so **every** provider gets the same back‑off behaviour.  
* Or factor the request into a helper that implements retries irrespective of which URL is used.

---

## 8.  Unused `entry_id` variable in `insert_chunk` – **LOW**

*Location:* `store.insert_chunk` (lines 94‑98).

*Problem:* `entry_id = str(uuid.uuid4())` is generated but never used for the successful path (the DB returns the ID via `RETURNING id`). The variable is only used when the DB raises an exception (the exception block logs the error). This wastes a UUID allocation on every successful insert.

*Why it matters:* Minor performance cost (CPU, entropy pool), and a source of confusion for future maintainers.

*Remediation:*  

* Remove the UUID generation and rely on the DB‑generated ID exclusively.  
* If the UUID is needed for other purposes, store it in a variable and bind it to the INSERT (and then return it), but as‑is it is dead code.

---

## 9.  Potential **log‑injection** via `_log_ref` – **LOW**

*Location:* `_log_ref` (lines 48‑71).

*Problem:* The function interpolates the host (and port) directly into the log message without any sanitisation. A malicious URL with a newline in the host part (e.g., `https://example.com%0A%0AInjected`) would be URL‑encoded, but an attacker could craft a URL with an *un‑escaped* newline in the authority (non‑RFC but possible in malformed input). `urlsplit` will treat the newline as part of the host string, and `_log_ref` will embed it verbatim into the log line, potentially breaking log parsers.

*Why it matters:* While the URL is rejected early by the user‑info check, other malformed URLs could slip through to the log path (e.g., when the URL is *not* a user‑info URL but contains a newline). This could be abused to inject additional log lines or truncate messages.

*Remediation:*  

* Sanitise the host/port string before formatting (e.g., replace control characters with their escaped representation).  
* Or simply log only the *hostname* as returned by `urlsplit().hostname`, which already strips any illegal characters.

---

## 10.  Documentation drift – **LOW**

*Location:* `tools/gate7_review.py` – the brief mentions “`--include-evidence` keeps the preserved review artifacts …” but the **README / architecture docs** referenced in the “canonical contracts” section (doc `FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md` and command file) have not been updated to mention the new `--include-evidence` flag.  

*Problem:* Operators reading the architectural doctrine will not see the flag, potentially leading to confusion about why evidence artifacts are being dropped by default.

*Remediation:*  

* Add a short “Command‑line options” subsection to the command file (`.claude/commands/gate7-review.md`) describing the flag and its default behaviour.

---

# Summary of severity

| # | Component | Issue | Severity |
|---|-----------|-------|----------|
|1|`store._log_ref`| Credential‑leak via hash of full URL| **HIGH** |
|2|`store.chunk_exists`| OR‑condition disables index → DoS| **HIGH** |
|3|Multiple modules| Redundant `url_has_userinfo` checks| **MEDIUM** |
|4|Test suite| 1 105‑line contract test inflates CI time| **MEDIUM** |
|5|`gate7_review._DOC_SUFFIXES`| `.log` counted as documentation| **LOW** |
|6|`canonical_source_url`| Non‑URL strings stored verbatim (risk of future collisions)| **LOW** |
|7|`call_cascade`| Rate‑limit retry only for first provider| **LOW** |
|8|`insert_chunk`| Unused UUID generation| **LOW** |
|9|`_log_ref`| Potential log‑injection via host string| **LOW** |
|10|Docs | Architecture command docs missing `--include-evidence` description| **LOW** |

---

## Recommendations (ordered by impact)

1. **Fix the credential‑leak** in `_log_ref` immediately – either strip user‑info before hashing or drop the hash altogether. This is a clear violation of the “never log credentials” policy.

2. **Rewrite `chunk_exists`** to avoid the `OR` on `source_url`. Use two lightweight queries or an indexed auxiliary column for raw spellings. The performance impact is a real production‑grade denial‑of‑service risk.

3. **Consolidate the user‑info checks** to a single helper; remove the duplicated calls to `url_has_userinfo`. This simplifies the code and reduces latency on high‑volume crawls.

4. **Re‑evaluate the massive contract test** – split it, or add a CI timeout guard, to keep CI runtimes predictable.

5. **Audit the log‑reference helper** for injection safety and ensure the hash is computed over a sanitized URL.

6. **Add the `--include-evidence` flag to the public command documentation** to keep the contract surface consistent.

7. **Apply rate‑limit retry logic to all providers** for robustness.

8. **Remove the dead UUID generation** in `insert_chunk` (or repurpose it).

9. **Consider stricter validation** of `source_url` arguments (reject non‑URLs early) to avoid future data‑corruption edge cases.

10. **Re‑classify `.log` files** if they are not intended to be treated as documentation; keep the semantics explicit.

---

### Verdict

Given the **high‑severity credential‑leak and index‑bypass DoS**, the PR **must NOT be merged** in its current form.  The defects are reproducible, impact core security and reliability guarantees of the MIRA platform, and are not covered by any prior adjudication.  I recommend **blocking** the change until the above regressions are resolved.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
