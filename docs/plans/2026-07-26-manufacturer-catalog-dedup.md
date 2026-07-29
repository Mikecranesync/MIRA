# Manufacturer catalog de-duplication — design & execution plan

**Issues:** #2263 (design), #1596 (bug) · **Date:** 2026-07-26 · **Node:** Bravo
**Status:** DESIGN (this doc is the #2263 "document the chosen approach before any code changes" deliverable)
**Owner label:** `rag`, `P2`

---

## 1. Why this exists

The Hub Knowledge catalog (`GROUP BY knowledge_entries.manufacturer`) is fragmented: one
real OEM appears under several catalog rows, and ~30% of chunks carry no manufacturer at
all. Fragmentation hurts retrieval grouping and inflates the vendor count shown to users.

This plan is the *remaining* work after #1713 / #1719 / #2083 already shipped the
ingest-side normalizer, the query-side canonical, and the brand-vs-parent decision. It is
**not** a from-scratch design — it closes the three gaps those PRs explicitly left open.

## 2. Verified current state (do not re-derive)

Already shipped and live (merged #1713 / #1719 / #2083):

- `mira-crawler/ingest/manufacturer_normalize.py` — `OCR_VARIANT_ALIASES` (8 curated keys) +
  `propose_fuzzy_canonical` (high-threshold proposer, logs only, never merges).
- Wired at every ingest write boundary that sets `knowledge_entries.manufacturer`:
  `store.insert_chunk` (store.py:86), `kg_writer` (kg_writer.py:311/389), and the mira-core
  photo/RAG API (`mira-core/mira-ingest/db/neon.py:367/437`). The hub upload route normalizes too.
- `mira-bots/shared/uns_resolver.py::canonical_vendor()` — single source of truth for
  "are these two manufacturer strings the same OEM?" (comparison only; does **not** rewrite the
  stored catalog). Used by the retrieval cross-vendor filter + citation gate.
- Brand-vs-parent decision **RESOLVED: Rockwell Automation** (parent). Allen-Bradley → Rockwell
  Automation on both catalog and resolver. Locked by `tests/test_manufacturer_alias_consistency.py`
  (byte-identical vendored copies + agreement with `VENDOR_ALIASES` on shared keys).
- `tools/reconcile_manufacturers.py` — DRY-RUN planner. `--from-db` is read-only
  (`SELECT DISTINCT manufacturer`), default-deny allowlisted to the staging endpoint. **No apply path.**

### Ground truth — staging Neon, 2026-07-26 (read-only via the planner + a SELECT)

`ep-polished-hall-ahcqtcxe` (staging). Counts are **indicative** — prod's catalog is the real
apply target (prod QA reported ~83K/24K/304); staging shapes match, magnitudes differ.

- **84,072** total chunks; **24,800 (29.5%)** have NULL/blank manufacturer ("Uncategorized").
- **325** distinct manufacturer strings. The planner collapses only **10** (the seeded OCR keys)
  + 1 fuzzy proposal (`ANDO RIGGING` → `Orlando Rigging`, 0.889). **314 pass through unchanged.**

The unchanged 314 is where the real fragmentation hides — same OEM, different string:

| Same OEM, split rows (staging chunk counts) | Cause |
|---|---|
| `Siemens` 1948 **vs** `siemens` 514 | pure **casing** — 514 chunks stranded |
| `Rockwell Automation` 34186 **vs** `Rockwell` 18 **vs** `Allen-Bradley` 2706 | known-vendor spelling; `Rockwell`/`Allen-Bradley` are legacy rows |
| `AutomationDirect` 4298 **vs** `Automation Direct` 8 | spacing variant |
| `Yaskawa` 9340 **vs** `Yaskawa Electric Corporation` 27 | long-form vs short |
| `Coffing` 11 **vs** `COFFING` 7 **vs** `Coffing Hoists` 5 | casing + suffix |
| `Harrington` 43 **vs** `HARRINGTON` 6 | casing |

## 3. The three verified gaps

**Gap A — ingest normalizer does not bridge to `canonical_vendor()`.**
At ingest, only `normalize_manufacturer()` fires, and it consults **only** the 8-key
`OCR_VARIANT_ALIASES` (traced: store.py:86, kg_writer.py:311/389, neon.py:367/437). It never
consults the resolver's `VENDOR_ALIASES`. So a *new* ingest of `"Rockwell"`, `"siemens"`,
`"Automation Direct"`, or `"Yaskawa Electric Corporation"` is stored verbatim and mints its own
catalog row — even though `canonical_vendor()` already knows the canonical. The module docstring
says "known vendors use the resolver's canonical," but the code only does that for the 8 OCR keys.
**This is the biggest source of live fragmentation (e.g. the 514 stranded `siemens` chunks).**

**Gap B — existing catalog is never cleaned.** The normalizer only fixes *new* ingests. The
34,186 / 2,706 / 18 Rockwell split and every legacy variant row persist until a **gated backfill**
runs. `reconcile_manufacturers.py` plans it but has no apply path.

**Gap C — 24,800 (29.5%) uncategorized chunks** have no manufacturer at all. No amount of alias
merging helps them; they need a classifier pass over title/content, backfilled as a one-shot.

## 4. Chosen approach — three slices, gates explicit

### Slice B1 — bridge the ingest normalizer to the known-vendor canonical (autonomous; code + test)

Extend `normalize_manufacturer()` so that, after the `OCR_VARIANT_ALIASES` miss, it consults the
resolver's **exact-key** `VENDOR_ALIASES` before falling through to identity:

- Use **exact case-insensitive key match** (`_norm_key(raw) in VENDOR_ALIASES`), **NOT**
  `canonical_vendor()`'s substring fallback. Substring match at a *write* boundary is unsafe — it
  would over-collapse a long-tail vendor whose name merely *contains* `"ab"`/`"delta"`/`"sew"`.
  Exact-key only collapses strings that are unambiguously the known vendor.
- This closes Gap A for `siemens`→`Siemens`, `rockwell`→`Rockwell Automation`,
  `automation direct`→`AutomationDirect`, `yaskawa electric corporation`→… (add the long-form key).
- Keeps the divergence-safety invariant: unknown long-tail vendors still pass through to
  `uns.slug()` unchanged on both ingest and query sides.
- **Consistency test** already asserts crawler/mira-core Python + hub JSON agree with
  `VENDOR_ALIASES`; extend it so the bridge cannot drift. Run
  `tests/test_manufacturer_alias_consistency.py` + the crawler unit tests locally (python3.12).
- Enrich `OCR_VARIANT_ALIASES` with any newly-observed true OCR artifacts staging surfaced that
  are NOT known vendors (e.g. review `ANDO RIGGING`; `Magnetek` had no variant in staging — do not
  invent one).

### Slice B2 — build the catalog backfill apply (autonomous to build; **APPLY IS GATED**)

Turn the dry-run plan into a reviewed, idempotent apply migration:

- Reuse `reconcile_manufacturers.py` to emit the plan (alias = safe; fuzzy = NEEDS REVIEW).
- Apply path is a **gated dev → staging → prod** data pass via `apply-migrations.yml`
  (`dry-run` then `apply`), following the `tools/uns_backfill.py` pattern. Only the
  deterministic `alias` + human-reviewed `fuzzy` rows are written; `unchanged` untouched.
- Update `knowledge_entries.manufacturer` (the catalog GROUP BY column) **and** the matching
  `kg_entities` manufacturer nodes so the KG tree and catalog stay consistent. Merge, not
  duplicate: point variant chunks at the canonical, retire the emptied variant node.
- **Preserve the read filter** `(is_private=false OR tenant_id=$caller)` — the backfill runs on
  the raw owner pool, touches only the denormalized column + KG nodes, never widens visibility.
- Fuzzy proposals stay `needs_review`; **no auto-promote to `verified`** (KG law + issue constraint).
- **I cannot apply this autonomously** (prod psql is blocked; staging apply needs the gated
  workflow). Deliverable = the reviewed script + a staging dry-run report; the operator runs the
  gated apply.

### Slice C — uncategorized classifier (autonomous to build; **APPLY IS GATED**)

For the 24,800 blank-manufacturer chunks:

- A **regex/title-first** classifier (cheap, deterministic) over the source filename + chunk title,
  reusing `canonical_vendor()` for the label. LLM fallback only for the residue, batched, with a
  `confidence` field (mandatory per ingest rules) and a `needs_review` gate for low confidence.
- Emit a dry-run report; the assignment backfill is the same gated dev→staging→prod pass as B2.
- **Never** best-guess a manufacturer into a `verified` state — low-confidence stays proposed.

## 5. Constraints honored (checklist for the implementer)

- [ ] `.claude/rules/uns-compliance.md` — path/slug builders in `mira-crawler/ingest/uns.py` only.
- [ ] `.claude/rules/knowledge-entries-tenant-scoping.md` — hybrid read filter intact; backfill on raw pool.
- [ ] No auto-promotion `proposed → verified` (KG law).
- [ ] `test_manufacturer_alias_consistency.py` green (byte-identical vendored copies).
- [ ] Migrations dev → staging → prod via `apply-migrations.yml`, never hand-edited prod schema.
- [ ] python3.12 for Python tests; `tests/` and `mira-bots/tests/` in separate pytest runs.

## 6. Recommended sequencing

1. **Slice B1 first** — smallest, fully autonomous, closes the largest *live* fragmentation source
   (the 514 stranded `siemens` chunks and every future known-vendor casing variant). Ships as a
   normal PR with the consistency test extended.
2. **Slice B2** — build + staging dry-run; hand the gated apply to the operator.
3. **Slice C** — largest; build the classifier + dry-run; gated apply.

## 7. What this plan deliberately does NOT do

- Does not change `canonical_vendor()`'s substring semantics (comparison-side is correct as-is).
- Does not merge two genuinely distinct vendors — fuzzy stays review-gated.
- Does not apply anything to prod from a code session.
