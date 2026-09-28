// 086 §3 — a DISPUTED asset identity must survive the whole client contract.
//
// The server withholds the notebook's bound machine for a turn when the
// client's asset claim does not match the confirmed binding, and persists a
// `{kind:"identity_dispute"}` evidence entry so a reload can say WHY the
// attribution is missing. Live, the evidence frame carries
// `identityDisputed: true`. Both must project to the SAME part — the live ≡
// hydrated invariant (criterion 6) — and neither may be shown as "something
// this app version can't display".
//
// Run: cd mira-mobile && bunx vitest run src/chat-adapter/__tests__/identity-dispute
import { describe, expect, it } from "vitest";
import { parseChatSse } from "../../lib/sse";
import type { NotebookServerTurn } from "../../api/resources";
import {
  comparableProjection,
  hydrateMessages,
  liveTurnMessages,
  pendingMessages,
  unknownEvidenceEntries,
} from "../turns-to-parts";
import { toThreadMessage } from "../runtime";

const frame = (o: Record<string, unknown>) => `data: ${JSON.stringify(o)}\n\n`;
const DONE = "data: [DONE]\n\n";

const DISPUTE = {
  kind: "identity_dispute" as const,
  requestedAssetId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  boundAssetId: "ee715d08-4ea6-4b7a-b99b-958a33c39ea8",
  boundUnsPath: "enterprise.plant.line.conveyor_1",
};

const LIVE_DISPUTED = parseChatSse(
  frame({ kind: "content", content: "An overcurrent fault usually means…" }) +
    frame({ kind: "sources", citations: [] }) +
    frame({ kind: "evidence", basis: "general_reasoning", label: "General guidance", identityDisputed: true }) +
    frame({ kind: "status", status: "answered" }) +
    DONE,
);
const LIVE_PLAIN = parseChatSse(
  frame({ kind: "content", content: "An overcurrent fault usually means…" }) +
    frame({ kind: "sources", citations: [] }) +
    frame({ kind: "evidence", basis: "general_reasoning", label: "General guidance" }) +
    frame({ kind: "status", status: "answered" }) +
    DONE,
);
const ROW_DISPUTED: NotebookServerTurn = {
  id: "t-dispute",
  question: "what happened around the fault?",
  answerStatus: "answered",
  answerText: "An overcurrent fault usually means…",
  evidence: [DISPUTE],
  basis: "general_reasoning",
};
const ROW_PLAIN: NotebookServerTurn = { ...ROW_DISPUTED, id: "t-plain", evidence: [] };

describe("the ONE parser reads the dispute marker off the evidence frame", () => {
  it("identityDisputed: true on the evidence frame is captured", () => {
    expect(LIVE_DISPUTED.identityDisputed).toBe(true);
  });
  it("absent on the wire → absent on the turn (never inferred)", () => {
    expect(LIVE_PLAIN.identityDisputed).toBeUndefined();
  });
});

describe("hydration knows the persisted dispute entry", () => {
  it("is a distinct identity_dispute part, NOT an unknown part", () => {
    const [, assistant] = hydrateMessages([ROW_DISPUTED]);
    expect(assistant.parts.some((p) => p.type === "identity_dispute")).toBe(true);
    expect(assistant.parts.some((p) => p.type === "unknown")).toBe(false);
    expect(unknownEvidenceEntries([DISPUTE])).toEqual([]);
  });
  it("a STOPPED persisted turn carrying the dispute keeps it", () => {
    const [, assistant] = hydrateMessages([{ ...ROW_DISPUTED, answerStatus: "error", answerText: "An overc" }]);
    expect(assistant.parts.some((p) => p.type === "identity_dispute")).toBe(true);
    expect(assistant.lifecycle).toBe("stopped");
  });
  it("an ordinary row has no dispute part (control)", () => {
    const [, assistant] = hydrateMessages([ROW_PLAIN]);
    expect(assistant.parts.some((p) => p.type === "identity_dispute")).toBe(false);
  });
});

describe("live ≡ hydrated for a disputed turn (criterion 6)", () => {
  it("the live turn projects like its persisted row, and the projection SEES the dispute", () => {
    const live = liveTurnMessages(ROW_DISPUTED.question, LIVE_DISPUTED, 0)[1];
    const hydrated = hydrateMessages([ROW_DISPUTED])[1];
    expect(comparableProjection(live)).toEqual(comparableProjection(hydrated));
    expect(comparableProjection(live).identityDisputed).toBe(true);
  });
  it("control: an undisputed turn projects identityDisputed=false on both paths", () => {
    const live = liveTurnMessages(ROW_PLAIN.question, LIVE_PLAIN, 0)[1];
    const hydrated = hydrateMessages([ROW_PLAIN])[1];
    expect(comparableProjection(live)).toEqual(comparableProjection(hydrated));
    expect(comparableProjection(live).identityDisputed).toBe(false);
  });
  it("the projection distinguishes a disputed turn from the same turn undisputed", () => {
    const disputed = comparableProjection(hydrateMessages([ROW_DISPUTED])[1]);
    const plain = comparableProjection(hydrateMessages([ROW_PLAIN])[1]);
    expect(disputed).not.toEqual(plain);
  });
});

