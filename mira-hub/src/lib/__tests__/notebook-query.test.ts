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
  buildTopicHint,
  classifyBroad,
  classifyCoverage,
  ensureFacetRepresentation,
  facetEvidencePages,
  classifyIntent,
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

  it("bridges 'taking too long to stop' → deceleration (decel time, not stop mode)", () => {
    const e = expandIndustrialQuery("the motor is taking too long to stop");
    expect(e.variants.join(" ").toLowerCase()).toContain("decel time");
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

describe("topic-state tracking (battery defects D + A)", () => {
  // The topic-switch battery script: decel thread → Ethernet thread → return.
  const decelThenEthernet: ChatHistoryTurn[] = [
    { role: "user", content: "what's the decel parameter?" },
    {
      role: "assistant",
      content: "Decel Time 1 is parameter P042. It sets the deceleration time from maximum frequency to 0 Hz. [2]",
    },
    { role: "user", content: "actually, how does Ethernet work on this drive?" },
    {
      role: "assistant",
      content: "EtherNet/IP is embedded on the drive; a dual-port option requires a communication adapter. [5]",
    },
  ];

  it("augments a return-to-topic follow-up from the topic it names, not the intervening topic (A)", () => {
    const q = buildRetrievalQuery(
      "okay, go back to that decel setting. What's the default again?",
      decelThenEthernet,
    );
    expect(q).toMatch(/P042/); // recovered from the decel turns
    expect(q.toLowerCase()).not.toMatch(/ethernet|adapter/); // intervening topic excluded
  });

  it("adds nothing when the message names a topic no history turn shares", () => {
    const q = buildRetrievalQuery("ok so what about the autotune procedure?", decelThenEthernet);
    expect(q).toBe("ok so what about the autotune procedure?");
  });

  it("still augments a bare referential follow-up from the most recent turns", () => {
    const q = buildRetrievalQuery("what's the maximum?", decelThenEthernet.slice(0, 2));
    expect(q).toMatch(/P042/);
    expect(q.toLowerCase()).toMatch(/decel/);
  });

  it("spec intent floats a value-bearing chunk over a name-list index chunk (both exact hits)", () => {
    // Defect D residual: "what's the maximum?" resolved to P042 but the chunk
    // holding the numeric range sat below the parameter name-list pages, so the
    // model abstained. A spec question wants the chunk with the VALUES.
    const expanded = expandIndustrialQuery("what's the maximum? parameter decel P042 deceleration");
    const nameList = {
      content:
        "P040 Motor NP Poles P041 Accel Time 1 P042 Decel Time 1 P043 Minimum Freq P044 Maximum Freq P045 Stop Mode P046 Start Source 1",
      rank: 1.2,
      sourcePage: 77,
      docId: "d",
    };
    const detail = {
      content:
        "P042 [Decel Time 1] Range: 0.00 - 600.00 s. Default: 10.00 s. Sets the time for the drive to decelerate from maximum frequency to 0 Hz.",
      rank: 0.02,
      sourcePage: 86,
      docId: "d",
    };
    const out = rerankChunks(expanded, [nameList, detail], { intent: "spec" });
    expect(out[0].sourcePage).toBe(86);
  });

  it("does not pollute a topic-naming question with the prior topic despite a trailing deictic", () => {
    // "how do I set up Ethernet on this?" — "this" is the DRIVE, not the decel
    // thread; the named topic (Ethernet) defines the subject. Decel tokens
    // polluted this into an abstention (adv-5topic T3).
    const q = buildRetrievalQuery("how do I set up Ethernet on this?", decelThenEthernet.slice(0, 2));
    expect(q).not.toMatch(/P042/);
    expect(q.toLowerCase()).not.toMatch(/decel/);
  });

  it("leaves a keypad-navigation follow-up un-augmented (synonym bridge carries retrieval)", () => {
    // "keypad" names the question's topic; no history turn shares it, so the
    // query stays clean — the keypad→procedure-vocabulary synonyms (not the
    // thread's P042) are what retrieve the navigation section.
    const q = buildRetrievalQuery("where do I find it on the keypad?", decelThenEthernet.slice(0, 2));
    expect(q).toBe("where do I find it on the keypad?");
  });
});

describe("EtherNet/IP architecture discrimination (topic-switch T3/T4)", () => {
  it("comm intent naming a protocol floats that family's chunks over another family's (T3)", () => {
    // "how does Ethernet work?" must not fill context with the RS-485/DSI-Modbus
    // appendix just because it is comm-dense — the embedded EtherNet/IP material
    // is the queried family.
    const expanded = expandIndustrialQuery("actually, how does Ethernet work on this drive?");
    const modbusAppendix = {
      content:
        "RS485 (DSI) protocol. The drive supports the RS-485 (DSI) protocol Modbus RTU. Connect the network to the DSI port. Modbus function codes supported by the drive. Baud rate and node address are set in the comm group.",
      rank: 1.2,
      sourcePage: 202,
      docId: "d",
    };
    const embedded = {
      content:
        "PowerFlex 525 Embedded EtherNet/IP Indicators. ENET display state. Connect one end of an Ethernet cable to the EtherNet/IP network and insert the cable's plug into the embedded EtherNet/IP port of the drive.",
      rank: 0.4,
      sourcePage: 35,
      docId: "d",
    };
    const out = rerankChunks(expanded, [modbusAppendix, embedded], { intent: "comm" });
    expect(out[0].sourcePage).toBe(35);
  });

  it("bare referential follow-up after a topic switch augments from the CURRENT topic segment only (T4)", () => {
    const thread: ChatHistoryTurn[] = [
      { role: "user", content: "what's the decel parameter?" },
      { role: "assistant", content: "P042 [Decel Time 1] sets the deceleration time. [2]" },
      { role: "user", content: "what's the maximum?" },
      { role: "assistant", content: "The maximum allowed value for P042 [Decel Time 1] is 600.00 seconds. [1]" },
      { role: "user", content: "actually, how does Ethernet work on this drive?" },
      {
        role: "assistant",
        content: "EtherNet/IP is configured via C128 [EN Addr Sel] and the EN IP Addr parameters. [5]",
      },
    ];
    const q = buildRetrievalQuery("does that require an adapter?", thread);
    expect(q.toLowerCase()).toMatch(/ethernet|c128/); // current topic carried
    expect(q).not.toMatch(/P042/); // pre-switch topic must NOT pollute
    expect(q.toLowerCase()).not.toMatch(/decel/);
  });
});

describe("classifyCoverage — answer-shape planning", () => {
  it("classifies multi-facet family questions with an evidence plan", () => {
    const c = classifyCoverage("what protections does this drive have?");
    expect(c.shape).toBe("multi_facet");
    expect(c.facets.length).toBeGreaterThanOrEqual(4);
  });

  it("classifies 'all the ways' as exhaustive with facets", () => {
    const c = classifyCoverage("what are all the ways I can command the speed?");
    expect(c.shape).toBe("exhaustive");
    expect(c.facets.join(" ")).toMatch(/preset/i);
  });

  it("classifies comparisons", () => {
    expect(classifyCoverage("what's the difference between the accel time and the decel time?").shape).toBe(
      "comparison",
    );
  });

  it("classifies procedures and single facts without facet plans", () => {
    expect(classifyCoverage("how do I autotune the motor?").shape).toBe("procedure");
    const single = classifyCoverage("what does P042 do?");
    expect(single.shape).toBe("single_fact");
    expect(single.facets).toEqual([]);
  });
});

describe("classifyCoverage — impossible exhaustive", () => {
  it("classifies 'list every parameter' as exhaustive even outside known families", () => {
    const c = classifyCoverage("list every parameter this drive supports");
    expect(c.shape).toBe("exhaustive");
  });
});

describe("ensureFacetRepresentation — facet-guaranteed slots", () => {
  const mk = (content: string, page: number) => ({ content, rank: 0.5, sourcePage: page, docId: "d" });

  it("promotes a pool chunk for a facet the selection missed (protections gap)", () => {
    // Baseline failure: 'what protections?' context filled with overload/param
    // chunks; overcurrent/undervoltage evidence stayed in the pool, uncovered.
    const overload = mk("F007 Motor Overload protection per P033 [Motor OL Current]", 84);
    const params = mk("P031 Motor NP Volts P032 Motor NP Hertz parameter table", 65);
    const overcurrent = mk("F063 HW OverCurrent — hardware overcurrent trip at 200% of rating", 162);
    const undervolt = mk("F004 UnderVoltage — DC bus voltage fell below the minimum", 160);
    const selected = [overload, params];
    const pool = [overload, params, overcurrent, undervolt];
    const out = ensureFacetRepresentation(selected, pool, ["motor overload", "overcurrent", "undervoltage"]);
    expect(out).toContain(overcurrent);
    expect(out).toContain(undervolt);
    expect(out[0]).toBe(overload); // original order preserved
  });

  it("adds nothing when every facet is already represented or has no pool evidence", () => {
    const a = mk("overcurrent trip levels", 1);
    const out = ensureFacetRepresentation([a], [a], ["overcurrent", "ground fault"]);
    expect(out).toEqual([a]); // ground fault has no pool evidence — no invented slot
  });
});

describe("facetEvidencePages — evidence map provenance", () => {
  it("maps facets to the pages of the chunks that prove them, and flags gaps", () => {
    const chunks = [
      { content: "embedded EtherNet/IP port on the drive", sourcePage: 147, docId: "d" },
      { content: "RS-485 (DSI) protocol Modbus RTU", sourcePage: 202, docId: "d" },
    ];
    const map = facetEvidencePages(chunks, ["embedded EtherNet/IP", "RS-485 Modbus RTU", "DeviceNet"]);
    expect(map.get("embedded EtherNet/IP")).toEqual([147]);
    expect(map.get("RS-485 Modbus RTU")).toEqual([202]);
    expect(map.get("DeviceNet")).toEqual([]); // gap — generation must declare it
  });
});

describe("classifyIntent — param-ID request vs spec value", () => {
  it("'what's the maximum frequency parameter?' asks WHICH parameter, not a value", () => {
    // The word "maximum" must not force spec intent (whose value-density boost
    // floods context with A-group frequency tables) when the question asks for
    // a parameter ID (adv-similar-names T1 abstention).
    expect(classifyIntent("what's the maximum frequency parameter?")).toBe("param_lookup");
    expect(classifyIntent("which parameter sets the maximum frequency?")).toBe("param_lookup");
  });

  it("keeps spec intent for value questions", () => {
    expect(classifyIntent("what's the maximum?")).toBe("spec");
    expect(classifyIntent("what's the max I can set that to?")).toBe("spec");
  });
});

describe("ordinal return-to-first-topic (adv-5topic T7)", () => {
  const thread: ChatHistoryTurn[] = [
    { role: "user", content: "what's the accel parameter?" },
    { role: "assistant", content: "P041 [Accel Time 1] sets the acceleration ramp. [1]" },
    { role: "user", content: "how do I set up Ethernet on this?" },
    { role: "assistant", content: "Configure the embedded EtherNet/IP via C128 [EN Addr Sel]. [3]" },
    { role: "user", content: "which inputs start it from the terminal block?" },
    { role: "assistant", content: "P046 [Start Source 1] selects the start source; DigIn TermBlk terminals. [5]" },
  ];

  it("resolves 'that first setting we talked about' to the FIRST topic, not the latest", () => {
    const q = buildRetrievalQuery(
      "ok, go back to that first setting we talked about. what's its default?",
      thread,
    );
    expect(q).toMatch(/P041/);
    expect(q).not.toMatch(/P046|C128/);
  });

  it("does NOT treat a 'what do I set first?' step question as a return-to-first-topic", () => {
    const q = buildRetrievalQuery("what parameter do I set first?", thread.slice(2, 4));
    // stays on the recent (Ethernet) topic — 'first' here is step order.
    expect(q).toMatch(/C128|Ethernet/i);
    expect(q).not.toMatch(/P041/);
  });
});

describe("procedure-intent ranking (keypad navigation)", () => {
  it("expands a keypad-navigation question into the manual's procedure vocabulary", () => {
    // "where do I find it on the keypad?" shares no tokens with the answer
    // section ("Viewing and Editing Parameters … programming menu"); the
    // synonym table must bridge the vocabulary, same as decel→deceleration.
    const e = expandIndustrialQuery("where do I find it on the keypad?");
    const joined = e.variants.join(" ").toLowerCase();
    expect(joined).toMatch(/editing parameters|programming menu/);
  });

  it("floats a navigation procedure above a param-detail exact hit on a procedure question", () => {
    // "where do I find it on the keypad?" — the answer is the generic keypad
    // procedure (no P042 in it); the history-carried P042 must not let the
    // param-detail chunk dominate via the exact-token bonus.
    const expanded = expandIndustrialQuery("where do I find it on the keypad? P042 Decel deceleration");
    const paramDetail = {
      content:
        "P042 [Decel Time 1] Range: 0.00 - 600.00 s. Default: 10.00 s. Sets the time for the drive to decelerate from maximum frequency to 0 Hz.",
      rank: 1.4,
      sourcePage: 86,
      docId: "d",
    };
    const keypadProcedure = {
      content:
        "Viewing and Editing Parameters. The following is an example of basic integral keypad and display functions. Press Esc to display the menu. Press the Up Arrow or Down Arrow to scroll through the group list. Press Enter or Sel to enter a group. Press the Up Arrow or Down Arrow to scroll through the parameter list. Press Enter to view the value.",
      rank: 0.5,
      sourcePage: 18,
      docId: "d",
    };
    const out = rerankChunks(expanded, [paramDetail, keypadProcedure], { intent: "procedure" });
    expect(out[0].sourcePage).toBe(18);
  });
});

describe("buildTopicHint", () => {
  const decelThread: ChatHistoryTurn[] = [
    { role: "user", content: "what's the decel parameter?" },
    {
      role: "assistant",
      content: "Decel Time 1 is parameter P042. It sets the deceleration time from maximum frequency to 0 Hz. [2]",
    },
  ];
  const decelThenEthernet: ChatHistoryTurn[] = [
    ...decelThread,
    { role: "user", content: "actually, how does Ethernet work on this drive?" },
    {
      role: "assistant",
      content: "EtherNet/IP is embedded on the drive; a dual-port option requires a communication adapter. [5]",
    },
  ];

  it("names the active thread tokens for a bare referential follow-up (D)", () => {
    const hint = buildTopicHint("what's the maximum?", decelThread);
    expect(hint).toMatch(/P042/);
    expect(hint.toLowerCase()).toMatch(/decel/);
  });

  it("scopes the hint to the topic the message names, not the intervening one", () => {
    const hint = buildTopicHint(
      "okay, go back to that decel setting. What's the default again?",
      decelThenEthernet,
    );
    expect(hint).toMatch(/P042/);
    expect(hint.toLowerCase()).not.toMatch(/ethernet|adapter/);
  });

  it("is empty for a self-contained question or an empty thread", () => {
    expect(
      buildTopicHint("What is the maximum value of parameter P042 on this drive controller?", decelThread),
    ).toBe("");
    expect(buildTopicHint("what's the maximum?", [])).toBe("");
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

describe("classifyIntent", () => {
  it("classifies fault-clear/reset as a fault (procedure-style ranking)", () => {
    expect(classifyIntent("how do I clear a fault?")).toBe("fault");
    expect(classifyIntent("how do I reset this trip?")).toBe("fault");
    expect(classifyIntent("how do I get it running again after a fault?")).toBe("fault");
  });
  it("classifies how-to as a procedure", () => {
    expect(classifyIntent("how do I run an autotune?")).toBe("procedure");
    expect(classifyIntent("walk me through commissioning")).toBe("procedure");
  });
  it("classifies comm/protocol questions as comm", () => {
    expect(classifyIntent("where's the Profinet setting?")).toBe("comm");
    expect(classifyIntent("how do I set the Modbus node address?")).toBe("comm");
    expect(classifyIntent("what are the Ethernet settings?")).toBe("comm");
  });
  it("classifies limit/range questions as spec", () => {
    expect(classifyIntent("what's the maximum decel time?")).toBe("spec");
    expect(classifyIntent("what's the default for that?")).toBe("spec");
  });
  it("classifies a bare parameter lookup", () => {
    expect(classifyIntent("what does P042 do?")).toBe("param_lookup");
  });
});

describe("protocol exact-token", () => {
  it("treats a named protocol as an exact token so its chunk can dominate", () => {
    expect(expandIndustrialQuery("where's the Profinet setting?").exactTokens).toContain("PROFINET");
    expect(expandIndustrialQuery("how do I set up DeviceNet").exactTokens).toContain("DEVICENET");
  });
});

describe("rerankChunks — intent-gated content features", () => {
  const mk = (content: string, rank: number, page: number) => ({ content, rank, sourcePage: page, docId: "d" });
  // A dense parameter-index chunk vs a real fault-clearing procedure chunk.
  const paramIndex = mk(
    "P034 Motor NP FLA P035 Motor NP Poles P036 Motor NP RPM(1) 641 Fault 9 Current(1) 692 EN Subnet(1) 700 Fault 7",
    0.9,
    155,
  );
  const procedure = mk(
    "The cause must be corrected before the fault can be cleared. Press Stop, then set A551 Fault Clear to reset the drive after you verify the condition.",
    0.4,
    160,
  );

  it("floats the procedure above the param-index under fault intent", () => {
    const e = expandIndustrialQuery("how do I clear a fault?");
    const out = rerankChunks(e, [paramIndex, procedure], { intent: "fault" });
    expect(out[0]).toBe(procedure);
  });

  it("does NOT demote the param-index under param_lookup intent (default behavior preserved)", () => {
    const e = expandIndustrialQuery("motor poles parameter");
    const out = rerankChunks(e, [paramIndex, procedure], { intent: "param_lookup" });
    expect(out[0]).toBe(paramIndex); // higher ts_rank wins; no index penalty
  });
});
