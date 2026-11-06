import { describe, expect, it } from "vitest";
import { packetFixture, field } from "./packet-fixture";
import { validatePacketIntake, packetBody, qcTargets, applyCloseoutDecisions, validateCloseout } from "../packet-intake";
import { validateJobSheetBody } from "../validate";
import { reduceSheet } from "../reduce";
const nb = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const input = () => ({ clientRequestId: id, packet: packetFixture(nb), record: null });
describe("bounded packet intake and closeout content", () => {
  it("preserves complete opaque additions, revisions and imported approval without granting authority", () => {
    const raw = input();
    Object.assign(raw.packet, { futureEvidence: { original: ["retained"] } });
    raw.packet.approval.supervisor = { state: "approved", by: "client claim", at: "2026-11-01" };
    const checked = validatePacketIntake(raw, nb);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.packet).toEqual(raw.packet);
    const body = packetBody(checked.value.packet);
    expect(validateJobSheetBody(body).ok).toBe(true);
    const view = reduceSheet([{ id, seq: 1, kind: "job_started", payload: { title: body.title, machine: { entityId: "asset", name: "Fixture" }, templateRevisionId: null, template: body }, actorUserId: "u", actorLabel: "Tech", occurredAt: "2026-11-01", recordedAt: "2026-11-01", workOrderId: null }], id);
    expect(view.steps[0].done).toBe(false);
  });
  it.each([1, 2])("accepts supported packet version %s", version => {
    const raw = input(); raw.packet.version = version as 1 | 2;
    expect(validatePacketIntake(raw, nb).ok).toBe(true);
  });
  it("refuses future versions, foreign notebooks, malformed nested shapes and active image types", () => {
    for (const patch of [{ version: 3 }, { notebookId: id }, { steps: [{ text: {} }] }, { figures: [{ section: "x", docId: "d", filename: null, page: 1, caption: [], image: "data:image/svg+xml;base64,PHN2Zz4=" }] }]) {
      expect(validatePacketIntake({ ...input(), packet: { ...packetFixture(nb), ...patch } }, nb).ok).toBe(false);
    }
  });
  it("rejects malformed records and out of range links instead of dropping evidence", () => {
    expect(validatePacketIntake({ ...input(), record: { version: 1, packetId: "wrong", steps: {}, measurements: {}, notes: [], photos: [] } }, nb).ok).toBe(false);
    const raw = input(); raw.packet.figures = [{ section: "Inspection", docId: "d", filename: null, page: 1, caption: [], image: null, step: 20 }];
    expect(validatePacketIntake(raw, nb).ok).toBe(false);
  });
  it("requires every canonical field decision once and preserves unknowns and correction source history", () => {
    const p = packetFixture(nb);
    p.steps[0].text = { ...field("Original"), source: { docId: "manual", fileId: null, filename: "Fixture.pdf", page: 3, line: "Original" } };
    const decisions = qcTargets(p).map(({ path }) => ({ path, action: "confirm" as const }));
    expect(() => applyCloseoutDecisions(p, decisions.slice(1), "u", "2026-11-06")).toThrow();
    const corrected = applyCloseoutDecisions(p, decisions.map(d => d.path === "steps[0].text" ? { path: d.path, action: "settle", value: "Corrected", source: "Technician closeout observation" } : d), "u", "2026-11-06");
    expect(corrected.steps[0].text.value).toBe("Corrected");
    expect(corrected.steps[0].text.source).toEqual(p.steps[0].text.source);
    expect(corrected.steps[0].text.review).toMatchObject({ previous: "Original", next: "Corrected", by: "u" });
    expect(corrected.unknowns[0].value).toBeNull();
    expect(corrected.approval.supervisor.state).toBe("pending");
    expect(p.steps[0].text.value).toBe("Original");
  });
  it("includes document revisions and rejects forged review fields/ambiguous corrections", () => {
    const p = packetFixture(nb); p.documents.push({ docId: "d", fileId: null, filename: "synthetic.pdf", role: "service_manual", modelFoundOn: [1], via: "file", revision: field(null) });
    expect(qcTargets(p).some(f => f.path === "documents[0].revision")).toBe(true);
    const base = { clientRequestId: id, seq: 2, snapshotId: `sha256:${"a".repeat(64)}`, decisions: [] };
    expect(validateCloseout({ ...base, userId: "forged" }).ok).toBe(false);
    expect(validateCloseout({ ...base, decisions: [{ path: "steps[0].text", action: "settle", value: "Changed", source: "" }] }).ok).toBe(false);
    expect(validateCloseout({ ...base, decisions: [{ path: "steps[0].text", action: "confirm", value: "Changed" }] }).ok).toBe(false);
  });
  it("refuses deep opaque payloads and MIME-spoofed images without dropping evidence", () => {
    const raw = input();
    raw.packet.figures = [{ section: "x", docId: "d", filename: null, page: 1, image: "data:image/png;base64,PHN2Zz48L3N2Zz4=", caption: [] }];
    expect(validatePacketIntake(raw, nb).ok).toBe(false);
    let nested: unknown = "leaf"; for (let i = 0; i < 30; i++) nested = { nested };
    expect(validatePacketIntake({ ...input(), packet: { ...packetFixture(nb), opaque: nested } }, nb).ok).toBe(false);
  });
});
