# Convergence Unit — CU-P1 (PILOT): one asset-tag grammar for Hub + Mobile

**Contract ID:** TAG-001 · **Status:** implemented, awaiting Gate 7 review + Gate 9 promotion
**Doctrine:** `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md` — this is the §15 pilot.

## Current behavior (pre-change)
Hub enforced ONE grammar (`mira-hub/src/lib/asset-tag.ts` `ASSET_TAG_REGEX = /^[A-Za-z0-9_-]{1,64}$/`, resolution in `scan-target.ts`). Mobile re-implemented extraction by hand (`mira-mobile/src/lib/tags.ts`) and drifted four ways: dots accepted (traversal-defense bypassed at the client), 1-char tags rejected, no percent-decoding, URL query/fragment forms rejected. Its comment claimed "Hub semantics"; nothing verified that.

## Target architecture
`docs/contracts/asset-tag-grammar.json` is THE grammar (32 executable cases). Both surfaces run it in their unit suites; mobile additionally shadow-executes the *real* Hub resolver side-by-side over the corpus + 5,000 seeded fuzz inputs. Exactly two sanctioned mobile-only behaviors, named in the contract: the deep-link trust filter, and the `factorylm://` scheme (mobile-authoritative — Node's parse of it is a parser accident, discovered when the corpus was probed under Bun vs Node and locked as Node-canonical).

## Why this change exists
Gate 0 drift finding D-5: a QR/tag that parses on mobile could 404 on Hub (and vice versa) on the product spine (QR → asset). Chosen as pilot per §15: real, bounded, no auth/tenancy/DB/Supervisor.

## Canonical implementation
Hub `asset-tag.ts` + `scan-target.ts` (unchanged this unit — zero Hub production-code edits).

## Old implementation
Mobile's hand-rolled regex — replaced in place (`mira-mobile/src/lib/tags.ts`), same exported signature, consumers untouched (`App.tsx`, `AssetsTab.tsx`).

## Affected modules
`mira-mobile/src/lib/tags.ts` (impl) · `docs/contracts/asset-tag-grammar.json` (new contract) · test files both sides · `.github/workflows/ci.yml` (mobile suite wired into CI — it ran NOWHERE before; + cross-watch filters both directions).

## Contracts/invariants
Every corpus case agrees across surfaces except the two named sanctioned divergences; every extracted tag satisfies the canonical regex; corpus `canonical_regex` is pinned to the shipped `ASSET_TAG_REGEX` by test.

## Risk classification
Low (client-side parsing, no schema/auth/tenancy). Gate 7 default effort (High), no xhigh trigger.

## Behavior-lock tests (Gate 3, red-first)
- Hub: `asset-tag-grammar-contract.test.ts` — green on unchanged Hub (34/34), proving the corpus locks observed behavior.
- Mobile: `tag-grammar-contract.test.ts` + `tag-grammar-shadow.test.ts` — **12 failures on the pre-fix implementation** (the drift, caught), 0 after.

## R0 SHA/checkpoint
`3ba7f4e5420e7a48b09350d09f9990eff79ff907` (main, clean tree). Baselines: hub tag tests 14/14, mobile suite 28/28. No schema/data state involved. **Recovery:** abandon branch `fix/cu-p1-asset-tag-grammar`; R0 restores fully.

## Implementation plan (executed)
Corpus probed against the live Hub resolver (zero-mismatch before adoption) → red tests → minimal `tags.ts` rewrite mirroring `scan-target.ts` + explicit `factorylm://` prefix branch → CI wiring.

## Shadow-validation plan (Gate 8, executed + permanent)
`tag-grammar-shadow.test.ts` imports the real Hub resolver (no copy) and diffs structured results over corpus + 5,000 deterministic fuzz inputs (seeded LCG — reproducible forever). Runs on every mobile/hub-grammar/corpus change via the CI filters. Fuzz already paid off pre-merge: it exposed the `factorylm://m//m/x` parser-accident divergence, which the contract now names instead of hiding.

## Adversarial reviewer effort
High (default). **Deviation from §Gate 7:** the Codex/GPT-5.6 Sol lane is not yet wired; an independent fresh-context reviewer agent substituted for this pilot. Wiring the external lane remains an open program task.

**Gate 7 round 1: BLOCK — and the gate worked.** The reviewer proved a real divergence the shadow suite was blind to: mobile's trust filter did a case-sensitive raw-string `startsWith`, so `HTTPS://APP.FACTORYLM.COM/m/<tag>` (and, found on re-probe, explicit `:443` default ports) resolved on Hub but died on mobile — and both the corpus and the lowercase-only fuzz generator were structurally unable to see it. Root-cause fix, not case-patching: the trust decision now operates on the parsed, normalized URL (`isTrustedDeepLink`, exported), the shadow's sanctioned-divergence rule now REUSES that exact function instead of privately re-implementing it (the false-green mechanism), the fuzz generator includes mixed-case prefixes, and 6 new corpus cases pin the finding (uppercase scheme/host, `:443`, userinfo trick, uppercase path). Evidence post-fix: mobile 68/68, hub 54/54.

## Human approval requirement
Mike GO on CU-P1 given 2026-08-15 (pilot authorization). Gate 9 promotion = PR merge after green CI + adversarial review.

## Promotion plan
Normal PR → required checks → merge. Mobile ships to users via its own store/release pipeline (ADR-0034); no VPS deploy surface changes.

## R1 SHA/checkpoint
_To record at merge (PR merge commit + auto-tag)._

## Observation window
Next mobile release cycle: watch Hub `/api/assets/by-tag` 404 rate on mobile-originated requests (should only drop).

## Deletion criteria
N/A — nothing deleted; the old regex was replaced in place.

## Evidence required for GO
Hub 54/54 (contract + pre-existing tag suites) · mobile 68/68 (full suite incl. shadow) · `tsc --noEmit` clean · actionlint clean · red-first proof recorded above.
