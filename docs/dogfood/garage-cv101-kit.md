# Garage CV-101 dogfood kit

Everything needed to make the garage conveyor a properly identified asset before the first
walk. One rig, one identity, applied in one order.

**Parents:** `docs/specs/mira-technician-app-dogfood-system.md` (what the system must be) ·
`docs/plans/2026-08-23-conveyor-localization-and-live-data-plan.md` (the slice program; this is
its I1) · `docs/adr/0035-cv101-canonical-uns-path.md` (the identity authority, as amended
2026-08-23).

---

## 1. The identity

| Layer | Value | Lives in |
|---|---|---|
| Internal key | the row UUID | `cmms_equipment.id`, mirrored to `kg_entities.entity_id` |
| Human handle | **`CV-101`** | `cmms_equipment.equipment_number` — the QR sticker, search, speech |
| Canonical asset key | `cv_101` | **derived** (`slug(equipment_number)`); recorded in `properties->>'canonical_key'` for display only |
| Alias key the bot reads | `CV-101` | `kg_entities.properties->>'asset_tag'` |
| Display name | **`Discharge Conveyor`** | `kg_entities.name` and `cmms_equipment.description` |
| Signal address | `enterprise.home_garage.conveyor_lab.conveyor_1` | `approved_tags`, `tag_events`, `live_signal_cache` |
| Ingest source | `cv101-bench-gw` | `tag_events.source_connection_id` |

**The display name is `Discharge Conveyor`, not a new name.** ADR-0035 §1 fixes it and dogfood
spec §19 makes that ADR the authority, requiring references to follow it "rather than duplicating
or casually renaming its values". The conveyor plan's suggestion of "Garage Bench Conveyor CV-101"
is therefore **not** adopted.

**`CV-200` / the Northwind surface is the same physical rig**, published a second time as another
tenant onto a different UNS subtree (`tools/seeds/approved_tags_northwind_cv200.sql:5-10`). It is a
presentation alias, not a second conveyor.

## 2. What the identity seed repairs

`tools/seeds/dogfood-cv101-identity.sql` — additive, idempotent, one transaction:

1. **Promotes the bridge row to `verified`.** `kg_entities.approval_state` defaults to `'proposed'`
   and the bridge seed omits the column, while every KG-grounded reader requires `'verified'`. Until
   this runs, the conveyor's graph context silently resolves to nothing.
2. **Adds `properties->>'asset_tag' = 'CV-101'`** — the alias key that is actually read
   (`mira-bots/shared/demo_namespace.py:205`). The bridge seed wrote `equipment_number`, which zero
   readers read.
3. **Replaces the label in both places.** Both currently hold
   `"Conv_Simple Bench Conveyor (staging probe seed 2026-08-02, PRD #3048 PR 5)"` — a changelog
   string that renders as the machine's name on the QR card. Two UPDATEs are required because
   `kg_entities.name` was materialised at bridge-INSERT time and nothing propagates a later
   `description` change.

It never writes `entity_id`. `tests/test_dogfood_cv101_identity_seed.py` pins that mechanically,
and the ADR amendment explains why writing `cv_101` there would blank three working surfaces
without raising a single error.

## 3. Apply order

Both seeds are tenant-parameterised. Pass the tenant that owns the CV-101 row — **not** the seed's
built-in default, unless that is genuinely your tenant.

```bash
# 1. bridge row (asset ↔ KG ↔ uns_path). Skip if kg_entities already has it.
gh workflow run apply-seeds.yml -f target=staging \
  -f seeds=garage-cv101-kg-bridge -f tenant_id=<tenant-uuid> -f mode=apply

# 2. identity repair
gh workflow run apply-seeds.yml -f target=staging \
  -f seeds=dogfood-cv101-identity -f tenant_id=<tenant-uuid> -f mode=apply
```

Run `mode=dry-run` first; it prints the seed header, which is the operator runbook.

