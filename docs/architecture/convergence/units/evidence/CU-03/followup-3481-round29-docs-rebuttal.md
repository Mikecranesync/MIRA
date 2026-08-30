# #3481 round AE (S1: docs + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round29-gate7-docs.md` — head `212861d5f860bd9493bb0e60c15e103012de7445`,
**289,001/289,001** chars (valid on attempt 1), 13 files excluded by scope (the code the finding
discusses is among them; the adjudication scope adds `mira-crawler/` so every quoted line is
visible). Every quoted line below is a `+` line of this PR's diff.

## F1 — "`url_has_userinfo` uses `urlparse(url).username`, so an IPv6 zone identifier (`[fe80::1%eth0]`) is refused as userinfo" (high)

The quoted implementation does not exist. `url_has_userinfo` never calls `urlparse`; it slices
the authority as a string — everything between `//` and the first `/`, `?` or `#` — and answers
one question, whether that slice contains `@`:

```diff
+    s = str(url).strip()
+    head, sep, rest = s.partition(":")
+    if not sep or not _URL_SCHEME_RE.fullmatch(head) or not rest.startswith("//"):
+        return False
+    authority = rest[2:]
```
```diff
+    return "@" in authority
```

`http://[fe80::1%eth0]/` has the authority `[fe80::1%eth0]`, which contains no `@`; the
function returns `False` and the URL is not refused. A `%` in the authority plays no part in the
decision — the percent-escape rule applies only to query-parameter *names* in the separate
query check. The finding argues about code the diff does not contain.

## F2 — "No test covers IPv6 zone-identifier URLs" (medium)

True as a coverage remark and non-blocking; the behaviour follows from the `+` lines above
(no `@` ⇒ `False`). Bracketed IPv6 authorities are covered for both directions of the rule
(`+            "http://u@[::1]/x",` is refused; `+            "https://[2001:DB8::1]:443/A"` and
`+        "ftp://svc:hunter2@[2001:db8::1]:2121/x",  # IPv6 authority`), and a zone-id case is
a one-line addition to the negative controls for the next head.
