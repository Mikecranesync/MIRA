# #3481 round 32 (S1: `docs/` + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round32-gate7-docs.md` — head `9e7230330704c9fa600a56cedc5da41b7ee2985e`
(valid on attempt 1). Both findings are about `mira-crawler/ingest/store.py`, a file outside the
S1 scope; the adjudication scope adds `mira-crawler/ingest/` and `mira-crawler/tests/` so every
quoted `+` line below is visible in the reviewed diff.

## F1 — "Percent-encoded unreserved characters are not normalized, enabling duplicate rows with inconsistent visibility" (high)

Two claims. (a) *Equivalence normalisation:* decoding is excluded by the stated contract of the
storage identity — the rule is case-of-escape only, and "nothing is ever decoded" is the design,
not an omission:

```diff
+    * the hex digits of every valid ``%HH`` escape are **upper-cased** in the
+      userinfo, path, query and fragment (RFC 3986 §6.2.2.1); nothing is ever
+      decoded, and invalid ``%`` text (``%7``, ``%``, ``%zz``) is preserved;
```
```diff
+    """Upper-case the hex digits of every valid ``%HH`` escape; decode nothing."""
```

A spelling difference the contract does not fold is at worst a second row for one document — a
dedup miss, which is the documented historical-residual class — never a security defect.

(b) *"Inconsistent visibility / a public row bypasses the private-only check":* false.
Visibility is decided from the **origin** (`classify_origin` keys on the lower-cased host), which
is identical for `…/~user` and `…/%7Euser`; and every write passes the same credential check
before classification:

```diff
+    refusal = url_credential_reason(source_url)
+    if refusal:  # before classification: a credential-bearing URL is never a document
```

Two spellings of one origin therefore receive the **same** `is_private` decision from the same
policy entry. There is no spelling under which a row is "public" while its sibling is "private".

## F2 — "Hostnames are lower-cased but not IDNA-normalized" (medium)

The stated contract lower-cases the host and nothing more:

```diff
+    * the scheme and the host are lower-cased (a host is case-insensitive;
+      origin classification already lower-cases it);
```

Origins are configured in `provenance_policy.yaml` in one spelling; a Unicode and a punycode
spelling of one host is, again, the dedup-miss class, and both spellings classify from the policy
by host — the visibility consequence claimed does not follow, for the same reason as F1(b).
Coverage remark, not a defect on the diff.
