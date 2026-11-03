/**
 * Work Packet field journey — the quote chip, the technician-entry marker, the job-record controls
 * and the completion block, as rendered (screen + print markup).
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/job-record-view
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Field, SourceRef, WorkPacket } from "@/capabilities/work-packet/types";
import { addNote, emptyRecord, recordMeasurement, setStepPerformed } from "@/capabilities/work-packet/job-record";
import { FieldRow } from "../WorkPacketPanel";
import { CompletionBlock, JobNotesSection, MeasurementRecordInput, PacketCoverage, StepRecordControls } from "../JobRecordView";

const T = "2026-11-02T17:00:00.000Z";
const SRC = { docId: "d1", filename: "manual.pdf", page: 6, line: "Torque valve plugs 30 ft-lbs" } as unknown as SourceRef;
const f = (value: string, extra: Partial<Field> = {}): Field => ({ value, label: "verified", source: SRC, basis: "t", ...extra });
const noop = () => {};
const PACKET = {
  steps: [{ section: "V", topic: "v", text: f("Remove plug") }, { section: "V", topic: "v", text: f("Remove seal", { struck: true }) }],
  measurements: [{ name: f("Plug"), value: f("30 ft-lbs"), tool: f("Hex") }],
  parts: [], tools: [], documents: [{}],
} as unknown as Pick<WorkPacket, "steps" | "measurements" | "parts" | "tools" | "documents">;

describe("the source chip says it shows a quote", () => {
  it("without a shell viewer the chip reads 'Show quote'", () => {
    const html = renderToStaticMarkup(<FieldRow path="steps[0].text" field={f("x")} onEdit={noop} busy={false} />);
    expect(html).toContain("Show quote · p.6 manual.pdf");
  });
  it("the PDF still carries the plain page reference", () => {
    const html = renderToStaticMarkup(<FieldRow path="steps[0].text" field={f("x")} onEdit={noop} busy={false} />);
    expect(html).toContain("Source: p.6 manual.pdf");
  });
});

describe("a technician's change is marked on screen and on paper", () => {
  it("a corrected line carries the technician-entry marker (not inside a no-print block)", () => {
    const field = f("32 ft-lbs", { review: { path: "x", action: "set", by: "tech@x", at: T, previous: "30", next: "32" } });
    const html = renderToStaticMarkup(<FieldRow path="measurements[0].value" field={field} onEdit={noop} busy={false} />);
    expect(html).toMatch(/data-testid="wp-entry-note">Technician entry by tech@x, 2026-11-02 17:00 UTC — not from the manual/);
  });
  it("control: an untouched line has no marker", () => {
    expect(renderToStaticMarkup(<FieldRow path="x" field={f("x")} onEdit={noop} busy={false} />)).not.toContain("wp-entry-note");
  });
});

describe("steps are incomplete until the technician records them", () => {
  it("an unrecorded step prints as not performed and offers the button", () => {
    const html = renderToStaticMarkup(<StepRecordControls index={0} struck={false} record={emptyRecord("p")} by="a" onChange={noop} />);
    expect(html).toContain("Not recorded as performed");
    expect(html).toContain("Mark step performed");
  });
  it("a recorded step says who and when", () => {
    const r = setStepPerformed(emptyRecord("p"), 0, true, "tech@x", T);
    const html = renderToStaticMarkup(<StepRecordControls index={0} struck={false} record={r} by="a" onChange={noop} />);
    expect(html).toContain("Recorded as performed by tech@x, 2026-11-02 17:00 UTC");
  });
  it("a struck step cannot be marked performed", () => {
    const html = renderToStaticMarkup(<StepRecordControls index={1} struck={true} record={emptyRecord("p")} by="a" onChange={noop} />);
    expect(html).not.toContain("Mark step performed");
  });
});

describe("measured values are the technician's, beside the manual value", () => {
  it("not recorded by default", () => {
    expect(renderToStaticMarkup(<MeasurementRecordInput index={0} record={emptyRecord("p")} by="a" onChange={noop} />)).toContain("not recorded");
  });
  it("a recorded value is labelled a technician entry", () => {
    const r = recordMeasurement(emptyRecord("p"), 0, "29 ft-lbs", "tech@x", T);
    const html = renderToStaticMarkup(<MeasurementRecordInput index={0} record={r} by="a" onChange={noop} />);
    expect(html).toContain("<strong>29 ft-lbs</strong>");
    expect(html).toContain("technician entry");
  });
});

describe("notes and completion", () => {
  it("an open issue is shown as open", () => {
    const r = addNote(emptyRecord("p"), { id: "n", kind: "issue", text: "Weep at seal", stepIndex: 0, by: "a", at: T });
    const html = renderToStaticMarkup(<JobNotesSection record={r} by="a" steps={2} onChange={noop} />);
    expect(html).toContain("Open issue");
    expect(html).toContain("step 1");
  });
  it("the completion block is printed and never claims return to service", () => {
    const r = setStepPerformed(emptyRecord("p"), 0, true, "a", T);
    const html = renderToStaticMarkup(<CompletionBlock packet={PACKET} record={r} />);
    expect(html).toContain('data-status="all_steps_recorded"');
    expect(html).toContain("not a return to service");
    expect(html).not.toContain("data-no-print");
  });
  it("the coverage block explains Verified and disclaims field approval", () => {
    const html = renderToStaticMarkup(<PacketCoverage packet={PACKET} />);
    expect(html).toContain("not an approval for field use");
    expect(html).toContain("does not authorize work or return to service");
  });
});

describe("the panel keeps the record per packet and wires the direct link", () => {
  const src = readFileSync(join(__dirname, "..", "WorkPacketPanel.tsx"), "utf8");
  it("the record is stored under the packet id", () => {
    expect(src).toContain("`work-packet-record:${packetId}`");
  });
  it("a failed save is shown", () => {
    expect(src).toContain('data-testid="wp-record-error"');
  });
  it("the direct link opens the dialog", () => {
    expect(src).toContain("useState(openOnArrival)");
  });
  it("the host reads the link before it rewrites the URL, and opens only the linked notebook", () => {
    const host = readFileSync(join(__dirname, "..", "hub-host.tsx"), "utf8");
    const read = host.indexOf("wantsPacketOpen(readSearch())");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(host.indexOf("writeSearch(searchForSelection(next))"));
    expect(host).toContain("openOnArrival={packetLink !== null && packetLink === selection.notebookId}");
  });
});
