import { describe, expect, it } from "vitest";
import { buildPriorReportContext } from "@/lib/notebook-query";

const row = (id: string, question: string) => ({ id, question, createdAt: "2026-10-09T01:00:00Z" });
describe("bounded literal report context", () => {
 it("keeps old repeated observations and excludes only the recent repeated occurrence", () => {
   const reports = [row("old", "Seat 1 is red"), row("correction", "Each seat has its own slave"), row("recent", "Seat 1 is red")];
   const ctx = buildPriorReportContext(reports, [{ role: "user", content: "Seat 1 is red" }]);
   expect(ctx.turnIds).toEqual(["old", "correction"]);
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
