# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `fa304168073ab585df4a8201b87f5778a89b6181`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (244): .claude/commands/gate7-review.md, HANDOFF.md, PLAN.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 143,232/143,232 (cap 400,000)
- reviewed-diff sha256 (sent bytes): `5ce4ba3e6cc5f052beae2b8308482a93167d494dae2eaaa277d7a54622a9b27b`
- full scoped-diff sha256 (pre-cap): `5ce4ba3e6cc5f052beae2b8308482a93167d494dae2eaaa277d7a54622a9b27b`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## TL;DR  
The new *canonical‑URL* logic is **incomplete**: historic rows that contain an *explicit default port* (or any other canonical‑equivalent spelling) are **not recognised** when the caller supplies the *canonical* form.  
Both `chunk_exists` (the pre‑insert duplicate guard) and `ingested_source_urls` (the “ledger probe”) only look for **the exact raw spelling the caller passed** *or* its canonical form – they never look for the *other* canonical‑equivalent spelling that may already be stored.  

Result: a row that was written before the fix (e.g. `https://example.com:443/file.pdf`) can be duplicated by a later ingestion that uses the canonical spelling (`https://example.com/file.pdf`). This creates **duplicate logical documents**, breaks the “exact‑match UNIQUE index” guarantee, and corrupts the knowledge base. The defect is not exercised by the current test‑suite (the tests only cover the case where the historic row is queried with the same raw string).  

A secondary, low‑severity security observation: `_log_ref` includes the **userinfo** part of a URL in the log line, potentially leaking credentials. This is not covered by the tests either.

Below is a deep‑dive into the problem, a reproducible example, the impact analysis, and concrete remediation suggestions.

---

## 1. What the change was trying to achieve  

* Add case‑insensitive scheme matching in `_urls_in`.  
* Introduce a **canonical URL** normaliser (`canonical_source_url`) that lower‑cases scheme + host, drops default ports for `http/https`, and upper‑cases any valid `%HH` escapes.  
* Update the dedup guard (`chunk_exists`) and the write path (`insert_chunk`) to use the canonical form **and** the raw spelling supplied by the caller, so that historic rows (written before the fix) are still found.  
* Adjust the ledger‑probe (`ingested_source_urls`) to query both spellings.

These changes are verified by a huge new test suite (`tests/test_conflict_and_packaging_contracts.py`) that checks many happy‑path scenarios.

---

## 2. The hidden regression – duplicate logical rows

### 2.1. Where the code falls short

```python
def chunk_exists(tenant_id: str, source_url: str, chunk_index: int) -> bool:
    raw_url = source_url
    source_url = canonical_source_url(source_url)
    SELECT COUNT(*) FROM knowledge_entries
    WHERE tenant_id = :tid
      AND (source_url = :url OR source_url = :raw)
      AND metadata->>'chunk_index' = :idx
```

```python
def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    asked = list(source_urls)
    lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})
    SELECT DISTINCT source_url FROM knowledge_entries
    WHERE source_url = ANY(:urls) AND tenant_id = :tid
```

Both functions **only compare** the *raw* value the caller passed (`:raw`) **or** its canonicalisation (`:url`).  
If the DB already holds a *different* canonical‑equivalent spelling (e.g. the same URL **with an explicit default port**), it will **not** be matched.

### 2.2. Concrete reproduction

```python
from mira_crawler.ingest import store

# 1️⃣  Insert a historic row with an explicit default port.
store.insert_chunk(
    tenant_id="tenant-a",
    text="old content",
    image_embedding=[0.0] * 768,
    source_url="https://example.com:443/file.pdf",   # <-- explicit default port
    chunk_index=0,
    is_private=True,
)

# 2️⃣  Now ingest the same document **without** the port.
# The caller supplies the canonical spelling.
result = store.insert_chunk(
    tenant_id="tenant-a",
    text="new content",
    image_embedding=[0.0] * 768,
    source_url="https://example.com/file.pdf",      # <-- canonical form
    chunk_index=0,
    is_private=True,
)

print("Returned ID:", result)   # <-- non‑empty → a second row was inserted!
```

