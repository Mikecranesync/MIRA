/**
 * STRM-2 (abort path) + CMPS-1 (IME guard / auto-grow) pure helpers.
 * Run: npx vitest run src/components/equipment/notebook-chat-utils.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildChatBody,
  historyFromTurns,
  isAbortError,
  isEnterToSend,
  nextComposerHeight,
  persistedTurns,
  postNotebookChat,
  readNotebookStream,
  restoreComposer,
  stoppedTurn,
} from "./notebook-chat-utils";

import { visualObservationCaption } from "./notebook-chat-utils";

const enc = new TextEncoder();
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

function streamOf(chunks: string[], opts: { abortAfter?: number } = {}) {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (opts.abortAfter != null && i === opts.abortAfter) {
        // A fetch() body reader rejects with an AbortError once the signal fires.
        ctrl.error(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      if (i >= chunks.length) {
        ctrl.close();
        return;
      }
      ctrl.enqueue(enc.encode(chunks[i++]));
    },
  });
  return stream.getReader();
}

describe("readNotebookStream", () => {
  it("accumulates content frame by frame and returns the final turn", async () => {
    const chunks = [
      frame({ kind: "content", content: "F004 " }),
      frame({ kind: "content", content: "is undervoltage. [1]" }),
      frame({
        kind: "sources",
        citations: [{ citationId: "1", docId: "d", sourceTitle: "M", page: 1, fileId: null, quote: null }],
        sourceSnapshot: ["d"],
      }),
      frame({ kind: "evidence", basis: "oem_documentation" }),
      frame({ kind: "status", status: "answered" }),
      frame({ kind: "followups", suggestions: ["Next?"] }),
      "data: [DONE]\n\n",
    ];
    const seen: string[] = [];
    const out = await readNotebookStream(streamOf(chunks), (c) => seen.push(c));
    expect(seen).toEqual(["F004 ", "F004 is undervoltage. [1]"]);
    expect(out.content).toBe("F004 is undervoltage. [1]");
    expect(out.status).toBe("answered");
    expect(out.basis).toBe("oem_documentation");
    expect(out.citations).toHaveLength(1);
    expect(out.followups).toEqual(["Next?"]);
  });

  it("handles a frame split across two chunks", async () => {
    const whole = frame({ kind: "content", content: "hello" });
    const out = await readNotebookStream(streamOf([whole.slice(0, 9), whole.slice(9)]), () => {});
    expect(out.content).toBe("hello");
  });

  it("abort mid-stream rejects with AbortError carrying the partial text (STRM-2)", async () => {
    const chunks = [
      frame({ kind: "content", content: "The F004 " }),
      frame({ kind: "content", content: "fault is" }),
      frame({ kind: "content", content: " never reached" }),
    ];
    const seen: string[] = [];
    const p = readNotebookStream(streamOf(chunks, { abortAfter: 2 }), (c) => seen.push(c));
    await expect(p).rejects.toMatchObject({ name: "AbortError", partial: "The F004 fault is" });
    expect(seen).toEqual(["The F004 ", "The F004 fault is"]);
  });
});

describe("stoppedTurn", () => {
  it("keeps the partial text and is NOT an answered turn — no citations, basis, or follow-ups", () => {
    const t = stoppedTurn(
      {
        id: "a1",
        role: "assistant" as const,
        content: "",
        citations: [{ citationId: "1" }],
        basis: "oem_documentation",
        followups: ["x"],
      },
      "The F004 fault is",
    );
    expect(t).toMatchObject({
      id: "a1",
      content: "The F004 fault is",
      status: "error",
      stopped: true,
      citations: [],
      basis: null,
      followups: [],
    });
  });
});

describe("isAbortError", () => {
  it("recognises DOMException AbortError and rejects other errors", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("isEnterToSend (CMPS-1 IME guard)", () => {
  it("Enter sends; Shift+Enter does not", () => {
    expect(isEnterToSend({ key: "Enter", shiftKey: false })).toBe(true);
    expect(isEnterToSend({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isEnterToSend({ key: "a", shiftKey: false })).toBe(false);
  });
  it("Enter during an IME composition never sends", () => {
    expect(isEnterToSend({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
    expect(isEnterToSend({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
    expect(isEnterToSend({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false } })).toBe(true);
  });
});

describe("nextComposerHeight (CMPS-1 auto-grow fallback)", () => {
  it("grows to scrollHeight and caps at the max", () => {
    expect(nextComposerHeight(40, 160)).toBe(40);
    expect(nextComposerHeight(400, 160)).toBe(160);
    expect(nextComposerHeight(-1, 160)).toBe(0);
  });
});

describe("historyFromTurns (stopped turns never reach the model)", () => {
  const turns = [
    { role: "user" as const, content: "What does F004 mean?" },
    { role: "assistant" as const, content: "F004 is undervoltage. [1]", status: "answered" as const },
    { role: "user" as const, content: "And F005?" },
    // Stop pressed mid-stream: partial text, status error, stopped flag (live or rehydrated).
    { role: "assistant" as const, content: "F005 is over", status: "error" as const, stopped: true },
    { role: "user" as const, content: "" }, // no content → never sent
  ];
  it("excludes the stopped partial and empty turns, keeps completed turns", () => {
    const h = historyFromTurns(turns);
    expect(h).toEqual([
      { role: "user", content: "What does F004 mean?" },
      { role: "assistant", content: "F004 is undervoltage. [1]" },
      { role: "user", content: "And F005?" },
    ]);
    expect(JSON.stringify(h)).not.toContain("F005 is over");
  });
  it("caps at the last 12 turns (CONV-3 client half)", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: `q${i}` }));
    expect(historyFromTurns(many)).toHaveLength(12);
    expect(historyFromTurns(many)[0].content).toBe("q8");
  });
  it("buildChatBody carries the exact {message, sourceDocIds, history} shape", () => {
    expect(buildChatBody("q", ["d1"], turns)).toEqual({
      message: "q",
      sourceDocIds: ["d1"],
      history: historyFromTurns(turns),
    });
  });
});

describe("CMPS-2 — failure keeps the question, Retry re-posts the identical body", () => {
  const body = buildChatBody("What does F004 mean?", ["d1"], [
    { role: "user" as const, content: "earlier" },
    { role: "assistant" as const, content: "earlier answer", status: "answered" as const },
  ]);

  it("a 502 rejects (no fabricated answer) and the composer keeps the text", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    await expect(
      postNotebookChat("/chat", body, new AbortController().signal, () => {}, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("http_502");
    // The composer rule: an emptied composer gets the question back…
    expect(restoreComposer("", body.message)).toBe("What does F004 mean?");
    // …but a new draft the technician already started is never clobbered.
    expect(restoreComposer("new draft", body.message)).toBe("new draft");
  });

  it("retry posts a JSON-identical body to the same URL", async () => {
    const calls: string[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init.body as string);
      n += 1;
      if (n === 1) return new Response("bad gateway", { status: 502 });
      return new Response(`data: ${JSON.stringify({ kind: "content", content: "ok" })}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    const sig = new AbortController().signal;
    await expect(postNotebookChat("/chat", body, sig, () => {}, fetchImpl as unknown as typeof fetch)).rejects.toThrow("http_502");
    const out = await postNotebookChat("/chat", body, sig, () => {}, fetchImpl as unknown as typeof fetch);
    expect(out.content).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
    expect(JSON.parse(calls[1])).toEqual({
      message: "What does F004 mean?",
      sourceDocIds: ["d1"],
      history: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "earlier answer" },
      ],
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(fetchImpl.mock.calls[1][0]);
  });
});

describe("persistedTurns — reload applies the STOPPED-TURN CONTRACT", () => {
  const cite = { citationId: "1", docId: "d", sourceTitle: "M", page: 1, fileId: null, quote: null };

  it("error + partial text ⇒ stopped: partial shown, no citations, no basis, out of history", () => {
    const [q, a] = persistedTurns([
      { id: "t1", question: "And F005?", answerStatus: "error", answerText: "F005 is over", evidence: [cite], basis: "oem_documentation" },
    ]);
    expect(q).toEqual({ id: "t1-q", role: "user", content: "And F005?" });
    expect(a).toEqual({ id: "t1-a", role: "assistant", content: "F005 is over", status: "error", citations: [], basis: null, stopped: true });
    // Same exclusion rule as the live path:
    expect(historyFromTurns([q, a])).toEqual([{ role: "user", content: "And F005?" }]);
  });

  it("error + null text ⇒ the existing error copy, unchanged, not stopped", () => {
    const [, a] = persistedTurns([
      { id: "t2", question: "q", answerStatus: "error", answerText: null, evidence: [], basis: null },
    ]);
    expect(a).toEqual({
      id: "t2-a",
      role: "assistant",
      content: "I couldn't find that in the selected sources.",
      status: "error",
      citations: [],
      basis: null,
    });
    expect(a).not.toHaveProperty("stopped");
  });

  it("answered and insufficient_evidence rows map exactly as before (basis + evidence survive)", () => {
    const rows = persistedTurns([
      { id: "t3", question: "q", answerStatus: "answered", answerText: "A. [1]", evidence: [cite], basis: "oem_documentation" },
      { id: "t4", question: "q2", answerStatus: "insufficient_evidence", answerText: null, evidence: [] },
    ]);
    expect(rows[1]).toEqual({ id: "t3-a", role: "assistant", content: "A. [1]", status: "answered", citations: [cite], basis: "oem_documentation" });
    expect(rows[3]).toEqual({
      id: "t4-a",
      role: "assistant",
      content: "I couldn't find that in the selected sources.",
      status: "insufficient_evidence",
      citations: [],
      basis: null,
    });
  });
});

// ── Sensor S4 (D5): machine evidence rides in evidence[] / the evidence frame ──
import {
  MACHINE_HISTORY_UNAVAILABLE_CAPTION,
  MACHINE_NO_CHANGES_CAPTION,
  machineReplayCaption,
  recordedObservationsPhrase,
  splitEvidence,
} from "./notebook-chat-utils";

const machine = {
  kind: "machine_evidence" as const,
  assetId: "a1",
  anchorAt: "2026-08-27T23:16:31.000Z",
  pre: 5,
  post: 2,
  rowCount: 7,
  freshness: "stale" as const,
};

describe("persistedTurns tolerates non-document evidence entries (D5)", () => {
  const cite = { citationId: "1", docId: "d", sourceTitle: "M", page: 1, fileId: null, quote: null };

  it("splits the machine entry out of citations and keeps it on the turn", () => {
    const [, a] = persistedTurns([
      { id: "t9", question: "what happened?", answerStatus: "answered", answerText: "A. [1]", evidence: [cite, machine], basis: "machine_history" },
    ]);
    expect(a.citations).toEqual([cite]);
    expect(a.machineEvidence).toEqual([machine]);
    expect(a.basis).toBe("machine_history");
  });

  it("a turn without machine evidence is byte-identical to before (no machineEvidence key)", () => {
    const [, a] = persistedTurns([
      { id: "t10", question: "q", answerStatus: "answered", answerText: "A. [1]", evidence: [cite], basis: "oem_documentation" },
    ]);
    expect(a).toEqual({ id: "t10-a", role: "assistant", content: "A. [1]", status: "answered", citations: [cite], basis: "oem_documentation" });
  });

  it("a stopped turn drops machine evidence along with citations and basis", () => {
    const [, a] = persistedTurns([
      { id: "t11", question: "q", answerStatus: "error", answerText: "partial", evidence: [cite, machine], basis: "machine_history" },
    ]);
    expect(a).toEqual({ id: "t11-a", role: "assistant", content: "partial", status: "error", citations: [], basis: null, stopped: true });
  });

  it("splitEvidence drops junk that is neither a citation nor machine evidence", () => {
    expect(splitEvidence([cite, machine, null, "junk", { kind: "machine_evidence" }, { noDocId: true }])).toEqual({
      citations: [cite],
      machineEvidence: [machine],
      visualEvidence: [],
      safetyNotice: null,
    });
  });
});

// ── S5 D3: the persisted Visual observation card ────────────────────────────
const visual = {
  kind: "visual_observation" as const,
  fileId: "f0000000-0000-4000-8000-000000000001",
  capturedAt: "2026-08-27T23:14:21.000Z",
  provenance: "phone_photo" as const,
};

describe("persistedTurns / splitEvidence with a visual observation (S5 D3)", () => {
  const cite = { citationId: "1", docId: "d", sourceTitle: "M", page: 1, fileId: null, quote: null };

  it("splits the visual entry out of citations and keeps it on the turn, next to the machine entry", () => {
    const [, a] = persistedTurns([
      { id: "t12", question: "what is this LED?", answerStatus: "answered", answerText: "A. [1]", evidence: [cite, machine, visual], basis: "oem_documentation" },
    ]);
    expect(a.citations).toEqual([cite]);
    expect(a.machineEvidence).toEqual([machine]);
    expect(a.visualEvidence).toEqual([visual]);
    // the photo never moves the basis
    expect(a.basis).toBe("oem_documentation");
  });

  it("a turn without a photo carries no visualEvidence key (byte-identical to before)", () => {
    const [, a] = persistedTurns([
      { id: "t13", question: "q", answerStatus: "answered", answerText: "A.", evidence: [cite], basis: "oem_documentation" },
    ]);
    expect(a).not.toHaveProperty("visualEvidence");
  });

  it("a stopped turn drops the photo along with citations and basis", () => {
    const [, a] = persistedTurns([
      { id: "t14", question: "q", answerStatus: "error", answerText: "partial", evidence: [cite, visual], basis: "oem_documentation" },
    ]);
    expect(a).toEqual({ id: "t14-a", role: "assistant", content: "partial", status: "error", citations: [], basis: null, stopped: true });
  });

  it("a malformed visual entry (no fileId / no capturedAt) is dropped, never a dead card", () => {
    expect(splitEvidence([{ kind: "visual_observation" }, { kind: "visual_observation", fileId: "f" }])).toEqual({
      citations: [],
      machineEvidence: [],
      visualEvidence: [],
      safetyNotice: null,
    });
  });

  it("readNotebookStream picks the visual entry off the evidence frame; absent → null", async () => {
    const withPhoto = await readNotebookStream(
      streamOf([
        frame({ kind: "content", content: "A." }),
        frame({ kind: "sources", citations: [], sourceSnapshot: [] }),
        frame({ kind: "evidence", basis: "oem_documentation", label: "x", visualEvidence: visual }),
        frame({ kind: "status", status: "answered" }),
        "data: [DONE]\n\n",
      ]),
      () => {},
    );
    expect(withPhoto.visualEvidence).toEqual(visual);
    expect(withPhoto.machineEvidence).toBeNull();
    const without = await readNotebookStream(
      streamOf([frame({ kind: "evidence", basis: "oem_documentation", label: "x" }), frame({ kind: "status", status: "answered" }), "data: [DONE]\n\n"]),
      () => {},
    );
    expect(without.visualEvidence).toBeNull();
  });

  it("visualObservationCaption is the contract string", () => {
    expect(visualObservationCaption(visual, () => "02:14:21")).toBe("Visual observation · Photo captured · 02:14:21");
  });
});

describe("readNotebookStream picks the machine entry off the evidence frame", () => {
  it("machineEvidence is exposed alongside basis; absent → null", async () => {
    const withMachine = await readNotebookStream(
      streamOf([
        frame({ kind: "content", content: "A." }),
        frame({ kind: "sources", citations: [], sourceSnapshot: [] }),
        frame({ kind: "evidence", basis: "machine_history", label: "x", machineEvidence: machine }),
        frame({ kind: "status", status: "answered" }),
        "data: [DONE]\n\n",
      ]),
      () => {},
    );
    expect(withMachine.basis).toBe("machine_history");
    expect(withMachine.machineEvidence).toEqual(machine);

    const without = await readNotebookStream(
      streamOf([frame({ kind: "evidence", basis: "oem_documentation", label: "x" }), frame({ kind: "status", status: "answered" }), "data: [DONE]\n\n"]),
      () => {},
    );
    expect(without.machineEvidence).toBeNull();
  });
});

describe("buildChatBody — the web body carries no window selection", () => {
  // The web notebook renders machine evidence; it never selects a window (the
  // mobile lane owns REPLAY selection). The body stays exactly three keys.
  it("is the three-key body, with no machineEvidence key", () => {
    const body = buildChatBody("q", ["d"], []);
    expect(body).toEqual({ message: "q", sourceDocIds: ["d"], history: [] });
    expect(Object.keys(body)).toEqual(["message", "sourceDocIds", "history"]);
  });
});

describe("machineReplayCaption", () => {
  const clock = () => "23:16:31";
  it("counts, anchors and names freshness honestly", () => {
    // S5 D5 cross-lane contract: mobile's replayCardTitle shape + the shared FRESHNESS_LABEL vocabulary.
    expect(machineReplayCaption(machine, clock)).toBe("Machine Replay · 7 recorded observations around 23:16:31 · connection at capture: Stale");
    expect(machineReplayCaption({ ...machine, rowCount: 1, freshness: "live" }, clock)).toBe("Machine Replay · 1 recorded observation around 23:16:31 · connection at capture: Live");
    expect(machineReplayCaption({ ...machine, freshness: "simulated" }, clock)).toBe("Machine Replay · 7 recorded observations around 23:16:31 · connection at capture: Simulated");
    // m1: the rows are not all CHANGES — a kind:"event" row is a periodic
    // sample with no prev_value, so the caption must not claim otherwise.
    expect(machineReplayCaption(machine, clock)).not.toContain("observed change");
    expect(recordedObservationsPhrase(1)).toBe("1 recorded observation");
    expect(recordedObservationsPhrase(0)).toBe("0 recorded observations");
  });

  // §2.8: a "0 recorded observations" count reads like a real, quiet window — so it must
  // never stand in for "the backend isn't there". Two distinct sentences.
  it("an unavailable window says so instead of counting zero", () => {
    expect(machineReplayCaption({ ...machine, rowCount: 0, reason: "unavailable" }, clock)).toBe(
      MACHINE_HISTORY_UNAVAILABLE_CAPTION,
    );
    expect(machineReplayCaption({ ...machine, rowCount: 0, reason: "unavailable" }, clock)).not.toContain("recorded observation");
  });

  it("a genuinely empty window says nothing was recorded, not a zero count", () => {
    expect(machineReplayCaption({ ...machine, rowCount: 0, freshness: "unknown" }, clock)).toBe(MACHINE_NO_CHANGES_CAPTION);
    expect(machineReplayCaption({ ...machine, rowCount: 0, reason: null }, clock)).toBe(MACHINE_NO_CHANGES_CAPTION);
  });
});


import { splitEvidence } from "./notebook-chat-utils";

describe("safety_notice round-trip (FLEET-001)", () => {
  it("splitEvidence extracts a safety_notice entry without treating it as a citation", () => {
    const entry = { kind: "safety_notice", trigger: "smoke coming" };
    const result = splitEvidence([entry]);
    expect(result.safetyNotice).toEqual(entry);
    expect(result.citations).toHaveLength(0);
    expect(result.machineEvidence).toHaveLength(0);
    expect(result.visualEvidence).toHaveLength(0);
  });

  it("persistedTurns restores safetyNotice on a reloaded safety turn", () => {
    const rows = [
      {
        id: "t1",
        question: "smoke is coming from the panel",
        answerStatus: "answered",
        answerText: "SAFETY STOP: isolate the machine immediately.",
        evidence: [{ kind: "safety_notice", trigger: "smoke coming" }],
        basis: null,
      },
    ];
    const turns = persistedTurns(rows);
    const assistant = turns.find((t: { role: string }) => t.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.safetyNotice).toEqual({ kind: "safety_notice", trigger: "smoke coming" });
    expect(assistant!.citations).toHaveLength(0);
    expect(assistant!.stopped).toBeUndefined();
  });

  it("persistedTurns does NOT surface safetyNotice as a citation", () => {
    const rows = [
      {
        id: "t2",
        question: "there is an exposed wire",
        answerStatus: "answered",
        answerText: "SAFETY STOP: isolate immediately.",
        evidence: [{ kind: "safety_notice", trigger: "exposed wire" }],
        basis: null,
      },
    ];
    const turns = persistedTurns(rows);
    const assistant = turns.find((t: { role: string }) => t.role === "assistant");
    expect(assistant!.citations).toHaveLength(0);
  });

  it("a normal answered turn with no safety_notice has safetyNotice undefined", () => {
    const rows = [
      {
        id: "t3",
        question: "what does P042 set",
        answerStatus: "answered",
        answerText: "P042 sets the deceleration ramp [1].",
        evidence: [{ citationId: "1", docId: "doc-a", sourceTitle: "Manual", page: 14, fileId: null, quote: null }],
        basis: "oem_documentation",
      },
    ];
    const turns = persistedTurns(rows);
    const assistant = turns.find((t: { role: string }) => t.role === "assistant");
    expect(assistant!.safetyNotice).toBeUndefined();
    expect(assistant!.citations).toHaveLength(1);
  });
});
