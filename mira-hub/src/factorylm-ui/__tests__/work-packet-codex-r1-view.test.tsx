/**
 * Codex adversarial review round 1 on PR #5173 @ 97c0516bf, findings F4 and F7 (view side).
 * F4: a torque value a technician struck is shown as excluded in the table and beside its step,
 *     never as an active torque instruction.
 * F7: a settle is a value change, so the correction column names who settled it.
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-codex-r1-view
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import { applyEdit } from "@/capabilities/work-packet/edits";
import type { Field, WorkPacket } from "@/capabilities/work-packet/types";
import { MeasurementsTable, PhasedSteps } from "../WorkPacketV2Sections";
import { measurementRows } from "../work-packet-v2-view";

const render = (path: string, field: Field) => <div data-path={path}>{field.value ?? "(unknown)"}</div>;

function packet(): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk", now: "2026-11-04T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO", title: "Reseal", description: "Pump leaking at the shaft — reseal it.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "m.pdf", pages: fixturePages(FIXTURES["manual-85v2.txt"]), via: "file" }], hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

describe("F4 — a struck torque value is shown as excluded", () => {
  const base = packet();
  const value = base.measurements[0]?.value.value ?? "";
  const struck = applyEdit(base, { path: "measurements[0].value", action: "strike" }, "Tech A", "2026-11-04T12:05:00Z");

  it("precondition: the packet has a torque value used by a step", () => {
    expect(value.length).toBeGreaterThan(0);
    expect((base.measurements[0].steps ?? []).length).toBeGreaterThan(0);
    expect(struck.measurements[0].value.struck).toBe(true);
  });

  it("the row carries the exclusion and who made it", () => {
    expect(measurementRows(struck, null)[0].excluded).toEqual({ by: "Tech A", at: "2026-11-04T12:05:00Z" });
  });

  it("the table marks it excluded", () => {
    const html = renderToStaticMarkup(<MeasurementsTable packet={struck} record={null} renderField={render} />);
    const row = html.slice(html.indexOf('data-testid="wp-measure-row-0"'));
    expect(row).toMatch(/EXCLUDED — struck by Tech A/);
    expect(row).toContain(`<s>${value}</s>`);
  });

  it("the step does not present it as a torque to use", () => {
    const html = renderToStaticMarkup(<PhasedSteps packet={struck} renderField={render} />);
    const line = html.match(/data-testid="wp-step-torque">([^<]*)</)?.[1] ?? "";
    expect(line).toMatch(/EXCLUDED — struck by Tech A/);
    expect(line).not.toContain(`${value} (manual)`);
  });

  it("control: an unstruck value is shown as the manual value", () => {
    expect(measurementRows(base, null)[0].excluded).toBeNull();
    const html = renderToStaticMarkup(<PhasedSteps packet={base} renderField={render} />);
    expect(html).toContain(`${value} (manual)`);
    expect(html).not.toContain("EXCLUDED");
  });
});

describe("F7 — a settle is attributed to whoever settled it", () => {
  const marked = applyEdit(packet(), { path: "measurements[0].value", action: "mark_unknown" }, "T", "2026-11-04T12:01:00Z");
  const settled = applyEdit(marked, { path: "measurements[0].value", action: "settle", value: "999 ft-lbs", source: "Site torque sheet" }, "Other", "2026-11-04T12:02:00Z");

  it("names the settler, not the earlier mark-unknown", () => {
    const row = measurementRows(settled, null)[0];
    expect(row.correction).toEqual({ value: "999 ft-lbs", by: "Other", at: "2026-11-04T12:02:00Z" });
  });

  it("control: a mark-unknown alone is attributed to its author", () => {
    expect(measurementRows(marked, null)[0].correction?.by).toBe("T");
  });
});
