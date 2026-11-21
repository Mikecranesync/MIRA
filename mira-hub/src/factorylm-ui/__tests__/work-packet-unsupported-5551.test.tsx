/**
 * #5551 — a confirmed maker job packets don't cover gets a plain reason, not a dead-end form; the
 * synthetic demo controls are internal opt-in only. Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-unsupported-5551
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isSupportedManufacturer, manufacturerRefusalMessage } from "@/capabilities/work-packet/manufacturer";
import { ConfirmationFeedback, SyntheticDemoControls, UnsupportedNotice } from "../WorkPacketPanel";
import { unsupportedManufacturerMessage } from "../work-packet-view";

const noop = () => {};
const blocked = (manufacturer: string | null) => ({ identity: { manufacturer }, blocking: { reason: "manufacturer_not_supported", message: "x" } });

describe("unsupportedManufacturerMessage", () => {
  it("a confirmed Siemens machine gets the plain sentence, with no request to attach the manual again", () => {
    const m = unsupportedManufacturerMessage(blocked("Siemens"));
    expect(m).toContain("Job packets aren't available for Siemens equipment yet.");
    expect(m).not.toMatch(/own documents|use that manufacturer|attach/i);
  });
  it("control: supported CAT Pumps, other refusals and no availability give no message", () => {
    expect(unsupportedManufacturerMessage({ identity: { manufacturer: "CAT Pumps" }, blocking: null })).toBeNull();
    expect(unsupportedManufacturerMessage({ identity: { manufacturer: "Siemens" }, blocking: { reason: "no_documents" } })).toBeNull();
    expect(unsupportedManufacturerMessage(null)).toBeNull();
  });
  it("reuses the existing predicate: wording matches the refusal helper and CAT Pumps still passes", () => {
    expect(isSupportedManufacturer("CAT Pumps")).toBe(true);
    expect(isSupportedManufacturer("Siemens")).toBe(false);
    expect(unsupportedManufacturerMessage(blocked("Siemens"))).toBe(manufacturerRefusalMessage("Siemens"));
  });
});

describe("rendering", () => {
  it("the notice shows the machine and the reason", () => {
    const html = renderToStaticMarkup(<UnsupportedNotice identity={{ manufacturer: "Siemens", model: "S7-1200" }} message="Job packets aren't available for Siemens equipment yet." />);
    expect(html).toContain('data-testid="wp-unsupported-message"');
    expect(html).toContain("Siemens");
  });
  it("demo controls are absent by default and present only when explicitly enabled", () => {
    expect(renderToStaticMarkup(<SyntheticDemoControls show={false} synthetic={false} onSynthetic={noop} onLoad={noop} />)).toBe("");
    expect(renderToStaticMarkup(<SyntheticDemoControls show synthetic={false} onSynthetic={noop} onLoad={noop} />)).toContain('data-testid="wp-load-synthetic"');
  });
  it("the panel's opt-in defaults off and the host never turns it on; old synthetic stamp still renders from the packet", () => {
    const panel = readFileSync(join(__dirname, "..", "WorkPacketPanel.tsx"), "utf8");
    expect(panel).toContain("allowSyntheticDemo = false");
    expect(panel).toContain("packet.workOrder.synthetic && <div style={S.stamp}");
    const host = readFileSync(join(__dirname, "..", "hub-host.tsx"), "utf8");
    expect(host).not.toContain("allowSyntheticDemo");
  });
});

describe("#5731 F3 — the confirmation outcome is its own labelled block", () => {
  const OUTCOMES = [
    "Confirmed — I found the Siemens X1 manual and it's ready to answer from.",
    "Confirmed as a Siemens X1. I'll look for its manual.",
    "Confirmed as a Siemens X1. No automatic manual search was started — add its manual in Sources.",
    "Your nameplate was saved but is still being indexed (or indexing failed). Retry in a moment — the manual search runs once the nameplate is citable.",
  ];
  it("renders nothing when there is no outcome", () => {
    expect(renderToStaticMarkup(<ConfirmationFeedback nameplate={null} typed={null} />)).toBe("");
  });
  it.each(OUTCOMES)("shows the server's words for the typed path, verbatim and labelled: %s", (message) => {
    const html = renderToStaticMarkup(<ConfirmationFeedback nameplate={null} typed={message} />);
    expect(html).toContain("Identity and manual search");
    expect(html).toContain('data-testid="wp-typed-outcome"');
    expect(html).toContain(message.replace(/'/g, "&#x27;"));
    expect(html).not.toContain("wp-nameplate-outcome");
  });
  it("keeps the two paths distinct when both have spoken", () => {
    const html = renderToStaticMarkup(<ConfirmationFeedback nameplate="Nameplate confirmed. Manual search was not requested." typed="Confirmed as a Siemens X1. I'll look for its manual." />);
    expect(html).toContain('data-testid="wp-nameplate-outcome"');
    expect(html).toContain('data-testid="wp-typed-outcome"');
  });
  it("the outcome elements live outside the gated form: the panel renders the block before the unsupported notice, once", () => {
    const panel = readFileSync(join(__dirname, "..", "WorkPacketPanel.tsx"), "utf8");
    expect(panel.match(/<ConfirmationFeedback /g)).toHaveLength(1);
    expect(panel.indexOf("<ConfirmationFeedback ")).toBeLessThan(panel.indexOf("{unsupportedMessage && <UnsupportedNotice"));
    expect(panel.match(/data-testid="wp-typed-outcome"/g)).toHaveLength(1); // not duplicated inside the form
  });
});

describe("#5731 F2 — the refusal gates a saved packet too", () => {
  const panel = readFileSync(join(__dirname, "..", "WorkPacketPanel.tsx"), "utf8");
  it("the unsupported message no longer depends on whether a packet exists", () => {
    expect(panel).toContain("const unsupportedMessage = unsupportedManufacturerMessage(avail);");
    expect(panel).not.toContain("packet ? null : unsupportedManufacturerMessage");
  });
  it("Resume stays offered for a saved packet: only a packet-less unsupported panel hides the entry", () => {
    expect(panel).toContain("(unsupportedMessage && !packet && !open)");
  });
  it("a saved packet under an unsupported maker is stale, so Export (disabled when stale) stays off", () => {
    expect(panel).toMatch(/unsupportedMessage\s*\?\s*"job packets are not available/);
    expect(panel).toContain("disabled={stale !== null}");
  });
});
