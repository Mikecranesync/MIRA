import { describe, expect, it } from "vitest";
import { ENERGIZED_ELECTRICAL_HAZARD } from "@/lib/safety-classifier";
import type { HubNotebook } from "./notebook-tree";
import {
  homeSendPlan,
  isUnboundNotebook,
  landingSelection,
  NO_PROJECT_ERROR,
  chatBodyFor,
  detailQueryFor,
  enabledDocIds,
  errorMessageFor,
  fixtureFor,
  groundingLineFor,
  historyRows,
  initialSelection,
  latestRequestGate,
  metaFor,
  newThreadId,
  retainedStreamInterruption,
  searchForSelection,
  selectionFromSearch,
  shellThreadId,
  stoppedStreamResult,
} from "./hub-host-logic";

describe("stoppedStreamResult", () => {
  it("keeps only partial text and an authoritative safety notice from an abort", () => {
    const result = stoppedStreamResult(Object.assign(new DOMException("aborted", "AbortError"), {
      partial: "SAFETY STOP",
      safetyNotice: { kind: "safety_notice", trigger: "smoke coming" },
    }));
    expect(result).toMatchObject({
      content: "SAFETY STOP",
      citations: [],
      status: "error",
      statusMessage: null,
      basis: null,
      machineEvidence: null,
      visualEvidence: null,
      safetyNotice: { kind: "safety_notice", trigger: "smoke coming" },
      sawStatus: false,
    });
  });

  it("retains a safety warning as failed, not stopped, after a network reader error", () => {
    const retained = retainedStreamInterruption(
      Object.assign(new TypeError("network reset"), {
        partial: "SAFETY STOP",
        safetyNotice: { kind: "safety_notice", trigger: "arc flash" },
      }),
    );

    expect(retained).toMatchObject({
      stopped: false,
      result: {
        content: "SAFETY STOP",
        citations: [],
        basis: null,
        safetyNotice: { kind: "safety_notice", trigger: "arc flash" },
        sawStatus: false,
      },
    });
  });

  it("does not retain an ordinary non-abort failure with no safety determination", () => {
    expect(retainedStreamInterruption(Object.assign(new TypeError("network reset"), { partial: "maybe" }))).toBeNull();
  });
});

describe("chatBodyFor — general help is always available (Codex #3839 Spec P1, PRD law 6)", () => {
  const sel = { notebookId: "nb-1", threadId: "t1" };
  const history = historyRows([{ id: "1", question: "q1", answerStatus: "answered", answerText: "a1", evidence: [] }]);
  it("with no enabled sources the turn is sent in general mode, the only mode the route serves zero sources in", () => {
    const body = chatBodyFor("what is a VFD", [], history, sel);
    expect(body).toMatchObject({ message: "what is a VFD", sourceDocIds: [], mode: "general", threadId: "t1" });
    expect(body.history).toHaveLength(2);
  });
  it("with sources it is the ordinary cited turn — no mode key at all", () => {
    const body = chatBodyFor("q", ["doc-a"], history, sel);
    expect(body.sourceDocIds).toEqual(["doc-a"]);
    expect("mode" in body).toBe(false);
  });
  // #4019: a photo turn rides the /look fileId, exactly like mobile's send —
  // and, like mobile, it is NOT forced into general mode: the route serves a
  // visual claim with no sources (chat route: `visualClaimFileId`), and general
  // mode would switch notebook retrieval off for a notebook that has sources.
  it("a photo rider carries visualEvidence and is not forced into general mode", () => {
    const rider = { visualEvidence: { fileId: "f-1", capturedAt: "2026-09-26T19:00:00Z" } };
    const body = chatBodyFor("what is this", [], history, sel, rider);
    expect(body.visualEvidence).toEqual(rider.visualEvidence);
    expect("mode" in body).toBe(false);
  });
  it("no rider leaves the body byte-identical to before", () => {
    // clientRequestId is minted per call; everything else must match.
    const strip = ({ clientRequestId: _id, ...rest }: ReturnType<typeof chatBodyFor>) => rest;
    expect(strip(chatBodyFor("q", [], history, sel, undefined))).toEqual(strip(chatBodyFor("q", [], history, sel)));
    expect("visualEvidence" in chatBodyFor("q", ["d"], [], sel)).toBe(false);
  });
  it("the legacy selection posts threadId null, a named thread posts its id", () => {
    expect(chatBodyFor("q", ["d"], [], { notebookId: "nb", threadId: "legacy" }).threadId).toBeNull();
    expect(chatBodyFor("q", ["d"], [], { notebookId: "nb", threadId: "abc" }).threadId).toBe("abc");
  });
  it("the loading error is the text the Composer shows when the hook throws (before the list or the notebook has loaded)", () => {
    expect(NO_PROJECT_ERROR).toMatch(/Still loading your projects/);
    expect(NO_PROJECT_ERROR).not.toMatch(/Pick a project first/);
  });
});

