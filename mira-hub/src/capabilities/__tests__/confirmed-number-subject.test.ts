// #6085: a thread-scoped detail read counts the numbers the technician confirmed, for a settled
// identity and the notebook's own model only, and reads them only when the thread would
// otherwise be withheld.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/confirmed-number-subject
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  deleteNotebook: vi.fn(), getNotebook: vi.fn(), listSources: vi.fn(), listTurns: vi.fn(),
  listThreads: vi.fn(async () => []), updateNotebook: vi.fn(), normalizeNotebookThreadId: vi.fn((v: string) => v),
}));
vi.mock("@/lib/workspace-files", () => ({ listFilesForTarget: vi.fn(async () => []) }));
const currentManualSearchStatus = vi.hoisted(() => vi.fn());
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return { currentManualSearchStatus, threadStatusScope: actual.threadStatusScope, offeredOwnNumber: actual.offeredOwnNumber };
});
const readConfirmedNumbers = vi.hoisted(() => vi.fn());
vi.mock("@/capabilities/confirmed-numbers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/confirmed-numbers")>()),
  readConfirmedNumbers,
}));

import { GET } from "@/app/api/equipment-notebooks/[id]/route";
import { numbersForMachine } from "@/capabilities/manual-status-subject";
import { offeredOwnNumber } from "@/capabilities/notebook-manual-acquisition";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns } from "@/lib/equipment-notebooks";
import type { EquipmentNotebook } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const THREAD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const threadReq = { nextUrl: { searchParams: new URLSearchParams({ threadId: THREAD }) } } as unknown as NextRequest;
const params = { params: Promise.resolve({ id: NB }) };
const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";
const NOTEBOOK = { id: NB, displayName: "Panel", identityStatus: "user_confirmed", identitySourceType: "user", manufacturer: "Siemens", model: "TP700", catalogNumber: "" };
const READY = { manufacturer: "Siemens", model: "TP700", running: false, message: "SIMATIC HMI Comfort Panels manual is ready in Sources." };
const saved = (number: string, manufacturer = "Siemens", model = "TP700") => ({ number, manufacturer, model, confirmedAt: "2026-11-27T00:00:00.000Z" });
const ask = (question: string) => ({ id: "t", question, evidence: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT, email: "x@y", status: "trial", trialExpiresAt: null, role: "owner" } as never);
  vi.mocked(getNotebook).mockResolvedValue(NOTEBOOK as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
  vi.mocked(listTurns).mockResolvedValue([ask(J2)] as never);
  currentManualSearchStatus.mockResolvedValue(READY);
  readConfirmedNumbers.mockResolvedValue([saved("6AV2124-0GC01-0AX0")]);
});

describe("GET notebook detail: a confirmed number (#6085)", () => {
  it("shows the status in the walk thread once the number is confirmed", async () => {
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toEqual(READY);
    expect(body).not.toHaveProperty("manualSearchScope");
    expect(readConfirmedNumbers).toHaveBeenCalledWith(TENANT, NB);
  });

  it("control: with no saved number the walk thread is withheld as today", async () => {
    readConfirmedNumbers.mockResolvedValue([]);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
  });

  it("control: a TP900 thread stays withheld whatever is saved", async () => {
    vi.mocked(listTurns).mockResolvedValue([ask(J2), ask("Find the manual for Siemens TP900 Comfort 6AV2124-0JC01-0AX0")] as never);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearchScope).toBe("other_model");
  });

  // Review Focus 4. The question names only the number, so the saved entry alone decides it:
  // counted, the thread would be own; filtered out for the old identity, it is withheld.
  const ONLY_NUMBER = "Siemens panel 6AV2124-0GC01-0AX0 will not power up";
  it("a number saved for the notebook's earlier identity does not count", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ ...NOTEBOOK, model: "TP900" } as never);
    currentManualSearchStatus.mockResolvedValue({ ...READY, model: "TP900" });
    vi.mocked(listTurns).mockResolvedValue([ask(ONLY_NUMBER)] as never);
    const body = await (await GET(threadReq, params)).json();
    expect(readConfirmedNumbers).toHaveBeenCalledTimes(1); // precondition: the entry was read
    expect(body.manualSearchScope).toBe("other_model");
  });

  it("control: the same thread shows the status on the identity the number was saved for", async () => {
    vi.mocked(listTurns).mockResolvedValue([ask(ONLY_NUMBER)] as never);
    expect((await (await GET(threadReq, params)).json()).manualSearch).toEqual(READY);
  });

  // A catalog confirmed after the tick (PATCH keeps the identity confirmed) is the machine's
  // number; the ticked one stops counting, fail closed.
  it("a different catalog confirmed later withholds the thread the ticked number settled", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ ...NOTEBOOK, catalogNumber: "6AV2124-0JC01-0AX0" } as never);
    vi.mocked(listTurns).mockResolvedValue([ask(ONLY_NUMBER)] as never);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
  });

  // Review Focus 5: follow polling in an own thread adds no query.
  it("an own thread never reads the saved numbers", async () => {
    vi.mocked(listTurns).mockResolvedValue([ask("Find the manual for Siemens TP700")] as never);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toEqual(READY);
    expect(readConfirmedNumbers).not.toHaveBeenCalled();
  });

  it("a whole-notebook read never reads the saved numbers", async () => {
    await GET({ nextUrl: { searchParams: new URLSearchParams() } } as unknown as NextRequest, params);
    expect(readConfirmedNumbers).not.toHaveBeenCalled();
  });

  it("an unsettled identity never reads the saved numbers", async () => {
    vi.mocked(getNotebook).mockResolvedValue({ ...NOTEBOOK, identityStatus: "unconfirmed" } as never);
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearchScope).toBe("other_model");
    expect(readConfirmedNumbers).not.toHaveBeenCalled();
  });

  it("a reader that fails keeps today's withheld status, with its scope", async () => {
    readConfirmedNumbers.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = await (await GET(threadReq, params)).json();
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
  });
});

