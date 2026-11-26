/**
 * #6013: the cited manual's own warning (DANGER / WARNING statement) rides the live evidence frame,
 * so the finished answer shows it before the history reload, in the same place the saved turn does.
 * Before this the live turn left it out and it appeared only after the reload, about a second later.
 *
 * Run: npx vitest run src/factorylm-ui/manual-safety-live.test.ts
 */
import { describe, expect, it } from "vitest";
import { readNotebookStream, type PersistedTurn, type StreamResult } from "@/components/equipment/notebook-chat-utils";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { hazardBanner } from "@/lib/safety-classifier";
import { partsFromStream, turnsFromPersisted, type HubNotebookMeta } from "./to-interaction";

const meta: HubNotebookMeta = {
  notebookId: "nb-1",
  threadId: "notebook-nb-1:thread-t-1",
  title: "Conveyor CV-101",
  tenantId: "tenant-1",
  asset: { id: "asset-uuid-1", name: "Micro820", unsPath: "enterprise.garage.cv_101" },
  identityConfirmed: true,
  capturedAt: "2026-11-26T12:00:00.000Z",
};

const citation: EvidenceCitation = {
  citationId: "2",
  docId: "doc-1",
  sourceTitle: "2080-IN009B-EN-P.pdf",
  page: 5,
  fileId: null,
  quote: "If you connect or disconnect the serial cable with power applied, an electrical arc can occur.",
};

const manualWarning = {
  kind: "manual_safety_statement" as const,
  marker: "DANGER",
  statement: "If you connect or disconnect the serial cable with power applied, an electrical arc can occur.",
  sourceDocId: "doc-1",
  sourceCitationId: "2",
  sourceTitle: "2080-IN009B-EN-P.pdf",
  page: 5,
};

const DIRECTIVE = `${hazardBanner("smoke")} (p.5)`;
const STEPS = "1. Stop the conveyor from the upstream disconnect.\n2. Keep the enclosure closed.";
const ANSWER = `${DIRECTIVE}\n\n${STEPS}`;

function result(over: Partial<StreamResult> = {}): StreamResult & { statusMessage: string | null } {
  return {
    content: ANSWER,
    citations: [citation],
    status: "answered",
    basis: "oem_documentation",
    followups: [],
    machineEvidence: null,
    visualEvidence: null,
    safetyNotice: null,
    hazardNotice: null,
    sawStatus: true,
    ...over,
    statusMessage: null,
  } as StreamResult & { statusMessage: string | null };
}

function savedRow(): PersistedTurn & { createdAt?: string } {
  return {
    id: "turn-1",
    question: "smoke from the PLC cabinet",
    answerStatus: "answered",
    answerText: ANSWER,
    evidence: [manualWarning, citation] as unknown as PersistedTurn["evidence"],
    basis: "oem_documentation",
    createdAt: "2026-11-26T12:00:00.000Z",
  };
}

type Part = ReturnType<typeof partsFromStream>[number];
const shape = (parts: readonly Part[]) =>
  parts.map((p) => (p.type === "text" ? `text:${p.text}` : p.type === "safety_notice" ? `notice:${p.notice.message}` : p.type));

function readerOf(frames: unknown[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      c.close();
    },
  }).getReader();
}

describe("#6013 the stream reader keeps the manual's warning from the evidence frame", () => {
  const frames = (evidence: Record<string, unknown>) => [
    { kind: "content", content: ANSWER },
    { kind: "sources", citations: [citation] },
    { kind: "evidence", basis: "oem_documentation", ...evidence },
    { kind: "status", status: "answered" },
  ];

  it("reads it when the frame carries it", async () => {
    const out = await readNotebookStream(readerOf(frames({ manualSafetyStatement: manualWarning })), () => undefined);
    expect(out.manualSafetyStatement).toEqual(manualWarning);
  });

  it("control: a frame without it, or with a malformed one, leaves it empty", async () => {
    expect((await readNotebookStream(readerOf(frames({})), () => undefined)).manualSafetyStatement ?? null).toBeNull();
    const bad = { ...manualWarning, statement: 42 };
    expect((await readNotebookStream(readerOf(frames({ manualSafetyStatement: bad })), () => undefined)).manualSafetyStatement ?? null).toBeNull();
  });
});

describe("#6013 the finished live answer shows the warning where the saved turn does", () => {
  it("precondition: the saved turn shows the manual's warning", () => {
    const [, saved] = turnsFromPersisted(savedRow(), meta);
    expect(shape(saved.parts)).toContain(`notice:DANGER: ${manualWarning.statement} (2080-IN009B-EN-P.pdf, p. 5)`);
  });

  it("live and saved render the same parts in the same order (warning before the steps)", () => {
    const live = partsFromStream(result({ manualSafetyStatement: manualWarning }), { turnId: "turn-1-a" });
    const [, saved] = turnsFromPersisted(savedRow(), meta);
    expect(shape(live)).toEqual(shape(saved.parts));
    const notice = shape(live).findIndex((s) => s.startsWith("notice:DANGER"));
    const steps = shape(live).indexOf(`text:${STEPS}`);
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(notice).toBeLessThan(steps);
  });

  it("control: a stopped or cut-off stream shows no manual warning", () => {
    for (const r of [
      partsFromStream(result({ manualSafetyStatement: manualWarning }), { turnId: "t", stopped: true }),
      partsFromStream(result({ manualSafetyStatement: manualWarning, sawStatus: false }), { turnId: "t" }),
    ]) {
      expect(shape(r).some((s) => s.startsWith("notice:DANGER"))).toBe(false);
    }
  });
});
