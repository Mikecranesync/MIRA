/**
 * The repeated-serial advisory: after a technician confirms a component whose serial number is usable,
 * the same tenant's other components carrying that serial are listed as a warning. Never a block,
 * never a merge, never a serial in the answer or the log. No database: withTenantContext is a
 * recording fake, the matcher and the row decoder are the real ones.
 *
 * Run: npx vitest run src/capabilities/bench-components/__tests__/same-serial.test.ts
 */
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { withTenantContext } = vi.hoisted(() => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext }));

import { SAME_SERIAL_DEADLINE_MS, SAME_SERIAL_LIMIT, SAME_SERIAL_SQL, sameSerialAdvisory, usableSerial } from "../same-serial";
import type { StoredRevision } from "../store";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SAVED_ID = "44444444-4444-4444-8444-444444444444";
const SERIAL = "SN-00 77A";
const OTHER_SPELLING = "sn0077a";

const saved = (over: Partial<StoredRevision> = {}): { id: string; current: StoredRevision | null } => ({
  id: SAVED_ID,
  current: {
    componentId: SAVED_ID,
    revision: 2,
    rawLabel: null,
    inputKind: "typed",
    manufacturer: "AutomationDirect",
    family: null,
    catalogNumber: "GS11N-20P2",
    serialNumber: SERIAL,
    hardwareRevision: null,
    localTag: "VFD1",
    identityStatus: "user_confirmed",
    unresolved: [],
    evidenceFileId: null,
    evidenceNote: null,
    confirmedAt: "2026-11-19T10:00:00.000Z",
    createdAt: "2026-11-19T10:00:00.000Z",
    ...over,
  },
});

let n = 0;
/** A row in the column shape componentReadProjection.decode reads, plus the notebook name. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  n += 1;
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  return {
    id,
    notebook_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    position: 0,
    kind: "drive",
    origin: "technician",
    created_at: new Date("2026-11-01T00:00:00.000Z"),
    retired_at: null,
    component_id: id,
    revision: 1,
    raw_label: null,
    input_kind: "typed",
    manufacturer: "Siemens",
    family: null,
    catalog_number: "6SL3210",
    serial_number: OTHER_SPELLING,
    hardware_revision: null,
    local_tag: "VFD2",
    identity_status: "user_confirmed",
    unresolved: [],
    evidence_file_id: null,
    evidence_note: null,
    confirmed_at: new Date("2026-11-01T00:00:00.000Z"),
    revision_created_at: new Date("2026-11-01T00:00:00.000Z"),
    revision_request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    notebook_name: "Line 2 drives",
    ...over,
  };
}

/** withTenantContext runs the callback against a client that records each query and answers `rows`. */
function answerWith(rows: Record<string, unknown>[]) {
  const queries: { text: string; params: unknown[] }[] = [];
  withTenantContext.mockImplementation(async (_tenant: string, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: async (text: string, params: unknown[]) => (queries.push({ text, params }), { rows }) }),
  );
  return queries;
}

const everything = (value: unknown) => inspect(value, { depth: null, showHidden: true }) + JSON.stringify(value ?? null);
const spellings = [SERIAL, SERIAL.toLowerCase(), OTHER_SPELLING, "sn0077a", "00 77a"];

