# Gate 7 adjudication — PR #3268

**Verdict:** PASS · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 5 · **Rulings:** 5 (sustained: 1)

> Verdict is computed structurally from the rulings: any SUSTAINED high ⇒ BLOCK;
> an unruled finding cannot pass. Both phases are preserved intact as evidence.

## Rulings

- **[REFUTED] [high] Uncurated redirects may be followed because the client is not forced to disable auto‑redirects**
- **[REFUTED] [high] Path‑traversal bypass for `file://` URLs**
- **[REFUTED] [high] Environment‑variable‑at‑import bug – tests set `INGEST_LOCAL_ALLOWED_DIR` after the module is imported**
- **[REFUTED] [medium] Upper‑case scheme handling may be inconsistent**
- **[SUSTAINED] [medium] AST scanner may miss `is_private` passed via a variable‑expanded `**

## Raw adjudication

## RULINGS
- **[ruling: REFUTED] [severity: high] Uncurated redirects may be followed because the client is not forced to disable auto‑redirects** — the diff shows `httpx.Client(..., follow_redirects=False, ...)` and the test’s fake client asserts this argument, directly disproving the claim.  
- **[ruling: REFUTED] [severity: high] Path‑traversal bypass for `file://` URLs** — `_validated_local_path` in the diff resolves the path with `.resolve()` and checks containment via `is_relative_to`, matching the rebuttal’s quoted code and negating the finding.  
- **[ruling: REFUTED] [severity: high] Environment‑variable‑at‑import bug – tests set `INGEST_LOCAL_ALLOWED_DIR` after the module is imported** — the diff reads `INGEST_LOCAL_ALLOWED_DIR` inside `_validated_local_path` at call time, so setting the variable in tests takes effect; the quoted evidence appears verbatim.  
- **[ruling: REFUTED] [severity: medium] Upper‑case scheme handling may be inconsistent** — both `shared_corpus_source_allowed` and `ingest_url` lower‑case the scheme (`_up(url).scheme.lower()`), proving case‑insensitive handling as shown in the diff.  
- **[ruling: SUSTAINED] [severity: medium] AST scanner may miss `is_private` passed via a variable‑expanded `**kwargs` that does not contain the key** – the new scanner implementation deliberately treats `**kwargs` as not providing an explicit `is_private` flag (see `_scan_tree` in the diff), which aligns with the finding’s description; the rebuttal’s policy argument does not negate the identified limitation.  

## VERDICT
PASS

## Cascade attempts

- `groq: ok`
