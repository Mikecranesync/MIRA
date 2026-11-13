# Candidate-admission context invariants

First local, keyless implementation slice of [regression protection proposal #5470](https://github.com/Mikecranesync/MIRA/pull/5470).

`mira-hub/src/capabilities/__tests__/retrieval-context-invariants.test.ts` calls the production `retrieveNodeChunks` function with scripted SQL candidates, matching the existing capability tests. Three public development facts each run in five contexts: baseline, neutral filename, unrelated document added, document order reversed, and a wrong-model request. Every case forbids `fetch` calls.

Positive cases require the original evidence text, CT/VT and units where applicable, document ID, citation title, source page, page label, source URL and table-model attribution to survive. Wrong-model controls require refusal before a knowledge search and the expected sibling diagnostic. These are candidate-admission and provenance tests. They do not measure SQL recall, PDF extraction, numeric answer generation, live retrieval, device behavior or technician acceptance. The private benchmark and Python replay store remain untouched.

## Public fact anchors

The fixture sentences and short requests are development paraphrases, not private benchmark questions or copied answer keys.

| Fact | Public primary source | Anchor |
| --- | --- | --- |
| Input current | [GS10 user manual](https://cdn.automationdirect.com/static/manuals/gs10m/gs10usermanual.pdf), 1st Ed., Rev C | PDF page 26, printed 1–12, GS11N-20P2 column; CT and VT rows |
| Input supply | Same GS10 manual | Same page, rated voltage/frequency row |
| Controller supply | [Micro820 installation instructions](https://literature.rockwellautomation.com/idc/groups/literature/documents/in/2080-in009_-en-p.pdf), 2080-IN009B-EN-P, April 2014 | PDF/printed page 16, general specifications, power-supply row |

The GS10 page was independently rendered and inspected. Rockwell's primary PDF text was checked separately; the local download was blocked, so no local hash or rendered-page verification is claimed for it. Synthetic source URLs and page labels in the fixtures test metadata preservation; they are not live citations.

## Execution proof

The existing Hub Unit Tests job runs these cases with the full suite, then runs a focused JSON report and `scripts/check-context-invariants.mjs`. The verifier requires the expected file and all 15 distinct case IDs to have passed. Missing, zero, duplicated, unknown, failed, skipped, todo and inconsistent results fail. Its native Node tests run in the same CI step. `tests/test_hub_unit_filter_contract.py` requires the proof step to remain wired and non-optional.

From `mira-hub/`:

```sh
node --test scripts/check-context-invariants.test.mjs
bun run test src/capabilities/__tests__/retrieval-context-invariants.test.ts --reporter=json --outputFile=/tmp/context-invariants.json
node scripts/check-context-invariants.mjs /tmp/context-invariants.json
```

Author verification on base `91452e28fbe9adab88c627fede9d7bebef63d871`, November 13, 2026:

| Probe | Passed / failed | Required failures observed |
| --- | --- | --- |
| Pre-#5471 applicability implementation | 14 / 1 | Controller supply with publication-number filename |
| Sibling early-refusal guard disabled | 12 / 3 | All wrong-model controls |
| Candidate admission bypassed | 9 / 6 | All unrelated-document and document-order cases |
| Returned table-model provenance removed | 3 / 12 | All positive cases |
| Returned citation title replaced by a placeholder (review fix) | 3 / 12 | All positive cases |
| Original production files restored byte-for-byte | 15 / 0 | None |
| Report verifier before implementation | 1 / 20 | Missing, skipped and invalid reports accepted by the initial stub |
| Report verifier after implementation | 21 / 0 | None |
| CI contract before/after wiring | 5 / 1 → 6 / 0 | Missing proof step, then restored |

All 15 named cases failed a relevant semantic mutation, with no collection failures counted as proof. The full Hub run passed 15,858 tests with 53 skips and zero failures; all 15 new cases executed. Focused ESLint and workflow `actionlint` passed. TypeScript has 134 existing diagnostics: candidate and unchanged-base output were byte-identical, with no diagnostic in the new test. These are local author receipts, separate from hosted CI, independent review and deployment acceptance.
