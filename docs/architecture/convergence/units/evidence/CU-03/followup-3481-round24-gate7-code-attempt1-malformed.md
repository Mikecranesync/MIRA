# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `60c61870dc24891f82ac6146d703353bb7980960`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (259): .claude/commands/gate7-review.md, HANDOFF.md, PLAN.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round20-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round21-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round22-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round23-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-code-attempt1-aborted.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round24-gate7-docs-attempt1-aborted.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 151,763/151,763 (cap 400,000)
- reviewed-diff sha256 (sent bytes): `c50e06abccae6d2fec536ae7bf00c5575bbf78bdccc53c8edd6f8140d9f3cbf2`
- full scoped-diff sha256 (pre-cap): `c50e06abccae6d2fec536ae7bf00c5575bbf78bdccc53c8edd6f8140d9f3cbf2`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – Independent adversarial review (XHIGH effort)**  
**PR:** `fix(ingest): CU‑03 Gate 9 follow‑up … case‑insensitive origin discovery`  
**Reviewer:** *Gate 7 adversarial reviewer (you)*  

---

## TL;DR – why this change **must NOT be merged**  

| Severity | Area | Issue |
|----------|------|-------|
| **HIGH** | **Security – log leakage** | `_log_ref()` hashes the **full URL** (including user‑info, query string and path) and writes the hash to the warning log. The docstring explicitly promises “never the user‑info … never the path or query”. A truncated SHA‑256 (12 hex chars) is trivially brute‑forced for short credentials or tokens, turning the log into a side‑channel that leaks secrets. |
| **HIGH** | **Security – evidence‑artifact handling** | `drop_evidence_artifacts()` **excludes only files that remain under `…/units/evidence/`**. If an attacker moves a malicious file out of that directory (e.g. `git mv docs/evidence/bad.py src/bad.py`) the function treats the rename as “code” and **keeps the diff**, allowing malicious code to slip past the gate while the original artifact is still listed as “evidence”. This defeats the whole “evidence‑only, never code” policy and enables a supply‑chain hide‑in‑plain‑sight attack. |
| **MEDIUM** | **Functional – over‑eager URL canonicalisation** | `canonical_source_url()` treats any string matching `<scheme>:` (where the scheme satisfies RFC 3986) as a URL, even if there is **no authority component** (`rest` does not start with `//`). Examples like `"foo:bar"` are normal data literals that will be **lower‑cased** and stored as a canonical URL, creating spurious dedup keys and possible duplicate rows for unrelated strings. |
| **MEDIUM** | **Performance – pathological port strings** | `_canonical_port()` strips leading zeros by `digits.lstrip("0") or "0"` on *every* insert/lookup. For a port consisting of **thousands of digits** (the test already pushes 5 000) the operation is O(N) on the string length and allocates a new string each time. In a high‑throughput crawler this can become a measurable latency bottleneck. |
| **LOW** | **Robustness – `parse_rulings` fallback on stray “F1 SUSTAINED”** | The new bare‑ruling regex (`_BARE_RULING_RE`) will still capture a line like `F1 SUSTAINED` that appears **inside a fenced code block** if the fence is malformed and not stripped by `_strip_fences`. While the current `_strip_fences` handles normal fences, an attacker could craft a fence that starts with backticks but never closes, causing the whole remainder of the file to be treated as code and the stray ruling to be ignored – but the reverse (a stray ruling *outside* a fence) would be accepted, potentially allowing an adversary to inject a fake ruling without a proper `## RULINGS` section. The risk is low but worth noting. |

> **Only the two HIGH findings are blockers.** The MEDIUM/LOW items are reported for completeness and future hardening.

---

## Detailed findings & evidence  

### 1. Log‑reference function leaks full URL (HIGH – security)

*File:* `mira-crawler/ingest/store.py` – lines **7‑18**  

```python
def _log_ref(url: str) -> str:
    """A log‑safe reference to a source URL: its host (plus an explicit port)
    and a short hash of the exact URL — enough for an operator to correlate a
    refusal with a row, never the path or query (which can carry a document
    name or a token) and never the userinfo (which can carry credentials —
    ``netloc`` includes it; ``hostname``/``port`` do not)."""
    …
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

*Why this is a violation*  

* The docstring promises **“never the path or query … never the userinfo”**, yet the hash is computed **over the entire raw URL** (`url.encode('utf-8')`).  
* If the URL contains `user:password@host`, a token in the query string, or any other secret, the 12‑character truncated SHA‑256 is effectively a *deterministic* fingerprint. An attacker who can observe the logs (or who controls the log aggregation system) can mount a dictionary/brute‑force attack against short secrets (e.g. API keys, passwords) and recover them.  
* The log line is emitted on every visibility refusal:

```python
logger.warning(
    "Refusing knowledge_entries write for %s — %s",
    _log_ref(source_url),
    prov_reason,
)
```

Thus the secret‑leaking hash is written to the *warning* log for **every refused write** – a high‑frequency side‑channel.

*Evidence in tests* – `tests/test_store_verified.py` and `tests/test_write_path_visibility.py` verify that the warning is emitted, but they never assert that the hash is safe. The test suite therefore **does not catch** the leakage.

*Suggested remediation*  

```python
def _log_ref(url: str) -> str:
    # hash only the *origin* (host[:port]) to avoid secret material
    origin = _origin_from_url(url)          # reuse the parsing from _log_ref
    digest = hashlib.sha256(origin.encode('utf-8')).hexdigest()[:12]
    return f"{origin} sha256:{digest}"