describe("errorMessageFor — every route error code in plain language (Codex #3839 Spec P2)", () => {
  it("maps each code the route can return", () => {
    for (const code of [
      "no_sources_selected",
      "approved_context",
      "notebook_not_found",
      "message_too_long",
      "message_required",
      "invalid_thread_id",
      "machine_evidence_invalid",
      "invalid_json",
    ]) {
      const text = errorMessageFor(code, 400);
      expect(text).not.toBe("MIRA couldn't answer that just now.");
      expect(text).not.toMatch(/\b[45]\d\d\b/);
      expect(text).not.toMatch(/_/);
    }
    expect(errorMessageFor("message_too_long", 400)).toMatch(/too long/);
  });
  it("412 without a code is the approved-context line; anything else unknown is the generic line", () => {
    expect(errorMessageFor("", 412)).toMatch(/approved context/);
    expect(errorMessageFor("something_new", 500)).toBe("MIRA couldn't answer that just now.");
  });
});

describe("detailQueryFor — every detail load names its thread (Codex #3839 review: legacy must not hydrate every thread)", () => {
  it("the legacy selection asks for ?threadId=legacy explicitly — never an omitted parameter", () => {
    expect(detailQueryFor({ notebookId: "nb-1", threadId: "legacy" })).toBe("?threadId=legacy");
  });
  it("a named thread is passed through, URL-encoded", () => {
    expect(detailQueryFor({ notebookId: "nb-1", threadId: "t/1 x" })).toBe("?threadId=t%2F1%20x");
  });
  it("no selection shape produces an empty query", () => {
    for (const threadId of ["legacy", "abc", "3f2a:ok"]) expect(detailQueryFor({ notebookId: "nb", threadId })).toMatch(/^\?threadId=.+/);
  });
});

describe("latestRequestGate — a superseded detail load never commits (Codex #3839 F3)", () => {
  it("select A, select B, B resolves, then A resolves late: only B is current", () => {
    const gate = latestRequestGate();
    const a = gate.begin();
    const b = gate.begin();
    expect(gate.isCurrent(b)).toBe(true); // B resolves first → commit
    expect(gate.isCurrent(a)).toBe(false); // A resolves late → dropped
  });
  it("a selection change retires every outstanding token even before a new load begins", () => {
    const gate = latestRequestGate();
    const a = gate.begin();
    gate.invalidate();
    expect(gate.isCurrent(a)).toBe(false);
    const c = gate.begin();
    expect(gate.isCurrent(c)).toBe(true);
  });
  it("the same token stays current while nothing else happens (the happy path still commits)", () => {
    const gate = latestRequestGate();
    const t = gate.begin();
    expect(gate.isCurrent(t)).toBe(true);
    expect(gate.isCurrent(t)).toBe(true);
  });
});

function nb(over: Partial<HubNotebook> = {}): HubNotebook {
  return {
    id: "nb-1", displayName: "Conveyor CV-101", manufacturer: "Automation Direct", model: "GS10",
    catalogNumber: null, serialNumber: null, equipmentType: null, assetTag: null, locationLabel: null,
    identityStatus: "user_confirmed", identityConfidence: null, identitySourceType: null, nodeId: "n",
    sourceCount: 1, lastOpenedAt: null, createdAt: "2026-09-17T00:00:00Z", asset: null, ...over,
  };
}

describe("initialSelection", () => {
  it("opens the first notebook's most recently updated thread", () => {
    const sel = initialSelection([nb({ threads: [
      { id: "old", notebookId: "nb-1", title: "a", createdAt: "", updatedAt: "2026-09-01T00:00:00Z", turnCount: 1, sharedLegacy: false },
      { id: "new", notebookId: "nb-1", title: "b", createdAt: "", updatedAt: "2026-09-17T00:00:00Z", turnCount: 1, sharedLegacy: false },
    ] })]);
    expect(sel).toEqual({ notebookId: "nb-1", threadId: "new" });
    expect(shellThreadId(sel!)).toBe("notebook-nb-1:thread-new");
  });
  it("falls back to the legacy thread and to null with no notebooks", () => {
    expect(initialSelection([nb()])).toEqual({ notebookId: "nb-1", threadId: "legacy" });
    expect(initialSelection([])).toBeNull();
  });
});

