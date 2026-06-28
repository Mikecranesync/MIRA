# Sparkplug B MQTT consumer — runbook (Lane 3, Phase 3b)

**What this is, in plain English.** The standard industrial way to get PLC tags
into software is *not* a custom HTTP script — it's **Sparkplug B over MQTT**:
Ignition (the SCADA platform already reading your Micro820) publishes tags to an
MQTT broker, and a consumer subscribes. This consumer is that subscriber for
FactoryLM/MIRA. It decodes Sparkplug B and lands tags into the **same**
`tag_events` + `live_signal_cache` the HTTP relay uses — so live tags, historian,
trending, and the run-diff flight recorder all work regardless of how a tag
arrived. The custom HTTP relay stays as the bench/dev fallback.

```
Micro820 ──CIP──▶ Ignition ──MQTT Transmission (Sparkplug B)──▶ Mosquitto
                                                                   │  subscribe (read-only)
                                                                   ▼
                                        mira-sparkplug-consumer (mqtt_ingest)
                                                                   │  decode → canonical batch
                                                                   ▼
                                  tag_ingest.ingest_batch  ──▶  tag_events + live_signal_cache
                                  (allowlist · normalize · provenance · persist — the ONE pipeline)
```

Code: `mira-relay/mqtt_ingest/` (`config.py`, `decode.py`, `subscriber.py`,
`codecs/sparkplug_b.py`, `run.py`). Design: `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md`.

---

## 1. Run it WITHOUT Ignition (fake Sparkplug payloads)

Everything decodes through `codecs/sparkplug_b.py`, which has an encoder for
exactly this. The unit tests are the canonical "no broker, no Ignition" demo:

```bash
cd mira-relay
python -m pytest tests/test_sparkplug_codec.py tests/test_sparkplug_decoder.py \
                 tests/test_sparkplug_consumer.py -q
```

To exercise the decode → canonical-batch path interactively:

```python
from mqtt_ingest.codecs import sparkplug_b as spb
from mqtt_ingest.decode import SparkplugDecoder

dec = SparkplugDecoder()
birth = spb.encode_payload([
    spb.encode_metric(name="Conveyor/VFD_Hz", alias=2, datatype=spb.DT_FLOAT, value=60.0),
])
print(dec.handle("spBv1.0/FactoryLM/DBIRTH/ConveyorEdge/Conv_Simple", birth).entries)
# DDATA then carries alias 2 + a new value; the decoder resolves it via BIRTH.
```

## 2. Point the consumer at a local Mosquitto

```bash
# A local broker (matches the bench fault-detective broker: anonymous, 1883):
docker run --rm -p 1883:1883 eclipse-mosquitto:2.0 \
    sh -c 'printf "listener 1883\nallow_anonymous true\n" > /m.conf; mosquitto -c /m.conf'

# Run the consumer against it (NEON_DATABASE_URL = your staging Neon; or dry-run):
cd mira-relay
MQTT_INGEST_TENANT_ID=<tenant-uuid> \
MQTT_INGEST_BROKER_HOST=localhost \
MQTT_INGEST_SOURCE_SYSTEM=ignition \
MQTT_INGEST_DRY_RUN=1 \            # decode + log only; flip to 0 to write
python -m mqtt_ingest
```

`MQTT_INGEST_DRY_RUN=1` decodes and logs without touching the DB — the safest
first run. All knobs are documented in `mira-relay/mqtt_ingest/config.py`
(`MQTT_INGEST_*`): broker host/port, TLS, user/pass, group/edge/device filters,
flush window/size, auto-discover, debug.

## 3. Configure Ignition MQTT Transmission (the real producer) — later

This is the only manual, GUI step and it lives in Ignition, not this repo:

1. In the Ignition Gateway, install the **Cirrus Link MQTT Transmission** module.
2. **Transmission → Settings → Servers:** add your broker URL
   (`tcp://<broker-host>:1883`, or `ssl://…:8883` with TLS). Set credentials if
   the broker requires them.
3. **Transmission → Settings → Transmitters:** set the **Group ID** (e.g.
   `FactoryLM`), **Edge Node ID** (e.g. `ConveyorEdge`), and the **tag tree path**
   to publish (point it at the conveyor tag folder). Leave it **read/report-only**
   — do NOT enable command (writeable) tags; this consumer is ingest-only.
4. Save. Ignition emits NBIRTH/DBIRTH (with the alias table) then NDATA/DDATA.
5. Set the consumer's `MQTT_INGEST_GROUP_IDS` / `MQTT_INGEST_EDGE_NODES` to match.

**MQTT Explorer** (free desktop app) pointed at the broker is the best way to
*see* the `spBv1.0/...` topic tree and confirm Ignition is publishing.

## 4. Verify tags are arriving

- Consumer logs print per-flush counters: `accepted=… events=… rejected=… cache_skipped=…`.
- `rejected=… not_allowlisted` means the tag isn't in `approved_tags` yet (§6).
- In the DB: `SELECT count(*), max(event_timestamp) FROM tag_events WHERE source_system='ignition';`