Because `source_url` is canonicalised to `https://example.com/file.pdf`, the `SELECT … (source_url = :url OR source_url = :raw)` sees **no** row (the historic row is `…:443/file.pdf`). The insert proceeds, the `ON CONFLICT` does **not** fire (different `source_url`), and a **second logical row** appears.

The same blind‑spot exists in `ingested_source_urls`:

```python
# DB currently contains the historic row with default port
found = store.ingested_source_urls(
    ["https://example.com/file.pdf"],   # caller asks canonical form
    tenant_id="tenant-a",
)
print(found)   # → empty set! (false‑negative)
```

The probe thinks the document has never been ingested and a later crawl will re‑write it – another duplicate.

### 2.3. Why the current tests miss it

* `test_insert_itself_never_writes_beside_a_historical_raw_spelled_row` **injects** `captured["count"] = 1` for the **exact raw URL** that the test passes. It never exercises the case where the historic row *differs* from the raw URL only by an *implicit* canonicalisation (default‑port removal or `%`‑case change).  
* `test_ledger_probe_matches_historical_port_and_escape_spellings` only verifies the situation where the **caller** supplies the *raw* spelling that exists in the DB. It does **not** query the canonical spelling when the DB row contains the explicit default port.

Consequently, the regression lives undetected in production data.

---

## 3. Impact analysis

| Symptom | Root cause | Consequence |
|---------|------------|-------------|
| Two rows with the same logical document (same tenant, same chunk index) appear in `knowledge_entries` | `chunk_exists`/`ingested_source_urls` miss historic rows that differ only by default‑port or `%`‑case | - Violates the “exact‑match UNIQUE index” contract (the DB still enforces uniqueness on the *stored* string, not the logical document).<br>- Duplicate embeddings, duplicate KG links, inflated storage.<br>- Down‑stream services (KG writer, search, analytics) may see contradictory data for the same source.<br>- `ingested_source_urls` may falsely report “not ingested”, causing endless re‑crawls and eventual resource exhaustion. |
| Ingestion pipeline may think a document is “new” and re‑process it | `ingested_source_urls` false‑negative | Unnecessary work, higher load, and possible race‑condition where two crawlers ingest the same doc concurrently (both see “not ingested” → both try to write). |
| The “canonical‑only” duplicate‑guard is bypassed for historic rows that contain a default port | Incomplete query predicate | The system’s guarantee that **one logical document ⇒ one row** is broken – a fundamental data‑integrity contract of Gate 7. |
| Potential credential leakage (secondary) | `_log_ref` logs the full *origin* (`netloc`) which includes user‑info if present | Logs may contain `user:password@host` – a secret‑boundary violation. The test suite does not cover URLs with user‑info. |

All of the above are **high‑severity** from the Gate 7 perspective (database/schema, data‑corruption, concurrency/idempotency, tenant‑scoping). The defect is hidden because it only manifests when an *old* row with a default port co‑exists with a *new* canonical request – a scenario that real crawlers will encounter after the migration.

---

## 4. Recommended remediation

### 4.1. Extend the duplicate‑detect query

Create a helper that returns **all canonical‑equivalent variants** of a URL that could already be stored:

