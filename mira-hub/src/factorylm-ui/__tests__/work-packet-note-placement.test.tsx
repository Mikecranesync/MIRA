/**
 * F22 on screen and on paper: a warning about the action a step performs is printed above that step,
 * so it is read before the step is done; a plain note about what may happen stays below it.
 * Fixture is invented (7ZQ notes manual).
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-note-placement
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import type { Field, WorkPacket } from "@/capabilities/work-packet/types";
import { PhasedSteps } from "../WorkPacketV2Sections";

function build(): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk", now: "2026-11-03T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "7ZQ10", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id: "WO", title: "Reseal", description: "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", assetTag: null, site: null, synthetic: true },
    docs: [{ docId: "sm", fileId: null, filename: "manual.pdf", pages: fixturePages(FIXTURES["manual-7zq-notes.txt"]), via: "file" }], hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

const renderField = (_path: string, f: Field) => <span>{f.value ?? ""}</span>;

describe("F22 — the page prints a warning above the step it protects", () => {
  const html = renderToStaticMarkup(<PhasedSteps packet={build()} renderField={renderField} />);
  const stepBlock = (re: RegExp) => {
    const blocks = html.split(/data-testid="wp-step-\d/).slice(1);
    const b = blocks.find((x) => re.test(x));
    if (!b) throw new Error(`no step block matching ${re}`);
    return b;
  };

  it("the pliers warning comes before the pliers step's text", () => {
    const b = stepBlock(/With a reverse pliers/);
    expect(b.indexOf("may damage")).toBeGreaterThan(-1);
    expect(b.indexOf("may damage")).toBeLessThan(b.indexOf("With a reverse pliers"));
  });

  it("control: the plain note stays after its step's text", () => {
    const b = stepBlock(/Lift out the Spacer/);
    expect(b.indexOf("may stay")).toBeGreaterThan(b.indexOf("Lift out the Spacer"));
  });

  it("the intro says where warnings are shown", () => {
    expect(html).toContain("A warning about a step is shown above it");
  });
});
