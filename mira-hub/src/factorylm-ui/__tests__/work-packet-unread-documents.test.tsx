import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ availability: {} as Record<string, unknown>, calls: 0 }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(state.calls++ === 0 ? state.availability : initial) };
});
import { WorkPacketPanel } from "../WorkPacketPanel";

beforeEach(() => {
  state.calls = 0;
  state.availability = {
    enabled: true, documents: [],
    identity: { manufacturer: "AutomationDirect", model: "GS10", status: "user_confirmed", catalogNumber: null },
    blocking: { reason: "manufacturer_not_supported", message: "This manufacturer is not supported." },
  };
});
function documentText() {
  const html = renderToStaticMarkup(<WorkPacketPanel notebookId="52890000-0000-4000-8000-000000000003" openOnArrival />);
  const section = html.match(/<section[^>]*data-testid="wp-documents"[^>]*>([\s\S]*?)<\/section>/);
  expect(section).not.toBeNull();
  return section![1];
}
describe("#5289 unread documents are distinct from an empty source register", () => {
  it("says documents have not been read when the route deferred parsing", () => {
    state.availability.documentsState = "deferred";
    const text = documentText();
    expect(text).toContain("Documents have not been read yet.");
    expect(text).not.toContain("No manufacturer documents yet");
    expect(text).not.toContain("Attach this machine");
  });
  it.each([undefined, "read"])("preserves the actual empty-source copy for state %s", (value) => {
    if (value !== undefined) state.availability.documentsState = value;
    const text = documentText();
    expect(text).toContain("No manufacturer documents yet.");
    expect(text).not.toContain("Documents have not been read yet.");
  });
});
