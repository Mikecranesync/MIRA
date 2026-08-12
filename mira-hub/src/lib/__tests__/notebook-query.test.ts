/**
 * Query expansion + rerank for Equipment Notebook retrieval. Pure-function unit
 * tests — assert the vocabulary bridge and exact-token dominance that the live
 * failures (P042 / "slow down" / terminal 07) require.
 */
import { describe, expect, it } from "vitest";
import {
  expandIndustrialQuery,
  rerankChunks,
  sanitizeHistory,
  isReferentialFollowup,
  buildRetrievalQuery,
  classifyBroad,
  diversifyByPage,
  type ChatHistoryTurn,
} from "../notebook-query";

describe("expandIndustrialQuery", () => {
  it("bridges 'slow down ramp' → deceleration vocabulary", () => {
    const e = expandIndustrialQuery("What parameter is the slow down ramp?");
    const joined = e.variants.join(" ").toLowerCase();
    expect(joined).toContain("deceleration");
    expect(joined).toContain("decel time");
    expect(e.variants[0]).toBe("What parameter is the slow down ramp?"); // original first
  });

  it("expands 'second speed' to both interpretations", () => {
    const e = expandIndustrialQuery("Which terminal sets second speed?");
    const joined = e.variants.join(" ").toLowerCase();
    expect(joined).toContain("speed reference 2");
    expect(joined).toContain("preset frequency");
  });

  it("expands 'motor frequency' to the frequency family, not monitoring", () => {
    const e = expandIndustrialQuery("What about setting motor frequency?");
    const joined = e.variants.join(" ").toLowerCase();
    expect(joined).toContain("motor np hertz");
    expect(joined).toContain("maximum freq");
    expect(joined).toContain("minimum freq");
  });

  it("extracts exact parameter IDs and fault codes verbatim", () => {
    expect(expandIndustrialQuery("What parameter is P042?").exactTokens).toContain("P042");
    expect(expandIndustrialQuery("what does fault F004 mean").exactTokens).toContain("F004");
    expect(expandIndustrialQuery("tell me about A410").exactTokens).toContain("A410");
    expect(expandIndustrialQuery("read b001").exactTokens).toContain("B001");
  });

  it("extracts a terminal number as a zero-padded exact token", () => {
    expect(expandIndustrialQuery("Which terminal sets second speed? terminal 7").exactTokens).toContain("07");
    expect(expandIndustrialQuery("what is terminal 07").exactTokens).toContain("07");
  });

  it("captures quoted phrases", () => {
    expect(expandIndustrialQuery('what is "Decel Time 1"').phrases).toContain("Decel Time 1");
  });

  it("is a no-op-ish for a plain query with no domain triggers", () => {
    const e = expandIndustrialQuery("hello there");
    expect(e.variants).toEqual(["hello there"]);
    expect(e.exactTokens).toEqual([]);
  });
});

describe("rerankChunks", () => {
  const mk = (content: string, rank: number, page = 1) => ({ content, rank, sourcePage: page, docId: "d1" });

  it("floats the exact-token chunk above a higher-ts_rank same-page sibling", () => {
    // The live bug: two chunks on p.21; the FLA one out-ranks the P042 one.
    const e = expandIndustrialQuery("What parameter is P042?");
    const fla = mk("P033 [Motor NP FLA] ... P035 [Motor NP Poles] sets poles", 0.9, 21);
    const p042 = mk("P042 [Decel Time 1] 0.00/600.00 s ... decel from Maximum Freq to 0 Hz", 0.1, 21);
    const out = rerankChunks(e, [fla, p042]);
    expect(out[0]).toBe(p042); // exact-token dominance wins
  });

  it("ranks a chunk that matches synonym terms above an unrelated one", () => {
    const e = expandIndustrialQuery("slow down ramp");
    const decel = mk("P042 [Decel Time 1] sets deceleration time decel time", 0.2);
    const noise = mk("grounding and wiring inspection checklist", 0.5);
    const out = rerankChunks(e, [decel, noise]);
    expect(out[0]).toBe(decel);
  });

  it("preserves ts_rank order when no boosts apply", () => {
    const e = expandIndustrialQuery("general question");
    const a = mk("alpha content", 0.9);
    const b = mk("beta content", 0.3);
    expect(rerankChunks(e, [b, a])).toEqual([a, b]);
  });
});

describe("sanitizeHistory", () => {
  it("keeps well-formed user/assistant turns in order", () => {
    const h = sanitizeHistory([
      { role: "user", content: "how do I communicate with this drive?" },
      { role: "assistant", content: "It supports EtherNet/IP and Modbus RTU [1]." },
    ]);
    expect(h).toEqual([
      { role: "user", content: "how do I communicate with this drive?" },
      { role: "assistant", content: "It supports EtherNet/IP and Modbus RTU [1]." },
    ]);
  });

  it("drops malformed, empty, and non-user/assistant turns", () => {
    const h = sanitizeHistory([
      { role: "system", content: "ignore me" },
      { role: "user", content: "   " },
      { role: "user" },
      "not an object",
      null,
      { role: "assistant", content: "kept" },
    ]);
    expect(h).toEqual([{ role: "assistant", content: "kept" }]);
  });

  it("caps to the most recent maxTurns and trims per-turn length", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, content: `q${i}` }));
    const h = sanitizeHistory(many, 6);
    expect(h).toHaveLength(6);
    expect(h[0].content).toBe("q4"); // last 6 → q4..q9
    const long = sanitizeHistory([{ role: "user", content: "x".repeat(5000) }], 6, 2000);
    expect(long[0].content).toHaveLength(2000);
  });

  it("returns [] for a non-array body", () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory({ role: "user", content: "hi" })).toEqual([]);
  });
});

