import { describe, expect, it } from "vitest";
import { equipmentTestDatabaseUrl } from "../../../../scripts/equipment-test-database.mjs";

describe("equipment browser disposable database URL", () => {
  it("normalizes localhost and preserves explicit loopback PostgreSQL destinations", () => {
    expect(equipmentTestDatabaseUrl("postgresql://test:local@localhost:5544/equipment_browser", "DISPOSABLE"))
      .toBe("postgresql://test:local@127.0.0.1:5544/equipment_browser");
    expect(equipmentTestDatabaseUrl("postgres://[::1]:5432/equipment_browser", "DISPOSABLE"))
      .toBe("postgres://[::1]:5432/equipment_browser");
  });

  it("rejects unconfirmed, non-loopback and implicit or option-bearing URLs before use", () => {
    expect(() => equipmentTestDatabaseUrl("postgres://localhost/equipment_browser")).toThrow();
    for (const value of [
      "postgres://fixture.example.invalid/equipment_browser",
      "postgres://localhost/",
      "postgres://localhost/equipment_browser?application_name=equipment_test",
      "postgres://localhost/%65quipment_browser",
      "postgres://localhost/staging_equipment",
    ]) {
      expect(() => equipmentTestDatabaseUrl(value, "DISPOSABLE")).toThrow();
    }
  });
});