describe("library conversion", () => {
  it("rides as a registered data part, never the unknown fallback", () => {
    const msg = toThreadMessage(hydrateMessages([ROW_DISPUTED])[1]);
    const types = (msg.content as unknown as readonly { type: string }[]).map((c) => c.type);
    expect(types).toContain("data-identity-dispute");
    expect(types).not.toContain("data-unknown");
  });
});

describe("terminal paths carry the dispute live, exactly as persisted (round 5)", () => {
  // The server's wire contract: a basis-less evidence frame carrying ONLY the
  // marker, emitted FIRST on every disputed stream (safety stop, abstention,
  // answered — so a Stop mid-answer has already seen it).
  const DISPUTE_FRAME = frame({ kind: "evidence", identityDisputed: true });

  it("a basis-less dispute frame sets the flag and NO basis; a later evidence frame adds the basis and the flag stays", () => {
    const bare = parseChatSse(DISPUTE_FRAME + frame({ kind: "sources", citations: [] }) + frame({ kind: "status", status: "insufficient_evidence" }) + DONE);
    expect(bare.identityDisputed).toBe(true);
    expect(bare.evidenceBasis).toBe("");
    const full = parseChatSse(
      DISPUTE_FRAME +
        frame({ kind: "content", content: "x" }) +
        frame({ kind: "sources", citations: [] }) +
        frame({ kind: "evidence", basis: "general_reasoning", label: "General guidance", identityDisputed: true }) +
        frame({ kind: "status", status: "answered" }) +
        DONE,
    );
    expect(full.identityDisputed).toBe(true);
    expect(full.evidenceBasis).toBe("general_reasoning");
  });

  it("safety stop: live projects like its persisted row (basis null, safety + dispute)", () => {
    const live = parseChatSse(
      DISPUTE_FRAME +
        frame({ kind: "sources", citations: [] }) +
        frame({ kind: "content", content: "STOP." }) +
        frame({ kind: "safety", trigger: "smoke" }) +
        frame({ kind: "status", status: "answered" }) +
        DONE,
    );
    const row: NotebookServerTurn = {
      id: "t-stop-dispute", question: "smoke!", answerStatus: "answered", answerText: "STOP.",
      evidence: [{ kind: "safety_notice", trigger: "smoke" }, DISPUTE], basis: null,
    };
    const l = comparableProjection(liveTurnMessages(row.question, live, 0)[1]);
    expect(l).toEqual(comparableProjection(hydrateMessages([row])[1]));
    expect(l.identityDisputed).toBe(true);
    expect(l.safetyNotice).toBe(true);
  });

  it("abstention: live projects like its persisted row", () => {
    const live = parseChatSse(DISPUTE_FRAME + frame({ kind: "sources", citations: [] }) + frame({ kind: "status", status: "insufficient_evidence" }) + DONE);
    const row: NotebookServerTurn = { id: "t-abstain", question: "q", answerStatus: "insufficient_evidence", answerText: null, evidence: [DISPUTE], basis: null };
    const l = comparableProjection(liveTurnMessages("q", live, 0)[1]);
    expect(l).toEqual(comparableProjection(hydrateMessages([row])[1]));
    expect(l.identityDisputed).toBe(true);
  });

  it("client-stopped: live projects like its persisted row", () => {
    const live = { ...parseChatSse(DISPUTE_FRAME + frame({ kind: "content", content: "partial" })), status: "stopped" };
    const row: NotebookServerTurn = { id: "t-stopped", question: "q", answerStatus: "error", answerText: "partial", evidence: [DISPUTE], basis: null };
    const l = comparableProjection(liveTurnMessages("q", live, 0)[1]);
    expect(l).toEqual(comparableProjection(hydrateMessages([row])[1]));
    expect(l.identityDisputed).toBe(true);
  });

  it("the IN-FLIGHT turn shows the dispute as soon as the frame lands — before any content", () => {
    const [, pending] = pendingMessages("q", { answer: "", citations: [], status: "", identityDisputed: true });
    expect(pending.parts.some((p) => p.type === "identity_dispute")).toBe(true);
    const [, plain] = pendingMessages("q", { answer: "", citations: [], status: "" });
    expect(plain.parts.some((p) => p.type === "identity_dispute")).toBe(false);
  });
});
