/**
 * The provisional inventory seed (Mike 2026-11-14: "The old device schedule is the
 * starting checklist"; en04m6bb: label it provisional, never hard-code the count).
 * Every schedule tag becomes a row; nothing a technician did not read off the part
 * is saved as a label or an identity; a second run adds nothing.
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/seed.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runSeed, seedInputs, seedRequestId, type InventoryRow } from "../seed";

const HUB = path.resolve(__dirname, "../../../..");
const inventory = JSON.parse(readFileSync(path.join(HUB, "scripts/data/cv101-provisional-inventory.json"), "utf8")) as {
  inventory: string;
  rows: InventoryRow[];
};
const NB = "22222222-2222-4222-8222-222222222222";
const NB2 = "33333333-3333-4333-8333-333333333333";

/** The schedule's devices: tag, type, and the model line verbatim (one line per field in this file). */
function scheduleDevices(): { tag: string; type: string; model: string | null; io: string | null }[] {
  const text = readFileSync(path.join(HUB, "../plc/conv_simple_electrical/model/devices.yaml"), "utf8");
  const out: { tag: string; type: string; model: string | null; io: string | null }[] = [];
  for (const line of text.split("\n")) {
    const tag = /^ {2}- tag: (\S+)\s*$/.exec(line);
    if (tag) {
      out.push({ tag: tag[1], type: "", model: null, io: null });
      continue;
    }
    const field = /^ {4}(type|model|io): (.+?)\s*$/.exec(line);
    if (field && out.length > 0) {
      const d = out[out.length - 1];
      if (field[1] === "type") d.type = field[2].replace(/\s+#.*$/, "");
      else if (field[1] === "model") d.model = field[2];
      else d.io = field[2];
    }
  }
  return out;
}

describe("the provisional inventory", () => {
  const devices = scheduleDevices();

  it("is labelled provisional", () => {
    expect(inventory.inventory).toMatch(/provisional/i);
  });

  it("has every tag on the old device schedule as a schedule row, quoting only its model line", () => {
    expect(devices.length).toBeGreaterThan(0);
    for (const d of devices) {
      const row = inventory.rows.find((r) => r.key === d.tag);
      expect(row, d.tag).toBeDefined();
      expect(row).toMatchObject({ localTag: d.tag, kind: d.type, origin: "device_schedule" });
      if (d.model) expect(row!.note, d.tag).toContain(`"${d.model}"`);
      else expect(row!.note, d.tag).toContain("names no model");
    }
    // The schedule's I/O line is not copied: PLC1's "7 relay DO" is a suspected wrong-model row (F31).
    const plc = devices.find((d) => d.tag === "PLC1")!;
    expect(plc.io).toContain("relay DO");
    for (const r of inventory.rows) expect(r.note).not.toContain("relay DO");
  });

  it("adds parts the schedule missed as inventory rows, with no invented tag", () => {
    const tags = new Set(devices.map((d) => d.tag));
    const extra = inventory.rows.filter((r) => r.origin === "inventory");
    expect(extra.length).toBeGreaterThan(0);
    for (const r of extra) {
      expect(tags.has(r.key), r.key).toBe(false);
      expect(r.localTag, r.key).toBeNull();
      expect(r.note).toMatch(/^Not on the old device schedule\./);
    }
    expect(inventory.rows.length).toBe(devices.length + extra.length);
    expect(new Set(inventory.rows.map((r) => r.key)).size).toBe(inventory.rows.length);
  });
});

describe("seedInputs", () => {
  it("saves every row unconfirmed, with no label text and no identity field; the note is kept whole", () => {
    const inputs = seedInputs(NB, inventory.rows);
    expect(inputs).toHaveLength(inventory.rows.length);
    inputs.forEach((i, n) => {
      const row = inventory.rows[n];
      expect(i.position).toBe(n);
      expect(row.note.length).toBeLessThanOrEqual(1000);
      expect(i.revision).toEqual({
        rawLabel: null,
        inputKind: row.origin === "device_schedule" ? "schedule" : "inventory",
        manufacturer: null, family: null, catalogNumber: null, serialNumber: null, hardwareRevision: null,
        localTag: row.localTag,
        identityStatus: "unknown",
        unresolved: [],
        evidenceFileId: null,
        evidenceNote: row.note,
      });
    });
  });

  it("fixes each row's request id by project and row, so a second run is the same request", () => {
    const a = seedInputs(NB, inventory.rows).map((i) => i.clientRequestId);
    expect(seedInputs(NB, inventory.rows).map((i) => i.clientRequestId)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    for (const id of a) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Control: another project gets its own ids for the same rows.
    const b = seedInputs(NB2, inventory.rows).map((i) => i.clientRequestId);
    expect(b.filter((id) => a.includes(id))).toEqual([]);
    expect(seedRequestId(NB, "PLC1")).toBe(a[0]);
  });
});

describe("runSeed", () => {
  const inputs = seedInputs(NB, inventory.rows.slice(0, 3));

  it("stops at the first refusal so a wrong project is not half-seeded", async () => {
    const add = vi.fn()
      .mockResolvedValueOnce({ status: "created", component: {} })
      .mockResolvedValueOnce({ status: "request_id_conflict" });
    const out = await runSeed(add, inputs);
    expect(out).toEqual([{ key: inputs[0].key, status: "created" }, { key: inputs[1].key, status: "request_id_conflict" }]);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("control: a rerun that finds every row goes to the end", async () => {
    const add = vi.fn().mockResolvedValue({ status: "existing", component: {} });
    expect((await runSeed(add, inputs)).map((o) => o.status)).toEqual(["existing", "existing", "existing"]);
  });
});
