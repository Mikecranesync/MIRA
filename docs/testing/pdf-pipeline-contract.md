# Real PDF → SQL → citation contract

Implements the fast, keyless slice of [#5497](https://github.com/Mikecranesync/MIRA/issues/5497), extending the existing `t2108-doc-chat.integration.test.ts` rather than creating a second harness. The eight cases use generated PDF bytes, the real unpdf/pdf.js parser, production chunk writer and production SQL retrieval against a disposable local PostgreSQL connection.

The connection adapter supplies one real client to the writer and retriever. An observer forwards actual queries/results and records rejected SQL even when production catches the error and falls back; the contract also rejects production degradation warnings. A session-local TEMP table and the canonical writer's partial dedup-index expression isolate the rows. SQL and candidate results are not mocked. This does not certify production RLS, the complete migration lineage, HTTP upload/storage recovery, generated answers, manufacturer-manual accuracy or a browser/device journey.

## Eight required cases

| Case ID | Protection |
| --- | --- |
| `baseline` | Real PDF bytes become private v2 rows and retrievable evidence |
| `rename` | Identical bytes retain their fact/page and the renamed citation title |
| `unrelated` | A retrievable competing manual cannot replace the selected model's fact |
| `order` | Reversing selected documents preserves the evidence/citation tuple |
| `wrong-model` | An explicit sibling request refuses the confirmed record |
| `foreign-tenant` | The actual SQL excludes another tenant's private document |
| `page-anchor` | PDF page3 is returned instead of stored chunk ordinal2; no printed label is invented |
| `blank` | A real blank PDF raises `NoExtractableTextError` and inserts no rows |

The manuals describe fictional BX410/BX420 equipment. Each generated PDF is under64KiB. The suite logs byte lengths and SHA-256 identities; buffers are reused, with copies passed to the parser. No manufacturer PDF or private benchmark key is committed.

## Local execution

Use only a confirmed disposable loopback PostgreSQL database. Unconfigured generic integration runs skip the group and report NOT RUN. Required CI demands explicit disposable configuration before running and then rejects any skipped required case. Configured invalid/nonlocal URLs, query/fragment overrides and production/staging database names are rejected before connection. The baseline also checks the unconfigured developer-run behavior in a bounded child process and directly exercises unsafe-URL canaries without connecting to them. It pins embedding off before module import, disables hybrid/rerank/lexical-v2 lanes, and blocks/asserts all fetch calls.

From `mira-hub/`, with `TEST_DATABASE_URL` and `MIRA_TEST_DB_CONFIRM=DISPOSABLE` already set:

```sh
bun run test --config vitest.integration.config.ts src/lib/__tests__/t2108-doc-chat.integration.test.ts -t 'PDF pipeline contract' --reporter=default --reporter=json --outputFile=/tmp/pdf-pipeline.json
```

The original T2108 manufacturer audit remains opt-in, requires its verified fixture and pgvector, and is reported separately. The focused contract runs8 cases; its11 legacy audit cases are NOT RUN. Historical `it.fails` markers are not evidence of successful retrieval.

## Execution enforcement

The existing `turn-lifecycle-reconciliation` job runs a separate focused step on PostgreSQL16. It consumes the actual JSON report and requires all8 distinct `[pipeline:...]` IDs passed in the expected file. Missing, empty, duplicated, unknown, skipped, failed or inconsistent execution fails. Filtered legacy cases cannot count toward the8 passes. Both existing `CI Gate` connections remain enforced: the job is in `needs`, and its result must satisfy `require_success`.

The existing workflow-contract test file executes the actual inline validator on valid and malformed reports. It also pins source watches, selection flags, gate dependency and result binding. Library/capability source trees are watched to include transitive parser/admission dependencies; package, lock, config, workflow and guard-test changes also trigger this job.

## Author proof

Local PostgreSQL was18.6; the intended hosted version is16. Record hosted16 proof independently. The isolated branch incorporated main bf09dc86d after the static implementation review; required review remains exact-head governance work.

| Deliberate regression | Required-case passed / failed |
| --- | --- |
| Citation title replaced with placeholder | 1 / 7 |
| Source page replaced with chunk ordinal | 1 / 7 |
| Sibling early refusal disabled | 7 / 1 |
| Tenant predicates bypassed in real retrieval SQL | 7 / 1 |
| Blank-document rejection disabled | 7 / 1 |
| Production files restored byte-for-byte | 8 / 0 |

Every required case failed a meaningful semantic mutation. Required CI with missing database configuration fails closed; optional unconfigured developer collection skips. A caught question-IDF SQL error still passed all8 cases with the error fences removed, but failed7/8 when the fences were enabled; restoration passed8/8. Unsafe-URL and unconfigured-run regression assertions were also observed RED before their fixes. No collection error was counted as semantic RED.

The missing CI step first failed its wiring test. A permissive report-validator stub caused16 negative-control failures; the implemented guard passes all26 workflow-contract tests. Removing the CI Gate dependency/result binding, changing the test-selection flag or removing source watches each fails its relevant test; an always-rejecting guard fails both positive controls. The exact workflow step also passes locally on the real database. An all-skipped report was rejected, and its negative-control test was shown RED against a permissive guard.

Surrounding Hub unit suite after synchronization with main bf09dc86d:16,082 passed,53 existing skips,0 failed (separate from the8 integration cases). Final TypeScript output has the same134 diagnostics as main bf09dc86d, byte-for-byte; focused lint/actionlint passed. This is author evidence, not a governed R3 review or release attestation.