## 5. See the latest live tag values

The consumer upserts `live_signal_cache`, which the Historian read API serves:

```
GET /api/historian/tags/live           # list_tags → latest value per tag
GET /api/historian/tags/{tag}?start=…&end=…&interval=…   # history
POST /api/historian/trends             # bucketed trends across tags
```

These are the same endpoints the Hub Command Center live-tag view reads — a
Sparkplug-sourced tag shows up there with no extra wiring.

## 6. Approve / contextualize a discovered tag

Ingest is **fail-closed**: a tag whose normalized path isn't in `approved_tags`
is rejected, never stored. Two ways a tag becomes trusted:

- **Seed it** (the deliberate path): generate the allowlist from the node's BIRTH
  metric set with **`tools/seeds/gen_approved_tags_sparkplug.py`** — it builds each
  row with the *same* `metric_to_tag_path` + `normalize_tag_path` the live
  subscriber uses, so the normalized keys match exactly (the §5 fail-closed
  contract; pinned by `tests/test_sparkplug_seed.py`). The Conv_Simple discharge
  demo node is built in; run it, then apply staging-first then prod:
  ```bash
  python tools/seeds/gen_approved_tags_sparkplug.py --tenant <tenant-uuid>
  # → tools/seeds/approved_tags_sparkplug_conveyoredge.sql  (11 rows, enabled=true)
  psql "$STAGING_URL" -f tools/seeds/approved_tags_sparkplug_conveyoredge.sql
  ```
  Copy the `CONVEYOR_NODE` manifest in the generator for another edge node.
- **Auto-discover** (set `MQTT_INGEST_AUTO_DISCOVER=1`): an unknown tag is recorded
  as **seen/proposed** — an `approved_tags` row with `enabled=false`. It is
  visible for a human to review but, being disabled, stays rejected and is **never
  historized**. Promote it by flipping `enabled=true`. (ON CONFLICT DO NOTHING
  means discovery never disables an already-approved tag.)

Lifecycle: `seen/proposed` (enabled=false) → `approved/historized` (enabled=true).

## 7. Historize / trend an approved tag

Once `enabled=true`, the tag flows into `tag_events`. The **tag-diff historizer**
(`mira-historian-worker`/`-beat`, every 5 min) turns it into `tag_event_diffs`,
and the Historian trends API (§5) serves history/trends — no extra steps.

## 8. How this feeds the MIRA flight recorder / run-diff

The run engine (`mira-crawler/run_engine/`, task `historize_runs`) reads
`tag_events` and parses each row into a `Reading` (numeric value + timestamp +
uns_path). A Sparkplug-ingested numeric conveyor tag (e.g. `Conveyor/VFD_Hz`,
`value_type=float`) is therefore run-diff-ready with no new code: set
`MIRA_RUN_TRIGGERS="<uns_path>=<tag>:<threshold>"` and `MIRA_RUN_DIFF_ENABLED=1`.
The discharge-demo tags (photo eye, motor running, VFD frequency, VFD comm OK,
amber LED, start button, discharge request/accepted/complete/timeout) all land
the same way once allowlisted.

## 9. The old custom relay still works (fallback)

Nothing here changes the HTTP relay. `POST /api/v1/tags/ingest` (SimLab's
`RelayIngestPublisher`, the Ignition `tag-stream.py` timer) still lands through
the identical `ingest_batch`. The 174 relay + 86 SimLab tests pass unchanged.
Use the relay for bench/dev/simulator; use Sparkplug for live industrial feeds.

---

## Deploy (opt-in)

The consumer is gated behind the **`sparkplug` compose profile** and is **not** in
`deploy-vps.yml` TARGETS, so it never auto-starts:

```bash
# On the host, after setting MQTT_INGEST_* (esp. TENANT_ID + BROKER_HOST) in Doppler:
docker compose -f docker-compose.saas.yml --profile sparkplug up -d --build mira-sparkplug-consumer
docker logs -f mira-sparkplug-consumer
```

Broker reachability: `mira-mosquitto` is on the fault-detective `core-net` today.
Either join that network or point `MQTT_INGEST_BROKER_HOST` at a broker reachable
from `mira-net` before enabling.

## Security / read-only guarantees

- **Subscribe only.** The consumer never publishes; NCMD/DCMD topics are dropped,
  not acted on (`.claude/rules/fieldbus-readonly.md`). Live PLC writes are out of scope.
- **No secrets in code or logs.** Broker credentials come from env;
  `SparkplugConfig.redacted()` is what gets logged.
- **Tenant from config, never the topic.** One consumer ↔ one `(tenant, broker)`;
  a Sparkplug topic cannot set or spoof the tenant. RLS + the fail-closed allowlist
  keep tenants isolated.
- **Unknown tags are not trusted evidence.** They enter as `seen` (disabled) and
  are never historized until a human approves them.
