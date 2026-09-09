import { describe, expect, it } from "vitest";
import {
  askEndpointFor,
  listNotice,
  filterMachines,
  partitionMachines,
  scopeHint,
  scopeIdentity,
  scopeLabel,
  suggestionsFor,
  toMachines,
  type Machine,
} from "./ScopePicker";

/**
 * The risk in a scope picker is SILENT: a machine-scoped question sent to the
 * general endpoint still returns a fluent, plausible answer — one that reads as
 * machine-specific and is not. Nothing on screen says so. So the routing
 * function is asserted directly, in both directions.
 */

const cv101: Machine = {
  id: "3f1a2b4c-0000-4000-8000-000000000001",
  unsPath: "enterprise.plant.line_1.cv_101",
  tag: "CV-101",
  name: "Infeed conveyor",
  manufacturer: "Rockwell Automation",
  model: "PowerFlex 525",
  location: "Line 1",
};

describe("scope routing", () => {
  it("sends a general question to the general endpoint", () => {
    expect(askEndpointFor(null)).toMatch(/\/api\/hub\/ask\/$/); // #3712: slash form, no 308
  });

  it("sends a machine question to that machine's asset chat, not the general route", () => {
    // The general route's own system prompt forbids claiming to know which
    // machine the technician is at. Serving a bound question there would
    // produce a generic answer presented as machine-specific.
    const url = askEndpointFor(cv101);
    expect(url).toContain(`/api/assets/${cv101.id}/chat/`);
    expect(url).not.toContain("/api/hub/ask");
  });

  it("carries the machine id verbatim — a wrong id answers about a wrong machine", () => {
    expect(askEndpointFor({ ...cv101, id: "other-id" })).toContain("/api/assets/other-id/chat/");
  });
});

describe("scope labelling", () => {
  it("names the machine once bound, so the header cannot imply general", () => {
    expect(scopeLabel(cv101)).toContain("CV-101");
    expect(scopeLabel(cv101)).toContain("Infeed conveyor");
  });

  it("states plainly that no machine is bound", () => {
    // "No machine" must be said, not implied by absence: a blank badge is
    // indistinguishable from one that failed to render.
    expect(scopeLabel(null).toLowerCase()).toContain("no machine");
  });

  it("hint tells the technician the CONSEQUENCE of the current scope", () => {
    expect(scopeHint(cv101)).toContain("CV-101");
    expect(scopeHint(null).toLowerCase()).toContain("general");
  });
});

describe("machine list projection", () => {
  it("drops a row with no id rather than rendering an unroutable option", () => {
    // Picking such a row would POST to /api/assets/undefined/chat/.
    const rows = [
      { tag: "CV-102", name: "No id here", unsPath: "enterprise.p.l.cv_102" },
      { id: "a", tag: "CV-103", name: "Fine", unsPath: "enterprise.p.l.cv_103" },
    ];
    const out = toMachines(rows);
    expect(out.map((m) => m.tag)).toEqual(["CV-103"]);
  });

  it("falls back to the tag when a machine has no description", () => {
    expect(toMachines([{ id: "a", tag: "CV-104", name: "", unsPath: "enterprise.p.l.cv_104" }])[0].name).toBe("CV-104");
  });

  // Binding a question to a machine is a direct connection; a direct connection
  // must carry a resolvable UNS identifier or refuse. A machine with no place in
  // the namespace is real in the CMMS and still not a scope this picker may offer.
  it("drops a machine with no UNS path — a scope you cannot place cannot be bound", () => {
    const rows = [
      { id: "a", tag: "CV-105", name: "Placed", unsPath: "enterprise.p.l.cv_105" },
      { id: "b", tag: "CV-106", name: "Never placed" },
    ];
    expect(toMachines(rows).map((m) => m.tag)).toEqual(["CV-105"]);
  });

  it("treats an empty or non-string UNS path as unplaced, not as an identity", () => {
    const rows = [
      { id: "a", tag: "CV-107", name: "blank", unsPath: "" },
      { id: "b", tag: "CV-108", name: "spaces", unsPath: "   " },
      { id: "c", tag: "CV-109", name: "number", unsPath: 42 },
    ];
    expect(toMachines(rows)).toEqual([]);
  });

  it("carries the UNS path onto the machine, so a bound scope can always say where it is", () => {
    expect(toMachines([{ id: "a", tag: "CV-110", name: "x", unsPath: "enterprise.p.l.cv_110" }])[0].unsPath).toBe(
      "enterprise.p.l.cv_110",
    );
  });

  it("counts unplaced machines so the sheet can say why they are missing", () => {
    const { machines, unplaced } = partitionMachines([
      { id: "a", tag: "CV-111", name: "ok", unsPath: "enterprise.p.l.cv_111" },
      { id: "b", tag: "CV-112", name: "no path" },
      { id: "c", tag: "CV-113", name: "blank path", unsPath: "" },
      // No id: unroutable, dropped — and NOT counted, because it was never a
      // machine the technician could have been offered under any rule.
      { tag: "CV-114", name: "no id", unsPath: "enterprise.p.l.cv_114" },
    ]);
    expect(machines.map((m) => m.tag)).toEqual(["CV-111"]);
    expect(unplaced).toBe(2);
  });

  it("reports zero unplaced when every machine is placed (positive control)", () => {
    expect(partitionMachines([{ id: "a", tag: "CV-115", name: "ok", unsPath: "enterprise.p.l.cv_115" }]).unplaced).toBe(0);
  });

  // An id-less row is a broken API response, not an unplaced asset. It is dropped
  // (unroutable) but COUNTED separately, so an /api/assets regression on `id`
  // cannot present as "you own no machines" (round-4 review on #3683).
  it("counts id-less rows as malformed, separately from unplaced, and never as machines", () => {
    const { machines, unplaced, malformed } = partitionMachines([
      { tag: "CV-116", name: "no id, has path", unsPath: "enterprise.p.l.cv_116" },
      { tag: "CV-117", name: "no id, no path" },
      { id: "c", tag: "CV-118", name: "placed", unsPath: "enterprise.p.l.cv_118" },
      { id: "d", tag: "CV-119", name: "unplaced" },
    ]);
    expect(machines.map((m) => m.tag)).toEqual(["CV-118"]);
    expect(unplaced).toBe(1);
    expect(malformed).toBe(2);
  });

  it("reports zero malformed for a well-formed list (positive control)", () => {
    expect(partitionMachines([{ id: "a", tag: "CV-120", name: "ok", unsPath: "enterprise.p.l.cv_120" }]).malformed).toBe(0);
    expect(partitionMachines([]).malformed).toBe(0);
    expect(partitionMachines(null).malformed).toBe(0);
  });

  it("returns an empty list for a non-array body instead of throwing", () => {
    // The route returns a bare array on success and `{error}` on failure; an
    // exception here would blank the whole shell rather than one sheet.
    expect(toMachines({ error: "Query failed" })).toEqual([]);
    expect(toMachines(null)).toEqual([]);
  });
});

