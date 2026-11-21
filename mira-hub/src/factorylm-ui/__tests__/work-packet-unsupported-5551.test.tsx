/**
 * #5551 — a confirmed maker job packets don't cover gets a plain reason, not a dead-end form; the
 * synthetic demo controls are internal opt-in only. Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-unsupported-5551
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isSupportedManufacturer, manufacturerRefusalMessage } from "@/capabilities/work-packet/manufacturer";
import { SyntheticDemoControls, UnsupportedNotice } from "../WorkPacketPanel";
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
