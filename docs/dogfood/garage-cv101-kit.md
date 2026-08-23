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
