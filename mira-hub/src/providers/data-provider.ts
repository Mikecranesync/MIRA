"use client";

import dataProvider from "@refinedev/simple-rest";
import type { DataProvider } from "@refinedev/core";

const MOCK_ASSETS = [
  { id: "1", name: "Air Compressor #1", type: "Mechanical", status: "Running",  location: "Building A", lastPM: "2026-03-15" },
  { id: "2", name: "Conveyor Belt #3",  type: "Electrical", status: "Needs PM", location: "Building B", lastPM: "2026-01-20" },
  { id: "3", name: "CNC Mill #7",       type: "CNC",        status: "Running",  location: "Shop Floor", lastPM: "2026-04-01" },
  { id: "4", name: "HVAC Unit #2",      type: "HVAC",       status: "Down",     location: "Roof",       lastPM: "2025-12-10" },
  { id: "5", name: "Pump Station A",    type: "Fluid",      status: "Running",  location: "Basement",   lastPM: "2026-02-28" },
];

const MOCK_WORK_ORDERS = [
  { id: "WO-2026-001", title: "PM Air Compressor #1",     asset: "Air Compressor #1", priority: "High",     status: "Open",        assignee: "Mike H.", due: "2026-04-25" },
  { id: "WO-2026-002", title: "Replace conveyor belt",     asset: "Conveyor Belt #3",  priority: "Critical", status: "In Progress", assignee: "John S.", due: "2026-04-23" },
  { id: "WO-2026-003", title: "Quarterly HVAC inspection", asset: "HVAC Unit #2",      priority: "Medium",   status: "Open",        assignee: "—",       due: "2026-04-30" },
  { id: "WO-2026-004", title: "Lubrication PM cycle",      asset: "CNC Mill #7",       priority: "Low",      status: "Scheduled",   assignee: "Mike H.", due: "2026-05-01" },
];

const MOCK_DATA: Record<string, Record<string, unknown>[]> = {
  assets: MOCK_ASSETS,
  workorders: MOCK_WORK_ORDERS,
  "work-orders": MOCK_WORK_ORDERS,
};

const mockProvider: DataProvider = {
  getList: async ({ resource }) => ({
    data: (MOCK_DATA[resource] ?? []) as never[],
    total: (MOCK_DATA[resource] ?? []).length,
  }),
  getOne: async ({ resource, id }) => ({
    data: ((MOCK_DATA[resource] ?? []).find((item) => item.id === String(id)) ?? {}) as never,
  }),
  create: async ({ variables }) => ({ data: variables as never }),
  update: async ({ variables }) => ({ data: variables as never }),
  deleteOne: async ({ id }) => ({ data: { id } as never }),
  getApiUrl: () => process.env.NEXT_PUBLIC_PIPELINE_API_URL ?? "http://localhost:9099",
};

const pipelineUrl = process.env.NEXT_PUBLIC_PIPELINE_API_URL;

export const hubDataProvider: DataProvider = pipelineUrl
  ? dataProvider(pipelineUrl)
  : mockProvider;
