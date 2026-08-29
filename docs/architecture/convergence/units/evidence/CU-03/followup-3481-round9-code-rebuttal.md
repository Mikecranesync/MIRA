# #3481 round I (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round9-gate7-code.md` — head `085a1b909cb6d7a560d290df318330c2bb86ee22`,
scope `mira-crawler/ tests/ .github/ tools/` (rounds C and E settled), **70,440/70,440** chars,
sha256 `871fb01ddbec8319c8e838233aca137139c8be4b7cc05f2e59759b1852888159`.

## F1 — "Evidence-artifact removal bypasses file renames/moves" (high)

The finding's harm is a data leak: an artifact renamed out of `units/evidence/` "is sent to the
LLM". Three things in the diff disprove that framing.

First, the exclusion exists to stop preserved *reviewer output* being misread as the PR's claims —
its docstring says so — not to keep data out of the model:

```diff
+def is_evidence_artifact(path: str) -> bool:
+    """A preserved review artifact: a file under units/evidence/ that is raw
+    reviewer/adjudicator output or a lane log — NOT the author-written index
+    (README.md) and NOT a rebuttal.
```

Second, it is deliberately narrow — only documentation/log suffixes under that directory — because
a file that is *not* such an artifact must stay in review; that is the property the finding's
scenario needs, and it is a lock in this PR, not a gap:

```diff
+    # Only documentation/log files are artifacts. Anything executable or
+    # structured under units/evidence/ (a script, a policy, a Dockerfile) stays
+    # in the reviewed diff — the directory must never become a place to hide
+    # code from the gate (#3481 round H).
```

A file moved from `units/evidence/` to `src/` is, at the `b/` path the lane keys on, a source-tree
change of this PR and **must** be reviewed; excluding it because of where it *came from* would be
the silent-scope failure the receipts exist to prevent. And a pure rename (`similarity index
100%`) carries no content hunk at all, so nothing is "sent" that the reviewer could not see before
this PR — the lane has always sent the scoped, capped, redacted diff:

```diff
+Gate 7: sending 78,857/78,857 diff chars to a third-party provider (redacted: IP/MAC/SN)
```

## F2 — "Adding `.log` to the documentation-suffix list changes PR-kind classification" (medium)

That is the change, and it is the intended one: committed lane logs are documentation-of-record,
and a docs scope that carried them was being briefed as "partly documentation":

```diff
+# `.log` is here because committed review evidence (the lane's own stderr logs,
```
```diff
+_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
```

Kind affects only the note in the brief; the disprove brief, the escalation triggers and the
redacted diff are the same for every kind.

## F3 — "`canonical_source_url` does not normalize default ports" (low)

By design and by name: the function lower-cases only the scheme and the host and preserves
everything else byte-for-byte, so that the stored key never diverges from what the resolver
classified. Its docstring and the parametrised lock both state the boundary:

```diff
+    """Lower-case ONLY the scheme and the host of ``url``; every other byte —
+    userinfo, port, path, query, fragment — is preserved exactly as given.
```

Port normalisation would be a different, larger contract change; it is recorded as out of scope,
not as a defect of this one.
