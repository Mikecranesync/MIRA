/**
 * draft-applicability.test.ts — real parsers + real builder, end to end (no mocks).
 *
 * Codex #5062 F1–F3: a packet must never show, as Verified, a torque value, procedure or kit
 * that the manual restricts to a different model or to an unresolved hardware variant.
 * Fixtures are the invented 9XP / 85-frame documents in ./fixtures — never real CAT documents.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { buildDraftPacket } from "../draft";
import type { DocText, DraftInput, Identity, WorkPacket as DraftPacket } from "../types";

function docFromText(raw: string, name: string, docId: string): DocText {
  const parts = raw.split(/\n?===== PAGE (\d+) =====\n/).slice(1);
  const pages: DocText["pages"] = [];
  for (let i = 0; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: parts[i + 1] });
  return { docId, fileId: null, filename: name, pages, via: "file" };
}

const docFromFixture = (name: string, docId: string) => docFromText(FIXTURES[name], name, docId);

function build(model: string, docs: DocText[], description: string): DraftPacket {
  const identity: Identity = { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 };
  const input: DraftInput = {
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-1",
    now: "2026-11-01T12:00:00Z",
    identity,
    workOrder: { id: "WO-1", title: "Service", description, assetTag: null, site: null, synthetic: true },
    docs,
    hazardFlags: [],
  };
  const result = buildDraftPacket(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("refused");
  return result.packet;
}

const plungerRetainer = (p: DraftPacket) => p.measurements.filter((m) => m.name.value === "Plunger Retainer").map((m) => m.value.value);

describe("F1 — a model-specific torque row replaces the general row for that model", () => {
  const manual = () => [docFromFixture("manual-35style.txt", "sm")];

  it("8560 gets only its own Plunger Retainer torque (90 in-lbs), not the general 220", () => {
    const values = plungerRetainer(build("8560", manual(), "replace plungers"));
    expect(values).toHaveLength(1);
    expect(values[0]).toContain("90 in-lbs");
  });

  it("another covered model (8520) keeps the general 220 in-lbs row", () => {
    const values = plungerRetainer(build("8520", manual(), "replace plungers"));
    expect(values).toHaveLength(1);
    expect(values[0]).toContain("220 in-lbs");
  });
});

describe("F2 — restricted or unresolved procedures are never admitted as applicable", () => {
  it("an '(8520 Only)' section never appears in an 8560 packet", () => {
    const text = FIXTURES["manual-35style.txt"].replace(
      "Reassembly (All models except 8560)",
      "Disassembly (8520 Only)\n1. Remove the eight-only bracket.\nReassembly (All models except 8560)",
    );
    const doc = docFromText(text, "manual-35style.txt", "sm");

    const for8560 = build("8560", [doc], "valve service").steps.map((s) => s.text.value);
    expect(for8560).not.toContain("Remove the eight-only bracket.");
    // control: the 8520 packet does get it
    const for8520 = build("8520", [doc], "valve service").steps.map((s) => s.text.value);
    expect(for8520).toContain("Remove the eight-only bracket.");
  });

  it("Hi-Pressure Seal and V-Packing alternatives are both left out and listed as Unknown, not shown as Verified steps", () => {
    const packet = build("9XP1000", [docFromFixture("manual-cpstyle.txt", "sm")], "reseal");
    const seals = packet.steps.filter((s) => s.topic === "seals").map((s) => s.text.value);
    expect(seals).not.toContain("Press the Seal Case into each seal chamber until completely seated.");
    expect(seals).not.toContain("Press Seal Case into each seal chamber until completely seated.");
    expect(seals).toContain("Remove the Manifold Head as described in SERVICING THE PUMPING SECTION.");
    const variantUnknowns = packet.unknowns.filter((u) => /Hi-Pressure Seal Models:|V-Packing Models:/.test(u.basis));
    expect(variantUnknowns).toHaveLength(2);
    expect(variantUnknowns.every((u) => u.label === "unknown" && u.value === null)).toBe(true);
  });
});

describe("F3 — kits are filtered by the models each kit row names", () => {
  const ds = () => [docFromFixture("datasheet-9xp1000.txt", "ds")];
  const kitNumbers = (p: DraftPacket) => p.parts.filter((x) => x.item === null).map((x) => x.partNumber.value);
  const itemParts = (p: DraftPacket) => p.parts.filter((x) => x.item !== null).map((x) => x.partNumber.value);

  it("9XP1000G (on the sheet, but on no kit row) gets neither kit nor their components, and the gap is reported", () => {
    const packet = build("9XP1000G", ds(), "reseal and valve service");
    expect(kitNumbers(packet)).not.toContain("300001");
    expect(kitNumbers(packet)).not.toContain("400001");
    expect(itemParts(packet)).not.toContain("100006");
    expect(itemParts(packet)).not.toContain("100007");
    expect(packet.unknowns.filter((u) => /No (seal|valve) kit for model 9XP1000G/.test(u.basis))).toHaveLength(2);
  });

  it("9XP1000CS gets the seal kit it is listed on, but not the 9XP1000-only valve kit", () => {
    const packet = build("9XP1000CS", ds(), "reseal and valve service");
    expect(kitNumbers(packet)).toContain("300001");
    expect(kitNumbers(packet)).not.toContain("400001");
  });

  it("control: 9XP1000 gets both kits", () => {
    const packet = build("9XP1000", ds(), "reseal and valve service");
    expect(kitNumbers(packet)).toEqual(expect.arrayContaining(["300001", "400001"]));
  });
});