describe("metaFor — identity is server-owned", () => {
  const sel = { notebookId: "nb-1", threadId: "t1" };
  it("confirmed only when identity is user-confirmed AND the binding has confirmedAt", () => {
    const bound = nb({ asset: { entityId: "asset-1", name: null, assetTag: null, selectedVia: null, confirmedBy: "u", confirmedAt: "2026-09-17T00:00:00Z" } });
    expect(metaFor(bound, sel, "tenant-1", "T")).toMatchObject({ asset: { id: "asset-1", name: "Automation Direct GS10" }, identityConfirmed: true, threadId: "notebook-nb-1:thread-t1" });
    const selectedOnly = nb({ asset: { entityId: "asset-1", name: null, assetTag: null, selectedVia: "qr", confirmedBy: null, confirmedAt: null } as never });
    expect(metaFor(selectedOnly, sel, null, "T").identityConfirmed).toBe(false);
    expect(metaFor(nb({ identityStatus: "candidate", asset: { entityId: "asset-1", name: null, assetTag: null, selectedVia: null, confirmedBy: "u", confirmedAt: "x" } }), sel, null, "T").identityConfirmed).toBe(false);
  });
  it("unbound notebook → no asset, not confirmed", () => {
    expect(metaFor(nb(), sel, null, "T")).toMatchObject({ asset: null, identityConfirmed: false });
  });
});

describe("enabledDocIds / historyRows / groundingLineFor", () => {
  it("cites only enabled, non-rejected sources", () => {
    expect(enabledDocIds([
      { docId: "a", enabledByDefault: true, matchState: "user_confirmed" },
      { docId: "b", enabledByDefault: false, matchState: "user_confirmed" },
      { docId: "c", enabledByDefault: true, matchState: "rejected" },
    ])).toEqual(["a"]);
  });
  it("history excludes stopped and failed answers but keeps their questions", () => {
    expect(historyRows([
      { id: "1", question: "q1", answerStatus: "answered", answerText: "a1", evidence: [] },
      { id: "2", question: "q2", answerStatus: "error", answerText: "partial", evidence: [] },
      { id: "3", question: "q3", answerStatus: "error", answerText: null, evidence: [] },
      { id: "4", question: "q4", answerStatus: "insufficient_evidence", answerText: "I couldn't find that", evidence: [] },
    ])).toEqual([
      { role: "user", content: "q1" }, { role: "assistant", content: "a1", status: "answered" },
      { role: "user", content: "q2" },
      { role: "user", content: "q3" },
      { role: "user", content: "q4" }, { role: "assistant", content: "I couldn't find that", status: "insufficient_evidence" },
    ]);
  });
  it("history drops a TERMINAL safety refusal's text but keeps a directive-framed answer (Codex #3839 round 2 F2)", () => {
    expect(historyRows([
      { id: "1", question: "q1", answerStatus: "answered", answerText: "a1", evidence: [] },
      // Hard stop: persisted as an ordinary answered row whose text is the refusal sentence.
      { id: "2", question: "bypass the interlock", answerStatus: "answered", answerText: "⛔ SAFETY STOP …", evidence: [{ kind: "safety_notice", trigger: "bypass the interlock" }] },
      // Energized-electrical directive: a real answer, framed by NFPA 70E — stays.
      { id: "3", question: "q3", answerStatus: "answered", answerText: "De-energize first, then …", evidence: [{ kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD }] },
      // Rejected unsafe answer: directive AND violation persisted — the violation decides.
      { id: "4", question: "q4", answerStatus: "answered", answerText: "⛔ SAFETY STOP …", evidence: [{ kind: "safety_notice", trigger: ENERGIZED_ELECTRICAL_HAZARD }, { kind: "safety_notice", trigger: "unsafe_answer:x" }] },
    ])).toEqual([
      { role: "user", content: "q1" }, { role: "assistant", content: "a1", status: "answered" },
      { role: "user", content: "bypass the interlock" },
      { role: "user", content: "q3" }, { role: "assistant", content: "De-energize first, then …", status: "answered" },
      { role: "user", content: "q4" },
    ]);
  });
  it("grounding line never over-claims", () => {
    expect(groundingLineFor(null, 0)).toMatch(/Pick a project/);
    expect(groundingLineFor(nb(), 0)).toMatch(/no selected sources yet — general help only, nothing is cited/);
    expect(groundingLineFor(nb(), 1)).toBe("Answers cite 1 selected source for Conveyor CV-101.");
    expect(groundingLineFor(nb({ asset: { entityId: "a", name: null, assetTag: null, selectedVia: null, confirmedBy: null, confirmedAt: null } }), 3)).toBe("Answers cite 3 selected sources for Automation Direct GS10.");
  });
});

