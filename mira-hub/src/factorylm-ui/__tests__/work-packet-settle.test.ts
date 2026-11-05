/**
 * F17 + F18: the "what is still open" count tells the truth.
 * F18 — it counts every open item: who may do the job (qualifications), return-to-service acceptance
 * limits, and an issue the technician recorded and has not closed; and it does not say "the documents
 * do not give it" for text that could not be read.
 * F17 — an open question has a way to be settled: a technician enters the answer and where it came
 * from; the count follows. Settled answers stay Proposed, never Verified. Confirm alone settles nothing.
 * Fixture is invented (85-frame manual).
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-settle
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import { applyEdit } from "@/capabilities/work-packet/edits";
import { addNote, emptyRecord } from "@/capabilities/work-packet/job-record";
import type { Field, WorkPacket } from "@/capabilities/work-packet/types";
import { readinessSummary } from "../work-packet-v2-view";
import { technicianEntryNote } from "../work-packet-view";

const AT = "2026-11-03T12:00:00Z";
function packet(): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk", now: AT,
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO", title: "Reseal", description: "Pump leaking at the shaft — reseal it.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(FIXTURES["manual-85v2.txt"]), via: "file" }], hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}
const unk = (basis: string, extra: Partial<Field> = {}): Field => ({ value: null, label: "unknown", source: null, basis, ...extra });
/** A packet whose only open items are the ones a test puts in. */
function bare(over: Partial<WorkPacket> = {}): WorkPacket {
  const p = packet();
  return { ...p, blockers: [], unknowns: [], qualifications: [], restoration: [], safety: { ...p.safety, cautions: p.safety.cautions.filter((c) => c.label !== "unknown") }, ...over };
}
const line = (p: WorkPacket, re: RegExp, record?: Parameters<typeof readinessSummary>[1]) => readinessSummary(p, record).lines.find((l) => re.test(l));

describe("F18 — the count includes every open item", () => {
  it("precondition: a bare packet has nothing open", () => {
    expect(line(bare(), /unknown/)).toBeUndefined();
  });

  it("counts who may do the job, and return-to-service acceptance limits", () => {
    const p = bare({ qualifications: [unk("qualification is not specified")], restoration: [unk("acceptance limits are not specified")] });
    expect(line(p, /unknown/)).toMatch(/^2 items are unknown/);
    expect(readinessSummary(p).status).toBe("needs_review");
  });

  it("does not count a return-to-service line twice when it is a copy of a caution", () => {
    const p = bare({ restoration: [unk("acceptance limits are not specified"), unk("copy", { copyOf: "safety.cautions[0]" })] });
    expect(line(p, /unknown/)).toMatch(/^1 item is unknown/);
  });

  it("counts an issue the technician recorded and has not closed", () => {
    let r = emptyRecord("pk");
    r = addNote(r, { id: "n1", kind: "issue", text: "Seal kit not in stores", stepIndex: null, by: "Tech", at: AT, resolved: false });
    r = addNote(r, { id: "n2", kind: "issue", text: "Old issue", stepIndex: null, by: "Tech", at: AT, resolved: true });
    expect(line(bare(), /recorded issue/, r)).toBe("1 recorded issue is still open (see Job notes).");
    expect(readinessSummary(bare(), r).status).toBe("needs_review");
  });

  it("says plainly that some unknowns are text that could not be read, not only things the documents leave out", () => {
    expect(line(bare({ unknowns: [unk("x")] }), /unknown/)).toBe("1 item is unknown — the documents do not give it, or its text could not be read. Nothing has been guessed.");
  });
});

describe("F17 — settling an open question", () => {
  const p0 = bare({ blockers: [unk("the manual limits these steps to some models")], unknowns: [unk("seal material is unknown")] });

  it("settle records the answer, who, when and the source — Proposed, never Verified", () => {
    const p = applyEdit(p0, { path: "unknowns[0]", action: "settle", value: "NBR", source: "nameplate suffix photo" }, "J. Tech", AT);
    expect(p.unknowns[0].value).toBe("NBR");
    expect(p.unknowns[0].label).toBe("proposed");
    expect(p.unknowns[0].review).toMatchObject({ action: "settle", by: "J. Tech", at: AT, source: "nameplate suffix photo" });
    expect(technicianEntryNote(p.unknowns[0])).toBe("Settled by J. Tech, 2026-11-03 12:00 UTC — source: nameplate suffix photo. Proposed, not verified.");
  });

  it("refuses a settle without an answer or without a source — blank means unknown", () => {
    expect(() => applyEdit(p0, { path: "unknowns[0]", action: "settle", value: " ", source: "x" }, "T", AT)).toThrow(/answer/);
    expect(() => applyEdit(p0, { path: "unknowns[0]", action: "settle", value: "NBR", source: "" }, "T", AT)).toThrow(/source/);
  });

  it("the count follows a settle, for an unknown and for an open question", () => {
    expect(line(p0, /open question/)).toMatch(/^1 open question/);
    expect(line(p0, /unknown/)).toMatch(/^1 item is unknown/);
    let p = applyEdit(p0, { path: "unknowns[0]", action: "settle", value: "NBR", source: "nameplate" }, "T", AT);
    p = applyEdit(p, { path: "blockers[0]", action: "settle", value: "this pump has the V-Packing build", source: "supervisor" }, "T", AT);
    expect(line(p, /open question/)).toBeUndefined();
    expect(line(p, /is unknown|are unknown/)).toBeUndefined();
    expect(line(p, /settled/)).toBe("2 items were settled by a technician — Proposed, not verified; see each line.");
  });

  it("control: Confirm on an open item settles nothing", () => {
    const p = applyEdit(p0, { path: "unknowns[0]", action: "confirm" }, "T", AT);
    expect(line(p, /unknown/)).toMatch(/^1 item is unknown/);
    expect(line(p, /settled/)).toBeUndefined();
  });

  it("a struck open item is reported as excluded, not as settled", () => {
    const p = applyEdit(p0, { path: "unknowns[0]", action: "strike" }, "T", AT);
    expect(line(p, /is unknown|are unknown/)).toBeUndefined();
    expect(line(p, /excluded/)).toBe("1 open item was struck by a technician — excluded from the job, not settled.");
    expect(line(p, /settled by/)).toBeUndefined();
  });
});
