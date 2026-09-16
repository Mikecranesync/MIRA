/**
 * Contract tests for the shared MIRA chat route, driven by the frame sequences
 * `mira-hub/src/lib/notebook-chat-types.ts` documents as the real wire order.
 *
 * The point of every assertion here is the same: when the route does not
 * produce an answer, nothing takes its place.
 */
import { describe, expect, it } from "bun:test";
import {
  NotebookChatClient,
  chatGate,
  chatUnavailable,
  framesToParts,
  notebookChatPath,
  parseFrame,
  parseStream,
  splitSseFrames,
  type ChatFailureReason,
  type ChatFrame,
  type NotebookChatOptions,
} from "../notebook-chat";
import type { InteractionPart } from "../types";

function sse(...frames: unknown[]): string {
  return [...frames.map((frame) => `data: ${JSON.stringify(frame)}`), "data: [DONE]"].join("\n\n");
}

/** answered : content* → sources → evidence → [usage] → status → [followups] */
const ANSWERED = sse(
  { kind: "content", content: "The case packer infeed jammed" },
  { kind: "content", content: " and stopped the zone upstream [1]." },
  {
    kind: "sources",
    citations: [{ citationId: "1", docId: "doc-troubleshooting", sourceTitle: "CasePacker01 troubleshooting.md", page: 3 }],
    sourceSnapshot: ["doc-troubleshooting"],
  },
  { kind: "evidence", basis: "oem_documentation", label: "Answered from the machine's documentation" },
  { kind: "usage", provider: "groq", model: "x", routeReason: "primary", inputTokens: 900, outputTokens: 120, cachedInputTokens: null, costUsdEstimate: null, status: "ok" },
  { kind: "status", status: "answered" },
  { kind: "followups", suggestions: ["What clears a CP001?", "Is the palletizer involved?"] },
);

/** abstain : sources (empty) → status */
const ABSTAIN = sse(
  { kind: "sources", citations: [], sourceSnapshot: [] },
  { kind: "status", status: "insufficient_evidence", message: "Nothing in the approved sources covers that." },
);

/** safety : sources (empty) → content* → safety → status */
const SAFETY = sse(
  { kind: "sources", citations: [], sourceSnapshot: [] },
  { kind: "content", content: "Isolate and lock out before going near the infeed." },
  { kind: "safety", trigger: "energized" },
  { kind: "status", status: "answered" },
);

const ERRORED = sse(
  { kind: "sources", citations: [], sourceSnapshot: [] },
  { kind: "status", status: "error" },
);

function client(overrides: Partial<NotebookChatOptions> & { body?: string; status?: number; throws?: boolean } = {}) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  // `in` rather than `=== undefined`: the unconfigured case is expressed as an
  // explicit `notebookId: undefined`, and a default-on-undefined helper would
  // silently hand it "nb-1" and pass the test it was written to break.
  const notebookId = "notebookId" in overrides ? overrides.notebookId : "nb-1";
  const chat = new NotebookChatClient({
    baseUrl: "http://hub.test",
    ...(notebookId === undefined ? {} : { notebookId }),
    fetch: async (url, init) => {
      if (overrides.throws) throw new Error("ECONNREFUSED");
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return {
        ok: (overrides.status ?? 200) < 400,
        status: overrides.status ?? 200,
        text: async () => overrides.body ?? ANSWERED,
      };
    },
  });
  return { chat, calls };
}

function typesOf(parts: readonly InteractionPart[]): string[] {
  return parts.map((part) => part.type);
}

