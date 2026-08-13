# T2108 golden fixture — eufy RoboVac 11S owner's manual

The primary canary for the Agent-Readable Product Knowledge PRD
(`docs/plans/2026-08-10-prd-agent-readable-product-knowledge-t2108.md`): a
vendor the industrial alias table has never seen, proving the upload → chunk →
doc-scoped chat path is vendor-neutral.

## Identity / provenance

| field | value |
|---|---|
| Product | eufy RoboVac 11S |
| Model / product number | T2108 |
| Document | Owner's Manual, doc id 51005000959, revision V02 (2018-05-25) |
| Publisher | Anker Innovations Limited (official eufy CDN) |
| Source (authority class: manufacturer CDN) | https://d2211byn0pk9fi.cloudfront.net/spree/accessories/attachments/72623/T2108_Manual_51005000959_20180525_148x210mm_V02_EN.pdf?1533028783= |
| SHA-256 | `b2e7912ed063dd118eb8db05060c2c30f18865e60ea0b33d609cf6cf473b506e` |
| Pages (PDF) | 16 (page 16 blank; printed spreads carry two page labels per PDF page) |
| First verified retrieval | 2026-08-10 |

**Mirror equality (PRD acceptance gate C evidence):** the manuals.plus mirror is
content-addressed at `https://manuals.plus/m/<sha256>` and its slug equals the
hash above — the official file and the mirror are byte-identical, so the
`content_sha256` dedup (migration 072) collapses them by construction.

## The PDF is NOT committed

Repo policy keeps binary corpora out of git (same as the print-eval corpus).
Fetch it locally:

```bash
py tests/beta/fixtures/t2108/fetch.py
```

The script downloads from the official CDN URL above, verifies the SHA-256, and
writes `T2108_Manual_EN.pdf` next to itself (gitignored). A hash mismatch is a
hard failure — it would mean eufy revised the document (record the new revision
as a NEW fixture; never silently overwrite this one's identity).

## What consumes it

- `mira-hub/src/lib/__tests__/t2108-doc-chat.integration.test.ts` — the real
  ingest → doc-scoped-retrieval benchmark (golden questions grounded in the
  manual's actual text: identity, input power, battery, runtimes, rolling-brush
  cleaning, troubleshooting). Requires `TEST_DATABASE_URL` (disposable Postgres
  with pgvector) + `T2108_PDF_PATH` pointing at the fetched file.