```python
def _url_variants(url: str) -> set[str]:
    """
    Return the set of URL strings that are considered equivalent for dedup.
    Includes:
      * the raw URL as supplied,
      * the fully canonical form (scheme/host lower‑cased, default ports stripped, %‑escapes upper‑cased),
      * the raw URL *with* an explicit default port added if it is missing (only for http/https).
    """
    canonical = canonical_source_url(url)
    variants = {url, canonical}
    # Add explicit default‑port version if the URL lacks a port and the scheme has one.
    scheme, _, rest = url.partition(":")
    if scheme.lower() in ("http", "https") and not rest.startswith("//"):
        # Not a hierarchical URL – nothing to do.
        return variants
    # Parse out authority to see if a port is present.
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    if parts.port is None and parts.scheme.lower() in ("http", "https"):
        # Re‑build the URL with the default port explicitly inserted.
        default = _DEFAULT_PORTS[parts.scheme.lower()]
        netloc = parts.netloc
        # Preserve possible user‑info.
        if "@" in netloc:
            userinfo, host = netloc.split("@", 1)
            netloc = f"{userinfo}@{host}:{default}"
        else:
            netloc = f"{netloc}:{default}"
        explicit = urlunsplit(
            (parts.scheme.lower(), netloc, parts.path, parts.query, parts.fragment)
        )
        # Canonicalise the explicit‑port version as well (it will strip the port again,
        # so the set already contains the canonical form, but we keep the explicit
        # variant for the DB lookup).
        variants.add(explicit)
    return variants
```

#### 4.1.1. Update `chunk_exists`

```python
def chunk_exists(tenant_id: str, source_url: str, chunk_index: int) -> bool:
    variants = _url_variants(source_url)
    sql = text("""
        SELECT COUNT(*) FROM knowledge_entries
        WHERE tenant_id = :tid
          AND source_url = ANY(:variants)
          AND metadata->>'chunk_index' = :idx
    """)
    with _engine().connect() as conn:
        count = conn.execute(sql, {"tid": tenant_id,
                                   "variants": list(variants),
                                   "idx": str(chunk_index)}).scalar()
    return (count or 0) > 0
```

*Now* the lookup will match a historic row that includes an explicit default port even when the caller supplies the canonical form.

#### 4.1.2. Update `ingested_source_urls`

```python
def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    if not source_urls:
        return set()
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
        return set()

    # Build the full variant set for **all** requested URLs.
    # This is safe because the number of URLs in a single ledger probe is modest.
    variants = set()
    for u in source_urls:
        variants.update(_url_variants(u))

    with _engine().connect() as conn:
        rows = conn.execute(
            text(
                "SELECT DISTINCT source_url FROM knowledge_entries "
                "WHERE source_url = ANY(:variants) AND tenant_id = :tid"
            ),
            {"variants": list(variants), "tid": tenant_id},
        ).fetchall()

    # Convert DB rows to a set for O(1) lookup.
    found = {r[0] for r in rows if r and r[0]}

    # Return the caller's original URLs that have *any* equivalent stored.
    return {
        u for u in source_urls
        if u in found or canonical_source_url(u) in found or
           any(v in found for v in _url_variants(u) if v != u)
    }
```

Now a query for the canonical form will succeed even if the historic row stored the explicit default port.

### 4.2. Migration (one‑off) – clean up existing rows

The above change *prevents* new duplicates, but historic rows that already exist with explicit default ports will still be present. A one‑off migration is already hinted at in the docstring (“Historical residual, documented not migrated”). The migration can:

```sql
UPDATE knowledge_entries
SET source_url = canonical_source_url(source_url)
WHERE source_url ~* ':\d{1,5}$'   -- URLs ending with an explicit port
  AND (split_part(source_url, '://', 2) ~* '^([^/:]+):(?:0*80|0*443)$')
  AND split_part(source_url, ':', 1) IN ('http','https');
```

(Use a PL/pgSQL function that calls the same canonicalisation logic, or a Python script that reads rows, rewrites them, and updates them in batches.) This eliminates the *old* variants and guarantees that the DB contains only canonical URLs moving forward.

### 4.3. Security tightening – redact user‑info in logs

