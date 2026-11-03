/**
 * Work Packet V2 sections as rendered (static markup): the readiness summary, the open questions,
 * the phased numbered procedure with notes beside their step, the four-column torque table and
 * the left-out appendix — and the 44px rule on every new control and the page counter on paper.
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-v2-sections
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import type { DocText, Field, WorkPacket } from "@/capabilities/work-packet/types";
import { BlockersSection, JhaTable, LeftOutAppendix, MeasurementsTable, PartsTable, PhasedSteps, ReadinessBlock } from "../WorkPacketV2Sections";

const render = (path: string, field: Field) => <div data-path={path}>{field.value ?? "(unknown)"}|{field.basis}</div>;

function packet(): WorkPacket {
  const doc: DocText = { docId: "sm", fileId: null, filename: "manual-85v2.pdf", pages: fixturePages(FIXTURES["manual-85v2.txt"]), via: "file" };
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk", now: "2026-11-02T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO", title: "Reseal", description: "reseal it", assetTag: null, site: null, synthetic: true },
    docs: [doc], hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

describe("V2 packet as a technician reads it", () => {
  const p = packet();
  it("says it needs review, and why, before anything else", () => {
    const html = renderToStaticMarkup(<ReadinessBlock packet={p} />);
    expect(html).toContain("Needs review before work starts.");
    expect(html).toContain("2 open questions");
    expect(html).not.toMatch(/safe to|ready for service/i);
  });
  it("lists the open questions, quoting the manual", () => {
    const html = renderToStaticMarkup(<BlockersSection packet={p} renderField={render} />);
    expect(html).toContain('data-path="blockers[0]"');
    expect(html).toContain("early style");
  });
  it("numbers the steps 1..N in three parts, with each note right after its step", () => {
    const html = renderToStaticMarkup(<PhasedSteps packet={p} renderField={render} />);
    expect(html.indexOf("Part A — Removal")).toBeLessThan(html.indexOf("Part B — Service"));
    expect(html.indexOf("Part B — Service")).toBeLessThan(html.indexOf("Part C — Reinstall"));
    expect(html).toContain(`data-testid="wp-step-${p.steps.length}"`);
    const step = html.indexOf("Work the Inlet Head off the Plungers.");
    const note = html.indexOf("Hold the head level so the Plungers are not scratched.");
    const next = html.indexOf('data-testid="wp-step-5"');
    expect(step).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(step);
    expect(note).toBeLessThan(next);
    expect(html).toContain("Torque: Inlet Head Screws");
  });
  it("torque table keeps manual value, correction, approval and measured in separate columns", () => {
    const html = renderToStaticMarkup(<MeasurementsTable packet={p} record={null} renderField={render} />);
    for (const h of ["Manual value", "Proposed correction", "Approval", "Measured"]) expect(html).toContain(`>${h}</th>`);
    expect(html).toContain("Not approved — the site decides");
    expect(html).toContain("not recorded");
  });
  it("hazard and parts are tables, one row each — not repeated blocks", () => {
    const jha = renderToStaticMarkup(<JhaTable packet={p} renderField={render} />);
    expect((jha.match(/data-testid="wp-jha-row-/g) ?? []).length).toBe(p.jha!.length);
    const parts = renderToStaticMarkup(<PartsTable packet={p} renderField={render} />);
    expect((parts.match(/data-testid="wp-part-row-/g) ?? []).length).toBe(p.parts.length);
  });
  it("left-out content is listed in an appendix with its reason", () => {
    const html = renderToStaticMarkup(<LeftOutAppendix packet={p} renderField={render} />);
    expect(html).toContain(`(${p.leftOut!.length})`);
    expect(html).toContain("The 8545, 8541 do not have Guide Rings.");
  });
  it("control: a V1 packet renders without phases, blockers or appendix", () => {
    const v1 = { ...p, version: 1 as const, blockers: undefined, leftOut: undefined, steps: p.steps.map(({ phase: _p, ...s }) => s) };
    expect(renderToStaticMarkup(<PhasedSteps packet={v1} renderField={render} />)).not.toContain("Part A");
    expect(renderToStaticMarkup(<BlockersSection packet={v1} renderField={render} />)).toBe("");
    expect(renderToStaticMarkup(<LeftOutAppendix packet={v1} renderField={render} />)).toBe("");
  });
});

describe("phone and paper rules", () => {
  const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
  it("every new fold control is at least 44px tall, and the quote chip too", () => {
    expect(src("WorkPacketV2Sections.tsx")).toMatch(/foldSummary: \{[^}]*minHeight: 44/);
    expect(src("WorkPacketPanel.tsx")).toMatch(/chip: \{[^}]*minHeight: 44/);
  });
  it("the PDF prints 'Page X of Y'", () => {
    expect(src("WorkPacketPanel.tsx")).toContain('content: "Page " counter(page) " of " counter(pages)');
  });
});
