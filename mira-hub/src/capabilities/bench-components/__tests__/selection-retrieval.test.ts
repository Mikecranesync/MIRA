import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { readSubject } from "@/capabilities/conversation-subject";
import {
  componentManualIdentity,
  componentManualsBlocked,
  instantMicros,
  readSubjectUnderSelection,
  type ComponentRevision,
  type SelectedComponent,
  type SelectionTurn,
} from "@/capabilities/bench-components/selection";

/**
 * Whole-bench component workflow (Mike 2026-11-14): the technician picks a component and taps
 * "Return to <component>" instead of typing "back to mine". The action is server state, never a
 * phrase. These tests pin the two things that state has to do inside the EXISTING retrieval gate
 * (manual-rag.ts retrieveNodeChunks), which this module does not change:
 *
 *  1. the selected component's confirmed identity is the record: a sibling of its family
 *     (GS13N-20P2 beside a selected GS11N-20P2) is refused by the same sibling rule the
 *     notebook identity uses;
 *  2. an explicit selection (picker, Return, re-pick of the same component) is a boundary: the
 *     open questions read for the carry are only the ones asked under THIS selection, so a refused
 *     sibling question asked before "Return to GS11N-20P2" no longer carries into the bare
 *     follow-up. Without the boundary the same follow-up is refused (control below), so the
 *     boundary is what makes the action work.
 */

function makeClient(scriptedRows: Array<Record<string, unknown>[]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)") || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) return { rows: [] };
    return { rows: scriptedRows.shift() ?? [] };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const heading = "DURApulse GS10 Drive User Manual\nModels covered: GS11N-20P2, GS13N-20P2";
const base = {
  source_url: "node-doc/u1/gs10usermanual.pdf", filename: "gs10usermanual.pdf", doc_id: "d-1",
  document_heading: heading, section_path: null, rank: 0.4,
};
const ownColumn = {
  ...base, source_page: 26, page_start: 26, table_models: ["GS11N20P2"],
  content: "230V Class – 1-Phase Model-Specific Specifications — Model Name: GS11N-2xPx — GS11N-20P2\nGS11N-20P2: Frame Size A1\n",
};
const siblingColumn = {
  ...base, source_page: 27, page_start: 27, table_models: ["GS13N20P2"],
  content: "230V Class – 3-Phase Model-Specific Specifications — Model Name: GS13N-2xPx — GS13N-20P2\nGS13N-20P2: Frame Size A1\n",
};
const rows = () => [[siblingColumn, ownColumn]];
const retrieved = (calls: Array<{ sql: string }>) => calls.filter((c) => /knowledge_entries/.test(c.sql)).length;

const VFD1 = "c0000000-0000-4000-8000-000000000001";
const Q1 = "c0000000-0000-4000-8000-000000000002";

const revision = (over: Partial<ComponentRevision> = {}): ComponentRevision => ({
  componentId: VFD1,
  revision: 2,
  rawLabel: "GS11N-20P2",
  inputKind: "typed",
  manufacturer: "AutomationDirect",
  family: "GS10",
  catalogNumber: "GS11N-20P2",
  serialNumber: null,
  hardwareRevision: "1.03",
  localTag: "VFD1",
  identityStatus: "user_confirmed",
  unresolved: [],
  confirmedAt: "2026-11-14T04:00:00.000Z",
  createdAt: "2026-11-14T04:00:00.000Z",
  ...over,
});

const selected = (over: Partial<SelectedComponent> = {}): SelectedComponent => ({
  componentId: VFD1,
  revision: 2,
  selectedAt: "2026-11-14T04:10:00.000Z",
  ...over,
});

const opts = (rev: ComponentRevision, extra: Record<string, unknown> = {}) => ({
  nodeId: "n-1", unsPath: null, docIds: ["d-1"], validatedDocScope: true,
  ...componentManualIdentity(rev),
  ...extra,
});

// One conversation, OLDEST FIRST (listTurns' order). The sibling question was refused (no basis),
// then the technician tapped "Return to GS11N-20P2" at 04:10, then asked a bare follow-up.
const turn = (question: string, createdAt: string, componentId: string | null = VFD1, componentRevision: number | null = 2): SelectionTurn => ({
  question, answerStatus: "insufficient_evidence", basis: null, createdAt, componentId, componentRevision,
});
const conversation: SelectionTurn[] = [
  turn("what supply voltage does this drive need?", "2026-11-14T04:01:00.000Z"),
  turn("what about the GS13N-20P2, same thing?", "2026-11-14T04:05:00.000Z"),
];

describe("componentManualIdentity: the selected component's confirmed identity is the record", () => {
  it("a confirmed revision supplies manufacturer, family as model, and the full catalog number", () => {
    expect(componentManualIdentity(revision())).toEqual({
      identity: { manufacturer: "AutomationDirect", model: "GS10" },
      catalogNumber: "GS11N-20P2",
      identityStatus: "user_confirmed",
    });
  });

  it("with no family on record the catalog number is the model (never an invented family)", () => {
    expect(componentManualIdentity(revision({ family: null })).identity.model).toBe("GS11N-20P2");
  });

  it("an unconfirmed revision keeps its fields but is never a confirmed identity", () => {
    expect(componentManualIdentity(revision({ identityStatus: "candidate", confirmedAt: null })).identityStatus).toBe("candidate");
  });

  it("a sibling of the selected component's family is refused by the existing sibling rule", async () => {
    const diagnostics: Record<string, unknown> = {};
    const { client, calls } = makeClient(rows());
    const out = await retrieveNodeChunks(client, "t-1", "What frame size is the GS13N-20P2?", opts(revision(), { diagnostics }));
    expect(out).toEqual([]);
    expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
    expect(retrieved(calls)).toBe(0);
  });
});

