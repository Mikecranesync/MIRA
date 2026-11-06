import { describe, expect, it, vi } from "vitest";
import { localInstructionInput, instructionRequestId } from "../living-instruction-client";
import { packetFixture } from "@/capabilities/living-sheet/__tests__/packet-fixture";
describe("explicit local packet intake", () => {
  it("only reads existing keys, retains the original record and recreates the same retry ID after reload", async () => {
    const p = packetFixture("nb"); const r = { version: 1, packetId: p.packetId, steps: {}, measurements: {}, notes: [], photos: [] };
    const get = vi.fn(async (key: string) => key === "work-packet-draft:nb" ? JSON.stringify(p) : key === `work-packet-record:${p.packetId}` ? JSON.stringify(r) : null);
    const first = await localInstructionInput({ get }, "nb");
    expect(first).toEqual({ packet: p, record: r }); expect(get.mock.calls.map(x => x[0])).toEqual(["work-packet-draft:nb", `work-packet-record:${p.packetId}`]);
    const reloaded = await localInstructionInput({ get }, "nb");
    expect(await instructionRequestId("tech:nb", first)).toBe(await instructionRequestId("tech:nb", reloaded));
    expect(await instructionRequestId("other", first)).not.toBe(await instructionRequestId("tech:nb", first));
    expect(await instructionRequestId("tech:nb", { ...first, packet: { ...p, disclaimer: "changed" } })).not.toBe(await instructionRequestId("tech:nb", first));
  });
  it("does not silently discard unreadable local evidence", async () => {
    await expect(localInstructionInput({ get: async () => null }, "nb")).rejects.toThrow("No local packet");
    const p = packetFixture("nb");
    await expect(localInstructionInput({ get: async key => key.includes("draft:") ? JSON.stringify(p) : "{malformed" }, "nb")).rejects.toThrow();
  });
});
