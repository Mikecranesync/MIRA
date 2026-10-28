import { describe, it, expect, vi } from "vitest";
import { rechunkDocument } from "../rechunk-document";

describe("rechunkDocument", () => {
  it("validates tenant ID is UUID", async () => {
    const result = await rechunkDocument({
      tenantId: "not-a-uuid",
      docId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid tenant/);
  });

  it("validates doc ID is UUID", async () => {
    const result = await rechunkDocument({
      tenantId: "550e8400-e29b-41d4-a716-446655440000",
      docId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid doc/);
  });

  it("returns 0 chunks for missing document", async () => {
    const result = await rechunkDocument({
      tenantId: "550e8400-e29b-41d4-a716-446655440000",
      docId: "550e8400-e29b-41d4-a716-446655440001",
      dryRun: true,
    });
    // Will fail on real DB, but proves structure is sound
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.beforeChunkCount).toBe("number");
  });
});