beforeEach(() => {
  n = 0;
  withTenantContext.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("same serial: which serials the warning can use", () => {
  it.each([["AB12345"], ["abc"], ["ab-1"], ["000000"]])("same serial: %j is usable", (s) => {
    expect(usableSerial(s)).toBe(true);
  });

  it.each([["ab"], ["a-b"], ["---"], ["   "], [""], [null], [undefined], ["N/A"], ["unknown"], ["0000"], ["xxx"]])(
    "same serial: %j is not usable (too short or a placeholder)",
    (s) => {
      expect(usableSerial(s as string | null | undefined)).toBe(false);
    },
  );
});

describe("same serial: what the lookup returns", () => {
  it("same serial: a confirmed component whose serial another component carries in a different spelling lists that component", async () => {
    const other = row();
    answerWith([other]);
    expect(await sameSerialAdvisory(TENANT, saved())).toEqual({
      status: "checked",
      candidates: [
        {
          componentId: other.id,
          notebookId: other.notebook_id,
          notebookName: "Line 2 drives",
          label: "VFD2 · Siemens 6SL3210",
          retired: false,
        },
      ],
      truncated: false,
    });
  });

  it("same serial: one read, bound to the tenant, the component, the serial exactly as saved and one more than the limit", async () => {
    const queries = answerWith([]);
    await sameSerialAdvisory(TENANT, saved());
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([TENANT, SAVED_ID, SERIAL, SAME_SERIAL_LIMIT + 1]);
    expect(SAME_SERIAL_LIMIT + 1).toBe(11);
    expect(queries[0].text).toBe(SAME_SERIAL_SQL);
    for (const s of spellings) expect(queries[0].text).not.toContain(s);
    expect(withTenantContext).toHaveBeenCalledTimes(1);
    const [tenant, , options] = withTenantContext.mock.calls[0];
    expect(tenant).toBe(TENANT);
    expect(options).toMatchObject({ readOnly: true });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("same serial: a row whose serial differs after folding is dropped even though the database returned it", async () => {
    const same = row();
    answerWith([row({ serial_number: "sn0077b" }), same]);
    const out = await sameSerialAdvisory(TENANT, saved());
    expect(out).toMatchObject({ status: "checked", truncated: false });
    expect(out.status === "checked" && out.candidates.map((c) => c.componentId)).toEqual([same.id]);
  });

  it("same serial: a row with no serial is dropped even though the database returned it", async () => {
    answerWith([row({ serial_number: null })]);
    expect(await sameSerialAdvisory(TENANT, saved())).toEqual({ status: "checked", candidates: [], truncated: false });
  });

  it("same serial: a dropped row among eleven still reports that there may be more", async () => {
    const rows = [row({ serial_number: "sn0077b" }), ...Array.from({ length: 10 }, () => row())];
    answerWith(rows);
    const out = await sameSerialAdvisory(TENANT, saved());
    expect(out.status === "checked" && out.candidates).toHaveLength(10);
    expect(out).toMatchObject({ status: "checked", truncated: true });
  });

  it("same serial: eleven matches list ten and say there are more; ten matches list ten and say nothing is missing", async () => {
    const eleven = Array.from({ length: 11 }, () => row());
    answerWith(eleven);
    const many = await sameSerialAdvisory(TENANT, saved());
    expect(many.status === "checked" && many.candidates.map((c) => c.componentId)).toEqual(eleven.slice(0, 10).map((r) => r.id));
    expect(many).toMatchObject({ truncated: true });
    answerWith(eleven.slice(0, 10));
    const ten = await sameSerialAdvisory(TENANT, saved());
    expect(ten.status === "checked" && ten.candidates).toHaveLength(10);
    expect(ten).toMatchObject({ truncated: false });
  });

  it("same serial: a retired component with the same serial is listed as retired", async () => {
    answerWith([row({ retired_at: new Date("2026-11-10T00:00:00.000Z") })]);
    const out = await sameSerialAdvisory(TENANT, saved());
    expect(out.status === "checked" && out.candidates.map((c) => c.retired)).toEqual([true]);
  });

  it("same serial: the answer never contains the serial in any spelling", async () => {
    answerWith([row(), row({ retired_at: new Date("2026-11-10T00:00:00.000Z") })]);
    const text = JSON.stringify(await sameSerialAdvisory(TENANT, saved())).toLowerCase();
    expect(text).toContain("line 2 drives");
    for (const s of spellings) expect(text).not.toContain(s.toLowerCase());
  });
});

describe("same serial: when it does not look", () => {
  it.each([["candidate"], ["unknown"]] as const)("same serial: an identity that is only %s is not checked and nothing is read", async (identityStatus) => {
    answerWith([row()]);
    expect(await sameSerialAdvisory(TENANT, saved({ identityStatus }))).toEqual({ status: "not_checked", reason: "not_confirmed" });
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("same serial: a component with no identity yet is not checked and nothing is read", async () => {
    expect(await sameSerialAdvisory(TENANT, { id: SAVED_ID, current: null })).toEqual({ status: "not_checked", reason: "not_confirmed" });
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it.each([["N/A"], ["0000"], ["ab"], [null]])("same serial: a confirmed component with serial %j has nothing usable to compare and nothing is read", async (serialNumber) => {
    expect(await sameSerialAdvisory(TENANT, saved({ serialNumber }))).toEqual({ status: "not_checked", reason: "no_usable_serial" });
    expect(withTenantContext).not.toHaveBeenCalled();
  });
});

describe("same serial: a failing lookup never breaks the save and never leaks the serial", () => {
  it("same serial: a database error carrying the serial answers lookup_failed, throws nothing and logs only a fixed shape", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    withTenantContext.mockRejectedValue(
      Object.assign(new Error(`bad value ${SERIAL}`), { detail: `Key (serial)=(${SERIAL}) conflicts`, code: `bad ${SERIAL}` }),
    );
    expect(await sameSerialAdvisory(TENANT, saved())).toEqual({ status: "not_checked", reason: "lookup_failed" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual(["[bench-components] same-serial lookup failed", { componentId: SAVED_ID, sqlstate: null, deadline: false }]);
    const logged = everything(log.mock.calls).toLowerCase();
    for (const s of spellings) expect(logged).not.toContain(s.toLowerCase());
  });

  it("same serial: a five-character database error code is logged as the sqlstate", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    withTenantContext.mockRejectedValue({ code: "57014" });
    expect(await sameSerialAdvisory(TENANT, saved())).toEqual({ status: "not_checked", reason: "lookup_failed" });
    expect(log.mock.calls[0][1]).toEqual({ componentId: SAVED_ID, sqlstate: "57014", deadline: false });
  });

  it.each([
    ["a code that starts like one and then carries the serial", `57014 ${SERIAL}`, SERIAL],
    ["a five-character code that is itself the saved serial, typed another way", "AB123", "ab-123"],
  ])("same serial: %s is not logged", async (_name, code, serialNumber) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    withTenantContext.mockRejectedValue({ code });
    expect(await sameSerialAdvisory(TENANT, saved({ serialNumber }))).toEqual({ status: "not_checked", reason: "lookup_failed" });
    expect(log.mock.calls[0][1]).toEqual({ componentId: SAVED_ID, sqlstate: null, deadline: false });
    const logged = everything(log.mock.calls).toLowerCase();
    for (const s of [...spellings, "ab123", "ab-123"]) expect(logged).not.toContain(s.toLowerCase());
  });

  it("same serial: the deadline is put away as soon as the lookup answers, fails or cannot even start", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    withTenantContext.mockImplementation(async (_t: string, fn: (c: unknown) => Promise<unknown>, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return fn({ query: async () => ({ rows: [row()] }) });
    });
    expect(await sameSerialAdvisory(TENANT, saved())).toMatchObject({ status: "checked" });
    expect(vi.getTimerCount()).toBe(0);
    // Long after an answered lookup nothing fires: no abort, no log.
    await vi.advanceTimersByTimeAsync(SAME_SERIAL_DEADLINE_MS * 2);
    expect(signal!.aborted).toBe(false);
    expect(log).not.toHaveBeenCalled();

    withTenantContext.mockRejectedValue(new Error("down"));
    expect(await sameSerialAdvisory(TENANT, saved())).toEqual({ status: "not_checked", reason: "lookup_failed" });
    expect(vi.getTimerCount()).toBe(0);

    withTenantContext.mockImplementation(() => { throw new Error("could not start"); });
    expect(await sameSerialAdvisory(TENANT, saved())).toEqual({ status: "not_checked", reason: "lookup_failed" });
    expect(vi.getTimerCount()).toBe(0);
    expect(log.mock.calls.map((c) => c[1])).toEqual([
      { componentId: SAVED_ID, sqlstate: null, deadline: false },
      { componentId: SAVED_ID, sqlstate: null, deadline: false },
    ]);
  });

  it("same serial: a lookup that never answers is given up on at the deadline, aborted, logged as a deadline and leaves nothing unhandled", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      let signal: AbortSignal | undefined;
      let failLater!: (e: unknown) => void;
      withTenantContext.mockImplementation((_t: string, _fn: unknown, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise((_, reject) => { failLater = reject; });
      });
      let settled: unknown;
      const pending = sameSerialAdvisory(TENANT, saved()).then((v) => (settled = v));
      await vi.advanceTimersByTimeAsync(SAME_SERIAL_DEADLINE_MS - 1);
      expect(settled).toBeUndefined();
      expect(signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toEqual({ status: "not_checked", reason: "lookup_failed" });
      expect(signal!.aborted).toBe(true);
      expect(log.mock.calls[0][1]).toEqual({ componentId: SAVED_ID, sqlstate: null, deadline: true });
      // The abandoned lookup finally fails, seconds later.
      failLater(new DOMException("aborted", "AbortError"));
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("same serial: a row that cannot be read answers lookup_failed instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answerWith([row({ id: { toString: () => { throw new Error(`cannot read ${SERIAL}`); } } })]);
    await expect(sameSerialAdvisory(TENANT, saved())).resolves.toEqual({ status: "not_checked", reason: "lookup_failed" });
  });
});