```

or, even safer, drop the hash entirely and keep only the host‑port string.

---

### 2. Evidence‑artifact rename bypass (HIGH – security)

*File:* `tools/gate7_review.py` – functions `is_evidence_artifact()` and `drop_evidence_artifacts()` (lines ~ 115‑162)

```python
def is_evidence_artifact(path: str) -> bool:
    if not path.startswith(_EVIDENCE_DIR):
        return False
    name = path.rsplit("/", 1)[-1].lower()
    if not name.endswith(_DOC_SUFFIXES):
        return False
    return name != "readme.md" and "rebuttal" not in name
```

```python
def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
    …
    for line in diff.splitlines(keepends=True):
        if line.startswith("diff --git "):
            …
            moved_artifact = is_evidence_artifact(source) and target.lower().endswith(_DOC_SUFFIXES)
            keep = not (is_evidence_artifact(target) or moved_artifact)
            if not keep:
                dropped.append(target)
        …
```

*Why this is a violation*  

* The gate’s **architecture contract** (see `docs/architecture/convergence/units/evidence/` and the doctrine) states that *“preserved review artifacts … are never part of the PR’s present‑tense claims”* and that **all** evidence artifacts must be excluded from the review *regardless of where they end up*.  
* The current implementation **excludes only when the *target* path remains under the evidence directory**. If an artifact is **renamed or moved** to a non‑evidence location (e.g. `docs/evidence/bad.py` → `src/bad.py`), `is_evidence_artifact(target)` is `False` and `moved_artifact` is also `False` (because the source is evidence but the target does **not** end with a documentation suffix). Consequently `keep = True` and the diff for the renamed file is **kept**.  
* An attacker could therefore hide malicious code in a file that was originally part of the evidence payload, rename it to a `.py` file, and have it **reviewed as code** while the original artifact remains listed in the receipts as “evidence excluded”. The gate would never see the malicious payload.

*Evidence in tests* – `test_drop_evidence_artifacts` in `tools/gate7_review.py` covers the *pure‑drop* case but **does not test a rename that moves an artifact out of the evidence directory**. Hence the regression is not caught.

*Suggested remediation*  

1. **Treat any rename of an evidence artifact as evidence, regardless of the target suffix**:

```python
def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
    …
    if line.startswith("diff --git "):
        …
        # If the *source* was an evidence artifact, always drop, even if it is renamed.
        keep = not is_evidence_artifact(source)
        if not keep:
            dropped.append(target if target else source)  # report the new name for receipt
```

2. Update the receipts to list both the original and the renamed path, making the exclusion explicit.

3. Add a regression test that renames an evidence file to a `.py` file and asserts that it is dropped.

---

### 3. Over‑eager URL canonicalisation (MEDIUM – functional)

*File:* `mira-crawler/ingest/store.py` – function `canonical_source_url()` (lines ≈ 71‑168)

*Problem*  

`canonical_source_url` treats **any** string matching `<scheme>:` (where `<scheme>` satisfies `[A-Za-z][A-Za-z0-9+.-]*`) as a URL, even when the rest of the string is not a hierarchical URL (no `//`). For example:

```python
canonical_source_url("foo:bar")   # → "foo:bar" (scheme lower‑cased, no escapes)
canonical_source_url("data:application/json")  # → "data:application/json"
```

These are **not** URLs in the sense used for provenance (the system only cares about network resources). Storing them as canonical URLs creates spurious dedup keys and can cause *false positives* for duplicate detection across unrelated data literals.

*Impact*  

* A document that contains the literal `"foo:bar"` in a JSON field will be canonicalised, inserted into `knowledge_entries`, and later `chunk_exists` will treat a later occurrence of `"foo:bar"` as a duplicate, potentially suppressing a legitimate new chunk.  
* Conversely, an attacker could deliberately embed a crafted string that collides with a real URL after lower‑casing the scheme, causing an unintended conflict.

*Evidence* – No existing test checks this edge case; the current test suite only exercises scheme‑lowercasing on proper URLs.

*Suggested remediation*  

Add an explicit check that the URL either:

* has an authority component (`rest.startswith("//")`), **or**  
* belongs to a known whitelist of non‑hierarchical schemes (e.g. `mailto`, `data`) **and** the remainder is a valid scheme‑specific syntax.

If neither condition holds, return the input unchanged (i.e. treat it as a non‑URL).

