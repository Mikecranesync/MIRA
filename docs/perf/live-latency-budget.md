# Live-tag latency budget — why the Hub feels 5 s+ behind, and how to get to ~1 s

**Question (2026-07-04, Mike):** the asset card lags real life by 5 s and often much
more — how do we get it to near-real-time (< 1 s, ideally instant)?

**Answer:** the pipeline is **five stages, three of them independent polls that stack**.
Each poll adds *up to its full interval* of latency, so the worst case is the *sum* of
the intervals, not the max. That is why it feels much worse than any single "2 s" number.

## The pipeline

```
PLC (Micro820)  --RS-485 Modbus-->  Ignition Gateway  --tag scan-->  tag memory
   --collector timer POST-->  mira-relay (cloud)  --INSERT/upsert-->  NeonDB
   (live_signal_cache)  --Hub API query-->  browser  --setInterval poll-->  screen
```

## Measured / configured per-layer budget

| # | Stage | Mechanism (source) | Cadence | Worst-case add | Typical (½) |
|---|-------|--------------------|---------|----------------|-------------|
| 1 | PLC → gateway | rotating `vfd_poll_step`, 1 Modbus msg / 500 ms tick (`plc/INSTALL_ConvSimple_v1.9.md`, `LD_BUILD_GUIDE_v5.md`) | analog VFD reg refreshes every 500 ms × #steps; digital I/O fast | ~2 s analog / ~0.5 s digital | ~1 s / ~0.25 s |
| 2 | Gateway tag scan | tag group `scanClass:"Default"` (`ignition/tags/tags.json`) — Ignition factory default **1000 ms** ⚠ confirm on bench | ~1000 ms | ~1000 ms | ~500 ms |
| 3 | Collector push | gateway timer `tag-stream.py`, **Fixed Rate 2000 ms** (`STREAM_INTERVAL_MS`) — reads all allowlisted tags, POSTs signed batch | 2000 ms | ~2000 ms | ~1000 ms |
| 4 | Relay ingest | writes on POST receipt — INSERT `tag_events` + upsert `live_signal_cache`, server `NOW()` (#2429) | on receipt | ~100–200 ms | ~150 ms |
| 5 | Hub browser poll | `MachineMemoryCard.tsx` `POLL_INTERVAL_MS`, was **2000 ms** | 2000 ms | ~2000 ms | ~1000 ms |
| — | Hub API query | `/api/assets/[id]/machine-memory` (`force-dynamic`, few indexed point-lookups) | per poll | ~100–200 ms | ~150 ms |
| | **END-TO-END** | | | **~7 s worst (digital ~5.5 s)** | **~3.5 s typical** |

Matches the lived experience exactly: "5 s is too long and actually much longer."
Empirical corroboration: two prod `db-inspect` clock-skew probes showed ingest batches
landing ~2 s apart with server-stamped `updated_at ≈ last_seen_at` (skew 00:00:00) —
so stage 4 is genuinely fast and stage 3's 2 s is real.

## The fix ladder (highest leverage first)

Stages **2, 3, 5 are the three stacked polls** — the entire controllable latency lives
there. Stage 1 is the analog *physical floor* (digital is already fast); stage 4 is
already fast.

### Tier 1 — config, big win, low risk → gets to ~1–1.5 s
1. **Collector push 2000 → 500 ms** *(gateway timer — Mike, biggest single lever).*
   Ignition Designer → the MIRA tag-stream **Gateway Timer Script** → Schedule →
   Fixed Rate `500`. 12 tags × 2 Hz is trivial cloud load. Removes ~0.75 s typical /
   1.5 s worst on its own.
2. **Gateway scan class 1000 → 250 ms fast group** *(gateway — Mike).* Make a `Fast`
   tag group at 250 ms and assign the ~12 monitored `MIRA_IOCheck/*` tags to it (leave
   the rest on Default). Removes ~0.375 s typical.
3. **Browser poll 2000 → 750 ms** *(in-repo — DONE, this PR).* `MachineMemoryCard.tsx`.
   Keeps the display ahead of a 500 ms collector.

After Tier 1, digital tags ≈ **~1 s typical**; analog bounded by the PLC rotating poll.

### Tier 2 — kill the two poll stages with push → "feels instant" (< 1 s)
The relay **already has a tenant-scoped WebSocket** (`ws_tags` / `broadcast` /
`_ws_poll_loop` in `mira-relay/relay_server.py`, opt-in `MIRA_HISTORIAN_WS_POLL=1`,
interval `MIRA_HISTORIAN_WS_POLL_INTERVAL` default 2 s). Two options:
- **B (recommended, self-contained): Hub SSE endpoint.** A Hub route holds an
  `EventSource` connection open and server-side-polls `live_signal_cache` every
  ~300 ms, pushing only changed tags to the browser. Collapses stage 5 to ~0 perceived
  latency, no relay dependency. Card swaps `setInterval` fetch for `EventSource`.
- **A: Hub subscribes to the relay WS** and re-streams to the browser. Reuses the
  existing broadcaster but adds a Hub↔relay hop + auth; also drop
  `MIRA_HISTORIAN_WS_POLL_INTERVAL` to ~250 ms.

Either way the collector push (stage 3) still gates *freshness at the relay*, so Tier 1
step 1 is a prerequisite — pushing 2 s-old data instantly does not feel instant.

### Tier 3 — the honest ceiling on "instant"
A cloud round-trip from the home garage has a physical floor of network RTT + render
(~150–300 ms). You **cannot** get HMI-grade < 50 ms through the cloud Hub. For truly
instant, the near-zero-latency surface is a **local Ignition Perspective panel** reading
the tags directly (gateway scan rate, ~250 ms, no cloud hop) — the deployment surface the
maintenance-intelligence module already contemplates. Use the cloud Hub for remote/mobile
(~1 s achievable); use a local Perspective view when someone is standing at the machine.

## What this PR ships
Tier 1 step 3 only (browser poll 2000 → 750 ms) + this budget doc. Steps 1–2 are gateway
settings for Mike; Tier 2 (SSE push) is the follow-up that reaches sub-second.