describe("filtering", () => {
  const list: Machine[] = [
    cv101,
    { id: "2", unsPath: "enterprise.plant.line_2.pmp_7", tag: "PMP-7", name: "Coolant pump", manufacturer: "Grundfos", model: "CR-15", location: "Line 2" },
  ];

  it("matches on tag, maker and location — what a technician actually types", () => {
    expect(filterMachines(list, "cv-1").map((m) => m.tag)).toEqual(["CV-101"]);
    expect(filterMachines(list, "grundfos").map((m) => m.tag)).toEqual(["PMP-7"]);
    expect(filterMachines(list, "line 2").map((m) => m.tag)).toEqual(["PMP-7"]);
  });

  it("returns everything for an empty query, and nothing for a miss", () => {
    // Positive control: the filter must be capable of returning BOTH, or a
    // pass above could come from a matcher that always returns the input.
    expect(filterMachines(list, "   ")).toHaveLength(2);
    expect(filterMachines(list, "zzzz")).toHaveLength(0);
  });
});


/**
 * One state, four renderings — they must agree.
 *
 * The first guard for this was VACUOUS. It pinned the source string
 * `hint: "General question" }` in page.tsx, so a peer reinstated the exact
 * live-hub defect (every chip reading "General question" under a machine
 * badge) as `const hint = "General question";` and all 22 tests stayed green.
 * Hoisting to a variable, losing the space, or concatenating all walk past a
 * literal. These assert BEHAVIOUR, so all three shapes fail.
 */
