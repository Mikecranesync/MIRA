// TASK-S3 rider: a chat turn carries `livingSheetJobId` only when a sheet job
// is open on the SAME notebook, and send() must read the current job (its
// useCallback deps include livingSheetJob) — the §12 run found the receipt
// never arrived because send() had captured the job as null.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { withLivingSheetRider } from "./hub-host-logic";

const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");

describe("withLivingSheetRider", () => {
  const body = { message: "motor current 48 A" };
  it("adds the job id when the open job is on this notebook", () => {
    expect(withLivingSheetRider(body, "nb-1", { notebookId: "nb-1", jobId: "job-1" })).toEqual({ ...body, livingSheetJobId: "job-1" });
  });
  it("leaves the body alone when no job is open", () => {
    expect(withLivingSheetRider(body, "nb-1", null)).toBe(body);
  });
  it("never sends a job id from another notebook", () => {
    expect(withLivingSheetRider(body, "nb-2", { notebookId: "nb-1", jobId: "job-1" })).toBe(body);
  });
});

describe("hub-host send()", () => {
  it("routes the chat body through withLivingSheetRider", () => {
    expect(host).toContain("const prepared = frozenSheetSend(body, sel");
    expect(host).toContain("body = prepared.body; sel = prepared.target;");
    expect(host).toContain("body: prepared.serialized");
    expect(host).toMatch(/withLivingSheetRider\(body, sel!\.notebookId, livingSheetJob\)/);
  });
  it("lists livingSheetJob in send's useCallback deps (stale-closure guard)", () => {
    const sendStart = host.indexOf("const send = useCallback(");
    expect(sendStart).toBeGreaterThan(-1);
    const deps = host.slice(sendStart).match(/\n {2}\}, \[([^\]]*)\]\);/);
    expect(deps?.[1]).toMatch(/\blivingSheetJob\b/);
  });
});