describe("an explicit selection is the carry boundary (Return to <component>, no text parsed)", () => {
  it("CONTROL: without the boundary the refused sibling question carries and the bare follow-up is refused", async () => {
    const diagnostics: Record<string, unknown> = {};
    const { client } = makeClient(rows());
    const subjectQueries = readSubject(conversation, 6).questions;
    const out = await retrieveNodeChunks(client, "t-1", "and what frame size is it?", opts(revision(), { diagnostics, subjectQueries }));
    expect(out).toEqual([]);
    expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
  });

  it("after Return at 04:10 the bare follow-up answers from the selected unit's own column", async () => {
    const diagnostics: Record<string, unknown> = {};
    const { client, calls } = makeClient(rows());
    const read = readSubjectUnderSelection(conversation, 6, selected());
    expect(read).toEqual({ questions: [], complete: true });
    const out = await retrieveNodeChunks(client, "t-1", "and what frame size is it?", opts(revision(), { diagnostics, subjectQueries: read.questions, subjectOutOfReach: !read.complete }));
    expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
    expect(retrieved(calls)).toBeGreaterThan(0);
    expect(out.map((c) => c.content)).toContain(ownColumn.content);
    expect(out.map((c) => c.content)).not.toContain(siblingColumn.content);
  });

  it("a sibling asked AFTER the return still carries (typing nothing after a sibling still means the sibling)", async () => {
    const diagnostics: Record<string, unknown> = {};
    const { client } = makeClient(rows());
    const later = [...conversation, turn("ok and the GS13N-20P2 weight?", "2026-11-14T04:12:00.000Z")];
    const read = readSubjectUnderSelection(later, 6, selected());
    expect(read.questions).toEqual(["ok and the GS13N-20P2 weight?"]);
    const out = await retrieveNodeChunks(client, "t-1", "and what frame size is it?", opts(revision(), { diagnostics, subjectQueries: read.questions }));
    expect(out).toEqual([]);
    expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS13N-20P2"], record: "GS11N-20P2" });
  });

  it("a turn asked under another component after the boundary never carries (pending request finished late, restart)", () => {
    const mixed = [...conversation, turn("what is the coil voltage of the CA3KN22BD?", "2026-11-14T04:11:00.000Z", Q1, 1)];
    expect(readSubjectUnderSelection(mixed, 6, selected()).questions).toEqual([]);
  });

  it("a turn asked under an older revision of the same component never carries (identity was corrected)", () => {
    const corrected = [...conversation, turn("what frame size is the GS11N-20P5?", "2026-11-14T04:11:00.000Z", VFD1, 1)];
    expect(readSubjectUnderSelection(corrected, 6, selected()).questions).toEqual([]);
  });

  it("the boundary is exact below a millisecond: a turn 300 µs after the pick carries, one 300 µs before does not", () => {
    // Postgres keeps microseconds; a JS Date keeps milliseconds. Both turns fall in the pick's millisecond.
    const pick = selected({ selectedAt: "2026-11-14T04:10:00.123400Z" });
    const before = turn("what about the GS13N-20P2, same thing?", "2026-11-14T04:10:00.123100Z");
    const after = turn("what about the GS13N-20P2, same thing?", "2026-11-14T04:10:00.123700Z");
    expect(readSubjectUnderSelection([...conversation, after], 6, pick).questions).toEqual(["what about the GS13N-20P2, same thing?"]);
    expect(readSubjectUnderSelection([...conversation, before], 6, pick).questions).toEqual([]);
    // Control: millisecond-only stamps (fixtures, older rows) still compare as before.
    expect(instantMicros("2026-11-14T04:10:00.123Z")).toBe(Date.parse("2026-11-14T04:10:00.123Z") * 1000);
    expect(instantMicros("2026-11-14T04:10:00Z")).toBe(Date.parse("2026-11-14T04:10:00Z") * 1000);
  });

  it("no boundary in the read window: the ordinary widening rule is kept (complete only if the window was short)", () => {
    const after = [turn("what supply voltage does this drive need?", "2026-11-14T04:11:00.000Z"), turn("and the frame?", "2026-11-14T04:12:00.000Z")];
    expect(readSubjectUnderSelection(after, 2, selected())).toEqual({ questions: ["and the frame?", "what supply voltage does this drive need?"], complete: false });
    expect(readSubjectUnderSelection(after, 6, selected()).complete).toBe(true);
  });
});

describe("componentManualsBlocked: unknown is not ready", () => {
  it("a confirmed component with a family or catalog number may be answered from manuals", () => {
    expect(componentManualsBlocked(revision())).toBeNull();
    expect(componentManualsBlocked(revision({ catalogNumber: null }))).toBeNull();
  });

  it("an unconfirmed component is blocked until confirmed", () => {
    expect(componentManualsBlocked(revision({ identityStatus: "candidate", confirmedAt: null }))).toBe("not_confirmed");
    expect(componentManualsBlocked(revision({ identityStatus: "unknown", confirmedAt: null }))).toBe("not_confirmed");
  });

  it("a confirmed component with neither family nor catalog number has no identity a manual can be checked against", () => {
    expect(componentManualsBlocked(revision({ family: null, catalogNumber: null }))).toBe("no_model");
  });

  it("no revision at all (added, never described) is blocked", () => {
    expect(componentManualsBlocked(null)).toBe("not_confirmed");
  });
});