// The card's offer scopes the card's message alone, with the proposal's maker and model and no
// catalog number. The read scopes the whole thread with the notebook as the confirm left it.
// They agree because (a) the scope is decided by the NEWEST question that names a model, and the
// card's message names one whenever a number is offered, and (b) this route's proposals carry no
// catalog number, so the confirm writes an empty one. Pinned here end to end with the real code.
describe("offer, confirm and read agree (#6085)", () => {
  const AFTER_CONFIRM = { ...NOTEBOOK, catalogNumber: "" };

  it("the offered number, once confirmed, makes the read show the status", async () => {
    const offered = offeredOwnNumber(J2, { manufacturer: "Siemens", model: "TP700" })!;
    expect(offered).toBe("6AV2124-0GC01-0AX0");
    vi.mocked(getNotebook).mockResolvedValue(AFTER_CONFIRM as never);
    readConfirmedNumbers.mockResolvedValue([saved(offered)]);
    expect((await (await GET(threadReq, params)).json()).manualSearch).toEqual(READY);
  });

  it("a card on a later turn agrees too: older questions about another model do not decide", async () => {
    vi.mocked(getNotebook).mockResolvedValue(AFTER_CONFIRM as never);
    vi.mocked(listTurns).mockResolvedValue([ask("Find the manual for Siemens TP900 Comfort"), ask(J2), ask("What fuse does it take?")] as never);
    expect((await (await GET(threadReq, params)).json()).manualSearch).toEqual(READY);
  });

  it("control: a newer question about another model still withholds", async () => {
    vi.mocked(getNotebook).mockResolvedValue(AFTER_CONFIRM as never);
    vi.mocked(listTurns).mockResolvedValue([ask(J2), ask("Find the manual for Siemens TP900 Comfort")] as never);
    expect((await (await GET(threadReq, params)).json()).manualSearchScope).toBe("other_model");
  });
});

// #6104 r3 F6: an entry already saved with another machine's model counts for nothing.
describe("GET notebook detail: a saved number tied to another machine (#6104 r3 F6)", () => {
  const S7_THREAD = "Find the manual for Siemens S7-1200";

  it("control: with no saved number the S7-1200 thread is withheld", async () => {
    vi.mocked(listTurns).mockResolvedValue([ask(S7_THREAD)] as never);
    readConfirmedNumbers.mockResolvedValue([]);
    expect((await (await GET(threadReq, params)).json()).manualSearchScope).toBe("other_model");
  });

  it("a saved S7-1200 entry leaves the S7-1200 thread withheld", async () => {
    vi.mocked(listTurns).mockResolvedValue([ask(S7_THREAD)] as never);
    readConfirmedNumbers.mockResolvedValue([saved("S7-1200")]);
    const body = await (await GET(threadReq, params)).json();
    expect(readConfirmedNumbers).toHaveBeenCalledWith(TENANT, NB); // precondition: the entry was read
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
  });
});