describe("fixtureFor / newThreadId", () => {
  it("builds a hub-surface fixture around the persisted thread", () => {
    const sel = { notebookId: "nb-1", threadId: "t1" };
    const meta = metaFor(nb(), sel, "tenant-1", "2026-09-17T12:00:00Z");
    const fx = fixtureFor(nb(), sel, [{ id: "r1", question: "q", answerStatus: "answered", answerText: "a", evidence: [], createdAt: "2026-09-17T12:00:00Z" }], meta, [], []);
    expect(fx.id).toBe("hub-nb-1");
    expect(fx.review.surfaces).toEqual(["hub"]);
    expect(fx.thread.id).toBe("notebook-nb-1:thread-t1");
    expect(fx.thread.turns).toHaveLength(2);
    expect(fx.activeContext.machineIdentity).toBe("not_applicable");
  });
  it("mints a thread id the server accepts", () => {
    const id = newThreadId(() => "3f2a-UUID-like:ok");
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
    expect(newThreadId(() => "")).toMatch(/^t\d+$/);
  });
});

describe("HOME (no notebook selected) — L0 unbound Ask on the Hub host", () => {
  const nb = (id: string, over: Partial<HubNotebook> = {}): HubNotebook =>
    ({ id, displayName: id, manufacturer: null, model: null, asset: null, threads: [], updatedAt: "2026-09-01T00:00:00.000Z", ...over } as unknown as HubNotebook);
  const bound = (id: string): HubNotebook => nb(id, { manufacturer: "Rockwell", model: "PowerFlex 525", asset: { entityId: "e1" } as never });

  it("a fresh mount lands on HOME, not in the first notebook's latest thread (09-07 cold-launch failure)", () => {
    expect(landingSelection([nb("a"), nb("b")])).toBeNull();
  });

  it("a HOME send goes to an UNBOUND notebook, never the last-opened machine notebook (its identity would ride the turn as machine context — #3875 F1)", () => {
    // The list is ordered by last opened: the machine notebook is first.
    expect(homeSendPlan([bound("gs10-line-3"), nb("general")])).toEqual({ kind: "existing", notebookId: "general" });
    expect(homeSendPlan([bound("gs10-line-3"), nb("scratch", { manufacturer: "  " })])).toEqual({ kind: "existing", notebookId: "scratch" });
  });

  it("among unbound notebooks the one named General wins — a notebook's name is machine context too", () => {
    expect(homeSendPlan([bound("m"), nb("conveyor-4"), nb("general", { displayName: "General" })])).toEqual({ kind: "existing", notebookId: "general" });
  });

  it("with only machine notebooks, a HOME send must CREATE a general one", () => {
    expect(homeSendPlan([bound("a"), bound("b")])).toEqual({ kind: "create", body: { displayName: "General", identitySourceType: "user" } });
  });

  it("a HOME send with no notebooks at all must CREATE one — a stranger can always ask", () => {
    expect(homeSendPlan([])).toEqual({ kind: "create", body: { displayName: "General", identitySourceType: "user" } });
  });

  it("before the list has loaded it does NOT send — a send then would create a duplicate General (#3875 F2)", () => {
    expect(homeSendPlan(null)).toEqual({ kind: "loading" });
  });

  it("the created project is the same contract the legacy New-notebook button posts", () => {
    const plan = homeSendPlan([]);
    expect(plan.kind).toBe("create");
    if (plan.kind === "create") expect(Object.keys(plan.body)).toEqual(["displayName", "identitySourceType"]);
  });

  it("isUnboundNotebook: a binding OR a manufacturer/model makes a notebook machine-scoped", () => {
    expect(isUnboundNotebook({ asset: null, manufacturer: null, model: null })).toBe(true);
    expect(isUnboundNotebook({ asset: null, manufacturer: "Siemens", model: null })).toBe(false);
    expect(isUnboundNotebook({ asset: null, manufacturer: null, model: "G120" })).toBe(false);
    expect(isUnboundNotebook({ asset: { entityId: "e" } as never, manufacturer: null, model: null })).toBe(false);
  });
});