**⚙ Production is Mike's dispatch.** Verification afterwards is a read-only `db-inspect.yml` probe
showing the CV-101 KG row at `approval_state='verified'` with a non-null `uns_path`. Until that
probe is green, every "at the conveyor" result is a staging result.

## 4. What this kit deliberately does not rename

Four rival UNS paths exist for this rig. They are recorded, not renamed:

| Path | Where |
|---|---|
| `enterprise.garage.demo_cell.cv_101` | `tools/seeds/tag_scaling_gs10.sql:64`, `ignition/tags/mira_config_conveyor.json:23` |
| `enterprise.garage.demo_cell.bottling_demo.cv_101` | `plc/conv_simple_anomaly/context_model.cv101.json:16` |
| computed variants | `mira-crawler/ingest/config/bench_uns_map.json`, `tools/create_bench_equipment_node.py` |

ADR-0035 requires any UNS rename to be one atomic seven-part migration; a partial rename is the
failure it exists to prevent. Reconciling these is a separate, tracked piece of work.

## 5. QR sticker

The sticker encodes `https://app.factorylm.com/m/CV-101`. Print from `/assets/print-qr` in the Hub.

**Known gap (plan Stream 1):** production nginx routes `/m/` to `mira-web` on port 3200 while the
Hub is on 3101, so a scan currently lands on a "Register equipment" page rather than the Hub's
asset card. Verified live. The sticker itself is correct and permanent
(`012_qr_permanent_binding.sql`) — do not reprint when the routing is fixed.

---

## 6. Attaching the print set (I6)

```bash
node tools/dogfood/seed-cv101-notebook-sources.mjs \
  --base https://app.factorylm.com \
  --email you@example.test --password '…' \
  --notebook <the conveyor's notebook uuid>
```

Attaches three files and refuses to report success unless each one indexed:

| File | Chunks (staging) |
|---|---|
| `docs/onboarding/cv-101-evidence/cv101_print.pdf` | 1 |
| `docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf` | 6 |
| `plc/conv_simple_electrical/sheets/CV-101_print_set.pdf` | 49 |

**Why a script and not a SQL seed.** Retrieval filters `ingest_route = 'v2'`
(`manual-rag.ts:506,542`), a value only the real parser writes
(`node-knowledge-ingest.ts:406`), and `apply-seeds.yml` notes SQL-seeded chunks land with
`embedding = NULL`. A seeded row would sit in the table looking attached and never be citable —
failing as silence, which is the worst way for evidence to fail.

**Why not the asset page.** `validateTargetTx` returns `nodeId: null` for `cmms_asset`
(`workspace-files.ts:396-402`) and the Files route gates indexing on having a node, so a file
uploaded against an asset parks and never becomes citable. That is what mobile's asset Detail
upload does today.

**A bare 200 is not success.** The door returns `ok: true, indexed: false` when bytes parked but
never indexed. The script treats only `indexed: true` as a pass and exits non-zero otherwise.

### Honest limits

- **This does not close [#3218](https://github.com/Mikecranesync/MIRA/issues/3218).** One cited
  answer is not proof the whole print set is retrievable. It proves the door works and that at
  least one real passage is reachable.
- **`cv101_print.pdf` yields exactly one chunk** from a 130 KB single-page drawing. It is mostly
  vector geometry with a thin text layer, so treat it as a diagram with a caption, not as a
  searchable document. The 9-sheet `CV-101_print_set.pdf` (49 chunks) is the one that answers
  questions.
- The notebook chat path is **online-only**; there is no offline answer.

### Proof (staging, 2026-08-23)

Question: *"What PLC model controls this conveyor and what role does it have"*

> Allen-Brad­ley Micro820 2080-LC20-20QBB is the PLC model, and it serves as the conveyor
> controller and Modbus RTU master to VFD1 **[1]**
> — cited to `CV-101_print_set.pdf` p.1

That matches the print's own device schedule row (`PLC1 | plc | Allen-Bradley Micro820
2080-LC20-20QBB | Conveyor controller; Modbus RTU master`), read out of the PDF independently
before the question was asked.
