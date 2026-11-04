/**
 * F13: a page torn off the printed packet still says which job, which pump, and — for a demo job —
 * that it is not real. A photo added to a demo job is labelled a test image where it is shown.
 * Fixture is invented (85-frame manual).
 * Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-running-head
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, fixturePages } from "@/capabilities/work-packet/__tests__/fixtures";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import { emptyRecord } from "@/capabilities/work-packet/job-record";
import type { WorkPacket } from "@/capabilities/work-packet/types";
import { JobPhotosSection } from "../JobRecordView";
import { pageHeadCss, runningHead } from "../work-packet-v2-view";

function build(synthetic: boolean, id = "WO-4471"): WorkPacket {
  const r = buildDraftPacket({
    notebookId: "11111111-1111-4111-8111-111111111111", packetId: "pk", now: "2026-11-03T12:00:00Z",
    identity: { manufacturer: "CAT Pumps", model: "8520", catalogNumber: null, serialNumber: null, status: "user_confirmed", confidence: 0.9 },
    workOrder: { id, title: "Reseal", description: "Pump leaking at the shaft — reseal it per the manufacturer's procedure.", assetTag: null, site: null, synthetic },
    docs: [{ docId: "sm", fileId: null, filename: "manual.pdf", pages: fixturePages(FIXTURES["manual-85v2.txt"]), via: "file" }], hazardFlags: [],
  });
  if (!r.ok) throw new Error(r.message);
  return r.packet;
}

describe("F13 — every printed page names the job, the pump and a demo job", () => {
  it("names the work order and the model", () => {
    expect(runningHead(build(false))).toBe("Work order WO-4471 · CAT Pumps 8520");
  });

  it("says SYNTHETIC on a demo job", () => {
    expect(runningHead(build(true))).toBe("Work order WO-4471 · CAT Pumps 8520 · SYNTHETIC — not a real job");
  });

  it("is put in the page margin, so it repeats on every page", () => {
    const css = pageHeadCss(build(true));
    expect(css).toMatch(/@page\s*\{[^}]*@top-left\s*\{[^}]*content:\s*"Work order WO-4471 · CAT Pumps 8520 · SYNTHETIC — not a real job"/);
  });

  it("cannot break out of the CSS string", () => {
    const css = pageHeadCss(build(false, 'WO"} body{display:none} </style><x\\'));
    // One CSS string, closed only at the end of the rule: the id stays inside it.
    const m = css.match(/^@page \{ @top-left \{ content: "((?:[^"\\]|\\.)*)"; font-size: 9pt; \} \}$/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('WO\\"} body{display:none}');
    expect(css).not.toContain("</style");
  });
});

describe("F13 — a photo on a demo job is labelled a test image", () => {
  const record = { ...emptyRecord("pk"), photos: [{ id: "p1", image: "data:image/png;base64,AA==", caption: "seal face", stepIndex: null, by: "Tech", at: "2026-11-03T12:00:00Z" }] };
  const noop = () => {};

  it("demo job: heading and caption say test image", () => {
    const html = renderToStaticMarkup(<JobPhotosSection record={record} by="Tech" onChange={noop} onError={noop} synthetic />);
    expect(html).toContain("Test images — synthetic job, not a real job");
    expect(html).toContain("Test image by");
    expect(html).not.toContain("taken on this job");
  });

  it("control: a real job keeps the job-photo wording", () => {
    const html = renderToStaticMarkup(<JobPhotosSection record={record} by="Tech" onChange={noop} onError={noop} />);
    expect(html).toContain("Job photos (taken on this job)");
    expect(html).not.toContain("Test image");
  });
});
