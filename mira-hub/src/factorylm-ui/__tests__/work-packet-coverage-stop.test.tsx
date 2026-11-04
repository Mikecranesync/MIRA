/**
 * N1 on screen and on paper: a packet built from part of the manual stops itself first — before
 * the header, before anything a technician might start from — and the readiness summary says so.
 * A whole-procedure packet shows no stop. Fixtures are invented (9YP two-column, 85-frame).
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-coverage-stop
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import type { WorkPacket } from "@/capabilities/work-packet/types";
import { CoverageStop, ReadinessBlock } from "../WorkPacketV2Sections";
import { readinessSummary } from "../work-packet-v2-view";

function build(fixture: string, model: string): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk", now: "2026-11-03T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model, catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO", title: "Reseal", description: "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "manual.pdf", pages: fixturePages(FIXTURES[fixture]), via: "file" }], hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

describe("N1 — the stop is the first thing on screen and on page 1", () => {
  const partial = build("manual-9yp-twocol.txt", "9YP100");
  const whole = build("manual-85v2.txt", "8520");

  it("says in plain words how much was read and what is missing", () => {
    const html = renderToStaticMarkup(<CoverageStop packet={partial} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Not the whole job — do not work from this packet alone.");
    expect(html).toContain("Only 3 of at least 14 steps could be read (3 more may apply to this pump); this is not the whole job.");
    expect(html).toContain("SERVICING THE PUMPING SECTION");
    expect(html).toMatch(/not read/);
    expect(html).toContain("SERVICING THE SEALS");
    expect(html).toMatch(/partly read/);
    expect(html).toContain("SERVICING THE SEALS: partly read (3 read, at least 3 not read); 3 more may apply to this pump");
    expect(html).toContain("Nothing in this packet is marked Verified");
    expect(html).not.toContain("data-no-print");
  });

  it("shows nothing for a packet built from the whole procedure (and for packets saved before coverage)", () => {
    expect(renderToStaticMarkup(<CoverageStop packet={whole} />)).toBe("");
    const old = { ...whole };
    delete old.coverage;
    expect(renderToStaticMarkup(<CoverageStop packet={old} />)).toBe("");
  });

  it("leads the readiness summary", () => {
    expect(readinessSummary(partial).lines[0]).toBe("Only 3 of at least 14 steps could be read (3 more may apply to this pump); this is not the whole job.");
    expect(readinessSummary(partial).status).toBe("needs_review");
    expect(renderToStaticMarkup(<ReadinessBlock packet={partial} />)).toContain("not the whole job");
    expect(readinessSummary(whole).lines.some((l) => /not the whole job/.test(l))).toBe(false);
  });

  it("is mounted before the packet header in the panel, so it prints on page 1", () => {
    const src = readFileSync(join(__dirname, "..", "WorkPacketPanel.tsx"), "utf8");
    const stop = src.indexOf("<CoverageStop packet={packet} />");
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(src.indexOf("<PacketHeader packet={packet} />"));
  });
});
