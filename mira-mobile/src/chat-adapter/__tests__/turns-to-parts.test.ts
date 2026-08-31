// ChatV2 adapter contract (PRD 2026-08-30 §9/§10, ADR-0039).
//
// The invariant these tests exist for: a persisted conversation must hydrate
// to the SAME semantic parts the live stream produced. Everything else here
// guards a specific way MIRA could lie to a technician — a fabricated
// completion, a citation on a turn that never finished, a safety stop that
// reloads as an ordinary answer.
//
// Run: cd mira-mobile && bunx vitest run src/chat-adapter
import { describe, expect, it } from "vitest";
import { parseChatSse, type ChatTurn } from "../../lib/sse";
import type { NotebookServerTurn } from "../../api/resources";
import {
  comparableProjection,
  hydrateMessages,
  liveTurnMessages,
  pendingMessages,
  threadMessages,
  unknownEvidenceEntries,
} from "../turns-to-parts";
import { citationsOf, textOf, type AdapterMessage } from "../contract";
import { toThreadMessage } from "../runtime";

const frame = (o: Record<string, unknown>) => `data: ${JSON.stringify(o)}\n\n`;
const DONE = "data: [DONE]\n\n";

const CITATIONS = [
  {
    citationId: "1",
    sourceTitle: "GS10 manual",
    page: 42,
    quote: "115% FLA",
    docId: "d1",
    fileId: "f1",
    originFileId: null,
  },
  {
    citationId: "2",
    sourceTitle: "GS10 manual",
    page: 57,
    quote: "check leads",
    docId: "d1",
    fileId: "f1",
    originFileId: null,
  },
];

const MACHINE = {
  kind: "machine_evidence" as const,
  assetId: "cv-101",
  anchorAt: "2026-08-28T14:03:00.000Z",
  pre: 120,
  post: 120,
  rowCount: 7,
  freshness: "stale" as const,
};

const VISUAL = {
  kind: "visual_observation" as const,
  fileId: "photo-1",
  capturedAt: "2026-08-28T14:00:00.000Z",
  provenance: "phone_photo" as const,
};

/** An answered, cited turn — the wire order the hub actually emits. */
const ANSWERED =
  frame({ kind: "content", content: "The overload trips at 115% [1]." }) +
  frame({ kind: "content", content: " Check the leads [2]." }) +
  frame({ kind: "sources", citations: CITATIONS }) +
  frame({ kind: "evidence", basis: "oem_documentation", label: "From the manual" }) +
  frame({ kind: "usage", provider: "groq", tokens: 12 }) +
  frame({ kind: "status", status: "answered" }) +
  frame({ kind: "followups", suggestions: ["How do I reset it?"] }) +
  DONE;

/** The same conversation as the server persists it. */
const PERSISTED: NotebookServerTurn[] = [
  {
    id: "t1",
    question: "What trips the overload?",
    answerStatus: "answered",
    answerText: "The overload trips at 115% [1]. Check the leads [2].",
    evidence: CITATIONS,
    basis: "oem_documentation",
  },
];

describe("hydration (criterion 1)", () => {
  it("emits user + assistant per row with the persistedTurns id scheme", () => {
    const msgs = hydrateMessages(PERSISTED);
    expect(msgs.map((m) => m.id)).toEqual(["t1-q", "t1-a"]);
    expect(msgs[0].role).toBe("user");
    expect(textOf(msgs[0])).toBe("What trips the overload?");
  });

  it("citations, basis and evidence cards survive reload", () => {
    const a = hydrateMessages([
      { ...PERSISTED[0], evidence: [...CITATIONS, MACHINE, VISUAL] },
    ])[1];
    expect(citationsOf(a)).toHaveLength(2);
    expect(a.parts.some((p) => p.type === "machine_evidence")).toBe(true);
    expect(a.parts.some((p) => p.type === "observation")).toBe(true);
    expect(a.parts.some((p) => p.type === "basis" && p.basis === "oem_documentation")).toBe(true);
    expect(a.lifecycle).toBe("completed");
  });

  it("STRM-2 stopped row: partial text, zero citations, stopped lifecycle", () => {
    const a = hydrateMessages([
      {
        id: "t2",
        question: "Tell me everything",
        answerStatus: "error",
        answerText: "The overload trips at 115",
        evidence: CITATIONS,
        basis: null,
      },
    ])[1];
    expect(textOf(a)).toBe("The overload trips at 115");
    expect(citationsOf(a)).toEqual([]);
    expect(a.lifecycle).toBe("stopped");
    expect(a.parts.some((p) => p.type === "error" && p.reason === "stopped")).toBe(true);
  });

  it("provider-failure row (error + no text) is distinguishable from stopped", () => {
    const a = hydrateMessages([
      { id: "t3", question: "x", answerStatus: "error", answerText: null, evidence: [], basis: null },
    ])[1];
    expect(a.lifecycle).toBe("failed");
    expect(a.parts.some((p) => p.type === "error" && p.reason === "provider_failure")).toBe(true);
  });

  it("an unknown evidence entry is preserved as an inspectable part, not a citation", () => {
    const a = hydrateMessages([
      { ...PERSISTED[0], evidence: [...CITATIONS, { kind: "hologram", x: 1 }] },
    ])[1];
    expect(citationsOf(a)).toHaveLength(2);
    expect(a.parts.filter((p) => p.type === "unknown")).toHaveLength(1);
    expect(unknownEvidenceEntries([{ kind: "hologram" }, ...CITATIONS])).toEqual([
      { kind: "hologram" },
    ]);
  });
});

