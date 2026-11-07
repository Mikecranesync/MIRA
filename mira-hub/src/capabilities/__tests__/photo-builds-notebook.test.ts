/**
 * Photo builds the notebook (owner decision 2026-11-07): a nameplate photo
 * yields the maker + model, the official-manual search starts from that
 * reading, and a manual whose own text verifies the model is enabled for
 * answers — no typed make/model, no confirm step. The serial number on the
 * same plate never leaves and never blocks.
 *
 * Fixture: the shape of a real AutomationDirect GS10-series drive plate with a
 * SYNTHETIC serial (public repo — never a real value).
 *
 * Run: npx vitest run src/capabilities/__tests__/photo-builds-notebook.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  confirmedSameKey: false,
  ownerRows: 1,
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[]) => {
        db.queries.push({ sql, params });
        if (/FOR UPDATE/.test(sql))
          return { rowCount: db.ownerRows, rows: db.ownerRows ? [{ id: "nb", confirmed_same_key: db.confirmedSameKey }] : [] };
        if (/RETURNING match_state/.test(sql)) return { rowCount: 1, rows: [{ match_state: params[3], enabled_by_default: params[4] }] };
        if (/SELECT match_state, enabled_by_default/.test(sql)) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      }),
    }),
  ),
}));
vi.mock("@/lib/workspace-files", () => ({ attachFileToTargetsTx: vi.fn(async () => ({ ok: true, links: [] })) }));
vi.mock("@/capabilities/manual-acquisition", () => ({ acquireManualForIdentity: vi.fn() }));

import { mentionsSerialLabel, partCodes, unambiguousPartNumber } from "../photo-part-lookup";
import { extractCandidateIdentity, isSafeCandidateSearchIdentity, makerFromText } from "../candidate-identity";
import { namesOnlyThisMachine } from "../identity-proposal";
import { acquisitionDeclineText, acquisitionEnabled, fencedWriter } from "../notebook-manual-acquisition";

const SERIAL = "7A3K9Q2026X11";
const MODEL = "GS11N-20P2";
const PLATE = [
  "AutomationDirect.com",
  `MODEL: ${MODEL}`,
  "INPUT: 1PH 200-240V 50/60Hz 8.4A",
  "OUTPUT: 3PH 0-240V 2.2A 0.5kW/0.5HP",
  `SERIAL NO: ${SERIAL}`,
].join("\n");

beforeEach(() => {
  db.queries.length = 0;
  db.confirmedSameKey = false;
  db.ownerRows = 1;
});

describe("the plate's MODEL label is the part, even with a serial on the same plate", () => {
  it("MODEL: survives the serial label (the main wall)", () => {
    expect(mentionsSerialLabel(PLATE)).toBe(true); // precondition: the serial IS on the plate
    expect(partCodes(PLATE)).toEqual([MODEL]);
    expect(unambiguousPartNumber(PLATE)).toBe(MODEL);
  });

  it.each(["MOD.", "TYPE", "TYPE:", "CAT", "CAT. NO.", "MODEL NO.", "Model Number:"])("'%s' is a part label too", (label) => {
    expect(unambiguousPartNumber(`${label} ${MODEL}\nSERIAL NO: ${SERIAL}`)).toBe(MODEL);
  });

  it("the serial is never a code — not as the part, not among the codes", () => {
    expect(partCodes(PLATE).map((c) => c.toUpperCase())).not.toContain(SERIAL);
    expect(partCodes(`SERIAL NO: ${SERIAL}`)).toEqual([]);
  });

  it.each(["what model is this?", "model number please", "which type is it", "Type 1 enclosure, cat 3 stop"])(
    "control: prose after a label word is not a part — '%s'",
    (typed) => expect(unambiguousPartNumber(typed)).toBeNull(),
  );

  it("control: a plate with two labelled codes is ambiguous (fails closed)", () => {
    expect(unambiguousPartNumber(`MODEL: ${MODEL}\nP/N: 1234567-AB\nSERIAL NO: ${SERIAL}`)).toBeNull();
  });
});

describe("the maker comes from the OEM maker table, not the library", () => {
  it("'AutomationDirect.com' on the plate names the maker", () => {
    expect(makerFromText(PLATE)).toBe("AUTOMATIONDIRECT");
    expect(extractCandidateIdentity(PLATE)).toEqual({ manufacturer: "AUTOMATIONDIRECT", part: MODEL });
  });
});

describe("serial-safe egress: the plate's model may leave, its serial may not, and the serial never blocks", () => {
  it("the labelled model with a serial on the same plate is a safe search identity", () => {
    expect(namesOnlyThisMachine(PLATE, MODEL)).toBe(true);
    expect(isSafeCandidateSearchIdentity(PLATE, "", MODEL, "AUTOMATIONDIRECT")).toBe(true);
    expect(isSafeCandidateSearchIdentity(PLATE, "how do I reset a fault on it?", MODEL, "AUTOMATIONDIRECT")).toBe(true);
  });

  it("control: the serial itself is never a safe identity", () => {
    expect(isSafeCandidateSearchIdentity(PLATE, "", SERIAL, "AUTOMATIONDIRECT")).toBe(false);
  });

  it("control: a second labelled code, or a second maker in the typed text, still refuses", () => {
    expect(isSafeCandidateSearchIdentity(`${PLATE}\nP/N: 1234567-AB`, "", MODEL, "AUTOMATIONDIRECT")).toBe(false);
    expect(isSafeCandidateSearchIdentity(PLATE, "or is it the Siemens one?", MODEL, "AUTOMATIONDIRECT")).toBe(false);
  });
});

describe("one kill switch, default ON, no tenant allowlist", () => {
  it.each([
    [{}, true],
    [{ MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" }, true],
    [{ MIRA_NOTEBOOK_MANUAL_ACQUISITION: "0" }, false],
    [{ MIRA_NOTEBOOK_MANUAL_ACQUISITION: " 0 " }, false],
    [{ MIRA_NOTEBOOK_MANUAL_ACQUISITION_TENANTS: "99999999-9999-4999-8999-999999999999" }, true],
    [{ MIRA_NOTEBOOK_CANDIDATE_ACQUISITION: "0" }, true],
  ])("%j → %s", (env, want) => {
    expect(acquisitionEnabled("11111111-1111-4111-8111-111111111111", env as Record<string, string>)).toBe(want);
  });
});

describe("a photo-basis manual whose text verifies the model is enabled for answers", () => {
  it("unbound notebook + candidateApplicability 'verified' → written verified/enabled, labelled from_photo", async () => {
    db.confirmedSameKey = false;
    const res = await fencedWriter("K", "g1", "candidate")("t", "nb", "doc", {
      matchState: "verified",
      enabledByDefault: true,
      matchEvidence: { candidateApplicability: "verified" },
    });
    expect(res).toEqual({ matchState: "verified", enabledByDefault: true });
    const write = db.queries.at(-1)!;
    expect(write.params[3]).toBe("verified");
    expect(write.params[4]).toBe(true);
    expect(JSON.parse(write.params[5] as string)).toMatchObject({ autoAcquisitionKey: "K", candidateApplicability: "verified", sourceLabel: "from_photo" });
  });

  it("control: an unproven document (candidateApplicability 'candidate') stays a disabled candidate", async () => {
    const res = await fencedWriter("K", "g1", "candidate")("t", "nb", "doc", {
      matchState: "candidate",
      enabledByDefault: false,
      matchEvidence: { candidateApplicability: "candidate" },
    });
    expect(res).toEqual({ matchState: "candidate", enabledByDefault: false });
    const write = db.queries.at(-1)!;
    expect(write.params[3]).toBe("candidate");
    expect(write.params[4]).toBe(false);
  });

  it("control: the confirmed basis is unchanged — it writes exactly what the verdict asked", async () => {
    await fencedWriter("K", "g1")("t", "nb", "doc", { matchState: "verified", enabledByDefault: true, matchEvidence: {} });
    const write = db.queries.at(-1)!;
    expect(write.params[3]).toBe("verified");
    expect(write.params[4]).toBe(true);
    expect(JSON.parse(write.params[5] as string)).not.toHaveProperty("sourceLabel");
  });
});

describe("plain copy: searching, found, or failed — never 'turned off until you check it'", () => {
  const rec = (state: string, extra: Record<string, unknown> = {}) =>
    ({ key: "K", state, started_at: null, finished_at: null, candidate_host: null, match_state: null, oem_request_url: null, ...extra }) as never;

  it("running: says it is searching from the photo and will answer from the manual", () => {
    const t = acquisitionDeclineText(rec("running"), "K", "AUTOMATIONDIRECT GS11N-20P2", "candidate")!;
    expect(t).toMatch(/looking for the official AUTOMATIONDIRECT GS11N-20P2 manual now/);
    expect(t).toMatch(/photo/i);
    expect(t).not.toMatch(/turned off until you check it/);
  });

  it("complete: says the manual was found from the photo and is on", () => {
    const t = acquisitionDeclineText(rec("complete"), "K", "AUTOMATIONDIRECT GS11N-20P2", "candidate")!;
    expect(t).toMatch(/found the official AUTOMATIONDIRECT GS11N-20P2 manual/);
    expect(t).toMatch(/photo/i);
    expect(t).not.toMatch(/turn it on/);
  });
});
