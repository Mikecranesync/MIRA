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

function attempt(model: string, docs: DocText[], description: string, catalogNumber: string | null = null, manufacturer: string | null = "CAT Pumps") {
  const identity: Identity = { manufacturer, model, catalogNumber, serialNumber: null, status: "user_confirmed", confidence: 0.9 };
  const input: DraftInput = {
    notebookId: "11111111-1111-4111-8111-111111111111",
    packetId: "pk-1",
    now: "2026-11-01T12:00:00Z",
    identity,
    workOrder: { id: "WO-1", title: "Service", description, assetTag: null, site: null, synthetic: true },
    docs,
    hazardFlags: [],
  };
  return buildDraftPacket(input);
}

function build(model: string, docs: DocText[], description: string, catalogNumber: string | null = null): DraftPacket {
  const result = attempt(model, docs, description, catalogNumber);
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

const M35 = FIXTURES["manual-35style.txt"];
const stepTexts = (p: DraftPacket) => p.steps.map((x) => x.text.value);

describe("F8 — torque conflicts are resolved across all attached manuals", () => {
  it("two manuals giving 8560 different Plunger Retainer torques: neither is shown, the conflict is listed", () => {
    const other = docFromText(M35.replace("Model 8560 Only M7 M14 Hex 90 7.5 10", "Model 8560 Only M7 M14 Hex 120 10 13.56"), "other.txt", "sm2");
    const packet = build("8560", [docFromFixture("manual-35style.txt", "sm"), other], "replace plungers");
    expect(plungerRetainer(packet)).toEqual([]);
    expect(packet.unknowns.some((u) => /more than one value for 'Plunger Retainer'/.test(u.basis))).toBe(true);
  });

  it("control: the same value in two manuals is shown once", () => {
    const packet = build("8560", [docFromFixture("manual-35style.txt", "sm"), docFromFixture("manual-35style.txt", "sm2")], "replace plungers");
    expect(plungerRetainer(packet)).toHaveLength(1);
    expect(plungerRetainer(packet)[0]).toContain("90 in-lbs");
  });
});

describe("F9 — a hardware heading keeps the model restriction of the phase it sits in", () => {
  const withBlock = (phase: string) =>
    docFromText(
      M35.replace(
        "Reassembly (All models except 8560)",
        `${phase}\nLo-Pressure Seal-All Models:\n1. Only 8520 low pressure step.\nReassembly (All models except 8560)`,
      ),
      "manual-35style.txt",
      "sm",
    );

  it("under 'Reassembly (Model 8520)': shown for 8520, never for 8560", () => {
    expect(stepTexts(build("8520", [withBlock("Reassembly (Model 8520)")], "valve service"))).toContain("Only 8520 low pressure step.");
    expect(stepTexts(build("8560", [withBlock("Reassembly (Model 8520)")], "valve service"))).not.toContain("Only 8520 low pressure step.");
  });

  it("under 'Reassembly (All models except 8560)': excluded for 8560", () => {
    const doc = withBlock("Reassembly (All models except 8560)");
    expect(stepTexts(build("8560", [doc], "valve service"))).not.toContain("Only 8520 low pressure step.");
    expect(stepTexts(build("8520", [doc], "valve service"))).toContain("Only 8520 low pressure step.");
  });
});

describe("F10 — restrictions are judged against the identifier the documents name", () => {
  it("model '85PFR' + catalog '8560' gives the same torque and steps as model '8560'", () => {
    const viaCatalog = build("85PFR", [docFromFixture("manual-35style.txt", "sm")], "replace plungers and valve service", "8560");
    const direct = build("8560", [docFromFixture("manual-35style.txt", "sm")], "replace plungers and valve service");
    expect(plungerRetainer(viaCatalog)).toEqual(plungerRetainer(direct));
    expect(plungerRetainer(viaCatalog)[0]).toContain("90 in-lbs");
    expect(stepTexts(viaCatalog)).toEqual(stepTexts(direct));
    expect(stepTexts(viaCatalog)).not.toContain("Remove the six (6) M41 Hex Valve Plugs.");
  });

  it("model and catalog number naming two different documented pumps is refused", () => {
    const r = attempt("8520", [docFromFixture("manual-35style.txt", "sm")], "replace plungers", "8560");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("identity_not_confirmed");
  });
});

describe("F11 — each kit-number row keeps its own models", () => {
  const SHEET = FIXTURES["datasheet-9xp1000.txt"];
  const WRAPPED = "9XP1000,\n9XP1000CS 300001 300011 * 300021";
  // The kit number itself (not a kit component): its part-number row cites the kit-number line.
  const sealKits = (p: DraftPacket) =>
    p.parts.filter((x) => x.kit === "seal" && x.item === null && /^Standard material/.test(x.partNumber.basis)).map((x) => x.partNumber.value);

  it("separate rows for 9XP1000 and 9XP1000CS: each model gets only its own seal kit", () => {
    expect(SHEET).toContain(WRAPPED);
    const doc = docFromText(SHEET.replace(WRAPPED, "9XP1000 300001 300011 300021\n9XP1000CS 310001 310011 310021"), "ds.txt", "ds");
    expect(sealKits(build("9XP1000", [doc], "reseal"))).toEqual(["300001"]);
    expect(sealKits(build("9XP1000CS", [doc], "reseal"))).toEqual(["310001"]);
  });

  it("a second row that names no model is refused as ambiguous, never applied to every model", () => {
    const doc = docFromText(SHEET.replace(WRAPPED, "9XP1000 300001 300011 300021\n310001 310011 310021"), "ds.txt", "ds");
    const packet = build("9XP1000", [doc], "reseal");
    expect(sealKits(packet)).toEqual([]);
    expect(packet.unknowns.some((u) => /No seal kit for model 9XP1000/.test(u.basis))).toBe(true);
  });

  it("control: a wrapped model list sharing one row still gives both models that kit", () => {
    const doc = docFromFixture("datasheet-9xp1000.txt", "ds");
    expect(sealKits(build("9XP1000", [doc], "reseal"))).toEqual(["300001"]);
    expect(sealKits(build("9XP1000CS", [doc], "reseal"))).toEqual(["300001"]);
  });
});

describe("F12 — a procedure the parser had to leave out is listed as a gap", () => {
  const GOOD = "1. Remove the six (6) M41 Hex Valve Plugs.\n2. Remove the exposed Coil Spring";
  const garbled = () => {
    expect(M35).toContain(GOOD);
    return docFromText(M35.replace(GOOD, "1. Remove the six (6) M41 Hex Valve Plugs.\n3. Remove the exposed Coil Spring"), "manual-35style.txt", "sm");
  };

  it("scrambled disassembly steps: left out, and the packet names the missing disassembly", () => {
    const packet = build("8520", [garbled()], "valve service");
    expect(stepTexts(packet)).not.toContain("Remove the six (6) M41 Hex Valve Plugs.");
    expect(stepTexts(packet).some((t) => (t ?? "").startsWith("Examine the O-Rings"))).toBe(true); // reassembly survives
    const gap = packet.unknowns.filter((u) => /SERVICING THE VALVES — Disassembly \(All models except 8560\).*could not be read reliably/.test(u.basis));
    expect(gap).toHaveLength(1);
    expect(gap[0].label).toBe("unknown");
    expect(gap[0].source?.page).toBe(2);
  });

  it("control: the gap is not listed for 8560, which that section excludes", () => {
    const packet = build("8560", [garbled()], "valve service");
    expect(packet.unknowns.some((u) => /could not be read reliably/.test(u.basis))).toBe(false);
  });

  it("control: the intact manual lists no such gap", () => {
    const packet = build("8520", [docFromFixture("manual-35style.txt", "sm")], "valve service");
    expect(packet.unknowns.some((u) => /could not be read reliably/.test(u.basis))).toBe(false);
  });
});

describe("F14 — only a CAT Pumps machine gets a packet from CAT Pumps documents", () => {
  const manual = () => [docFromFixture("manual-35style.txt", "sm")];

  it("another manufacturer with a model number the CAT manual names is refused by name", () => {
    const result = attempt("8560", manual(), "replace plungers", null, "Other Pump Manufacturer");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("manufacturer_not_supported");
    expect(result.message).toContain("Other Pump Manufacturer");
  });

  it("a blank manufacturer is refused, and 'Caterpillar' or a bare 'Cat' is not taken for CAT Pumps", () => {
    for (const m of [null, "", "Caterpillar", "Cat"]) {
      const result = attempt("8560", manual(), "replace plungers", null, m);
      expect(result.ok ? "ok" : result.reason).toBe("manufacturer_not_supported");
    }
  });

  it("control: CAT Pumps spelled as on a nameplate or invoice is accepted", () => {
    for (const m of ["CAT Pumps", "Cat Pumps", "CAT PUMPS", "Cat Pumps Inc."]) {
      expect(attempt("8560", manual(), "replace plungers", null, m).ok).toBe(true);
    }
  });
});

describe("a step worded for one model is shown only for that model (5CP6120 real-manual re-check)", () => {
  const LAST = "2. Remove the exposed Coil Spring from the top of the Spring Retainer.";
  const doc = () => {
    expect(M35).toContain(LAST);
    return docFromText(M35.replace(LAST, `${LAST}\n3. On the model 8527 remove the extra shim.`), "manual-35style.txt", "sm");
  };

  it("'On the model 8527 …' is left out of an 8520 packet", () => {
    expect(stepTexts(build("8520", [doc()], "valve service"))).not.toContain("On the model 8527 remove the extra shim.");
  });

  it("control: the 8527 packet keeps it, and the section's other steps stay for 8520", () => {
    expect(stepTexts(build("8527", [doc()], "valve service"))).toContain("On the model 8527 remove the extra shim.");
    expect(stepTexts(build("8520", [doc()], "valve service"))).toContain("Remove the six (6) M41 Hex Valve Plugs.");
  });
});

describe("F15 — text after a step or caution that cannot be placed turns that block into a gap", () => {
  // Old page 3 becomes page 4; each edit may insert a new "===== PAGE 3 =====" break into page 2.
  const edited = (...edits: [string, string][]) => {
    let text = M35.replace("===== PAGE 3 =====", "===== PAGE 4 =====");
    for (const [from, to] of edits) {
      expect(text).toContain(from);
      text = text.replace(from, to);
    }
    return docFromText(text, "manual-35style.txt", "sm");
  };
  const STEP2 = "2. Remove the exposed Coil Spring from the top of the Spring Retainer.\n";
  const CAUTION_TAIL = "shut off drive (electric motor, gas or diesel engine) and turn off water supply to\npump. Relieve all discharge line pressure by triggering gun or opening valve in discharge line.\n";
  const placeGaps = (p: DraftPacket, section: RegExp) => p.unknowns.filter((u) => section.test(u.basis) && /could not be placed/.test(u.basis));
  const noPlaceGap = (p: DraftPacket) => p.unknowns.some((u) => /could not be placed/.test(u.basis)) || p.safety.cautions.some((c) => /could not be placed/.test(c.basis ?? ""));

  it("a step split after a parenthetical: no verified fragment, one gap for that section", () => {
    const doc = edited([STEP2, "2. Remove the valve plug (M41)\n===== PAGE 3 =====\nonly after relieving all system pressure.\n"]);
    const packet = build("8520", [doc], "valve service");
    expect(stepTexts(packet).some((t) => (t ?? "").startsWith("Remove the valve plug"))).toBe(false);
    expect(stepTexts(packet)).not.toContain("Remove the six (6) M41 Hex Valve Plugs.");
    const gap = placeGaps(packet, /Disassembly \(All models except 8560\)/);
    expect(gap).toHaveLength(1);
    expect(gap[0].label).toBe("unknown");
    expect(gap[0].source?.page).toBe(2);
  });

  it("a caution split after a parenthetical: not verified, one unknown Safety line citing page 2", () => {
    const doc = edited([CAUTION_TAIL, "shut off drive (electric motor)\n===== PAGE 3 =====\nand relieve all discharge pressure.\n"]);
    const packet = build("8520", [doc], "valve service");
    expect(packet.safety.cautions.some((c) => c.label === "verified" && (c.value ?? "").startsWith("Before commencing"))).toBe(false);
    const gap = packet.safety.cautions.filter((c) => c.label === "unknown" && /CAUTION on p\.2 .*could not be placed/.test(c.basis ?? ""));
    expect(gap).toHaveLength(1);
  });

  it("a multi-sentence step split after a full stop: its section is a gap", () => {
    const doc = edited([
      "2. Slowly thread the Valve Plug into chamber. Then torque to\nspecifications per chart.\n",
      "2. Slowly thread the Valve Plug into chamber.\n===== PAGE 3 =====\nThen torque to specifications per chart.\n",
    ]);
    const packet = build("8520", [doc], "valve service");
    expect(stepTexts(packet).some((t) => (t ?? "").startsWith("Slowly thread the Valve Plug"))).toBe(false);
    expect(placeGaps(packet, /Reassembly \(All models except 8560\)/)).toHaveLength(1);
  });

  it("an unfinished step, then a diagram and a caption run, then the rest on the next page: furniture skipped, the continuation still makes a gap", () => {
    const doc = edited([
      STEP2,
      "2. Remove the valve plug and\n1 3 5 7 8 6 4 2\n8520, 8521\nRemoval of Valve Plug\n===== PAGE 3 =====\nonly after relieving all system pressure.\n",
    ]);
    const packet = build("8520", [doc], "valve service");
    expect(stepTexts(packet).some((t) => (t ?? "").startsWith("Remove the valve plug"))).toBe(false);
    const gap = placeGaps(packet, /Disassembly \(All models except 8560\)/);
    expect(gap).toHaveLength(1);
    expect(gap[0].basis).toContain("only after relieving");
  });

  it("control: the intact manual keeps the step and the caution as verified", () => {
    const packet = build("8520", [docFromFixture("manual-35style.txt", "sm")], "valve service");
    expect(stepTexts(packet)).toContain("Remove the exposed Coil Spring from the top of the Spring Retainer.");
    expect(packet.safety.cautions.some((c) => c.label === "verified" && (c.value ?? "").startsWith("Before commencing"))).toBe(true);
    expect(noPlaceGap(packet)).toBe(false);
  });

  it("control: a page that starts with a page header and then step 3 makes no gap", () => {
    const doc = edited([STEP2, `${STEP2}===== PAGE 3 =====\nPN 993999 Rev A 1/24\n3. Remove the Valve Seat.\n`]);
    const packet = build("8520", [doc], "valve service");
    expect(stepTexts(packet)).toContain("Remove the Valve Seat.");
    expect(noPlaceGap(packet)).toBe(false);
  });

  it("control: intro prose before a section's step 1 makes no gap", () => {
    const doc = edited(["Reassembly (All models except 8560)\n", "Reassembly (All models except 8560)\nUse only genuine parts when servicing the valves.\n"]);
    const packet = build("8520", [doc], "valve service");
    expect(stepTexts(packet).some((t) => (t ?? "").startsWith("Examine the O-Rings"))).toBe(true);
    expect(noPlaceGap(packet)).toBe(false);
  });
});