describe("every scope-derived string agrees about identity", () => {
  const cv101: Machine = {
    id: "id-1", unsPath: "enterprise.plant.line_1.cv_101", tag: "CV-101", name: "Infeed conveyor",
    manufacturer: "Rockwell Automation", model: "PowerFlex 525", location: "Line 1",
  };

  it("a chip hint under a bound machine names that machine, never 'General question'", () => {
    // The live-hub defect, asserted directly: chips routed to the asset
    // endpoint while labelling themselves general.
    for (const s of suggestionsFor(cv101)) {
      expect(s.hint).toBe(scopeIdentity(cv101));
      expect(s.hint).not.toBe("General question");
    }
  });

  it("the chip hint is the same identity the badge shows", () => {
    expect(scopeLabel(cv101)).toContain(suggestionsFor(cv101)[0].hint);
    expect(scopeHint(cv101)).toContain(suggestionsFor(cv101)[0].hint);
  });

  it("still says 'General question' when nothing is bound (positive control)", () => {
    // Without this the assertions above could pass on a function that named
    // the machine unconditionally — including in the general case, where that
    // would be a worse lie than the one being fixed.
    for (const s of suggestionsFor(null)) expect(s.hint).toBe("General question");
  });

  it("degrades identically when a machine's tag is empty", () => {
    // `tag` is non-optional but nothing guarantees non-empty. Before
    // `scopeIdentity`, the badge rendered " — Infeed conveyor" with a leading
    // dash while the chip hint rendered "" — one state, two renderings, both
    // wrong in different ways.
    const untagged: Machine = { ...cv101, tag: "" };
    expect(scopeIdentity(untagged)).toBe("Infeed conveyor");
    expect(suggestionsFor(untagged)[0].hint).toBe("Infeed conveyor");
    expect(scopeLabel(untagged)).toBe("Infeed conveyor");
    expect(scopeLabel(untagged)).not.toContain("—");
  });

  it("never renders an empty identity, even with nothing to go on", () => {
    const blank: Machine = { ...cv101, tag: "  ", name: "  " };
    expect(scopeIdentity(blank).trim().length).toBeGreaterThan(0);
    expect(suggestionsFor(blank)[0].hint.trim().length).toBeGreaterThan(0);
  });
});

describe("machine starters are groundable, never invented", () => {
  it("asks about things the asset path can retrieve", () => {
    const hints = suggestionsFor({
      id: "i", unsPath: "enterprise.plant.line_1.cv_101", tag: "CV-101", name: "Infeed conveyor",
      manufacturer: null, model: null, location: null,
    }).map((s) => s.q);
    expect(hints).toContain("What faults has this machine had before?");
  });

  it("never names a fault code or part number for a machine not yet retrieved", () => {
    // A starter printing "F0004" for an arbitrary bound machine would be a
    // fabrication produced by the UI itself, before any retrieval happened.
    for (const s of suggestionsFor({
      id: "i", unsPath: "enterprise.plant.line_1.cv_101", tag: "CV-101", name: "Infeed conveyor",
      manufacturer: null, model: null, location: null,
    })) {
      expect(s.q).not.toMatch(/\b[A-Z]{1,2}\d{3,5}\b/);
    }
    // Positive control: the GENERAL set deliberately does name codes, so this
    // matcher is capable of firing.
    expect(suggestionsFor(null).some((s) => /\b[A-Z]\d{4}\b/.test(s.q))).toBe(true);
  });
});

// Round 4 Q2, second gap. The guard keeping a wholly-unreadable payload from
// rendering as "No machines yet" lived in a JSX condition, and this component
// fetches in useEffect — which never runs under renderToStaticMarkup, so no SSR
// render reaches these states. The guard was therefore free to delete: dropping
// `&& malformed === 0` changed one line and all 37 tests still passed. Verified
// by mutation before writing these.
describe("listNotice — degraded data is not an empty register", () => {
  // A complete Machine, not a partial cast — `listNotice` only reads the array's
  // length, so a loose object would type-check nothing and would let the shape
  // drift out from under these tests unnoticed.
  const M = (id: string): Machine => ({
    id,
    unsPath: `enterprise.site.area.line.${id}`,
    tag: id.toUpperCase(),
    name: `Machine ${id}`,
    manufacturer: null,
    model: null,
    location: null,
  });

  it("EVERY row unreadable is a failure, never the empty state", () => {
    expect(listNotice({ failed: false, machines: [], malformed: 3, shown: 0 })).toBe("unreadable");
  });

  it("genuinely no machines is the empty state", () => {
    expect(listNotice({ failed: false, machines: [], malformed: 0, shown: 0 })).toBe("empty");
  });

  it("the two are distinguishable on malformed alone — same machines, different notice", () => {
    const empty = listNotice({ failed: false, machines: [], malformed: 0, shown: 0 });
    const broken = listNotice({ failed: false, machines: [], malformed: 1, shown: 0 });
    expect(empty).not.toBe(broken);
  });

  it("some unreadable, some usable is degraded — the good machines are kept", () => {
    expect(listNotice({ failed: false, machines: [M("cv1")], malformed: 2, shown: 1 })).toBe("degraded");
  });

  it("a fetch failure outranks everything below it", () => {
    expect(listNotice({ failed: true, machines: [], malformed: 5, shown: 0 })).toBe("load-failed");
  });

  it("not-yet-loaded is loading, not empty", () => {
    expect(listNotice({ failed: false, machines: null, malformed: 0, shown: 0 })).toBe("loading");
  });

  it("a filter that matches nothing is no-match, not empty", () => {
    expect(listNotice({ failed: false, machines: [M("cv1")], malformed: 0, shown: 0 })).toBe("no-match");
  });

  it("nothing to say when there are machines and nothing is wrong", () => {
    expect(listNotice({ failed: false, machines: [M("cv1")], malformed: 0, shown: 1 })).toBeNull();
  });
});
