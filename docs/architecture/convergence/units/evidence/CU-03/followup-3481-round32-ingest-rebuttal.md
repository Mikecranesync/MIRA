# #3481 round 32 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round32-gate7-ingest.md` — head `9e7230330704c9fa600a56cedc5da41b7ee2985e`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `mira-crawler/tests/` so the locks are visible.

## F1 — "Credential detection bypassed with a second `?` delimiter" (high)

The rule is defined on query-parameter **NAMES** as a server parses them; **values are never
inspected**, by contract:

```diff
+# Query-parameter NAMES that carry a credential (round AD on #3481, round-27
+# scope C F1 SUSTAINED). Matched on the percent-decoded name, lower-cased, with
+# `-`, `_`, `.` and whitespace removed — so `api_key`, `Api-Key`, `api%5Fkey`
+# and `X-Amz-Signature` all match; values are never inspected (a value that
+# merely contains the word "token" is an ordinary query), and a longer name
+# such as `tokenizer` is not the family.
```

In `http://example.com?foo=bar?api_key=SECRET` the query is `foo=bar?api_key=SECRET`; every
server parses that as the parameter **`foo`** whose *value* is `bar?api_key=SECRET` — a second
`?` is an ordinary value character (RFC 3986 §3.4: `query = *( pchar / "/" / "?" )`). The
implementation reads exactly that query and exactly those names:

```diff
+    query = str(url).strip().partition("?")[2].partition("#")[0]
+    for pair in re.split(r"[&;]", query):
```
```diff
+        name = _QUERY_NAME_NOISE_RE.sub("", unquote(pair.split("=", 1)[0])).lower()
```

`%3F` decodes to the same `?` inside the value of `foo`. The finding asks the name rule to
inspect values, which the contract excludes on purpose (a value that merely contains "token" is
an ordinary query).

## F2 — "Percent-encoded delimiters (`api%26key=`) bypass detection" (high)

`api%26key` is the parameter **named `api&key`** to every server that receives it (one decode
of the name, which is what the rule performs — see the `unquote` line above). `api&key` is not
`api_key`: the noise rule removes only `-`, `_`, `.` and whitespace, by contract (quoted above),
and a server does not map `api&key` onto `api_key` either — so no credential-family parameter
exists in that URL under any parser. `foo=bar%3Fapi_key=SECRET` is F1's value case again. The
finding presupposes a second decode and a delimiter-folding step that no server performs; the
rule matches server semantics deliberately.
