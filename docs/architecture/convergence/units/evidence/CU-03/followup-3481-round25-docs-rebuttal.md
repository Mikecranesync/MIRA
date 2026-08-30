# #3481 round Z (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round25-gate7-docs.md` — head `8db09c2ea81d9c9e58613fab5326803548add483`,
scope `docs/` (rounds R, T, U, V, W, Y settled), sha256 in the report's receipts (valid shape on
attempt 1). Every quoted line below is a `+` line of this PR's diff.

## F1 — "Duplicate storage due to lack of default-port normalization" (high)

The finding quotes, as the current contract, a docstring reading "Lower-case ONLY the scheme and
the host of ``url``; every other byte — userinfo, port, path, query, fragment — is preserved
exactly as given". **That text is not in the diff** — it was an earlier revision within this PR,
superseded before this head. The current docstring states the default-port rule the finding says
is missing, and the code implements it:

```diff
+    * an explicit **default port** is removed for ``http`` (80) and ``https``
+      (443), including an equivalent digit spelling such as ``:0443``
+      (RFC 3986 §6.2.3); non-default, empty (``:``) or invalid port text and the
+      ports of every other scheme are preserved byte-exact;
```
```diff
+_DEFAULT_PORTS = {"http": 80, "https": 443}
```
```diff
+def _canonical_port(scheme: str, port: str) -> str:
```

The privacy sub-claim is separately false: visibility is decided per row on a lower-cased host,
so two spellings of one origin classify identically (`+    def test_port_and_escape_canonicalisation_never_changes_visibility_or_refusal(self):`).

## F2 — "Duplicate storage due to case-sensitive percent-encoding" (high)

Same superseded quotation. The current contract and code upper-case every valid escape:

```diff
+    * the hex digits of every valid ``%HH`` escape are **upper-cased** in the
+      userinfo, path, query and fragment (RFC 3986 §6.2.2.1); nothing is ever
+      decoded, and invalid ``%`` text (``%7``, ``%``, ``%zz``) is preserved;
```
```diff
+_PCT_ESCAPE_RE = re.compile(r"%[0-9A-Fa-f]{2}")
```
```diff
+def _upper_escapes(component: str) -> str:
```

## F3 — "Evidence-artifact exclusion may bypass review on renamed files" (high)

The finding quotes a `drop_evidence_artifacts` body made of three comments and says the check
"only sees the new path". The real body keys on **both** sides of a rename — the old path
(`source`) and the new path (`target`) — and the scenario the finding describes (an artifact
renamed to a non-artifact path) is exactly what the second term keeps **in** review unless the new
path is still a doc/log file:

```diff
+            moved_artifact = is_evidence_artifact(source) and target.lower().endswith(_DOC_SUFFIXES)
+            keep = not (is_evidence_artifact(target) or moved_artifact)
```

Locked in this PR — a rename to code stays in review, a doc-to-doc move is receipted under its new
path:

```diff
+    # #3481 round I (sustained): a rename/move must be keyed on BOTH sides. An
```
```diff
+    assert dropped2 == ["docs/notes/round-9-review.md", e + "plain.md"]
```

An `x.log` under `units/evidence/` renamed to `tools/r.py` is kept (`+now code` stays in the
reviewed diff in that lock); a script placed under `units/evidence/` is never an artifact in the
first place (`is_evidence_artifact` returns `False` for non-doc suffixes).