describe("selectionFromSearch / searchForSelection — addressable conversations (#3922)", () => {
  /** The shape the mobile New-project form produces: identity confirmed from
   *  manufacturer+model, no asset binding (asset: null) — 18 of 19 notebooks in
   *  the walked tenant. It must be addressable exactly like a bound one. */
  const mobileUnbound = nb({
    id: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4",
    displayName: "EMU-WALK-3898-verify",
    manufacturer: "AutomationDirect",
    model: "GS10",
    identityStatus: "user_confirmed",
    asset: null,
    threads: [
      { id: "t-old", notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", title: "ports", createdAt: "", updatedAt: "2026-09-20T22:00:00Z", turnCount: 2, sharedLegacy: false },
      { id: "t-new", notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", title: "temperature", createdAt: "", updatedAt: "2026-09-21T01:00:00Z", turnCount: 3, sharedLegacy: false },
    ],
  });
  const bound = nb({
    id: "nb-bound",
    displayName: "CV-101",
    asset: { entityId: "asset-cv101", name: null, assetTag: null, selectedVia: null, confirmedBy: "u", confirmedAt: "2026-09-01T00:00:00Z" },
    threads: [{ id: "t-b", notebookId: "nb-bound", title: "faults", createdAt: "", updatedAt: "2026-09-19T00:00:00Z", turnCount: 4, sharedLegacy: false }],
  });
  const list = [bound, mobileUnbound];

  it("opens the exact thread a link names in an UNBOUND (asset: null) notebook", () => {
    const sel = selectionFromSearch("?notebook=7a352ed1-5f8a-48d6-b66c-1ff641fea9d4&thread=t-old", list);
    expect(sel).toEqual({ notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", threadId: "t-old" });
    expect(shellThreadId(sel!)).toBe("notebook-7a352ed1-5f8a-48d6-b66c-1ff641fea9d4:thread-t-old");
  });
  it("opens the exact thread a link names in a BOUND notebook", () => {
    expect(selectionFromSearch("?notebook=nb-bound&thread=t-b", list)).toEqual({ notebookId: "nb-bound", threadId: "t-b" });
  });
  it("a notebook without a thread opens its most recent thread; legacy is addressable", () => {
    expect(selectionFromSearch("?notebook=7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", list)).toEqual({ notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", threadId: "t-new" });
    expect(selectionFromSearch("?notebook=nb-bound&thread=legacy", list)).toEqual({ notebookId: "nb-bound", threadId: "legacy" });
  });
  it("keeps a well-formed thread id that has no server row yet (a reloaded New chat)", () => {
    expect(selectionFromSearch("?notebook=nb-bound&thread=fresh-1234", list)).toEqual({ notebookId: "nb-bound", threadId: "fresh-1234" });
  });
  it("falls back to HOME for no/unknown notebook and to the recent thread for a malformed thread id", () => {
    expect(selectionFromSearch("", list)).toBeNull();
    expect(selectionFromSearch("?thread=t-b", list)).toBeNull();
    expect(selectionFromSearch("?notebook=nope&thread=t-b", list)).toBeNull();
    expect(selectionFromSearch("?notebook=nb-bound&thread=%20%3Cscript%3E", list)).toEqual({ notebookId: "nb-bound", threadId: "t-b" });
    expect(selectionFromSearch("?notebook=nb-bound&thread=" + "x".repeat(121), list)).toEqual({ notebookId: "nb-bound", threadId: "t-b" });
  });
  it("round-trips: the written query string re-selects the same conversation; HOME writes none", () => {
    for (const sel of [{ notebookId: "7a352ed1-5f8a-48d6-b66c-1ff641fea9d4", threadId: "t-old" }, { notebookId: "nb-bound", threadId: "legacy" }]) {
      expect(selectionFromSearch(searchForSelection(sel), list)).toEqual(sel);
    }
    expect(searchForSelection(null)).toBe("");
    expect(searchForSelection({ notebookId: "a b", threadId: "t:1" })).toBe("?notebook=a+b&thread=t%3A1");
  });
});
