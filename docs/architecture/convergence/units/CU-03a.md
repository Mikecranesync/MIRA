# Convergence Unit — CU-03a: canonical provenance policy (CU-03 Gate 6)

**Status:** ✅ **DONE** — PR **#3297** merged as `969909ce6` **into the CU-03 branch**, and
reached `main` inside the CU-03 merge `dde2efcfc` → **v3.277.5**. **Blocks nothing.**
**Owner/session:** `01UKYdhFE6hvQYAAJ9iVPfPM` · **Base:** `origin/cu-03-knowledge-entries-write-path`
**Topology: STACKED — and the dependency is measured, not assumed.** The stacked topology is
also why this unit has **no release of its own** — see §R1 for the exact ref proof.

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

> ⚠️ Outcome 1 shipped **narrower than written**: the policy is the single authority for
> *classification*, not for *acquisition*. The claim was corrected, not quietly softened —
> see §Scope correction after Codex adversarial review (F1).

## Explicitly out of bounds

- ❌ Weakening or bypassing the gate to make existing manifests pass. An origin that should not be
  shared gets classified `private` or `blocked` **with a reason**, not quietly admitted.
- ❌ A second manifest. If `sources.yaml` stays, it becomes a *view* of the canonical policy, not a
  parallel truth.

## Progress — all delivered (evidence per line, verified on `origin/main`)

- [x] Dependency analysis; claim posted
- [x] **Canonical policy + classifier** — `mira-crawler/provenance_policy.yaml` (the one manifest)
      read by `mira-crawler/ingest/provenance.py`; `tasks/ingest.py::shared_corpus_source_allowed`
      consults it and nothing else, and the duplicate `sources.yaml` host loader is deleted.
- [x] **Classify all configured origins** — **49 origins, 49 classified**: 29 `curated` /
      12 `private` / 6 `infrastructure` / 2 `blocked`. **0 remain `PENDING-HUMAN`** — the 20
      that were pending are resolved by @Mikecranesync's 2026-08-18 decision (11 OEM portals
      promoted `curated`, 9 trade-press feeds demoted `private`), recorded per-origin in
      `confirmed_by`.
- [x] **Consistency test** — `mira-crawler/tests/test_provenance_policy.py`
      (`test_every_configured_origin_is_classified`, `test_no_entry_is_left_unreviewed`,
      `test_policy_is_the_only_host_list`, `test_a_malformed_policy_fails_loud_not_open`).
      It re-derives origins from the real module constants (`ingest/origins.py`), not a regex,
      and it **runs in CI** — `.github/workflows/ci.yml:439`.
- [x] **Gate 7 adversarial review** — see §Gate 7 record below. Two MEDIUM findings, both real,
      both fixed; the corrected code then carried the CU-03 GREEN at `fc00074c6`.


## Scope correction after Codex adversarial review (F1)

The reviewer challenged the claim that this unit makes one policy answer for "both the feeders and
the gate". That was **stronger than what shipped**, and the correction is recorded rather than the
claim quietly softened:

**What the policy now governs — classification.** May an origin reach the shared corpus, be
ingested tenant-scoped, or not at all. `tasks/ingest.py` consults the policy and nothing else; the
duplicate `sources.yaml` host loader that lived alongside it is **deleted**, so the ingest gate has
exactly one truth. That was a real second source and it is gone.

**What it does not govern — acquisition.** `RSS_FEEDS`, `SITEMAP_URLS`, `MANUFACTURER_TARGETS`,
`DIRECT_TARGETS` and `APIFY_TARGETS` still author their own URL lists, and
`crawler/manufacturer.py` + `crawler/curriculum.py` still read `sources.yaml` to decide what to
crawl. Adding a curated entry to the policy does **not** make a crawler discover it. The
consistency test proves the two agree; it does not make one derive from the other.

Making feeders derive their targets from the policy is a larger change than this unit claimed, and
it would alter what the crawler fetches — a behaviour change well beyond a classification gate.
It is recorded here as the remaining half rather than absorbed silently.

## Gate 7 record — adversarial review

The Codex Gate 7 lane reviewed this unit **before it was armed**, as a `--dry-run` against #3297:
**0 BLOCKER / 0 HIGH / 2 MEDIUM**, and both findings were real and were fixed in-branch:

- **F2 — private origins were refused mid-redirect-chain.** The redirect loop still called
  `shared_corpus_source_allowed`, which permits only `curated`, so a `private` origin accepted at
  hop zero was refused on the first hop. The nine trade-press feeds demoted an hour earlier would
  have silently stopped ingesting on any redirect. Visibility is now a **floor across the whole
  chain** — locked by `TestPrivateRedirectChains` in `tests/test_provenance_policy.py`.
- **F1 — the unit had overclaimed** (classification vs acquisition). Recorded above rather than
  softened.

The corrected code was then carried into the CU-03 head **`fc00074c6`** — `969909ce6` is an
ancestor of `fc00074c6` — which the same lane reviewed **GREEN: 0 BLOCKER / 0 HIGH / 0 MEDIUM /
0 LOW, 2 FALSE_POSITIVE** (`#issuecomment-5328661874`). CU-03a therefore has **no separate Gate 7
verdict of its own on a merged head**; its review evidence is the dry-run above plus its inclusion
in the reviewed CU-03 head. State it that way rather than claiming an independent GREEN.

## R1 — post-merge record ✅

**This unit has no standalone release. It reached `main` inside the CU-03 merge.** Recorded
precisely, because the stacked topology is exactly the thing a reader will get wrong:

| Field | Value |
|---|---|
| PR | **#3297** — head `convergence/cu-03a-canonical-provenance`, base **`cu-03-knowledge-entries-write-path`** (NOT `main`) |
| Merge commit | **`969909ce664652a74a5b42d240011b311721e2ec`** — a two-parent merge **into the CU-03 branch**, 2026-08-18T12:10:04Z |
| Parents | `86336da355e272b8604bd7bc0e6fe4593da24dc1` (CU-03 branch) · `482f0f35d04a906172a9dc54d1b86d05a46d8713` (this unit) |
| Path to `main` | via the CU-03 merge **`dde2efcfc8044186fbb20882cc142326c1bb615f`** (PR #3268) |
| Release tag | **none of its own.** No tag points at `969909ce6`; the *earliest* version tag containing it is **`v3.277.5`**, which resolves to the CU-03 merge SHA, not to this commit |
| Rollback checkpoint | **none of its own** — reverting this unit means reverting CU-03: `git revert -m 1 dde2efcfc` |
| Gate 7 | dry-run 0/0/2 MEDIUM (both fixed); GREEN inherited at `fc00074c6` — see §Gate 7 record |
| Gate 9 (human GO) | **CU-03's GO covers it** — @Mikecranesync's merge of #3268, 2026-08-18. There was no separate GO for #3297 |

```
$ git tag --points-at 969909ce6
(none)
$ git rev-list -n1 v3.277.5
dde2efcfc8044186fbb20882cc142326c1bb615f
$ git merge-base --is-ancestor 969909ce6 origin/main && echo ancestor
ancestor
```

**Blocks nothing.** The `Blocks: #3268 (CU-03) Gate 9` line this record opened with was true while
the unit was in flight; #3268 merged on 2026-08-18 and this file simply was not updated. That
stale claim is corrected here — it is not evidence of a live dependency.
