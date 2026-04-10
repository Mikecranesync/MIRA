/**
 * Demo data seeder — creates sample assets and work orders for new tenants.
 *
 * Called asynchronously after registration. Failures are logged but don't
 * block the signup flow.
 */

import { createWorkOrder, createAsset } from "../lib/atlas.js";

const DEMO_ASSETS = [
  {
    name: "GS10 VFD — Pump Station 2",
    description: "AutomationDirect GS10 variable frequency drive, 5HP, 460V",
    model: "GS1-45P0",
    area: "Pump Station 2",
  },
  {
    name: "Allen-Bradley PLC — Packaging Line 1",
    description: "CompactLogix L33ER controller with 16-pt I/O",
    model: "1769-L33ER",
    area: "Packaging Line 1",
  },
];

const DEMO_WORK_ORDERS = [
  {
    title: "VFD overcurrent fault E05 — Pump Station 2",
    description:
      "F05 fault code on GS10 VFD. DC bus voltage 8% below nominal. Capacitor check recommended.",
    priority: "HIGH" as const,
    status: "OPEN",
  },
  {
    title: "Conveyor belt tension adjustment — Line 3",
    description:
      "Belt tracking off by ~3mm at tail pulley. Adjust take-up assembly.",
    priority: "MEDIUM" as const,
    status: "IN_PROGRESS",
  },
  {
    title: "Robot joint 3 lubrication — quarterly PM",
    description:
      "Scheduled quarterly PM. 80cc grease via Zerk fitting at J3 axis.",
    priority: "MEDIUM" as const,
    status: "OPEN",
  },
];

export async function seedDemoData(atlasToken?: string): Promise<void> {
  for (const asset of DEMO_ASSETS) {
    try {
      await createAsset(asset, atlasToken);
    } catch (err) {
      console.error(`[seed] Failed to create asset "${asset.name}":`, err);
    }
  }

  for (const wo of DEMO_WORK_ORDERS) {
    try {
      await createWorkOrder(wo, atlasToken);
    } catch (err) {
      console.error(`[seed] Failed to create WO "${wo.title}":`, err);
    }
  }

  console.log("[seed] Demo data seeded: 2 assets, 3 work orders");
}
