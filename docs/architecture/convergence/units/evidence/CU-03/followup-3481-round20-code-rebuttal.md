# #3481 round T (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round20-gate7-code.md` — head `4abb63d000f7760d506319a7edcbcee59ecf0e32`,
scope `mira-crawler/ tests/ .github/ tools/` (rounds C, E, P, R settled), **118,890/118,890**
chars, sha256 `0a409c6223078b76a6b43aec3ac449e6e19dfb7d69f0ee76e75f8fcb6792f0a0` (valid shape on
attempt 2; attempt 1 preserved). Every quoted line below is a `+` line of that diff.

## F1 — "the main flow still uses the legacy `adjudication_verdict`" (high)

The quoted line does not exist in the diff. The main flow computes the verdict with the strict
function, which returns UNKNOWN unless exactly one `## RULINGS` and one `## VERDICT` exist and no
other section does:

```diff
+        verdict = adjudication_verdict_strict(text, prior)
```
```diff
+def validate_adjudication_shape(text: str) -> Optional[str]:
```
```diff
+    if validate_adjudication_shape(text) is not None:
+        return "UNKNOWN"
```

The locks in this diff cover the exact evasions the finding lists (missing RULINGS, duplicate
sections, bold verdict) and the mutation that removes the check turns them red.

## F2 and F3 — default ports / percent-encoding case not normalised (high, high)

By contract, and by name: the assignment for this fix was scheme + host only, everything else
byte-exact, so the stored key never diverges from what the resolver classified:

```diff
+    """Lower-case ONLY the scheme and the host of ``url``; every other byte —
```

The claimed harm — "a private ingest could coexist with a public ingest of the same document" —
cannot occur: visibility is decided per row by `enforce_visibility` on a lower-cased host, so two
spellings of one origin receive the same classification (locked), and a private row never widens
a public one. Port and percent-encoding normalisation are separate data-contract changes (#3482),
not defects of this one.

## F4 — "`ingested_source_urls` now refuses empty or whitespace tenant IDs" (medium)

That is the fix for a real cross-tenant probe (round M), not a regression: "administrative tooling
that used an empty tenant to query all tenants" describes the defect. Items stay pending (the
retryable direction) and the exact-key `ON CONFLICT … DO NOTHING` guard makes duplicate inserts
impossible:

```diff
+    if not isinstance(tenant_id, str) or not tenant_id.strip():
```

## F5 — "a PR touching only evidence files aborts with exit 1" (medium)

A PR whose only change is raw reviewer output has no author claim to review; refusing to invent a
verdict for it is the fail-closed behaviour, and the message names the flag that puts the contents
in scope:

```diff
+                "error: nothing left to review after excluding evidence artifacts", file=sys.stderr
```

`README.md` and rebuttals are never dropped, so an evidence-index change is always reviewable.

## F6 — receipts list of dropped artifacts is unbounded (low)

The receipts are the committed record, not the prompt; the prompt carries the bounded scope notice:

```diff
+SCOPE_NOTICE_MAX_PATHS = 40
```
