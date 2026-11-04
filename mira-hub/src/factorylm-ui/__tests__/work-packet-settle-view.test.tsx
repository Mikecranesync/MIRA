/**
 * F17/F18 on screen: an open item offers Settle (a Verified line does not), and the readiness block
 * counts an issue recorded on this job. Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-settle-view
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import { addNote, emptyRecord } from "@/capabilities/work-packet/job-record";
import type { Field } from "@/capabilities/work-packet/types";
import { FieldRow } from "../WorkPacketPanel";
import { ReadinessBlock } from "../WorkPacketV2Sections";

const noop = () => {};
const f = (label: Field["label"]): Field => ({ value: label === "unknown" ? null : "x", label, source: null, basis: "b" });

describe("F17 — Settle is offered only for an open item", () => {
  it("an unknown line has a Settle button", () => {
    expect(renderToStaticMarkup(<FieldRow path="unknowns[0]" field={f("unknown")} onEdit={noop} busy={false} />)).toContain('data-testid="wp-settle"');
  });
  it("control: a verified line does not", () => {
    expect(renderToStaticMarkup(<FieldRow path="steps[0].text" field={f("verified")} onEdit={noop} busy={false} />)).not.toContain('data-testid="wp-settle"');
  });
});

describe("F18 — the readiness block on screen counts a recorded issue", () => {
  it("shows the open issue line", () => {
    const r = buildDraftPacket({
      notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk", now: "2026-11-03T12:00:00Z",
      identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
      workOrder: { id: "WO", title: "Reseal", description: "Pump leaking at the shaft — reseal it.", assetTag: null, site: null, synthetic: true },
      docs: [{ docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(FIXTURES["manual-85v2.txt"]), via: "file" }], hazardFlags: [],
    });
    if (!r.ok) throw new Error(r.message);
    const rec = addNote(emptyRecord("pk"), { id: "n1", kind: "issue", text: "Seal kit not in stores", stepIndex: null, by: "T", at: "2026-11-03T12:00:00Z", resolved: false });
    expect(renderToStaticMarkup(<ReadinessBlock packet={r.packet} record={rec} />)).toContain("1 recorded issue is still open");
  });
});
