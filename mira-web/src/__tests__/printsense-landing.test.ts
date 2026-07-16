import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ps-leads-"));
process.env.PRINTSENSE_LEADS_DIR = dir;
const { printsensePage } = await import("../routes/printsense.js");

test("GET /printsense renders honest positioning", async () => {
  const res = await printsensePage.request("/printsense");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("does not replace engineering review");
  expect(html).toContain("Try in Telegram");
  expect(html).toContain("advanced_reasoning_unavailable");
  expect(html).not.toContain("#0"); // no hardcoded hex — tokens only
});

test("POST validates work email", async () => {
  const bad = await printsensePage.request("/printsense/interest", {
    method: "POST",
    body: new URLSearchParams({ email: "nope" }),
  });
  expect(bad.status).toBe(400);
});

test("POST captures lead; analytics stays content-free", async () => {
  const ok = await printsensePage.request("/printsense/interest", {
    method: "POST",
    body: new URLSearchParams({ email: "tech@example.com", pilot: "on" }),
  });
  expect(ok.status).toBe(200);
  const leads = readFileSync(join(dir, "leads.jsonl"), "utf-8");
  expect(leads).toContain("tech@example.com"); // CRM file carries the lead
  const funnel = readFileSync(join(dir, "funnel.jsonl"), "utf-8");
  expect(funnel).toContain("package_request_submitted");
  expect(funnel).not.toContain("tech@example.com"); // analytics never does
  expect(existsSync(join(dir, "funnel.jsonl"))).toBe(true);
});
