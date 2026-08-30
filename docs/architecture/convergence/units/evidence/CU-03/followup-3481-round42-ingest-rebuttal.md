# #3481 round 42 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round42-gate7-ingest.md` — head `03cd8357d202f5640d40b7ed2115ac169235c2fb`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `mira-crawler/tests/` so the locks are visible.

## F1 — "double percent-encoding (`api%255Fkey`) folds to `api5fkey` and bypasses detection" (high)

Adjudicated **REFUTED** on this exact logic in round 32 (`followup-3481-round32-ingest-adjudication.md`,
F1/F2: "parses only query-parameter names … a second decode is not performed by any server"),
and raised again in rounds 30, 31 and 41 without new evidence. The rule matches the parameter
**name as a server receives it**, decoded exactly once — which is what every server does:

```diff
+# Query-parameter NAMES that carry a credential (round AD on #3481, round-27
+# scope C F1 SUSTAINED). Matched on the percent-decoded name, NFKC-normalised,
```
```diff
+    decomposed = normalize("NFKD", unquote(raw))
```

`api%255Fkey` on the wire is the parameter **named `api%5Fkey`** to the receiving server (one
decode); no server decodes it a second time into `api_key`, so no consumer treats its value as
an API key — exactly as `api5fkey` is not the family. A second decode would be a rule the
contract does not make, and it has no fixed point (`%25255F…` and so on). The single-decode
family match is locked, including the encoded-separator spelling servers do fold:

```diff
+        "https://example.com/doc.pdf?api%5Fkey=abc123",  # encoded separator in the name
```

A URL of this shape is, moreover, refused at hop-0 unless its host is a curated origin,
regardless of its query.
