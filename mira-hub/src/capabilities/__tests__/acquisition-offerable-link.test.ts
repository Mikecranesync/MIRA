/**
 * #5910 (#5906 Codex r1 F1): a manual candidate link reaches the technician only
 * when it is a public https URL. This file covers the record and the chat text;
 * the confirm endpoint proof is in nameplate/__tests__/confirm.test.ts.
 *
 * Run: npx vitest run src/capabilities/__tests__/acquisition-offerable-link.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/workspace-files", () => ({ attachFileToTargetsTx: vi.fn() }));
// The real pipeline is covered by the nameplate confirm tests; here it is a seam.
vi.mock("@/capabilities/manual-acquisition", () => ({ acquireManualForIdentity: vi.fn() }));

import { offerableLinkUrl } from "@/capabilities/offerable-link";
import {
  acquisitionDeclineText,
  recordFromOutcome,
  type AcquisitionRecord,
} from "@/capabilities/notebook-manual-acquisition";

const HTTP = "http://support.industry.siemens.com/cs/document/12345/ktp700.pdf";
const HTTPS = "https://support.industry.siemens.com/cs/document/12345/ktp700.pdf";
const LABEL = "Siemens KTP700 Basic";

function reviewRecord(url: string): AcquisitionRecord {
  return recordFromOutcome("K", null, {
    status: "candidate_review",
    payload: { candidate: { url, host: "support.industry.siemens.com", title: "KTP700" } },
  });
}

describe("offerableLinkUrl: the one link policy", () => {
  it("accepts a public https URL unchanged", () => {
    expect(offerableLinkUrl(HTTPS)).toBe(HTTPS);
  });

  it.each([
    ["plain http", HTTP],
    ["credentials", "https://user:pw@support.industry.siemens.com/m.pdf"],
    ["a non-standard port", "https://support.industry.siemens.com:8443/m.pdf"],
    ["a loopback host", "https://127.0.0.1/m.pdf"],
    ["the metadata address", "https://169.254.169.254/latest/meta-data"],
    ["a quote that would break out of the sentence", 'https://support.industry.siemens.com/m.pdf"onclick'],
    ["not a URL", "not a url"],
  ])("withholds %s", (_name, url) => {
    expect(offerableLinkUrl(url)).toBeNull();
  });

  it("withholds empty and missing values", () => {
    expect(offerableLinkUrl(null)).toBeNull();
    expect(offerableLinkUrl(undefined)).toBeNull();
    expect(offerableLinkUrl("")).toBeNull();
  });
});

describe("the stored acquisition record never keeps a non-https candidate link", () => {
  it("drops an http candidate URL and keeps the host", () => {
    const rec = reviewRecord(HTTP);
    expect(rec.candidate_url).toBeNull();
    expect(rec.candidate_host).toBe("support.industry.siemens.com");
    expect(JSON.stringify(rec)).not.toContain("http://");
  });

  it("control: keeps a public https candidate URL", () => {
    expect(reviewRecord(HTTPS).candidate_url).toBe(HTTPS);
  });
});

describe("the chat review message never prints a non-https candidate link", () => {
  it("a record stored before this fix with an http link names only the host", () => {
    // Rows written while #5906 was live can still hold the raw http URL.
    const legacy: AcquisitionRecord = { ...reviewRecord(HTTPS), candidate_url: HTTP };
    expect(legacy.candidate_url).toBe(HTTP); // precondition: the stored link is http
    const text = acquisitionDeclineText(legacy, "K", LABEL)!;
    expect(text).not.toContain("http://");
    expect(text).toContain("on support.industry.siemens.com");
  });

  it("control: an https candidate link is still given", () => {
    const text = acquisitionDeclineText(reviewRecord(HTTPS), "K", LABEL)!;
    expect(text).toContain(`at ${HTTPS}`);
  });
});
