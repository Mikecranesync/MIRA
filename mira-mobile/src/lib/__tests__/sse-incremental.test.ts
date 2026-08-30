// STRM-1: the incremental SSE parser. Contract: feeding the body in ANY chunk
// split yields exactly the same turn as the old one-shot parse, and every
// completed `content` frame is observable as an update.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/sse-incremental

import { describe, it, expect } from "vitest";
import { createChatSseParser, parseChatSse, type ChatTurn } from "../sse";

const frame = (o: Record<string, unknown>) => `data: ${JSON.stringify(o)}\n\n`;

const FULL_BODY =
  frame({ kind: "content", content: "The " }) +
  frame({ kind: "content", content: "overload " }) +
  frame({ kind: "content", content: "trips " }) +
  frame({ kind: "content", content: "at 115% " }) +
  frame({ kind: "content", content: "[1]." }) +
  frame({
    kind: "sources",
    citations: [
      { citationId: "1", sourceTitle: "GS10 manual", page: 42, quote: "115% FLA", docId: "d1", fileId: "f1" },
    ],
  }) +
  frame({ kind: "evidence", basis: "oem_documentation", label: "From the manual" }) +
  frame({ kind: "usage", provider: "groq", tokens: 12 }) +
  frame({ kind: "status", status: "answered" }) +
  frame({ kind: "followups", suggestions: ["How do I reset it?"] }) +
  "data: [DONE]\n\n";

/** Reference: the pre-STRM-1 one-shot parser, verbatim, so "byte-identical"
 *  is asserted against the OLD algorithm and not against itself. */
function legacyParse(body: string, httpStatus = 200): ChatTurn {
  let answer = "";
  let citations: ChatTurn["citations"] = [];
  let status = httpStatus === 200 ? "" : `http ${httpStatus}`;
  let evidenceBasis: string | undefined;
  let followups: string[] | undefined;
  let evidenceLabel: string | undefined;
  for (const block of body.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const f = JSON.parse(payload) as Record<string, unknown>;
      if (f.kind === "content") answer += String(f.content ?? "");
      else if (f.kind === "sources")
        citations = (f.citations as Record<string, unknown>[]).map((c) => ({
          citationId: String(c.citationId),
          sourceTitle: String(c.sourceTitle ?? "Attached document"),
          page: typeof c.page === "number" ? c.page : null,
          quote: typeof c.quote === "string" ? c.quote : null,
          docId: c.docId != null ? String(c.docId) : null,
          fileId: c.fileId != null ? String(c.fileId) : null,
          originFileId: c.originFileId != null ? String(c.originFileId) : null,
        }));
      else if (f.kind === "status") status = String(f.status ?? "");
      else if (f.kind === "followups")
        followups = Array.isArray(f.suggestions) ? (f.suggestions as unknown[]).map(String) : undefined;
      else if (f.kind === "evidence") {
        evidenceBasis = String(f.basis ?? "");
        evidenceLabel = String(f.label ?? "");
      }
    } catch {
      /* skip */
    }
  }
  return { answer, citations, status, evidenceBasis, evidenceLabel, followups };
}

describe("createChatSseParser", () => {
  it("5 content frames, one per push → 5 answer updates, final == one-shot", () => {
    const p = createChatSseParser();
    const seen: string[] = [];
    for (const piece of FULL_BODY.split(/(?<=\n\n)/)) {
      const before = p.turn().answer;
      const t = p.push(piece);
      if (t.answer !== before) seen.push(t.answer);
    }
    expect(seen).toEqual([
      "The ",
      "The overload ",
      "The overload trips ",
      "The overload trips at 115% ",
      "The overload trips at 115% [1].",
    ]);
    expect(p.finish()).toEqual(parseChatSse(FULL_BODY));
    expect(p.finish()).toEqual(legacyParse(FULL_BODY));
  });

  it("byte-split chunks (every boundary mid-line / mid-JSON) still converge", () => {
    for (const size of [1, 3, 7, 13, 64]) {
      const p = createChatSseParser();
      for (let i = 0; i < FULL_BODY.length; i += size) p.push(FULL_BODY.slice(i, i + size));
      expect(p.finish()).toEqual(legacyParse(FULL_BODY));
    }
  });

  it("a partial frame is never applied until its terminator arrives", () => {
    const p = createChatSseParser();
    p.push('data: {"kind":"content","con');
    expect(p.turn().answer).toBe("");
    p.push('tent":"hi"}\n');
    expect(p.turn().answer).toBe("");
    p.push("\n");
    expect(p.turn().answer).toBe("hi");
  });

  it("malformed frames are skipped without poisoning later ones", () => {
    const body = "data: {not json\n\n" + frame({ kind: "content", content: "ok" }) + "event: x\n\n";
    const p = createChatSseParser();
    p.push(body);
    expect(p.finish().answer).toBe("ok");
    expect(p.finish()).toEqual(legacyParse(body));
  });

  it("finish() flushes a trailing frame with no blank-line terminator", () => {
    const p = createChatSseParser();
    p.push('data: {"kind":"status","status":"answered"}');
    expect(p.turn().status).toBe("");
    expect(p.finish().status).toBe("answered");
  });

  it("non-200 status tag matches the old parser", () => {
    expect(parseChatSse("", 502)).toEqual(legacyParse("", 502));
    expect(parseChatSse("", 502).status).toBe("http 502");
  });

  it("200-turn fuzz: random frames, random chunking — identical to legacy", () => {
    let seed = 1234;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const kinds = ["content", "sources", "evidence", "status", "followups", "usage", "junk"];
    for (let turn = 0; turn < 200; turn++) {
      let body = "";
      const n = 1 + Math.floor(rnd() * 12);
      for (let k = 0; k < n; k++) {
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        if (kind === "content") body += frame({ kind, content: `w${k} ` });
        else if (kind === "sources")
          body += frame({ kind, citations: [{ citationId: String(k), sourceTitle: `S${k}`, page: k }] });
        else if (kind === "evidence") body += frame({ kind, basis: "general_reasoning", label: `L${k}` });
        else if (kind === "status") body += frame({ kind, status: rnd() > 0.5 ? "answered" : "insufficient_evidence" });
        else if (kind === "followups") body += frame({ kind, suggestions: [`f${k}`] });
        else if (kind === "usage") body += frame({ kind, tokens: k });
        else body += "data: {broken\n\n";
      }
      if (rnd() > 0.5) body += "data: [DONE]\n\n";
      const p = createChatSseParser();
      let i = 0;
      while (i < body.length) {
        const step = 1 + Math.floor(rnd() * 40);
        p.push(body.slice(i, i + step));
        i += step;
      }
      expect(p.finish()).toEqual(legacyParse(body));
    }
  });
});