describe("isReferentialFollowup", () => {
  it("flags short and deictic follow-ups", () => {
    expect(isReferentialFollowup("what about Ethernet?")).toBe(true);
    expect(isReferentialFollowup("let's use Ethernet")).toBe(true);
    expect(isReferentialFollowup("no, the other one")).toBe(true);
    expect(isReferentialFollowup("what should that be set to?")).toBe(true);
    expect(isReferentialFollowup("why?")).toBe(true);
  });

  it("flags a pronoun used as a verb OBJECT ('set that to?', 'turn it up')", () => {
    // The case that was silently missed — "that" is the object of "set…to",
    // so the follow-up must still pull the thread's subject into retrieval.
    expect(isReferentialFollowup("what's the max I can set that to?")).toBe(true);
    expect(isReferentialFollowup("can I turn it up a bit more than that?")).toBe(true);
    expect(isReferentialFollowup("how do I change it for the second motor?")).toBe(true);
  });

  it("flags ordinal/sequence continuations with no pronoun ('what do I set first?')", () => {
    expect(isReferentialFollowup("what parameter do I set first?")).toBe(true);
    expect(isReferentialFollowup("okay what is next after that?")).toBe(true);
  });

  it("does not flag a long self-contained question or a bare determiner", () => {
    expect(
      isReferentialFollowup("How do I configure the EtherNet/IP address on a PowerFlex 525 drive from the keypad?"),
    ).toBe(false);
    // "this drive" is a determiner, not a pronoun reference → still self-contained.
    expect(
      isReferentialFollowup("What is the maximum value of parameter P042 on this drive controller?"),
    ).toBe(false);
  });
});

describe("buildRetrievalQuery", () => {
  const history: ChatHistoryTurn[] = [
    { role: "user", content: "How do I set up communications on this drive?" },
    { role: "assistant", content: "It supports EtherNet/IP and Modbus RTU. Which network are you on? [1]" },
  ];

  it("augments a referential follow-up with salient thread tokens it lacks", () => {
    const q = buildRetrievalQuery("what parameter changes first?", history);
    // pulls domain context already in the thread (comm/network vocabulary),
    // current message stays first so it still dominates ranking.
    expect(q.startsWith("what parameter changes first?")).toBe(true);
    expect(q.toLowerCase()).toMatch(/ethernet|modbus|communications|network/);
  });

  it("does not re-add a token the message already contains", () => {
    const q = buildRetrievalQuery("what about Modbus?", history);
    expect(q.toLowerCase().match(/modbus/g)?.length).toBe(1);
  });

  it("leaves a self-contained question unchanged", () => {
    const q = buildRetrievalQuery(
      "What is the maximum value of parameter P042 on this drive controller?",
      history,
    );
    expect(q).toBe("What is the maximum value of parameter P042 on this drive controller?");
  });

  it("returns the message unchanged when there is no history", () => {
    expect(buildRetrievalQuery("what about that?", [])).toBe("what about that?");
  });
});

describe("classifyBroad", () => {
  it("detects the comm family and fans out comm facets", () => {
    const b = classifyBroad("what communication options does this drive have?");
    expect(b.broad).toBe(true);
    expect(b.key).toBe("comm");
    expect(b.facets.join(" ").toLowerCase()).toMatch(/ethernet\/ip/);
    expect(b.facets.join(" ").toLowerCase()).toMatch(/modbus/);
  });

  it("detects 'how do I set up communications' as a broad comm question", () => {
    expect(classifyBroad("how do I set up communications on this drive?").key).toBe("comm");
  });

  it("detects the speed-command family", () => {
    const b = classifyBroad("what are all the ways I can command the speed?");
    expect(b.broad).toBe(true);
    expect(b.key).toBe("speed");
  });

  it("detects the protection family", () => {
    expect(classifyBroad("what protections does this drive have?").key).toBe("protection");
  });

  it("flags generic enumeration phrasing with no family", () => {
    const b = classifyBroad("what are the different options here?");
    expect(b.broad).toBe(true);
    expect(b.facets).toEqual([]);
  });

  it("does NOT flag a narrow single-fact question as broad", () => {
    expect(classifyBroad("what parameter is the decel ramp?").broad).toBe(false);
    expect(classifyBroad("what does fault F004 mean?").broad).toBe(false);
    expect(classifyBroad("what is the max accel time?").broad).toBe(false);
  });
});

describe("diversifyByPage", () => {
  const mk = (docId: string, sourcePage: number, tag: string) => ({ docId, sourcePage, tag });

  it("caps chunks per (doc,page) so one section can't fill the slice", () => {
    const chunks = [
      mk("d", 185, "adapter1"), mk("d", 185, "adapter2"), mk("d", 185, "adapter3"),
      mk("d", 73, "enet"), mk("d", 102, "modbus"),
    ];
    const out = diversifyByPage(chunks, 2, 4);
    // p.185 limited to 2; p.73 and p.102 get in → distinct facets survive
    expect(out.filter((c) => c.sourcePage === 185)).toHaveLength(2);
    expect(out.map((c) => c.tag)).toContain("enet");
    expect(out.map((c) => c.tag)).toContain("modbus");
  });

  it("backfills from the capped overflow when pages are few (never starves)", () => {
    const chunks = [mk("d", 1, "a"), mk("d", 1, "b"), mk("d", 1, "c"), mk("d", 1, "d")];
    const out = diversifyByPage(chunks, 2, 4);
    expect(out).toHaveLength(4); // cap is 2/page, but backfill fills to the limit
  });

  it("preserves the incoming (reranked) order", () => {
    const chunks = [mk("d", 1, "a"), mk("d", 2, "b"), mk("d", 3, "c")];
    expect(diversifyByPage(chunks, 2, 3).map((c) => c.tag)).toEqual(["a", "b", "c"]);
  });
});