// #6127 (#6104 r4 F9): a saved number settles a thread only when the question names no maker, or
// this machine's maker alone. The questions below differ only in the maker words.
describe("GET notebook detail: a saved number in a question naming two makers (#6127)", () => {
  const MIXED = "How do I wire the ABB 6AV2124-0GC01-0AX0 in our Siemens cabinet?";
  const SIEMENS_ONLY = "How do I wire the Siemens 6AV2124-0GC01-0AX0 in our Siemens cabinet?";
  const ABB_ONLY = "How do I wire the ABB 6AV2124-0GC01-0AX0 in our ABB cabinet?";
  const NO_MAKER = "How do I wire the 6AV2124-0GC01-0AX0 in our cabinet?";
  const read = async (question: string) => {
    vi.mocked(listTurns).mockResolvedValue([ask(question)] as never);
    return (await GET(threadReq, params)).json();
  };

  it("precondition: without the saved number the mixed thread is withheld", async () => {
    readConfirmedNumbers.mockResolvedValue([]);
    expect((await read(MIXED)).manualSearchScope).toBe("other_model");
  });

  it("the mixed thread stays withheld with the number saved", async () => {
    const body = await read(MIXED);
    expect(readConfirmedNumbers).toHaveBeenCalledWith(TENANT, NB); // precondition: the number was read
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
  });

  it("control: the Siemens-only thread shows the status with the number saved", async () => {
    const body = await read(SIEMENS_ONLY);
    expect(body.manualSearch).toEqual(READY);
    expect(body).not.toHaveProperty("manualSearchScope");
  });

  it("control: a thread naming no maker shows the status with the number saved", async () => {
    const body = await read(NO_MAKER);
    expect(body.manualSearch).toEqual(READY);
    expect(body).not.toHaveProperty("manualSearchScope");
  });

  it("control: the ABB-only thread stays withheld with the number saved", async () => {
    expect((await read(ABB_ONLY)).manualSearchScope).toBe("other_model");
  });

  it("the card offers nothing for the mixed question", () => {
    expect(offeredOwnNumber(MIXED, { manufacturer: "Siemens", model: "TP700" })).toBeNull();
  });

  it("control: the card offers the number for the Siemens-only question", () => {
    expect(offeredOwnNumber(SIEMENS_ONLY, { manufacturer: "Siemens", model: "TP700" })).toBe("6AV2124-0GC01-0AX0");
  });

  // #6131 r1 F1/F2: every maker the question names must be this machine's, read as the model is
  // read (Unicode hyphens folded), with a dictionary-word maker counted when it is typed right
  // before the number. The first row is the ASCII baseline the rule already caught.
  it.each([
    ["Allen-Bradley in ASCII (baseline)", "How do I wire the Allen-Bradley 6AV2124-0GC01-0AX0 in our Siemens cabinet?"],
    ["Allen-Bradley with a nonbreaking hyphen (r1 F1)", "How do I wire the Allen‑Bradley 6AV2124-0GC01-0AX0 in our Siemens cabinet?"],
    ["title-case Eaton before the number (r1 F2)", "How do I wire the Eaton 6AV2124-0GC01-0AX0 in our Siemens cabinet?"],
    ["title-case Eaton before the number, no other maker (already withheld by the exact identity read)", "How do I wire the Eaton 6AV2124-0GC01-0AX0?"],
    ["title-case Eaton before a number with nonbreaking hyphens", "How do I wire the Eaton 6AV2124‑0GC01‑0AX0 in our Siemens cabinet?"],
  ])("%s: withheld with the number saved, and the card offers nothing", async (_label, question) => {
    const body = await read(question);
    expect(readConfirmedNumbers).toHaveBeenCalledWith(TENANT, NB); // precondition: the number was read
    expect(body.manualSearch).toBeNull();
    expect(body.manualSearchScope).toBe("other_model");
    expect(offeredOwnNumber(question, { manufacturer: "Siemens", model: "TP700" })).toBeNull();
  });

  // Ordinary words stay ordinary: a dictionary-word maker counts only as above.
  it.each([
    ["a lowercase dictionary word", "How do I wire the 6AV2124-0GC01-0AX0 under the banner in our Siemens cabinet?"],
    ["a capitalised dictionary word used as a word", "Sick of this: the 6AV2124-0GC01-0AX0 in our Siemens cabinet will not power up."],
  ])("control: %s leaves the thread showing the status, and the card offers the number", async (_label, question) => {
    const body = await read(question);
    expect(body.manualSearch).toEqual(READY);
    expect(body).not.toHaveProperty("manualSearchScope");
    expect(offeredOwnNumber(question, { manufacturer: "Siemens", model: "TP700" })).toBe("6AV2124-0GC01-0AX0");
  });
});

describe("numbersForMachine", () => {
  const nb = (over: Partial<EquipmentNotebook> = {}) => ({ ...NOTEBOOK, ...over }) as unknown as EquipmentNotebook;
  const entries = [saved("6AV2124-0GC01-0AX0")];

  it("counts numbers for a settled identity naming the notebook's own model", () => {
    expect(numbersForMachine(entries, READY as never, nb())).toEqual(["6AV2124-0GC01-0AX0"]);
    expect(numbersForMachine(entries, READY as never, nb({ identityStatus: "verified" } as never))).toEqual(["6AV2124-0GC01-0AX0"]);
  });
  it("counts none for an unsettled identity", () => {
    expect(numbersForMachine(entries, READY as never, nb({ identityStatus: "unconfirmed" } as never))).toEqual([]);
  });
  // Round-3 pre-screen: only the identity card writes source `user`. An identity a nameplate photo
  // (or anything else) settled never brings back a number ticked for an earlier one.
  it("counts none for an identity settled without the identity card", () => {
    expect(numbersForMachine(entries, READY as never, nb({ identitySourceType: "nameplate_image" }))).toEqual([]);
    expect(numbersForMachine(entries, READY as never, nb({ identitySourceType: null }))).toEqual([]);
  });
  it("counts none when the status names a proposed model, not the notebook's", () => {
    expect(numbersForMachine(entries, { ...READY, model: "TP900" } as never, nb())).toEqual([]);
  });
  // Review Focus 4: entries saved under another identity never count, even when status and
  // notebook agree with each other.
  it("counts none for entries saved under another identity", () => {
    expect(numbersForMachine(entries, { ...READY, model: "TP900" } as never, nb({ model: "TP900" }))).toEqual([]);
  });
});
