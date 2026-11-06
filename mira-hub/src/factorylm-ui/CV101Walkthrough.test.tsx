import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CV101WalkthroughContent } from "./CV101Walkthrough";
import { CV101Architecture } from "./CV101Architecture";
import { HubAccountFooter } from "./HubAccountFooter";
import { LivingSheetPrint } from "./LivingSheetPrint";
import { newPractice, practiceView } from "./cv101-walkthrough-model";

describe("CV-101 walkthrough presentation", () => {
  it("offers all six guided workflows, evidence and honest practice/live labels", () => {
    const out = renderToStaticMarkup(<CV101WalkthroughContent viewerScope="test-viewer" onClose={() => {}} />);
    for (const name of ["Sign in and discover CV-101", "Inspect components and manuals", "Read telemetry with its source and time", "Ask a question and open its citation", "Document an inspection", "Open a new practice session and recall"]) expect(out).toContain(name);
    for (const text of ["Expected result", "Actual practice result", "Evidence", "Live acceptance", "BLOCKED", "SYNTHETIC PRACTICE", "No live connection", "Case study"]) expect(out).toContain(text);
    expect(out).not.toContain("All live checks passed");
    expect(out).not.toContain("fetch(");
  });
  it("provides a sourced visual map without declaring unknown physical links approved", () => {
    const out = renderToStaticMarkup(<CV101Architecture />);
    for (const text of ["Micro820", "GS10", "Motor", "PE-101", "RS-485", "historical", "unverified"]) expect(out).toContain(text);
    expect(out).toContain("role=\"img\"");
  });
  it("mounts the tour from the existing account footer", () => {
    const out = renderToStaticMarkup(<HubAccountFooter email="test@example.com" signingOut={false} onSignOut={() => {}} />);
    expect(out).toContain("CV-101 walkthrough");
    expect(out).toContain("Sign out");
  });
  it("previews the existing sheet content without attaching a global print root", () => {
    const view = practiceView(newPractice("test", "2026-11-06T12:00:00.000Z", "demo-cv101-test"));
    const out = renderToStaticMarkup(<LivingSheetPrint view={view} seq={view.seq} printedAt="2026-11-06T12:00:00.000Z" preview />);
    expect(out).toContain("Synthetic CV-101 documentation review");
    expect(out).not.toContain("fl-print-portal");
    expect(out).not.toContain("body &gt;");
    const normal = renderToStaticMarkup(<LivingSheetPrint view={view} seq={view.seq} printedAt="2026-11-06T12:00:00.000Z" />);
    expect(normal).toContain("fl-print-portal");
  });
});