describe("live turns", () => {
  it("answered turn carries text, citations, basis and follow-ups", () => {
    const turn = parseChatSse(ANSWERED);
    const a = liveTurnMessages("q", turn, 0)[1];
    expect(textOf(a)).toContain("115%");
    expect(citationsOf(a)).toHaveLength(2);
    expect(a.parts.some((p) => p.type === "followups")).toBe(true);
    expect(a.lifecycle).toBe("completed");
  });

  it("SAFETY: the safety frame becomes a distinct part, never an ordinary answer", () => {
    const safety =
      frame({ kind: "sources", citations: [] }) +
      frame({ kind: "content", content: "STOP. Isolate and lock out before opening." }) +
      frame({ kind: "safety", trigger: "arc flash" }) +
      frame({ kind: "status", status: "answered" }) +
      DONE;
    const a = liveTurnMessages("is it safe?", parseChatSse(safety), 0)[1];
    expect(a.parts[0]).toEqual({ type: "safety_notice", trigger: "arc flash" });
    expect(textOf(a)).toMatch(/^STOP\./);
  });

  it("an unknown FRAME kind is preserved and inspectable, never a crash", () => {
    const body =
      frame({ kind: "content", content: "answer" }) +
      frame({ kind: "hologram", payload: { x: 1 } }) +
      frame({ kind: "status", status: "answered" }) +
      DONE;
    const a = liveTurnMessages("q", parseChatSse(body), 0)[1];
    expect(a.parts.some((p) => p.type === "unknown")).toBe(true);
    expect(textOf(a)).toBe("answer");
  });

  it("TRUNCATION: a stream that dies after `sources` is NOT a cited answer", () => {
    // The defect this pins: `sources` arrives BEFORE `status`, so a dropped
    // connection would otherwise render a complete, cited, basis-badged answer
    // the server never finished — a fabricated completion (PRD §10.9).
    const truncated =
      frame({ kind: "content", content: "The overload trips at 115% [1]." }) +
      frame({ kind: "sources", citations: CITATIONS }) +
      frame({ kind: "evidence", basis: "oem_documentation", label: "From the manual" });
    const turn = parseChatSse(truncated);
    expect(turn.sawStatus).toBe(false);
    const a = liveTurnMessages("q", turn, 0)[1];
    expect(citationsOf(a)).toEqual([]);
    expect(a.parts.some((p) => p.type === "basis")).toBe(false);
    expect(a.lifecycle).toBe("failed");
    expect(a.parts.some((p) => p.type === "error" && p.reason === "provider_failure")).toBe(true);
  });

  it("a COMPLETE stream is never mistaken for a truncated one", () => {
    expect(parseChatSse(ANSWERED).sawStatus).toBeUndefined();
    expect(liveTurnMessages("q", parseChatSse(ANSWERED), 0)[1].lifecycle).toBe("completed");
  });

  it("stopped live turn keeps the partial and drops citations", () => {
    const stopped: ChatTurn = {
      ...parseChatSse(ANSWERED),
      status: "stopped",
      citations: [],
      followups: undefined,
    };
    const a = liveTurnMessages("q", stopped, 0)[1];
    expect(a.lifecycle).toBe("stopped");
    expect(citationsOf(a)).toEqual([]);
  });

  it("the in-flight turn shows text only — citations arrive after content", () => {
    const [u, a] = pendingMessages("q", { answer: "partial", citations: CITATIONS, status: "" });
    expect(u.role).toBe("user");
    expect(a.lifecycle).toBe("running");
    expect(citationsOf(a)).toEqual([]);
    expect(textOf(a)).toBe("partial");
  });
});

