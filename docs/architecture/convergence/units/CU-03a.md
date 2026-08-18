# Convergence Unit — CU-03a: canonical provenance policy (CU-03 Gate 6)

**Status:** 🚧 **CLAIMED — in progress** · **Blocks:** #3268 (CU-03) Gate 9
**Owner/session:** `01UKYdhFE6hvQYAAJ9iVPfPM` · **Base:** `origin/cu-03-knowledge-entries-write-path`
**Topology: STACKED — and the dependency is measured, not assumed.**

## Why stacked rather than main-targeted

The curation gate this unit replaces the manifest for exists **only on #3268's branch**:

| Symbol | on `origin/main` | on `cu-03-…` |
|---|---|---|
| `shared_corpus_source_allowed` | ✗ | ✓ |
| `_curated_hosts` | ✗ | ✓ |
| `_validated_local_path` | ✗ | ✓ |
| `ingest/provenance.py` | ✗ | ✓ |

There is nothing on `main` for this unit to modify. (Contrast Gate 7 / CU-03b, whose only
main↔branch delta in the files it touches is the `is_private=` kwarg — so that one *is*
main-targeted and merges first: **#3296**.)

## The problem

The gate authorizes shared-corpus writes from `sources.yaml`'s **18 curated hosts**, while four
feeders independently maintain their own origin lists. Measured drift:

| Feeder | Origins | Absent from the gate |
|---|---|---|
| `tasks/discover.py` `MANUFACTURER_TARGETS` | 9 | **7** |
| `tasks/rss.py` `RSS_FEEDS` | 10 | **10** |
| `tasks/sitemaps.py` `_SITEMAPS` | 7 | measured per-run |
| `tasks/foundational.py` `DIRECT_TARGETS` | 6 | measured per-run |

Every one of those is a source the crawler is configured to fetch and the gate is configured to
refuse. Shipping that means the gate either blocks most real traffic or the lists drift apart
silently — and "fix it by widening the gate" is the failure mode this unit exists to prevent.

## Required outcome

1. **One canonical, auditable provenance policy** consumed by **both** the feeders and the gate.
   No second host list anywhere.
2. **Every configured feeder origin carries an explicit classification:**
   - `curated` — may enter the shared corpus
   - `private` — ingested, but tenant-scoped
   - `blocked` — refused, with a written reason
3. **A consistency test that enumerates every configured feeder origin from its real structure**
   (not a regex) and fails when any origin lacks a classification. New feeder, new origin, or a
   removed policy entry all fail closed.

## Explicitly out of bounds

- ❌ Weakening or bypassing the gate to make existing manifests pass. An origin that should not be
  shared gets classified `private` or `blocked` **with a reason**, not quietly admitted.
- ❌ A second manifest. If `sources.yaml` stays, it becomes a *view* of the canonical policy, not a
  parallel truth.

## Progress

- [x] Dependency analysis; claim posted
- [ ] Canonical policy + classifier
- [ ] Classify all configured origins
- [ ] Consistency test
- [ ] Gate 7 adversarial review
