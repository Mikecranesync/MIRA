import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ rows: [] })));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn(async (_tenant: string, fn: (c: unknown) => unknown) => fn({ query })) }));
vi.mock("@/lib/db", () => ({ default: { query } }));
import { listTurns } from "@/lib/equipment-notebooks";
beforeEach(() => query.mockClear());
describe("persisted report owner/thread/equipment scope", () => {
 it.each([null, "machine-a"])("checks existing per-turn snapshot and current confirmed binding atomically: %s", async expectedEquipmentEntityId => {
   await listTurns("tenant-a", "notebook-a", 24, { viewerUserId: "tech-a", threadId: "case-a", expectedEquipmentEntityId });
   const [sql, params] = query.mock.calls[0] as [string, unknown[]];
   expect(sql).toContain("owner_user_id = $4");
   expect(sql).not.toContain("OR owner_user_id IS NULL");
   expect(sql).toContain("thread_id = $5");
   expect(sql).toContain("equipment_entity_id IS NOT DISTINCT FROM $6::text");
   expect(sql).toContain("n.equipment_entity_id IS NOT DISTINCT FROM $6::text");
   expect(sql).toContain("n.asset_confirmed_at IS NOT NULL");
   expect(sql).toContain("n.tenant_id = $1::uuid");
   expect(params).toEqual(["tenant-a", "notebook-a", 24, "tech-a", "case-a", expectedEquipmentEntityId]);
 });
 it("fails closed for scoped report recall without a viewer", async () => {
   await listTurns("tenant-a", "notebook-a", 25, { threadId: "case-a", expectedEquipmentEntityId: null });
   const [sql] = query.mock.calls[0] as [string];
   expect(sql).toContain("AND FALSE");
 });
 it("preserves the ordinary history read when recall scope was not requested", async () => {
   await listTurns("tenant-a", "notebook-a", 24, { viewerUserId: "tech-a", threadId: "case-a" });
   const [sql, params] = query.mock.calls[0] as [string, unknown[]];
   expect(sql).not.toContain("equipment_entity_id IS NOT DISTINCT");
   expect(sql).toContain("OR owner_user_id IS NULL");
   expect(params).toHaveLength(5);
 });
});