describe("live ≡ hydrated parity (the invariant)", () => {
  const cases: { name: string; live: ChatTurn; row: NotebookServerTurn }[] = [
    {
      name: "prose + citations",
      live: parseChatSse(ANSWERED),
      row: PERSISTED[0],
    },
    {
      name: "insufficient evidence",
      live: parseChatSse(
        frame({ kind: "sources", citations: [] }) +
          frame({ kind: "status", status: "insufficient_evidence" }) +
          DONE,
      ),
      row: {
        id: "t4",
        question: "q",
        answerStatus: "insufficient_evidence",
        answerText: null,
        evidence: [],
        basis: null,
      },
    },
    {
      name: "machine evidence (REPLAY)",
      live: parseChatSse(
        frame({ kind: "content", content: "Around 14:03 the bus dipped [1]." }) +
          frame({ kind: "sources", citations: [CITATIONS[0]] }) +
          frame({
            kind: "evidence",
            basis: "machine_history",
            label: "Recorded",
            machineEvidence: MACHINE,
          }) +
          frame({ kind: "status", status: "answered" }) +
          DONE,
      ),
      row: {
        id: "t5",
        question: "q",
        answerStatus: "answered",
        answerText: "Around 14:03 the bus dipped [1].",
        evidence: [CITATIONS[0], MACHINE],
        basis: "machine_history",
      },
    },
    {
      name: "visual observation (LOOK)",
      live: parseChatSse(
        frame({ kind: "content", content: "That's a contactor." }) +
          frame({ kind: "sources", citations: [] }) +
          frame({
            kind: "evidence",
            basis: "general_reasoning",
            label: "General",
            visualEvidence: VISUAL,
          }) +
          frame({ kind: "status", status: "answered" }) +
          DONE,
      ),
      row: {
        id: "t6",
        question: "q",
        answerStatus: "answered",
        answerText: "That's a contactor.",
        evidence: [VISUAL],
        basis: "general_reasoning",
      },
    },
    {
      name: "stopped response",
      live: { answer: "partial text", citations: [], status: "stopped" },
      row: {
        id: "t7",
        question: "q",
        answerStatus: "error",
        answerText: "partial text",
        evidence: [],
        basis: null,
      },
    },
    {
      name: "failed response",
      live: parseChatSse(
        frame({ kind: "sources", citations: [] }) + frame({ kind: "status", status: "error" }) + DONE,
      ),
      row: {
        id: "t8",
        question: "q",
        answerStatus: "error",
        answerText: null,
        evidence: [],
        basis: null,
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: the live turn projects like its persisted row`, () => {
      const live = liveTurnMessages(c.row.question, c.live, 0)[1];
      const hydrated = hydrateMessages([c.row])[1];
      expect(comparableProjection(live)).toEqual(comparableProjection(hydrated));
    });
  }

  it("a persisted safety stop hydrates as the same safety notice, never a citation", () => {
    const live = liveTurnMessages(
      "q",
      parseChatSse(
        frame({ kind: "content", content: "STOP." }) +
          frame({ kind: "safety", trigger: "loto" }) +
          frame({ kind: "status", status: "answered" }) +
          DONE,
      ),
      0,
    )[1];
    const hydrated = hydrateMessages([
      {
        id: "t9",
        question: "q",
        answerStatus: "answered",
        answerText: "STOP.",
        evidence: [{ kind: "safety_notice", trigger: "loto" }],
        basis: null,
      },
    ])[1];
    expect(live.parts[0]).toEqual({ type: "safety_notice", trigger: "loto" });
    expect(hydrated.parts[0]).toEqual({ type: "safety_notice", trigger: "loto" });
    expect(hydrated.parts.some((p) => p.type === "source")).toBe(false);
    expect(comparableProjection(live)).toEqual(comparableProjection(hydrated));
  });
});

describe("thread assembly + library conversion", () => {
  it("orders persisted → live → pending", () => {
    const msgs = threadMessages(
      PERSISTED,
      [{ q: "live q", a: parseChatSse(ANSWERED) }],
      { q: "in flight", a: { answer: "typ", citations: [], status: "" } },
    );
    expect(msgs.map((m) => m.id)).toEqual([
      "t1-q", "t1-a", "live-0-q", "live-0-a", "pending-q", "pending-a",
    ]);
  });

  it("converts to assistant-ui messages: user text stays text, MIRA parts ride as data-*", () => {
    const [u, a] = hydrateMessages([
      { ...PERSISTED[0], evidence: [...CITATIONS, MACHINE] },
    ]).map(toThreadMessage);
    expect(u.content).toEqual([{ type: "text", text: "What trips the overload?" }]);
    const kinds = (a.content as unknown as { type: string }[]).map((p) => p.type);
    expect(kinds).toContain("data-answer");
    expect(kinds).toContain("data-machine-evidence");
    // Citations ride WITH the answer body (they gate the inline marks) and are
    // never emitted twice.
    expect(kinds).not.toContain("source");
    const answer = (a.content as unknown as { type: string; data?: { citations?: unknown[] } }[]).find(
      (p) => p.type === "data-answer",
    );
    expect(answer?.data?.citations).toHaveLength(2);
  });

  it("lifecycle maps to library message status", () => {
    const running: AdapterMessage = {
      id: "x",
      role: "assistant",
      parts: [{ type: "text", text: "", knownCitationIds: [] }],
      lifecycle: "running",
      status: null,
    };
    expect(toThreadMessage(running).status).toEqual({ type: "running" });
    expect(toThreadMessage({ ...running, lifecycle: "stopped" }).status).toEqual({
      type: "incomplete",
      reason: "cancelled",
    });
    expect(toThreadMessage({ ...running, lifecycle: "failed" }).status).toEqual({
      type: "incomplete",
      reason: "error",
    });
  });
});
