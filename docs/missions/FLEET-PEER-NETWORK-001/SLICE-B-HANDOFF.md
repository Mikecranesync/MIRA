# Slice B — Foreman shadow state · handoff

**Owner:** Claude `fleet-001-review-e9` on Charlie · **Claim:** #3648 (ACTIVE)
**Branch:** `feat/fleet-peer-network-001b-foreman-shadow` · **Base:** `f5f994a78d6d2f2e9393381662804f375dc59209`
**Status:** draft PR, HELD. Not merged, not deployed, flag default OFF.

## What the slice found before it built anything

Two facts that shaped the work, both verified rather than assumed:

1. **Nothing read `FLEET_PEER_NETWORK_ENABLED`.** Slice A documents it as "read by Foreman from
   Slice B on"; a grep across `*.py`/`*.ts`/`*.tsx`/`*.yml` returned nothing at all. Wiring it is
   this slice's job, not a foundation it could build on.
2. **`ForemanPolicy` had no call site outside tests.** It is a well-formed pure policy class with
   no I/O — and nothing in production instantiated it. "Connect it to the live bot" was a genuine
   wiring gap, not a refactor.

And one defect the slice fixes as a side effect: Foreman's Slack dedup was an **in-memory set
cleared at 500 entries** (`bot.py`, `self.seen_events`). A restart reprocessed every redelivered
event, and a busy channel silently reopened the window for anything older than the last 500.

## What shipped

| file | what |
|---|---|
| `mira-bots/foreman/shadow.py` | flag reader, SQLite store (WAL), thread→mission identity, `ShadowRecorder` |
| `mira-bots/foreman/bot.py` | wiring only — flag read, durable dedup layered over the existing one, mission context per thread |
| `mira-bots/foreman/test_shadow.py` | 45 tests |

- **Flag** — `network_enabled()` defaults OFF and only an explicit truthy value enables. `""`,
  `"maybe"`, `"2"`, `"off"` all read as off, so a typo can never switch the network on.
- **Durable dedup** — the in-memory set is left **exactly as it was**; the SQLite check is layered
  *after* it, so flag-off behaviour is byte-identical to today and flag-on only adds survival
  across restart.
- **One mission per thread** — `mission_id_for_thread(thread_ts, channel)` is pure and
  deterministic; the channel is in the key because `thread_ts` is only unique within a channel.
  The stored identity wins over a re-derivation, so changing the rule later cannot split a live
  conversation into two missions.
- **Shadow recording** — `ShadowRecorder.observe()` returns the record; the caller may log it and
  may not route it.

## How "shadow mode" is made falsifiable

A decision that was recorded and one that was acted on look identical in a log, so shadow mode is
unfalsifiable unless something pins it down. Two structural guards, both tested:

1. `ShadowRecorder.PUBLIC_API` freezes the public surface, and a test fails if it grows. The class
   holds no Slack client, no agent handle, no subprocess — there is nothing to act *with*.
2. A parametrised test rejects any method whose name contains an action verb (`post`, `send`,
   `merge`, `deploy`, `invoke`, …).

**Mutation-verified:** adding `post_to_slack()` to `ShadowRecorder` fails two tests. My first
attempt at that mutation landed on `ShadowStore` instead (the anchor appears twice in the file) and
everything stayed green — a false negative I caught only by asserting the method was really on the
class before trusting the result. Worth repeating if anyone re-runs it.

## Scope decision, stated rather than buried

The PRD's Slice B line "create one Grok mission context per Slack thread" is **established and
persisted here, and deliberately not consumed.** Routing the Grok invocation through the mission
context would change live bot behaviour, which shadow mode forbids — the manual workflow stays
authoritative. The mapping is durable and ready; consuming it belongs to whichever slice turns the
network on. Flagged so the gap is a decision on the record, not an omission.

## Verification

```
mira-bots/foreman  pytest test_shadow.py                        45 passed
mira-bots/foreman  pytest test_mission_loop.py test_specialists.py  141 passed  (untouched by this slice)
                   ruff check mira-bots/foreman/                All checks passed
```

## Residual risk — the honest limitation

**`bot.py` could not be import-tested in this environment.** It hard-exits without `cursor-sdk`,
and `slack_bolt` is absent too; `test_bot.py` already fails collection on `main` for the same
reason, so this predates the slice. The wiring is therefore verified by AST parse and by matching
the file's own import convention — **not by execution**.

That convention match mattered: the first version used `from .shadow import …`, and `bot.py` is run
as a top-level script (`CMD ["python", "-u", "bot.py"]`) with sibling imports written absolutely
(`from specialists import …`). A relative import would have raised
`ImportError: attempted relative import with no known parent package` **at Foreman startup**. Fixed
to `from shadow import …` before commit.

**A verifier with the real dependencies should import `bot.py` and start Foreman once with the flag
off** to confirm the module loads and behaviour is unchanged. That is the one check this node
cannot perform.

## Not done here

No Foreman deploy, no Slack app configuration, no secrets touched, no merge. `ForemanPolicy` is
wired for observation only — the slice records what it would decide and never asks it to act.
