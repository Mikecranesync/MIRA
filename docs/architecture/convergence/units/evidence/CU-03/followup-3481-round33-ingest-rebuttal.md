# #3481 round 33 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round33-gate7-ingest.md` — head `01699b6690544ce0b955bddf118d942897d6dcb3`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `mira-crawler/tests/` so the locks are visible.

## F1 — "a second `?` hides a credential parameter" (high) and F2 — "`%26` hides one" (high)

Both were adjudicated **REFUTED (2/2)** on the previous head (`followup-3481-round32-ingest-adjudication.md`)
against this identical code; they are re-raised without new evidence. The rule is defined on
query-parameter **NAMES as a server parses them**; **values are never inspected**, by contract:

```diff
+# Query-parameter NAMES that carry a credential (round AD on #3481, round-27
+# scope C F1 SUSTAINED). Matched on the percent-decoded name, lower-cased, with
+# `-`, `_`, `.` and whitespace removed — so `api_key`, `Api-Key`, `api%5Fkey`
+# and `X-Amz-Signature` all match; values are never inspected (a value that
+# merely contains the word "token" is an ordinary query), and a longer name
+# such as `tokenizer` is not the family.
```
```diff
+    query = str(url).strip().partition("?")[2].partition("#")[0]
+    for pair in re.split(r"[&;]", query):
```
```diff
+        name = _QUERY_NAME_NOISE_RE.sub("", unquote(pair.split("=", 1)[0])).lower()
```

`http://example.com/a?x=1?token=abc`: the query is `x=1?token=abc`, one parameter named `x`
whose *value* is `1?token=abc` (RFC 3986 §3.4 allows `?` in a query) — a value, never inspected.
`?token%26id=123`: the parameter is **named `token&id`** to every server (one decode of the
name); `token&id` is not `token`, and no server folds `&` out of a name. Both ask the name rule
to become a value rule the contract excludes on purpose.

## F3 — "a historic padded row and a new unpadded insert become two rows" (high)

The historical residual is stated, not hidden, in the contract the finding quotes from, together
with the reason it is a follow-up migration and not a silent rewrite:

```diff
+    Historical residual, documented not migrated: rows written before this
+    function keep their stored spelling; ``chunk_exists`` and the ledger probe
+    also look up the exact raw spelling they were given, so a recrawl of such a
+    row finds it. A one-off dedup migration is the follow-up, never a silent
```

The probe binds the raw spelling next to the canonical one for exactly that reason:

```diff
+    urls = [source_url] if source_url == raw_url else [source_url, raw_url]
```

A dedup miss on a pre-existing row is the documented residual class (rounds T–Z), not a defect
introduced by this diff; no row is exposed, no visibility changes.

## F4 — "`_urls_in` still returns the original `n.value`" (high)

The finding's own quoted diff shows the opposite; the comprehension returns the stripped value:

```diff
+        n.value.strip()
```
```diff
+        and n.value.strip().lower().startswith(("http://", "https://"))
```

The claim contradicts the line it quotes.
