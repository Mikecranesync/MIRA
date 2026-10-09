import { describe, expect, it } from "vitest";
import { buildRetrievalQuery, buildTopicHint, expandIndustrialQuery, rerankChunks } from "@/lib/notebook-query";

const photo = "Teal handheld. LCD display shows 'PERI', 'RD', and '1'. Buttons read MODE and PRG. A brown surface is behind it.";
describe("current photo retrieval focus", () => {
  it("retrieves literal display text for a referential first question", () => {
    const q = buildRetrievalQuery("Does this help?", [], photo);
    expect(q).toContain("PERI");
    expect(q).toContain("RD");
    expect(q).not.toContain("PRG");
    expect(q).not.toContain("brown");
  });
  it("does not let a previous photo subject displace the current readout", () => {
    const q = buildRetrievalQuery("Does this help?", [{ role: "user", content: "What is Ethernet parameter P042?" }], photo);
    expect(q).toContain("PERI");
    expect(q).not.toContain("P042");
  });
  it("keeps an explicitly named fault question focused", () => {
    expect(buildRetrievalQuery("What does F004 mean?", [], photo)).toBe("What does F004 mean?");
  });
  it.each(["What does E.OV1 mean?", "What does fault ovA mean?", "What does Alarm 7 mean?"])("keeps every supported explicit code subject focused: %s", (question) => {
    expect(buildRetrievalQuery(question, [], "LCD display shows F004.")).toBe(question);
  });
  it("honors an explicit return to an earlier subject", () => {
    const history = [{ role: "user" as const, content: "How do I set P042 decel?" }, { role: "user" as const, content: "What does Ethernet do?" }];
    const question = "Go back to that first setting we talked about";
    expect(buildRetrievalQuery(question, history, "LCD display shows F004.")).toBe(buildRetrievalQuery(question, history));
    expect(buildRetrievalQuery(question, history, "LCD display shows F004.")).toContain("P042");
  });
  it("suppresses a stale provider topic hint when the current photo owns the referent", () => {
    expect(buildTopicHint("Does this help?", [{ role: "user", content: "Ethernet P042" }], photo)).toBe("");
  });
  it.each(["What is torque?", "What does RD mean?", "How does this torque limit work?"])("does not replace a self-contained subject outside the token whitelist: %s", (question) => {
    expect(buildRetrievalQuery(question, [], "LCD display shows F004.")).toBe(question);
  });
  it("keeps a readout in the sentence immediately following the display description", () => {
    const q = buildRetrievalQuery("Does this help?", [], "The LCD display has buttons labeled PRG and MODE underneath it. It reads PERI, RD and 1.");
    expect(q).toContain("PERI");
    expect(q).not.toContain("PRG");
  });
  it("supports the real host's default photo-only question", () => {
    const question = "What am I looking at, and what should I check?";
    expect(buildRetrievalQuery(question, [], photo)).toContain("PERI");
  });
  it("excludes inline button descriptions from display reading vocabulary", () => {
    const q = buildRetrievalQuery("Does this help?", [], 'LCD display shows PERI, RD and 1, with buttons labeled "MODE" and "PRG" beneath it.');
    expect(q).toContain("PERI");
    expect(q).not.toContain("MODE");
    expect(q).not.toContain("PRG");
  });
  it("preserves no-photo history behavior", () => {
    expect(buildRetrievalQuery("Where is it?", [{ role: "user", content: "Ethernet P042" }])).toContain("P042");
  });
  it("does not correct an uncertain mode label or turn it into a meaning", () => {
    const q = buildRetrievalQuery("Does this help?", [], "LCD display shows 'ID i', 'RD', and 'F'; label partially obscured.");
    expect(q).toContain("ID i");
    expect(q).not.toContain("ID1");
    expect(q).not.toContain("fault");
  });
});

// Review regressions: preserve multiline literals and exclude control-label ranking noise.
describe("bounded readout continuations", () => {
  it.each(["Does this help?", "What am I looking at, and what should I check?"])("keeps multiline literals for %s", (message) => {
    const q = buildRetrievalQuery(message, [{ role: "user", content: "Ethernet P042" }], "LCD display shows:\nPERI\nRD\n1\nButtons read PRG.");
    for (const term of ["PERI", "RD", "1"]) expect(q).toContain(term);
    for (const term of ["PRG", "P042"]) expect(q).not.toContain(term);
  });
  it.each(["and has buttons", "with two buttons"])("excludes %s from search phrases", (clause) => {
    const q = buildRetrievalQuery("Does this help?", [], `LCD display shows PERI, RD and 1, ${clause} labeled "MODE" and "PRG" beneath it.`);
    expect(q).toContain("PERI");
    expect(q).not.toContain("MODE");
    expect(q).not.toContain("PRG");
  });
});

it("keeps the readout page ahead of six quoted-control navigation passages", () => {
  const q = buildRetrievalQuery("Does this help?", [], 'LCD display shows PERI, RD and 1, and has buttons labeled "MODE" and "PRG" beneath it.');
  const rows = [{ content: "PERI Read Peripheral Fault: value 1 indicates a peripheral fault", sourcePage: 18, rank: 1 }, ...Array.from({ length: 6 }, (_, i) => ({ content: "MODE and PRG buttons navigate menus", sourcePage: 30 + i, rank: 0.1 }))];
  expect(rerankChunks(expandIndustrialQuery(q), rows).slice(0, 6).some(row => row.sourcePage === 18)).toBe(true);
});