describe("the route it talks to is the shared one", () => {
  it("posts to the equipment-notebook chat route, not a demo-only endpoint", async () => {
    expect(notebookChatPath("nb-1")).toBe("/api/equipment-notebooks/nb-1/chat");
    const { chat, calls } = client();
    await chat.ask({ message: "Why did the conveyor stop?" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://hub.test/api/equipment-notebooks/nb-1/chat");
    expect(calls[0].headers.accept).toBe("text/event-stream");
  });

  it("sends the question, the approved source ids and the thread history the route expects", async () => {
    const { chat, calls } = client();
    await chat.ask({
      message: "Why did the conveyor stop?",
      sourceDocIds: ["doc-troubleshooting", "doc-faults"],
      history: [{ role: "user", content: "earlier" }],
      threadId: "thread-1",
    });
    expect(calls[0].body).toEqual({
      message: "Why did the conveyor stop?",
      sourceDocIds: ["doc-troubleshooting", "doc-faults"],
      history: [{ role: "user", content: "earlier" }],
      threadId: "thread-1",
    });
  });
});

describe("frames become the shell's own parts", () => {
  it("an answered turn carries text, its citations, and its evidence basis", async () => {
    const result = await client().chat.ask({ message: "Why did the conveyor stop?" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = result.parts.find((part) => part.type === "text");
    expect(text).toEqual({ type: "text", text: "The case packer infeed jammed and stopped the zone upstream [1]." });

    const source = result.parts.find((part) => part.type === "source");
    expect(source).toEqual({
      type: "source",
      source: { id: "doc-troubleshooting", title: "CasePacker01 troubleshooting.md", kind: "oem_documentation", locator: "p. 3" },
    });

    expect(result.parts.find((part) => part.type === "evidence_basis")).toEqual({
      type: "evidence_basis",
      basis: { kind: "oem_documentation", label: "Answered from the machine's documentation", authorized: true },
    });
    expect(result.parts.find((part) => part.type === "followups")).toEqual({
      type: "followups",
      suggestions: ["What clears a CP001?", "Is the palletizer involved?"],
    });
    expect(result.lifecycle).toBe("completed");
  });

  it("citations attach after the content, as the route's own order requires", () => {
    // `sources` arrives last on the wire because citations are filtered to the
    // [n] the answer used. A client that attached them eagerly would show
    // citations the answer never referenced.
    const frames = parseStream(ANSWERED);
    expect(frames.findIndex((f) => f.kind === "sources"))
      .toBeGreaterThan(frames.findIndex((f) => f.kind === "content"));
    const parts = framesToParts(frames).parts;
    expect(typesOf(parts).indexOf("source")).toBeGreaterThan(typesOf(parts).indexOf("text"));
  });

  it("an abstention is a refusal MIRA made, not an error and not an empty answer", async () => {
    const result = await client({ body: ABSTAIN }).chat.ask({ message: "What is the relief valve setpoint?" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lifecycle).toBe("completed");
    expect(typesOf(result.parts)).not.toContain("error");
    expect(result.parts.find((part) => part.type === "text")).toEqual({
      type: "text", text: "Nothing in the approved sources covers that.",
    });
    expect(typesOf(result.parts)).not.toContain("source");
  });

  it("a safety stop is its own lifecycle, never 'stopped' and never 'failed'", async () => {
    const result = await client({ body: SAFETY }).chat.ask({ message: "Can I reach in while it runs?" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lifecycle).toBe("safety_stop");
    const notice = result.parts.find((part) => part.type === "safety_notice");
    expect(notice).toEqual({
      type: "safety_notice",
      notice: { severity: "stop", message: "Isolate and lock out before going near the infeed.", trigger: "energized" },
    });
  });

  it("a provider failure is reported as one, with no text passed off as an answer", async () => {
    const result = await client({ body: ERRORED }).chat.ask({ message: "Why did the conveyor stop?" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lifecycle).toBe("failed");
    expect(result.parts.find((part) => part.type === "error")).toBeDefined();
    expect(typesOf(result.parts)).not.toContain("text");
  });

  it("an identity dispute is surfaced, not silently dropped", () => {
    const frames: ChatFrame[] = [
      { kind: "evidence", identityDisputed: true },
      { kind: "content", content: "answer" },
      { kind: "status", status: "answered" },
    ];
    expect(typesOf(framesToParts(frames).parts)).toContain("identity_dispute");
  });
});

describe("parsing is fail-closed, and unknown frames are ignored not fatal", () => {
  it("ignores an unknown frame kind, as the route's additive contract requires", () => {
    const body = sse(
      { kind: "content", content: "hi" },
      { kind: "some_future_frame", whatever: 1 },
      { kind: "status", status: "answered" },
    );
    const frames = parseStream(body);
    expect(frames.map((frame) => frame.kind)).toEqual(["content", "status"]);
  });

  it("drops a malformed known frame rather than inventing its fields", () => {
    expect(parseFrame({ kind: "content" })).toBeNull();
    expect(parseFrame({ kind: "content", content: 7 })).toBeNull();
    expect(parseFrame({ kind: "status", status: "vibes" })).toBeNull();
    expect(parseFrame({ kind: "sources", citations: [{ citationId: "1" }] })).toBeNull();
    expect(parseFrame({ kind: "safety" })).toBeNull();
    expect(parseFrame(null)).toBeNull();
  });

  it("an unreadable payload does not abort the turn — status still decides", () => {
    const body = ["data: {oops", `data: ${JSON.stringify({ kind: "status", status: "answered" })}`, "data: [DONE]"].join("\n\n");
    expect(parseStream(body).map((frame) => frame.kind)).toEqual(["status"]);
  });

  it("stops at [DONE] and ignores anything after it", () => {
    const body = [
      `data: ${JSON.stringify({ kind: "content", content: "real" })}`,
      "data: [DONE]",
      `data: ${JSON.stringify({ kind: "content", content: "after the end" })}`,
    ].join("\n\n");
    expect(splitSseFrames(body)).toHaveLength(1);
  });
});

describe("when the real path cannot answer, nothing takes its place", () => {
  it("an unauthenticated preview says so and offers the way forward", async () => {
    const result = await client({ status: 401 }).chat.ask({ message: "Why did the conveyor stop?" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unauthenticated");
    expect(result.message).toContain("not signed in");
    expect(result.message).toContain("Create a workspace");
  });

  it("an unconfigured preview never even calls the route", async () => {
    const { chat, calls } = client({ notebookId: undefined });
    const result = await chat.ask({ message: "Why did the conveyor stop?" });
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
  });

  it("an unreachable hub reports unreachable rather than resolving to an answer", async () => {
    const result = await client({ throws: true }).chat.ask({ message: "Why did the conveyor stop?" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreachable");
  });

  it("a 500 is an http_error, and a frameless stream is a malformed one", async () => {
    const five = await client({ status: 500 }).chat.ask({ message: "q" });
    expect(five.ok).toBe(false);
    if (!five.ok) expect(five.reason).toBe("http_error");

    const empty = await client({ body: "data: [DONE]" }).chat.ask({ message: "q" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe("malformed_stream");
  });

  it("every failure message is a sentence, never a status code or a stack trace", () => {
    for (const reason of ["unauthenticated", "not_configured", "unreachable", "http_error", "malformed_stream"] as const) {
      const { message } = chatUnavailable(reason);
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/[.!]$/);
      expect(message).not.toMatch(/\b[45]\d\d\b/);
      expect(message).not.toContain("Error:");
    }
  });

  it("no failure path ever yields a text part — there is no canned answer in this module", async () => {
    for (const options of [{ status: 401 }, { status: 500 }, { throws: true }, { notebookId: undefined }]) {
      const result = await client(options).chat.ask({ message: "Why did the conveyor stop?" });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("parts");
    }
  });
});

describe("the account/fault gate", () => {
  const ALL: readonly ChatFailureReason[] = [
    "unauthenticated",
    "not_configured",
    "unreachable",
    "http_error",
    "malformed_stream",
  ];

  it("classifies exactly the two reasons the route DECIDES as account gates", () => {
    // This is the whole honesty rule in one assertion. `unauthenticated` and
    // `not_configured` are the route working as designed: there is no session
    // and no notebook, so there is nothing to ground an answer in. Everything
    // else is a genuine fault and must stay one.
    const account = ALL.filter((reason) => chatGate(reason) === "account");
    expect([...account].sort()).toEqual(["not_configured", "unauthenticated"]);
  });

  it("classifies every fault as a fault — a broken hub is never a sign-up prompt", () => {
    const fault = ALL.filter((reason) => chatGate(reason) === "fault");
    expect([...fault].sort()).toEqual(["http_error", "malformed_stream", "unreachable"]);
  });

  it("gives every reason a gate — a new one cannot default into the friendlier branch", () => {
    // If a reason is ever added to the union without an entry in the map, the
    // lookup yields undefined and this fails. The `Record<…>` type catches it
    // at compile time; this catches it if the map is ever loosened.
    for (const reason of ALL) {
      expect(["account", "fault"]).toContain(chatGate(reason));
    }
  });

  it("carries the gate on the result the host actually reads", async () => {
    const unauthenticated = await client({ status: 401 }).chat.ask({ message: "q" });
    expect(unauthenticated.ok).toBe(false);
    if (!unauthenticated.ok) expect(unauthenticated.gate).toBe("account");

    const unconfigured = await client({ notebookId: undefined }).chat.ask({ message: "q" });
    expect(unconfigured.ok).toBe(false);
    if (!unconfigured.ok) expect(unconfigured.gate).toBe("account");

    const broken = await client({ throws: true }).chat.ask({ message: "q" });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.gate).toBe("fault");
  });

  it("names the door in both account sentences, and in neither fault sentence", () => {
    // A visitor who cannot be answered because they have no workspace must be
    // told what to do about it. A visitor hitting a 500 must NOT be upsold.
    for (const reason of ["unauthenticated", "not_configured"] as const) {
      expect(chatUnavailable(reason).message).toContain("Create a workspace");
    }
    for (const reason of ["unreachable", "http_error", "malformed_stream"] as const) {
      expect(chatUnavailable(reason).message).not.toContain("Create a workspace");
      expect(chatUnavailable(reason).message).not.toMatch(/sign[ -]?in/i);
    }
  });
});
