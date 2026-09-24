# Capture privacy & tenant isolation — verified with a planted secret

**Staging SHA:** `5d0abaaebb92f1d5fa1ac5c05ed65c1e06530719` · 2026-09-23
Notebook `6edd3164-…`, turn `fb0b68ca-7f32-4dd9-a0fa-fd45eb957835`.

## Method — a positive control first

Asserting "no secrets in the packet" against a packet that never saw one proves
nothing. So the question itself carried two:

> "my password is **hunter2** and my key is **sk-live-abc123**; what causes
> bearing chatter"

The packet came back **2953 bytes** with `request.message_chars = 80` — the exact
length of that question — so the recorder demonstrably processed the string
containing both secrets.

## Result

| check | result |
|---|---|
| the literal `hunter2` | **absent** |
| the literal `sk-live` | **absent** |
| cookie / session token / bearer | absent |
| a `password` field | absent |
| private reasoning (`chain_of_thought`, `<thinking>`, `reasoning_content`) | absent |
| database connection string | absent |
| **question text** | **not stored** — only `message_chars: 80` |
| **answer text** | **not stored** — only `answer_chars: 398` |

The packet records the *shape* of the turn, never its content. That is what makes
`ungroundedUnitClaim` and the #3962 assessment run **in-route on the raw strings**
and persist only a boolean: there is no answer text in the packet to recompute
them from later, by design, and that trade is stated rather than discovered.

## Tenant isolation

| request | result |
|---|---|
| a **different tenant** reading this turn's diagnostics | **HTTP 404** |
| the **owner** reading the same turn | **HTTP 200** |

404 rather than 403 is the right answer: a cross-tenant read must not confirm the
row exists.

## Reconstruction, honestly scoped

What a packet reconstructs today is the **decision path** — retrieval strategy and
counts, evidence ids, which prompt kind was assembled, provider and model, gate
decision, citations shipped, timings, anomalies. It does **not** reconstruct the
inputs and outputs themselves, because it deliberately stores neither.

Full input/output reconstruction would need tenant-scoped content references
(#3939 item 4) — content in FactoryLM storage with only references in the
telemetry. That is **not built**, and this branch adds no content surface:
`contentCapture` is `false` on staging and no new third-party export exists.
Recording that as a gap rather than implying the packet already reconstructs
content.

## Reproduce

```bash
# plant a secret in the question, then scan the packet for it
curl -X POST "$BASE/api/equipment-notebooks/$NB/chat/" -H "Cookie: $C" \
  -d '{"message":"my password is hunter2 ...","mode":"general","sourceDocIds":[]}'
curl "$BASE/api/equipment-notebooks/$NB/turns/$TID/diagnostics/" -H "Cookie: $C"
```
