import { describe, test, expect } from "vitest";
import { formatEntityContext } from "../context-builder";

// formatEntityContext is pure — no DB required.

const BASE_ENTITY = {
  id: "uuid-eq-1",
  entity_type: "equipment",
  entity_id: "VFD-07",
  name: "Allen-Bradley PowerFlex 755",
  properties: {
    manufacturer: "Allen-Bradley",
    model_number: "PowerFlex 755",
    equipment_type: "VFD",
    location: "Line 3, Building A",
    criticality: "high",
  },
};

const BASE_FULL = {
  entity: BASE_ENTITY,
  outgoing: [],
  incoming: [],
  triples: [],
};

describe("formatEntityContext — header", () => {
  test("includes entity_id in header", () => {
    const ctx = formatEntityContext(BASE_FULL);
    expect(ctx).toContain("[GRAPH CONTEXT for VFD-07]");
  });

  test("includes manufacturer and model in type line", () => {
    const ctx = formatEntityContext(BASE_FULL);
    expect(ctx).toContain("Allen-Bradley");
    expect(ctx).toContain("PowerFlex 755");
    expect(ctx).toContain("VFD");
  });

  test("includes criticality", () => {
    const ctx = formatEntityContext(BASE_FULL);
    expect(ctx).toContain("Criticality: high");
  });
});

describe("formatEntityContext — location", () => {
  test("prefers located_at relationship over property", () => {
    const full = {
      ...BASE_FULL,
      outgoing: [{
        id: "rel-1", source_id: "uuid-eq-1", target_id: "uuid-loc-1",
        relationship_type: "located_at",
        source_entity_id: "VFD-07", target_entity_id: "line-3-building-a",
        target_name: "Line 3, Building A", source_name: "Allen-Bradley PowerFlex 755",
      }],
    };
    const ctx = formatEntityContext(full);
    expect(ctx).toContain("Location: Line 3, Building A");
  });

  test("falls back to property location when no located_at rel", () => {
    const ctx = formatEntityContext(BASE_FULL);
    expect(ctx).toContain("Location: Line 3, Building A");
  });
});

describe("formatEntityContext — work orders + PMs", () => {
  test("shows work order count", () => {
    const full = {
      ...BASE_FULL,
      outgoing: [
        {
          id: "rel-wo1", source_id: "uuid-eq-1", target_id: "uuid-wo1",
          relationship_type: "has_work_order",
          source_entity_id: "VFD-07", target_entity_id: "wo-001",
          target_name: "Replace capacitor", source_name: "Allen-Bradley PowerFlex 755",
        },
        {
          id: "rel-wo2", source_id: "uuid-eq-1", target_id: "uuid-wo2",
          relationship_type: "has_work_order",
          source_entity_id: "VFD-07", target_entity_id: "wo-002",
          target_name: "Bearing inspection", source_name: "Allen-Bradley PowerFlex 755",
        },
      ],
    };
    const ctx = formatEntityContext(full);
    expect(ctx).toContain("Work orders on record: 2");
  });

  test("shows PM schedule task name", () => {
    const full = {
      ...BASE_FULL,
      outgoing: [{
        id: "rel-pm1", source_id: "uuid-eq-1", target_id: "uuid-pm1",
        relationship_type: "has_pm",
        source_entity_id: "VFD-07", target_entity_id: "pm-001",
        target_name: "Quarterly filter change", source_name: "Allen-Bradley PowerFlex 755",
      }],
    };
    const ctx = formatEntityContext(full);
    expect(ctx).toContain("PM schedules: 1");
    expect(ctx).toContain("Quarterly filter change");
  });
});

describe("formatEntityContext — fault codes", () => {
  test("aggregates repeated fault codes with count", () => {
    const full = {
      ...BASE_FULL,
      triples: [
        { subject: "Allen-Bradley PowerFlex 755", predicate: "exhibited_fault", object: "F005", extracted_at: "2026-04-01T00:00:00Z" },
        { subject: "Allen-Bradley PowerFlex 755", predicate: "exhibited_fault", object: "F005", extracted_at: "2026-04-02T00:00:00Z" },
        { subject: "Allen-Bradley PowerFlex 755", predicate: "exhibited_fault", object: "OC", extracted_at: "2026-04-03T00:00:00Z" },
      ],
    };
    const ctx = formatEntityContext(full);
    expect(ctx).toContain("F005 ×2");
    expect(ctx).toContain("OC");
  });

  test("omits fault line when no fault triples", () => {
    const ctx = formatEntityContext(BASE_FULL);
    expect(ctx).not.toContain("Recent faults:");
  });
});

describe("formatEntityContext — parts + actions", () => {
  test("shows part entity_ids on record", () => {
    const full = {
      ...BASE_FULL,
      outgoing: [{
        id: "rel-p1", source_id: "uuid-eq-1", target_id: "uuid-part-1",
        relationship_type: "requires_part",
        source_entity_id: "VFD-07", target_entity_id: "IR-39868252",
        target_name: "Air Filter Element", source_name: "Allen-Bradley PowerFlex 755",
      }],
    };
    const ctx = formatEntityContext(full);
    expect(ctx).toContain("IR-39868252");
  });

  test("shows recent maintenance actions", () => {
    const full = {
      ...BASE_FULL,
      triples: [
        { subject: "Allen-Bradley PowerFlex 755", predicate: "performed_action", object: "replaced", extracted_at: "2026-04-01T00:00:00Z" },
        { subject: "Allen-Bradley PowerFlex 755", predicate: "performed_action", object: "calibrated", extracted_at: "2026-04-02T00:00:00Z" },
      ],
    };
    const ctx = formatEntityContext(full);
    expect(ctx).toContain("Recent maintenance actions:");
    expect(ctx).toContain("replaced");
    expect(ctx).toContain("calibrated");
  });
});

describe("formatEntityContext — graceful empty data", () => {
  test("entity with no relationships or triples still returns valid block", () => {
    const minimal = {
      entity: {
        id: "uuid-1", entity_type: "equipment_tag", entity_id: "PUMP-99",
        name: "PUMP-99", properties: {},
      },
      outgoing: [],
      incoming: [],
      triples: [],
    };
    const ctx = formatEntityContext(minimal);
    expect(ctx).toContain("[GRAPH CONTEXT for PUMP-99]");
    expect(ctx).not.toContain("undefined");
    expect(ctx).not.toContain("null");
  });
});
