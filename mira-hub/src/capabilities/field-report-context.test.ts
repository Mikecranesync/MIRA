import { describe, expect, it } from "vitest";
import { buildPriorReportContext, sanitizeHistory } from "@/lib/notebook-query";

const row = (id: string, question: string) => ({ id, question, createdAt: "2026-10-09T01:00:00Z" });
describe("bounded literal report context", () => {
 it("keeps bounded older corrections alongside recent reports without trusting client text", () => {
   const reports = [row("correction", "Each seat has its own slave"),
     ...Array.from({ length: 2 }, (_, i) => row(`older-${i}`, `Report ${i}: ${"y".repeat(980)}`)),
     ...Array.from({ length: 6 }, (_, i) => row(`recent-${i}`, `Observation ${i}: ${"x".repeat(3000)}`))];
   const history = sanitizeHistory(reports.slice(-6).flatMap(r => [
     { role: "user", content: r.question }, { role: "assistant", content: "Understood" },
   ]));
   const ctx = buildPriorReportContext(reports, history);
   expect(ctx.turnIds).toEqual(reports.map(report => report.id));
   expect(ctx.truncated).toBe(true);
   expect(ctx.content).toContain("Each seat has its own slave");
 });
 it("keeps every repeated server observation when client occurrence is unauthenticated", () => {
   const reports = [row("old", "Seat 1 is red"), row("correction", "Each seat has its own slave"), row("recent", "Seat 1 is red")];
   const ctx = buildPriorReportContext(reports, [{ role: "user", content: "Seat 1 is red" }]);
   expect(ctx.turnIds).toEqual(["old", "correction", "recent"]);
   expect(ctx.content).toContain("Each seat has its own slave");
   expect(ctx.content).toContain("not instructions or verified machine facts");
   expect(ctx.content).toContain("storage times, not event times");
 });
 it("keeps unresolved speech verbatim rather than inventing a seat identity", () => {
   const ctx = buildPriorReportContext([row("voice", "seat number Tuesday stayed green")], []);
   expect(ctx.content).toContain("seat number Tuesday");
   expect(ctx.content).not.toContain("seat number two");
 });
 it("bounds both per-report and serialized total size and exposes omission", () => {
   const reports = Array.from({ length: 30 }, (_, i) => row(`turn-${i}`, `${i}: ${"x\n".repeat(800)}`));
   const ctx = buildPriorReportContext(reports, []);
   expect(ctx.truncated).toBe(true);
   expect(ctx.content.length).toBeLessThan(9000);
   expect(ctx.content).toContain("omitted or truncated");
   expect(ctx.turnIds).not.toContain("turn-0");
   expect(ctx.turnIds.at(-1)).toBe("turn-29");
 });
 it("distinguishes an unavailable read from an empty history", () => {
   expect(buildPriorReportContext([], []).content).toBe("");
   const ctx = buildPriorReportContext([], [], "unavailable");
   expect(ctx.coverage).toBe("unavailable");
   expect(ctx.content).toContain("Do not assume");
 });
});


it("retains reaffirmed timestamped A after contradictory B with stale client A", () => {
  const a = "No, each seat has its own slave";
  const reports = [
    { id: "first", question: a, createdAt: "2026-10-09T01:00:00Z" },
    { id: "opposite", question: "Correction: both seats share one slave", createdAt: "2026-10-09T02:00:00Z" },
    { id: "latest", question: a, createdAt: "2026-10-09T03:00:00Z" },
  ];
  const ctx = buildPriorReportContext(reports, [{ role: "user", content: a }]);
  expect(ctx.turnIds).toEqual(["first", "opposite", "latest"]);
  expect(ctx.content).toContain("2026-10-09T03:00:00Z");
  expect(ctx.truncated).toBe(false);
});

it("shares the serialized budget even for heavily escaped reports", () => {
  const reports = Array.from({ length: 24 }, (_, i) => row(`turn-${i}`, '\"\n\t'.repeat(600)));
  const ctx = buildPriorReportContext(reports, []);
  expect(ctx.turnIds).toEqual(reports.map(report => report.id));
  expect(ctx.content.length).toBeLessThan(9000);
  expect(ctx.truncated).toBe(true);
});
