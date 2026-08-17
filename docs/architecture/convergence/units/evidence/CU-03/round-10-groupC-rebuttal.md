# CU-03 round-10 group C — author rebuttal (verbatim quoted evidence)

## F1 — "Incomplete update of insert_chunk callers"

Every caller in the repository was updated in this PR; the finding generalizes from one
scoped file group to the whole tree. In THIS group's own diff, all three non-crawler
callers pass the explicit value:

- `mira-bots/tools/learning_ingester.py` — `is_private=True,` (I-3, private rows)
- `mira-core/scripts/ingest_equipment_photos.py` — explicit `is_private` at its
  `insert_chunk` call
- `tools/vendor_coverage_ingest.py` — explicit `is_private` at its insert

The crawler-side callers are in the group-A diff (`tasks/*.py`, `crawler/base_crawler.py`,
`ingest/store.py` threading `is_private` through `store_chunks` → `insert_chunk`), and the
caller population is locked by a repo-wide AST scan test in the group-B diff
(`test_write_path_visibility.py` — the static call-site scan that fails on ANY
`insert_chunk`/`store_chunks`/`ingest_text_inline` call without an explicit `is_private`,
with import-alias resolution, and NOT counting bare `**kwargs` as explicit). A caller the
scan somehow missed still fails loud at runtime: the parameter is keyword-only and
required (`*, is_private: bool` — group A diff), so the failure mode is `TypeError`, never
a silent default.

## F2 — "Allowlist line numbers off-by-one → silently mis-matched queries"

Silent mis-match is structurally impossible: every allowlist entry binds to the query by
**content hash**, not line number alone. The re-keyed entries in this diff carry new
`query_sha256` values updated together with the line keys:

```yaml
  "tools/vendor_coverage_ingest.py:158":
    query_sha256: "b9d872e5e5430ac3b5e8f0ce9305a62e700fd5dfee62d556fd467d4b1466a693"
```

and the diff's own reason text documents the mechanism:
`"Re-keyed in CU-03: the hash context window extends into insert_chunk's signature, which
gained the required is_private param."` A wrong line number produces a missing/mismatched
hash and the checker **fails closed** (unclassified read = failure), it does not silently
approve. The checker ran clean at this head (`check_knowledge_entries_filters.py` exit 0 —
operator evidence in `units/CU-03.md`).

## F3 — "Removal of architecture-drift checks for visibility enforcement"

The deleted lines are the opposite of removed checks: they are two entries deleted from an
**exemption allowlist**, quoted with their own flag text in this diff:

```python
-    "mira-hub/scripts/verify-node-subtree-retrieval.ts":
-        "verification script writing node_attachment probe rows; default-false today. "
-        "Flagged for the CU-03 visibility audit — do not silently bless.",
```

Removing an exemption tightens enforcement: both files now must (and do) satisfy the
contract — this group's diff shows each gaining an explicit `is_private` column in its
INSERT (`... metadata, is_private)` in both `verify-node-subtree-retrieval.ts` and
`folder-brain-proof.spec.ts`). The enforcement test itself (Contract 13 + its honesty
companion) remains in `tests/test_architecture.py` and is green at head (26/26).

## F4 — "Receipts hash only the truncated view, undermining the guarantee"

The receipt's stated contract — quoted from this diff's docstring — is proof of **what was
reviewed**, not a claim of whole-PR coverage:

```python
    """Immutable run identity, embedded in every report (Gate 9 re-review: a
    committed PASS file must independently prove WHAT was reviewed — head SHA,
    --paths scope, the files that scope excluded, cap, chars sent, and a hash
    of the exact reviewed bytes — not rely on the operator's say-so)."""
```

Truncation and exclusion are made LOUD, not hidden: the receipt prints
`diff chars sent/total` (a truncated run visibly shows sent < total) and
`excluded by scope (N): <every file>`. The coverage guarantee lives one level up and is
stated in the doctrine file in this diff (`.claude/commands/gate7-review.md`): every
excluded file must be covered by another group's run, each group needing its own PASS.
Hashing bytes that were NOT sent to the reviewer would manufacture false proof — the
receipt hashing exactly the reviewed bytes is the honest design, not the defect.

## F5 (medium) — case-sensitive `--paths` prefix matching on Windows

`--paths` is operator-supplied review configuration, not attacker-controlled input, and it
matches against git diff paths (repo-canonical case, forward slashes) — not filesystem
lookups, so Windows case-insensitivity does not enter the comparison. The excluded-files
receipt prints every non-matched file by name, so a case-mismatched prefix visibly dumps
the affected files into the `excluded by scope` list rather than hiding them. Recorded as
accepted; non-blocking medium.