```python
def _log_ref(url: str) -> str:
    """
    A log‑safe reference: origin (host[:port] **without** user‑info) + short hash.
    """
    if not url:
        return "<no url>"
    from urllib.parse import urlsplit

    try:
        parts = urlsplit(url)
        # `netloc` may be "user:pass@host:port". Strip credentials.
        origin = parts.hostname or "<no host>"
        if parts.port:
            origin = f"{origin}:{parts.port}"
    except ValueError:
        origin = "<unparseable>"
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

*Effect*: A refusal log will never contain `user:password@` – only the host (and explicit port if present). This removes the secret‑boundary leak while preserving the hash needed for correlation.

### 4.4. Test coverage additions

Add two targeted tests to the existing suite:

```python
def test_chunk_exists_matches_historic_default_port(monkeypatch):
    # Simulate a DB row that stored the URL with an explicit default port.
    captured = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(captured))
    captured["rows"] = []          # not used
    captured["count"] = 1          # SELECT COUNT(*) returns 1 for the variant

    raw = "https://example.com:443/file.pdf"
    canonical = "https://example.com/file.pdf"
    # Caller supplies canonical spelling.
    assert store.chunk_exists("tenant-a", canonical, 0) is True
    # The params must include BOTH variants.
    assert set(captured["params"]["variants"]) == {raw, canonical}
```

```python
def test_ingested_source_urls_matches_historic_default_port(monkeypatch):
    captured = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(captured))
    captured["rows"] = [("https://example.com:443/file.pdf",)]

    # Caller asks for the canonical form.
    result = store.ingested_source_urls(
        ["https://example.com/file.pdf"], tenant_id="tenant-a"
    )
    assert result == {"https://example.com/file.pdf"}
```

These tests guarantee that the *variant* logic works for the default‑port edge‑case that broke the current implementation.

---

## 5. Summary of why this is a **Gate 7 failure**

| Gate 7 auto‑escalation trigger | Current behavior | Desired behavior |
|--------------------------------|------------------|------------------|
| **Database / schema** | Duplicate logical rows can be written because the UNIQUE index only protects *exact* `source_url` values. | No duplicate logical rows – any URL that is canonical‑equivalent must be treated as the same key. |
| **Canonical asset identity** | `canonical_source_url` is defined, but the *lookup* functions (`chunk_exists`, `ingested_source_urls`) do **not** use the full equivalence class. | Look‑ups must consider *all* canonical‑equivalent spellings, including explicit default ports and `%`‑case variations. |
| **Tenant scoping** | Not directly violated, but the false‑negative in `ingested_source_urls` causes the function to query **all tenants** when `tenant_id` is empty, which is already prevented. | Same as current – already safe. |
| **Concurrency / idempotency** | Two concurrent crawls can each think the document is “new” (because each sees a different spelling) and both write, breaking idempotency. | Pre‑check must be *idempotent* across all canonical equivalents, preventing the race. |
| **Data corruption** | Duplicate rows for the same logical document (same tenant, same chunk index) lead to inconsistent KG links, duplicate embeddings, and broken analytics. | Exactly‑one row per logical document. |
| **Security** | `_log_ref` may leak user‑info. | Log only host (no credentials). |

The defect is **high‑severity** because it compromises the core data‑integrity contract that Gate 7 enforces. It is also a **false‑green**: the existing test suite reports “PASS” while the production system is silently diverging.

---

## 6. Action items for the maintainer

1. **Implement the `_url_variants` helper** and modify `chunk_exists` and `ingested_source_urls` to use `ANY(:variants)` as shown.  
2. **Add the two new tests** to `tests/test_conflict_and_packaging_contracts.py` (or a dedicated file). Run the full test suite to confirm no regressions.  
3. **Apply the security patch** to `_log_ref` to strip user‑info before logging. Add a unit test asserting that a URL containing credentials does not appear in the log output.  
4. **Plan a one‑off migration** (Python script or DB function) to rewrite existing rows to their canonical form, or at least to add the explicit default‑port variant to the DB for backward compatibility.  
5. **Update the documentation** (docstring of `canonical_source_url` and the “dedup key” section) to note that the lookup now includes explicit‑default‑port variants, and that a migration is required.  

Once these changes are merged and the new tests pass, the system will once again guarantee **exact‑match deduplication** across all historical spellings, restoring the integrity expected by Gate 7.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
