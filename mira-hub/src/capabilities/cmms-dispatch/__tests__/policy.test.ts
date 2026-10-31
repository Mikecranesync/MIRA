/**
 * Unit coverage for `parseWritePolicy` (types.ts) and the env-driven gates
 * (policy.ts). No DB — `loadTenantWritePolicy` itself is covered end-to-end
 * by the integration suite (it is one query plus this parser).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWritePolicy } from "../types";
import { dispatchEnabled, dispatchTenantAllowlist } from "../policy";

describe("parseWritePolicy", () => {
  it("defaults to disabled for null", () => {
    expect(parseWritePolicy(null)).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("defaults to disabled for undefined", () => {
    expect(parseWritePolicy(undefined)).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("defaults to disabled for {} (the DB column default)", () => {
    expect(parseWritePolicy({})).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it.each([42, "nope", true, []])("defaults to disabled for a non-object (%j)", (raw) => {
    expect(parseWritePolicy(raw)).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("defaults to disabled when fix_recorded is missing", () => {
    expect(parseWritePolicy({ version: 1 })).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("defaults to disabled when fix_recorded is not an object", () => {
    expect(parseWritePolicy({ fix_recorded: "yes" })).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("reports disabled when fix_recorded.enabled is explicitly false", () => {
    expect(parseWritePolicy({ fix_recorded: { enabled: false } })).toEqual({
      version: 1,
      fixRecorded: { enabled: false },
    });
  });

  it("reports disabled when enabled is truthy but not literally true", () => {
    expect(parseWritePolicy({ fix_recorded: { enabled: "true" } })).toEqual({
      version: 1,
      fixRecorded: { enabled: false },
    });
  });

  it("falls back to disabled when enabled:true has no target (malformed policy never dispatches)", () => {
    expect(parseWritePolicy({ fix_recorded: { enabled: true } })).toEqual({
      version: 1,
      fixRecorded: { enabled: false },
    });
  });

  it("falls back to disabled when target.kind is unrecognized", () => {
    const raw = { fix_recorded: { enabled: true, target: { kind: "bogus" } } };
    expect(parseWritePolicy(raw)).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("falls back to disabled when target.kind is 'work_order' but externalWorkOrderId is missing", () => {
    const raw = { fix_recorded: { enabled: true, target: { kind: "work_order" } } };
    expect(parseWritePolicy(raw)).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("falls back to disabled when externalWorkOrderId is an empty/whitespace string", () => {
    const raw = { fix_recorded: { enabled: true, target: { kind: "work_order", externalWorkOrderId: "   " } } };
    expect(parseWritePolicy(raw)).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it("falls back to disabled when externalWorkOrderId is not a string", () => {
    const raw = { fix_recorded: { enabled: true, target: { kind: "work_order", externalWorkOrderId: 123 } } };
    expect(parseWritePolicy(raw)).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  // Codex round 3, F10: explicit incompatible values fail closed; omission keeps the default.
  it.each([99, 0, 2, "1", null])("fails closed when version is explicitly %j (not the literal number 1)", (version) => {
    expect(
      parseWritePolicy({ version, fix_recorded: { enabled: true, target: { kind: "work_order", externalWorkOrderId: "7" } } }),
    ).toEqual({ version: 1, fixRecorded: { enabled: false } });
  });

  it.each(["attach_evidence", "transition_work_order", "record_reading", "", null, 42])(
    "fails closed when operation is explicitly %j (not append_work_log)",
    (operation) => {
      expect(
        parseWritePolicy({ version: 1, fix_recorded: { enabled: true, operation, target: { kind: "work_order", externalWorkOrderId: "7" } } }),
      ).toEqual({ version: 1, fixRecorded: { enabled: false } });
    },
  );

  it("still parses when version and operation are omitted (defaults), and when they are the supported values", () => {
    const expected = { version: 1, fixRecorded: { enabled: true, operation: "append_work_log", target: { kind: "work_order", externalWorkOrderId: "7" } } };
    expect(parseWritePolicy({ fix_recorded: { enabled: true, target: { kind: "work_order", externalWorkOrderId: "7" } } })).toEqual(expected);
    expect(
      parseWritePolicy({ version: 1, fix_recorded: { enabled: true, operation: "append_work_log", target: { kind: "work_order", externalWorkOrderId: "7" } } }),
    ).toEqual(expected);
  });

  it("parses a valid work_order target", () => {
    const raw = { fix_recorded: { enabled: true, operation: "append_work_log", target: { kind: "work_order", externalWorkOrderId: "123" } } };
    expect(parseWritePolicy(raw)).toEqual({
      version: 1,
      fixRecorded: { enabled: true, operation: "append_work_log", target: { kind: "work_order", externalWorkOrderId: "123" } },
    });
  });

  it("parses a valid asset_linked_work_order target", () => {
    const raw = { fix_recorded: { enabled: true, target: { kind: "asset_linked_work_order" } } };
    expect(parseWritePolicy(raw)).toEqual({
      version: 1,
      fixRecorded: { enabled: true, operation: "append_work_log", target: { kind: "asset_linked_work_order" } },
    });
  });

  it("carries internal_test:true through as internalTest", () => {
    const raw = {
      fix_recorded: { enabled: true, target: { kind: "asset_linked_work_order" }, internal_test: true },
    };
    const parsed = parseWritePolicy(raw);
    expect(parsed.fixRecorded.internalTest).toBe(true);
  });

  it("omits internalTest when internal_test is absent", () => {
    const raw = { fix_recorded: { enabled: true, target: { kind: "asset_linked_work_order" } } };
    const parsed = parseWritePolicy(raw);
    expect(parsed.fixRecorded.internalTest).toBeUndefined();
  });

  it("omits internalTest when internal_test is not literally true", () => {
    const raw = {
      fix_recorded: { enabled: true, target: { kind: "asset_linked_work_order" }, internal_test: "yes" },
    };
    expect(parseWritePolicy(raw).fixRecorded.internalTest).toBeUndefined();
  });
});

describe("dispatchEnabled", () => {
  const ORIGINAL = process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED;
    else process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED = ORIGINAL;
  });

  it("is false when unset", () => {
    delete process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED;
    expect(dispatchEnabled()).toBe(false);
  });

  it("is false for any value other than the literal string 'true'", () => {
    process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED = "1";
    expect(dispatchEnabled()).toBe(false);
    process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED = "TRUE";
    expect(dispatchEnabled()).toBe(false);
  });

  it("is true only for the literal string 'true'", () => {
    process.env.NOTEBOOK_EVENT_DISPATCH_ENABLED = "true";
    expect(dispatchEnabled()).toBe(true);
  });
});

describe("dispatchTenantAllowlist", () => {
  const ORIGINAL = process.env.NOTEBOOK_EVENT_DISPATCH_TENANTS;
  beforeEach(() => {
    delete process.env.NOTEBOOK_EVENT_DISPATCH_TENANTS;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NOTEBOOK_EVENT_DISPATCH_TENANTS;
    else process.env.NOTEBOOK_EVENT_DISPATCH_TENANTS = ORIGINAL;
  });

  it("is empty when unset", () => {
    expect(dispatchTenantAllowlist()).toEqual(new Set());
  });

  it("is empty for an empty string", () => {
    process.env.NOTEBOOK_EVENT_DISPATCH_TENANTS = "";
    expect(dispatchTenantAllowlist()).toEqual(new Set());
  });

  it("trims, lowercases, and drops empty segments", () => {
    process.env.NOTEBOOK_EVENT_DISPATCH_TENANTS = " AAAA-1111 , bbbb-2222,  , cccc-3333 ";
    expect(dispatchTenantAllowlist()).toEqual(new Set(["aaaa-1111", "bbbb-2222", "cccc-3333"]));
  });

  it("nobody is allowlisted by default (empty set, not a wildcard)", () => {
    const allow = dispatchTenantAllowlist();
    expect(allow.has("any-tenant-id")).toBe(false);
  });
});
