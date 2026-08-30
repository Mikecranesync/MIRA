# #3481 round 44 (S1: `docs/` + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round44-gate7-docs.md` (attempt 2; attempt 1 malformed, preserved)
— head `18cde8db6e6437ac6f21938a66adc8581e32d135`. The finding is about
`mira-crawler/ingest/provenance.py`, outside the S1 scope; the adjudication scope adds
`mira-crawler/ingest/` and `mira-crawler/tests/` so every quoted `+` line is visible.

## F1 — "`_QUERY_NAME_NOISE_RE = re.compile(r"[-_.\s]")` strips only the ASCII hyphen, so `api－key` / `api‑key` bypass detection" (high)

The quoted regex is not in this diff: round AL replaced it, and the fold now removes
**every** non-alphanumeric byte after NFKD (a U+FF0D full-width hyphen is even a
compatibility form of `-`):

```diff
+_QUERY_NAME_NOISE_RE = re.compile(r"[^0-9a-z]")
```
```diff
+    return _QUERY_NAME_NOISE_RE.sub("", stripped.lower().translate(_CONFUSABLES))
```

Executed on this head: `?api－key=1` (U+FF0D) → refused (`apikey`); `?api‑key=1` (U+2011) →
refused (`apikey`). The U+2011 case is a lock of this diff:

```diff
+        "https://example.com/doc.pdf?api‑key=abc123",  # U+2011 non-breaking hyphen
```

The finding re-raises round-35 S2 F1, which was sustained and root-fixed in round AL.
