import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { packetFixture } from "./packet-fixture";

vi.mock("@/lib/equipment-notebooks", () => ({}));
vi.mock("../store", () => ({}));
vi.mock("../intake-closeout-store", () => ({}));
vi.mock("../job-sheet-store", () => ({}));
vi.mock("@/lib/knowledge-graph/traversal", () => ({}));
vi.mock("@/capabilities/observations/store", () => ({}));
vi.mock("@/capabilities/observations/flag", () => ({}));
vi.mock("@/capabilities/cmms-dispatch/status", () => ({}));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe("configured authenticated evidence links", () => {
  it.each(["/hub", ""])("uses the same base as the read client for %j", async base => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE", base); vi.resetModules();
    const { projectAssetMemory } = await import("../asset-memory");
    const { instructionRecordV2 } = await import("../instruction-record-v2");
    const { packetBody } = await import("../packet-intake");
    const { reduceSheet } = await import("../reduce");
    const { LivingInstructionGuide } = await import("@/factorylm-ui/LivingInstructionGuide");
    const { apiAssetMemoryRecord } = await import("@/factorylm-ui/living-sheet-client");
    const nb = "22222222-2222-4222-8222-222222222222", job = "33333333-3333-4333-8333-333333333333";
    const template = packetBody(packetFixture(nb));
    const view = reduceSheet([{ id: "start", seq: 1, kind: "job_started", payload: { title: template.title, machine: { entityId: "PUMP-01", name: "Fixture" }, template, templateRevisionId: null }, actorUserId: "tech", actorLabel: "Tech", occurredAt: "2026-11-06", recordedAt: "2026-11-06", workOrderId: null }], job);
    const record = instructionRecordV2(nb, view);
    const selector = { seq: 1, snapshotId: record.snapshotId, candidate: null };
    const memory = projectAssetMemory(record, selector, { binding: "same_confirmed_asset", statuses: { graph: "empty", documents: "empty", observations: "disabled", workOrder: "empty" }, facts: [], gaps: [], startedAt: "2026-11-06", finishedAt: "2026-11-06" });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...record, assetMemory: memory }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await apiAssetMemoryRecord(nb, job, selector);
    expect(memory.source.href).toBe(fetcher.mock.calls[0][0]);
    expect(memory.source.href.startsWith(`${base}/api/equipment-notebooks/`)).toBe(true);
    expect(JSON.parse(new URL(memory.source.href, "http://test").searchParams.get("memorySelector")!)).toEqual(selector);
    const html = renderToStaticMarkup(createElement(LivingInstructionGuide, { record: { ...record, assetMemory: memory } }));
    expect(html.split(`href="${memory.source.href.replaceAll("&", "&amp;")}"`)).toHaveLength(3);
  });
});
