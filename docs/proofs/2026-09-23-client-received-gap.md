# "Sent" is not "received" — demonstrated, not asserted

**Staging SHA:** `a83cb617c79fde4f95ac496c5e909463890f43d2` · 2026-09-23

## Two cancels, two different truths

| surface | when the client left | ledger outcome | did the technician see the answer? |
|---|---|---|---|
| emulator app | force-stop **3 s into the stream**, before commit | **`cancelled`** | no — and the ledger says so |
| real browser | navigated away **~2 s after send**, after commit | **`answered`** | **no — and the ledger says `answered`** |

Website turn: notebook `343e94b3-…`, attempt `dfe90808`, trace
`de147a12cdf93be7f8579bd770e4348a`, `responded 200`, packet written.

## Why the second one is correct behaviour and still a gap

The route detaches the client-abort listener at its commit point on purpose
(ADR-0038 rule 7): once validation is complete and generation has been served, a
disconnect is treated the same as a disconnect *after* the response — the turn
stays answered. That is deliberate and right; re-reading an abort signal after
commit would make the durable record depend on network timing.

The consequence is exact: **after the commit point, nothing in the system
distinguishes "the technician read this answer" from "the technician closed the
tab".** The ledger records `answered`, the ingress row records `responded 200`,
and both are true — the server did generate it and did write it to the socket.
Neither is evidence it arrived.

## Why this is the argument for client acknowledgement

#3939 asks that `generated`, `sent` and `received` be told apart. Two of the three
are recorded today and the third is not, and this is what that costs:

- `generated` — the packet proves a provider served an answer.
- `sent` — the server wrote frames to the socket.
- `received` — **unrecorded.** The only receipt that exists anywhere is in the
  client, and no client reports it back.

The acceptance harness records its own `recv` (bytes it actually read) precisely
because nothing else can honestly claim it — but that is the harness, not the
product. The mobile app and the website have no acknowledgement mechanism.

**This is a demonstrated gap, not a theoretical one.** A turn that a technician
never saw is sitting in staging right now, recorded as `answered`.

## What closing it would take

A client-side ack — the app posting "I rendered turn X" — plus a `delivered`
column or lifecycle phase. That is new client work in `mira-mobile` and the Hub
UI, and it is **not built**. Deliberately not started here: it is a product
surface change, not a capture fix, and #3939's instruction is not to expand
architecture unless a live failure requires it. This is the live failure that
would justify it; the decision is still Mike's.


### Narrower than I first wrote — the answer is not lost

Reloading the notebook renders that turn's answer in full. It was persisted and it
is retrievable, so the technician can still read it later. The gap is therefore
**not** "the answer was lost"; it is that **nothing distinguishes seen from
unseen**. That is a smaller claim than the one I made first, and the accurate one.


## The website matrix, completed

| scenario | result |
|---|---|
| normal question | trace `7d44f29bb812cce6ef4f0d888dad8db5` |
| multi-turn follow-up | attempt `d9fa5187`, trace `b322e922e795caa9…`, `closed/answered` |
| cancel (navigate away) | attempt `dfe90808`, trace `de147a12cdf93be7…`, `closed/answered` |
| reconnect | reload renders the persisted answer |
| photo / bearing follow-up | **N/A — the surface has no photo affordance** |
| failed upload | **N/A by design — see below** |

**2 website attempts on this notebook, 0 unaccounted.**

### "Failed upload" does not exist on this door, by design

The Sources control is labelled "Upload PDF" and its input carries
`accept="application/pdf,.pdf"`, so a `.txt` looked like it should be rejected. It
was accepted — `Sources · 1/1`, attached with `source_role: manual`.

That is **documented intent, not a defect**. The route says so in its own comment:

> "Everything else is RETAINED (a maintenance workspace holds arbitrary files) but
> normalized to application/octet-stream so it is parked as capability 'stored':
> never indexed, never rendered inline, download-only. The only hard rejection
> left on this door is the size limit."

`text/` is a known prefix, so a `.txt` keeps its MIME. I nearly filed this as an
input-validation defect before reading the policy it implements. The `accept`
attribute is a picker hint, not a contract.

The failed-upload scenario therefore lives on the **mobile LOOK route**, which
rejects a non-image with **415** — and that is where the matrix records it.


## Related surface fact, verified

The **website has no photo affordance at all** on notebook chat — a DOM probe
returns zero `input[type=file]` elements, and the only file control is "Sources"
for documents. LOOK is a mobile-only path. So "photo + question on the real
website" is not a test that was skipped; it is a scenario the surface does not
offer.