```python
if not rest.startswith("//"):
    # Only allow a short whitelist of non‑hierarchical schemes
    if head.lower() not in {"mailto", "data", "tel", "urn"}:
        return url   # treat as ordinary string
```

Add tests for `"foo:bar"` and `"data:application/json"` confirming they are left untouched.

---

### 4. Pathological port handling performance (MEDIUM)

*File:* `mira-crawler/ingest/store.py` – `_canonical_port()` (lines ≈ 41‑56)

```python
digits = port[1:]
if default is None or not port or not _ASCII_DIGITS_RE.fullmatch(digits):
    return port
return "" if (digits.lstrip("0") or "0") == str(default) else port
```

*Problem*  

When the port string is extremely long (the test already pushes a 5 000‑digit zero‑padded port), `digits.lstrip("0")` creates a **new 5 000‑character string** and then compares it. This is **O(N)** memory and CPU on each `canonical_source_url` call, and `canonical_source_url` is invoked for *every* chunk and every dedup lookup. In a high‑throughput crawler processing thousands of chunks per second, pathological inputs could cause measurable latency spikes.

*Suggested mitigation*  

* Early‑exit on length check: if `len(digits) > 6` (the longest realistic port length) and the first non‑zero digit is not in `{'0','8','4','4','3'}` (the default), just return the original port – we know it cannot be a default port.  
* Alternatively, use `int(digits)` inside a `try/except` limited to a small number of digits; Python already raises `ValueError` for > 4300 digits, which we can catch and treat as *non‑default*.

```python
if len(digits) > 6:
    return port  # far beyond any realistic port number
try:
    if int(digits) == default:
        return ""
except ValueError:
    return port
```

Add a benchmark test to ensure the function stays sub‑microsecond for normal ports.

---

### 5. Bare‑ruling regex can be fooled by malformed fences (LOW)

*File:* `tools/gate7_review.py` – `_BARE_RULING_RE` (line ~ 108) and `_strip_fences()` (line ~ 212)

*Problem*  

`_strip_fences()` removes lines that start with ``` or ~~~ and toggles an “inside fence” flag. If a fence is **opened but never closed** (e.g. a user writes “```” without a matching closing fence), the flag stays *inside* for the remainder of the file, causing any later `F1 SUSTAINED` line to be stripped and ignored. An adversary could therefore place a fake ruling *outside* any proper `## RULINGS` section and hide it from the parser, effectively making the adjudication **UNKNOWN** while the model believes it has a valid ruling.

*Impact* – Very low probability but a potential denial‑of‑service for the gate.

*Suggested mitigation*  

* After processing the whole file, verify that `inside` is `None`. If a fence was left open, raise a structural error that bubbles up to `validate_adjudication_shape` (treated as UNKNOWN).  
* Extend the regex to also match fences that use backticks with language specifiers and enforce that a closing fence must appear.

---

## Overall recommendation  

**Reject the PR** until the two HIGH‑severity security defects are fully remedied:

1. **Fix `_log_ref`** to hash only the origin (host + port) **or remove the hash entirely**; never include user‑info, path or query in the digest. Update the docstring to reflect the new behaviour and add unit tests confirming that a URL containing credentials does **not** affect the hash.

2. **Hard‑enforce exclusion of evidence artifacts** regardless of rename target. Treat any file whose *source* path lies under `docs/architecture/convergence/units/evidence/` as evidence and drop it from the diff, even if the rename moves it elsewhere. Update receipts to list the *new* path for auditability. Add regression tests covering:
   * Simple rename out of evidence (artifact → `.py`), expecting the diff to be omitted.
   * Rename within evidence (artifact → different evidence file), still omitted.

After these changes, re‑run the full test suite (including the new regression tests) and verify that the gate’s structural validators (`validate_review_shape`, `validate_adjudication_shape`) still pass.

---

### Additional notes for the development team

* The **log‑hash** issue is a classic “leak‑through via deterministic hash”. Even a truncated hash can be reversed for short secrets; consider using a **salted HMAC** with a secret key that is never logged, or drop the hash entirely.
* The **evidence‑artifact rename** bug demonstrates a subtle coupling between the diff‑parsing logic and the policy that evidence must stay out of the review surface. Future changes should treat the *origin* of a diff hunk (the `a/…` path) as the authoritative classification, not the *destination*.
* The **over‑eager URL detection** could be tightened by adding a whitelist for non‑hierarchical schemes, or by requiring the presence of `//` for any scheme that isn’t explicitly allowed. This prevents accidental canonicalisation of arbitrary “key:value” strings.
* The **port‑length performance** edge case is unlikely in production, but the current implementation unnecessarily allocates huge intermediate strings. The suggested early‑exit or bounded‑int conversion will keep the function O(1) for realistic inputs.

---

**Final verdict:** **BLOCK** – the PR introduces high‑severity security regressions that directly conflict with the Gate 7 security doctrine. The PR must be revised to address the findings above before any further consideration.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