it("keeps quoted literals and placeholder dashes without reading uppercase button labels", () => {
  const q = buildRetrievalQuery("Does this help?", [], 'LCD display shows:\n"PERI"\n"RD"\n--\nBUTTONS READ PRG.');
  expect(q).toContain("PERI");
  expect(q).toContain("RD");
  expect(q).toContain("--");
  expect(q).not.toContain("PRG");
});

describe("case-preserving literal readout continuations", () => {
  it.each(["Does this help?", "What am I looking at, and what should I check?"].flatMap(message => ["ovA", "ObF", "PERI\nRd\n1"].map(readout => [message, readout])))("preserves %s with %s", (message, readout) => {
    const history = [{ role: "user" as const, content: "Ethernet P042" }];
    const observation = `LCD display shows:\n${readout}\nButtons read PRG.`;
    const q = buildRetrievalQuery(message, history, observation);
    for (const literal of readout.split("\n")) expect(q).toContain(literal);
    for (const stale of ["P042", "Ethernet", "PRG"]) expect(q).not.toContain(stale);
    expect(buildTopicHint(message, history, observation)).toBe("");
  });
});

it("stops a mixed-case continuation before lowercase background prose", () => {
  const q = buildRetrievalQuery("Does this help?", [], "LCD display shows:\novA\nA brown surface is behind it.\nPRG");
  expect(q).toContain("ovA");
  expect(q).not.toContain("brown");
  expect(q).not.toContain("PRG");
});


describe("descriptions end a literal display block", () => {
  it.each(["Does this help?", "What am I looking at, and what should I check?"])("excludes cable/sticker prose for %s", (message) => {
    for (const background of ["A cable marked A410 is connected.", "Sticker marked A410.", "A wire is red."]) {
      const q = buildRetrievalQuery(message, [{ role: "user", content: "Ethernet P042" }], `LCD display shows:\novA\n${background}\nPRG`);
      expect(q).toContain("ovA");
      for (const term of ["A410", "cable", "Sticker", "wire", "PRG", "P042"]) expect(q).not.toContain(term);
    }
  });
});


it.each(["Does this help?", "What am I looking at, and what should I check?"])("inline background descriptions do not become display terms for %s", (message) => {
  for (const observation of ["LCD display shows ovA, and a cable marked A410 is connected.", "LCD display shows ovA, with a STICKER marked A410 above it."]) {
    const q = buildRetrievalQuery(message, [], observation);
    expect(q).toContain("ovA");
    for (const term of ["A410", "cable", "STICKER"]) expect(q).not.toContain(term);
  }
});

it.each(['LCD display shows "CABLE MISSING", and a sticker marked A410 is beside it.', 'LCD display shows:\n"CABLE MISSING"\nSticker marked A410.'])("preserves an explicitly quoted readout even when its words describe a cable: %s", (observation) => {
  const q = buildRetrievalQuery("Does this help?", [], observation);
  expect(q).toContain("CABLE MISSING");
  expect(q).not.toContain("A410");
});


it.each(["LCD display shows:\nUvLo", "LCD display shows Overcurrent Fault 1.", "LCD display shows:\nOvercurrent\nFault 1", "LCD display shows CABLE MISSING."])("preserves real literal shapes while excluding appended background: %s", (reading) => {
  const q = buildRetrievalQuery("Does this help?", [{ role: "user", content: "Ethernet P042" }], `${reading}\nA cable marked A410 is connected.`);
  if (reading.includes("UvLo")) expect(q).toContain("UvLo");
  if (reading.includes("Overcurrent")) { expect(q).toContain("Overcurrent"); expect(q).toContain("Fault 1"); }
  if (reading.includes("CABLE")) expect(q).toContain("CABLE MISSING");
  expect(q).not.toContain("A410");
  expect(q).not.toContain("P042");
});


describe("qualified or unreadable new display never inherits stale focus", () => {
  for (const message of ["Does this help?", "What am I looking at, and what should I check?"])
    for (const qualifier of ["error", "flashing", "blinking"])
      it(`retains ${qualifier} ovA for ${message}`, () => {
        const history = [{ role: "user" as const, content: "Ethernet P042" }];
        const observation = `LCD display shows ${qualifier} ovA.`;
        const query = buildRetrievalQuery(message, history, observation);
        expect(query).toContain("ovA");
        expect(query).not.toContain("P042");
        expect(query).not.toContain("Ethernet");
        expect(buildTopicHint(message, history, observation)).toBe("");
      });
  for (const message of ["Does this help?", "What am I looking at, and what should I check?"])
    it(`unreadable current display has unknown focus: ${message}`, () => {
      const history = [{ role: "user" as const, content: "Ethernet P042" }];
      const observation = "LCD display shows unreadable characters.";
      expect(buildRetrievalQuery(message, history, observation)).toBe(message);
      expect(buildTopicHint(message, history, observation)).toBe("");
    });
});
