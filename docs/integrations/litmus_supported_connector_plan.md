# Future: a supported Litmus → MIRA connector (investigation plan)

**Status:** PLAN / deferred follow-up. Not required for the weekend demo (that uses `--source plc`;
see `docs/discovery/litmus_mira_demo_decision.md`).

**Goal:** get conveyor tag values *out of Litmus Edge and into MIRA* over a **supported** Litmus
egress path — so MIRA can read "through Litmus" for real, without depending on any internal socket,
private database, or reverse-engineered gRPC.

---

## Why this document exists

This session pinned the blocker on the *direct* internal read: `loopedge-access :8094` validates a
UUID `apiKey` against its own boltdb store (`access.db` → `ApiKeys`, empty), is container-internal,
and has no supported create path we could confirm. That endpoint is **not** a product path. A real
connector must use a path Litmus supports and documents.

## Supported paths to investigate (in rough priority order)

1. **Official Litmus API + token flow.** Confirm the documented external API + how to mint a valid
   integration token/credential for it (the *supported* analog of what `:8094` wants). Start from the
   Litmus Edge docs / central.litmus.io, not the internal service.
2. **MQTT / NATS egress (preferred for streaming).** Litmus Edge can publish device tags to a broker.
   A MIRA subscriber consumes them. This fits MIRA's architecture best and is the natural fit for the
   one-pipeline ingest contract.
3. **Supported DeviceHub / DataHub REST**, *if* a documented, externally-reachable read endpoint
   exists on this build (distinct from the internal `loopedge-access` socket).
4. **Export / push into a MIRA receiver.** A Litmus flow/connector that POSTs tag batches to a MIRA
   HTTP receiver (MIRA pulls nothing; Litmus pushes).
5. **Litmus edge application / container approach.** A small app running *inside* Litmus that has
   legitimate in-platform access and forwards to MIRA over a supported channel.

## Hard requirement — route through the one canonical ingest pipeline

Whatever egress path wins, the MIRA side MUST enter through the **one-pipeline contract** —
`mira-relay/ingest_contract.py` (`build_tag_entry` → `build_ingest_batch`) → `ingest_batch`
(`mira-relay/tag_ingest.py`). A Litmus transport is *a transport*, not a second ingest core: it
decodes its wire format and calls the contract. See `.claude/rules/one-pipeline-ingest.md`.

**Note:** the one-pipeline work is on **HOLD** (see memory `project_ingest_one_pipeline` — pending
#2280 staging green + #2281 merge). This connector is a follow-up to be built **after** that comes
off HOLD, or explicitly gated behind it. Until then, Litmus stays a bench/eval collector and MIRA
reads the conveyor via `--source plc`.

## Explicitly REJECTED approaches (do not build these)

- ❌ **Direct boltdb writes** to `access.db` (or any Litmus internal DB).
- ❌ Depending on the container-internal **`loopedge-access :8094`** read API.
- ❌ Treating **loopedge-auth** API keys as valid for **loopedge-access** (different stores).
- ❌ **Reverse-engineering gRPC** (`:9094`) as the default product path.
- ❌ Recreating the `le` container with `-p 8094:8094` as a "fix" (it wipes provisioning and still
  relies on an unsupported endpoint).

## Definition of done (for the future connector)

- MIRA receives CV-101 tag values via a **documented, supported** Litmus egress path.
- Credentials come from **env/secret** (Doppler), never committed, never printed.
- Ingest goes through `ingest_contract` → `ingest_batch` (one-pipeline law), read-only toward OT.
- A parity check shows the Litmus-sourced snapshot matches the `--source plc` snapshot for the same
  instant (same context model, same MIRA answer).

## Cross-references

- `docs/discovery/litmus_mira_demo_decision.md` — why `:8094` is not the path.
- `.claude/rules/one-pipeline-ingest.md` — the canonical ingest contract this must use.
- `.claude/rules/fieldbus-readonly.md` — read-only OT posture (no PLC writes).
- `plc/litmus/DEVICEHUB_API.md` (PR #2390 branch) — the reverse-engineered *write* API (bench-only).
