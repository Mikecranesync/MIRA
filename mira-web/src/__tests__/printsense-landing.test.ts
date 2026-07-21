import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ps-leads-"));
process.env.PRINTSENSE_LEADS_DIR = dir;
const { printsensePage } = await import("../routes/printsense.js");

test("GET /printsense renders the standalone product promise honestly", async () => {
  const res = await printsensePage.request("/printsense");
  expect(res.status).toBe(200);
  const html = await res.text();

  expect(html).toContain("Standalone electrical-print intelligence");
  expect(html).toContain("Upload an electrical print. Ask how the machine works.");
  expect(html).toContain("Start in Telegram");
  expect(html).toContain("almost any reasonably legible electrical print");
  expect(html).toContain("never authorizes energization or replaces qualified verification");
  expect(html).not.toContain("Managed package pilot");
  expect(html).not.toContain("No browser upload here");
  expect(html).not.toContain("#0"); // no hardcoded hex — tokens only
});

test("POST validates work email", async () => {
  const bad = await printsensePage.request("/printsense/interest", {
    method: "POST",
    body: new URLSearchParams({ email: "nope" }),
  });
  expect(bad.status).toBe(400);
});

test("POST captures package/review interest; analytics stays content-free", async () => {
  const ok = await printsensePage.request("/printsense/interest", {
    method: "POST",
    body: new URLSearchParams({
      email: "tech@example.com",
      package: "on",
      review: "on",
    }),
  });
  expect(ok.status).toBe(200);

  const leads = readFileSync(join(dir, "leads.jsonl"), "utf-8");
  expect(leads).toContain("tech@example.com");
  expect(leads).toContain('"wantsPackage":true');
  expect(leads).toContain('"wantsReview":true');

  const funnel = readFileSync(join(dir, "funnel.jsonl"), "utf-8");
  expect(funnel).toContain("package_request_submitted");
  expect(funnel).not.toContain("tech@example.com");
  expect(existsSync(join(dir, "funnel.jsonl"))).toBe(true);
});

test("one page, multi-photo, and complete packages are one product continuum", async () => {
  const res = await printsensePage.request("/printsense");
  const html = await res.text();

  expect(html).toContain("ONE PAGE");
  expect(html).toContain("MULTI-PHOTO");
  expect(html).toContain("COMPLETE PACKAGE");
  expect(html).toContain("A conversation, not a one-time report.");
  expect(html).toContain("keep asking questions while PrintSense builds page relationships");
  expect(html).toContain("PrintSense stands alone. FactoryLM expands it.");
});

test("trust contract keeps citations, uncertainty, safety, and optional review visible", async () => {
  const res = await printsensePage.request("/printsense");
  const html = await res.text();

  expect(html).toContain("Cited when proven");
  expect(html).toContain("Unresolved when unclear");
  expect(html).toContain("Stopped when safety-critical");
  expect(html).toContain("Review when warranted");
  expect(html).toContain("human-reviewed assurance");
  expect(html).toContain('href="/_tokens.css"');
  expect(html).toContain("--fl-dark-");
  expect(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html)).toBe(false);
});
