/**
 * Answer-stage hygiene: citation-marker normalization (gpt-oss 【n】 → [n]),
 * honest-refusal detection (→ no citations), and citation-entailment (ship only
 * the [n] the answer used). These are the guards that turn a correct-but-
 * unlinked answer into a cited one and kill "retrieved page shown as proof".
 */
import { describe, expect, it } from "vitest";
import {
  makeCitationNormalizer,
  isRefusal,
  citationsUsedInAnswer,
  buildProviderMessages,
  isProviderCascadeError,
  makeGeneralBracketStripper,
} from "../route";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import type { ChatHistoryTurn } from "@/lib/notebook-query";

const cite = (id: string): EvidenceCitation => ({
  citationId: id,
  docId: "d1",
  sourceTitle: "pf525-quickstart.pdf",
  page: 21,
  fileId: null,
  quote: "P042 [Decel Time 1]",
});

describe("makeCitationNormalizer", () => {
  it("converts a plain fancy-bracket citation to [n]", () => {
    const n = makeCitationNormalizer();
    expect(n.push("P042 sets decel【3】.") + n.flush()).toBe("P042 sets decel[3].");
  });

  it("converts the gpt-oss file-citation form 【4†L1-L7】 to [4]", () => {
    const n = makeCitationNormalizer();
    expect(n.push("shown by b002【4†L1-L7】 only") + n.flush()).toBe("shown by b002[4] only");
  });

  it("handles a marker split across streamed deltas", () => {
    const n = makeCitationNormalizer();
    let out = n.push("the ramp is P042 【");
    out += n.push("3");
    out += n.push("†L2-L4】 done");
    out += n.flush();
    expect(out).toBe("the ramp is P042 [3] done");
  });

  it("leaves normal [n] markers untouched", () => {
    const n = makeCitationNormalizer();
    expect(n.push("answer [1] and [2]") + n.flush()).toBe("answer [1] and [2]");
  });
});

describe("isRefusal", () => {
  it("flags an honest not-found answer", () => {
    expect(isRefusal("I could not find that in the selected sources.")).toBe(true);
    expect(isRefusal("The provided excerpts do not contain information about terminal 07.")).toBe(true);
  });
  it("does not flag a grounded answer that happens to mention 'find'", () => {
    expect(isRefusal("You can find the decel ramp under P042 [Decel Time 1] [1].")).toBe(false);
  });
});

describe("citationsUsedInAnswer", () => {
  it("keeps only the citations the answer actually cited", () => {
    const all = [cite("1"), cite("2"), cite("3")];
    const used = citationsUsedInAnswer("P042 is the decel ramp [3].", all);
    expect(used.map((c) => c.citationId)).toEqual(["3"]);
  });
  it("returns nothing when the answer cited nothing", () => {
    expect(citationsUsedInAnswer("no markers here", [cite("1")])).toEqual([]);
  });
});

describe("buildProviderMessages — multi-turn memory", () => {
  const history: ChatHistoryTurn[] = [
    { role: "user", content: "how do I communicate with this drive?" },
    { role: "assistant", content: "It supports EtherNet/IP and Modbus RTU [1]." },
  ];

  it("places history between the system prompt and the current evidence turn", () => {
    const msgs = buildProviderMessages("SYS", history, "USER+EXCERPTS");
    expect(msgs).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "how do I communicate with this drive?" },
      { role: "assistant", content: "It supports EtherNet/IP and Modbus RTU [1]." },
      { role: "user", content: "USER+EXCERPTS" },
    ]);
  });

  it("still produces a valid single-turn shape with empty history", () => {
    const msgs = buildProviderMessages("SYS", [], "USER");
    expect(msgs).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
    ]);
  });

  it("keeps the CURRENT (evidence-bearing) turn last so grounding wins", () => {
    const msgs = buildProviderMessages("SYS", history, "CURRENT");
    expect(msgs.at(-1)).toEqual({ role: "user", content: "CURRENT" });
  });
});

describe("isProviderCascadeError — programming errors must not masquerade as provider exhaustion", () => {
  it("classifies programming errors as bugs (fail loud, never cascade)", () => {
    // The incident: a stale variable reference threw ReferenceError inside the
    // cascade try, was swallowed by `catch { continue }`, and every question
    // answered "No answer provider available".
    expect(isProviderCascadeError(new ReferenceError("isBroad is not defined"))).toBe(false);
    expect(isProviderCascadeError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isProviderCascadeError(new RangeError("Invalid array length"))).toBe(false);
    expect(isProviderCascadeError(new SyntaxError("Unexpected token"))).toBe(false);
  });

  it("classifies external provider failures as cascade-able", () => {
    // undici surfaces network failure as TypeError('fetch failed') with a cause.
    const netErr = new TypeError("fetch failed");
    (netErr as TypeError & { cause?: unknown }).cause = new Error("ECONNREFUSED");
    expect(isProviderCascadeError(netErr)).toBe(true);
    expect(isProviderCascadeError(new DOMException("The operation timed out.", "TimeoutError"))).toBe(true);
    expect(isProviderCascadeError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isProviderCascadeError(new Error("HTTP 429 rate limited"))).toBe(true);
    expect(isProviderCascadeError("weird non-Error throw")).toBe(true);
  });
});

describe("makeGeneralBracketStripper", () => {
  it("removes a complete marker with the space before it", () => {
    const s = makeGeneralBracketStripper();
    expect(s.push("Check the DC bus [1] and the fan [2].") + s.flush()).toBe(
      "Check the DC bus and the fan.",
    );
  });

  it("removes a marker SPLIT ACROSS DELTAS — the case a per-delta regex misses", () => {
    const s = makeGeneralBracketStripper();
    let out = s.push("the ramp is set by P042 ");
    out += s.push("[");
    out += s.push("12");
    out += s.push("] on this drive");
    out += s.flush();
    expect(out).toBe("the ramp is set by P042 on this drive");
  });

  it("never leaks a held-back partial as visible text", () => {
    // A trailing "[" that never completes is not a marker, so it must survive —
    // swallowing it would silently corrupt the answer.
    const s = makeGeneralBracketStripper();
    expect(s.push("see note [") + s.flush()).toBe("see note [");
  });

  it("leaves ordinary bracketed prose alone", () => {
    const s = makeGeneralBracketStripper();
    expect(s.push("terminal [A] and [B1]") + s.flush()).toBe("terminal [A] and [B1]");
  });
});
