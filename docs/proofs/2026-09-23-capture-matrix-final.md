# Capture matrix — every attempt accounted for

**Staging SHA:** `5d0abaaebb92f1d5fa1ac5c05ed65c1e06530719` · 2026-09-23
**Harness:** `tools/qa/capture_acceptance.py` · artifact `/tmp/matrix-5d0abaaeb.json`
**Website origin:** `https://app-staging.factorylm.com` · **Production untouched**

## The matrix

```
scenario                  http  att  acc  gen  per  sent  recv  outcome
A_photo_look               200  yes  yes  yes  yes   yes   yes  answered
B_text_followup            422  yes  yes   no   no   yes    no  error
C_failed_upload            415  yes   no   no   no   yes    no  pre-accept
D_malformed_json           400  yes   no   no   no   yes    no  pre-accept
E_unauthenticated          401  yes   no   no   no   yes    no  pre-accept
F_client_cancel            422  yes  yes   no   no   yes    no  error
G_reconnect_same_id        422  yes  yes   no   no   yes    no  error
```

**Zero unknowns.** Every one of the seven pre-registered attempts resolves to a
definite state, and the per-attempt table agrees with the independent aggregate:

```json
{ "arrived": 6, "pre_accept_rejections": 2, "accepted": 4, "accepted_closed": 4,
  "lost_starts": 0, "server_error_no_start": 0, "starts_without_arrival": 0,
  "no_response_recorded": 0, "close_rate": 1, "start_capture_rate": 1 }
```

`accepted: 4` = A, B, F, G — exactly the four rows the table marks `acc=yes`.
`arrived: 6` against 7 attempts is E, which middleware rejects before the route
runs (documented limit: the denominator is requests that reached the handler).

## What the columns mean, and why they are separate

| column | who knows it | why it is its own column |
|---|---|---|
| `att` | the client | the row exists because this process minted an id and sent it — a reconstructed count cannot tell never-sent from never-recorded |
| `acc` | the ledger | a durable start record exists |
| `gen` | the packet | a provider produced an answer |
| `per` | the packet | the evidence packet was written |
| `sent` | the **server** | it emitted frames |
| `recv` | the **client** | bytes this process actually read back |

`sent` and `recv` are deliberately not merged. The server can only honestly claim
what it wrote to the socket; whether it arrived is the client's fact, and #3939
asks for exactly that distinction.

## Three findings this matrix produced

It was not a formality — printing these states side by side is what exposed each
of the following, none of which was visible from the aggregate.

1. **The harness reported four accepted turns as never-accepted.** It inferred
   acceptance from the HTTP status, but `422 no_sources_selected` is raised well
   after the start record is written. It printed that table beside an aggregate
   reading `accepted: 4` — contradicting itself. Fixed by adding a real
   per-attempt lookup (`listAttempts`, `?attempts=N`) instead of inferring, and
   by printing `·` for unknown rather than `no`.

2. **A rejected upload could not be joined to the attempt that caused it.** The
   LOOK route read `clientKey` *after* the mime and size checks, so a 413/415
   reached the ledger with no client id at all. Moved above the validation.

3. **A malformed body was structurally unaccountable** — the id travels in the
   body, and the body is what failed to parse. Both wrappers now also read
   `X-Client-Request-Id` before any parsing.

Rows C and D were `·` before 2 and 3; they are definite now.

## Limits, stated

- **E never reaches the route.** `middleware.ts` returns 401 for `/api/*` before
  the wrapper, and middleware runs in the edge runtime where a durable write is
  impossible. `arrived` counts requests that reached the handler, and no number
  here claims otherwise.
- **`recv` is this harness's own receipt**, not the mobile app's. The app has no
  acknowledgement mechanism; that remains unbuilt and is listed as a gap, not
  quietly counted as covered.
- B/F/G return `422 no_sources_selected` because this branch is main-based; the
  contract PR #3959 is what stops an evidence-bearing notebook being refused for
  having no document sources. The capture behaviour under test is unaffected.

## Reproduce

```bash
export ACCEPT_BASE=https://app-staging.factorylm.com ACCEPT_COOKIE='next-auth.session-token=…'
python3 tools/qa/capture_acceptance.py --notebook <uuid> --photo <jpg>
```
