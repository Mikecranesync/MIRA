import { describe, expect, it } from "vitest";
import { INVENTORY_SCHEMA, tierLabel, validateInventory } from "@/lib/discovery";

function validPayload() {
  return {
    schema: INVENTORY_SCHEMA,
    scanned_at: "2026-05-29T00:00:00Z",
    scan: { subnets: ["192.168.1.0/24"], gentle: false },
    devices: [
      {
        transport: "ethernet",
        address: "192.168.1.100",
        tier: "device_identified",
        protocol: "ethernet_ip",
        profile: "micro820",
        identity: { vendor: "1", product: "2080-LC20-20QBB", serial: "D096D30C" },
        evidence: ["enip list-identity reply"],
        uns_hint: "enterprise.knowledge_base.rockwell_automation.micro820",
        next_actions: ["Deploy the Modbus map: python plc/deploy_modbus_map.py --auto"],
      },
    ],
    unknowns: [{ address: "192.168.1.50", open_ports: [502], note: "speaks Modbus, no profile match" }],
  };
}

describe("validateInventory", () => {
  it("accepts a well-formed fieldbus-inventory/1 payload", () => {
    const res = validateInventory(validPayload());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.inventory.devices).toHaveLength(1);
      expect(res.inventory.devices[0].profile).toBe("micro820");
      expect(res.inventory.devices[0].uns_hint).toContain("micro820");
      expect(res.inventory.unknowns).toHaveLength(1);
    }
  });

  it("rejects a wrong/missing schema tag", () => {
    const bad = { ...validPayload(), schema: "fieldbus-inventory/2" };
    const res = validateInventory(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/schema/);
  });

  it("rejects a non-object payload", () => {
    expect(validateInventory(null).ok).toBe(false);
    expect(validateInventory("nope").ok).toBe(false);
    expect(validateInventory([]).ok).toBe(false);
  });

  it("rejects when devices is not an array", () => {
    const bad = { ...validPayload(), devices: "x" };
    const res = validateInventory(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/devices/);
  });

  it("rejects an unknown tier", () => {
    const bad = validPayload();
    (bad.devices[0] as { tier: string }).tier = "made_up";
    const res = validateInventory(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tier/);
  });

  it("defaults optional fields leniently", () => {
    const lean = {
      schema: INVENTORY_SCHEMA,
      devices: [{ address: "10.0.0.1", tier: "port_open" }],
    };
    const res = validateInventory(lean);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const d = res.inventory.devices[0];
      expect(d.transport).toBe("ethernet");
      expect(d.protocol).toBe("unknown");
      expect(d.profile).toBeNull();
      expect(d.evidence).toEqual([]);
      expect(d.next_actions).toEqual([]);
      expect(res.inventory.unknowns).toEqual([]);
      expect(res.inventory.scanned_at).toBeNull();
    }
  });
});

describe("tierLabel", () => {
  it("maps every tier to a human label", () => {
    expect(tierLabel("device_identified")).toBe("Identified");
    expect(tierLabel("protocol_confirmed")).toBe("Protocol confirmed");
    expect(tierLabel("port_open")).toBe("Port open");
  });
});
