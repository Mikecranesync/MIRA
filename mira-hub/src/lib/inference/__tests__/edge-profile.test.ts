// #5265 — MIRA_PROFILE=edge: the notebook chat answers from ONE local,
// loopback-only provider, and the profile refuses to start while any cloud
// provider key is present (a sealed device must not be one env var away
// from sending a technician's question off the tablet).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertEdgeSealed,
  EDGE_NO_PASSAGE_TEXT,
  EDGE_PASSAGE_LIMIT,
  EDGE_PASSAGES_LEAD,
  edgeProfileEnabled,
  edgeProviders,
  edgeRequestOverrides,
  isNavigationChunk,
  renderEdgePassages,
  selectEdgePassages,
} from "../edge-profile";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import { effectiveNotebookProviders } from "../legacy-cascade";

const CLOUD_KEYS = [
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHERAI_API_KEY",
  "ANTHROPIC_API_KEY",
];
const saved = { ...process.env };

beforeEach(() => {
  process.env = { ...saved };
  for (const k of [...CLOUD_KEYS, "MIRA_PROFILE", "MIRA_EDGE_LLM_URL", "MIRA_EDGE_LLM_MODEL", "MIRA_CANONICAL_SEAM"]) {
    delete process.env[k];
  }
});
afterEach(() => {
  process.env = { ...saved };
});

describe("edgeProfileEnabled", () => {
  it("is on only for MIRA_PROFILE=edge", () => {
    expect(edgeProfileEnabled()).toBe(false);
    process.env.MIRA_PROFILE = "cloud";
    expect(edgeProfileEnabled()).toBe(false);
    process.env.MIRA_PROFILE = "edge";
    expect(edgeProfileEnabled()).toBe(true);
  });
});

describe("edgeProviders", () => {
  it("is one local provider with a non-empty key so dispatch does not skip it", () => {
    expect(edgeProviders()).toEqual([
      { name: "Local", url: "http://127.0.0.1:8080/v1/chat/completions", key: "local", model: "local" },
    ]);
  });

  it("honours MIRA_EDGE_LLM_URL and MIRA_EDGE_LLM_MODEL", () => {
    process.env.MIRA_EDGE_LLM_URL = "http://localhost:9000/v1/chat/completions";
    process.env.MIRA_EDGE_LLM_MODEL = "qwen2.5-1.5b-instruct-q4_0";
    expect(edgeProviders()[0]).toMatchObject({
      url: "http://localhost:9000/v1/chat/completions",
      model: "qwen2.5-1.5b-instruct-q4_0",
    });
  });
});

describe("effectiveNotebookProviders under the edge profile", () => {
  it("reports the local provider, never a cloud one, even when cloud keys exist", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.GROQ_API_KEY = "gsk-a";
    expect(effectiveNotebookProviders().map((p) => p.name)).toEqual(["Local"]);
  });

  it("is unchanged when the profile is off", () => {
    process.env.GROQ_API_KEY = "gsk-a";
    expect(effectiveNotebookProviders().map((p) => p.name)).toEqual(["Groq"]);
  });
});

describe("edgeRequestOverrides", () => {
  it("pins sampling so a repeated question gets a repeatable answer", () => {
    expect(edgeRequestOverrides()).toEqual({ temperature: 0, seed: 0 });
  });
});

describe("assertEdgeSealed", () => {
  it("does nothing when the profile is off", () => {
    process.env.GROQ_API_KEY = "gsk-a";
    expect(() => assertEdgeSealed()).not.toThrow();
  });

  it("passes with the profile on, no cloud keys and a loopback URL", () => {
    process.env.MIRA_PROFILE = "edge";
    expect(() => assertEdgeSealed()).not.toThrow();
    process.env.MIRA_EDGE_LLM_URL = "http://localhost:8080/v1/chat/completions";
    expect(() => assertEdgeSealed()).not.toThrow();
  });

  it.each(CLOUD_KEYS)("refuses while %s is set", (key) => {
    process.env.MIRA_PROFILE = "edge";
    process.env[key] = "secret-value";
    expect(() => assertEdgeSealed()).toThrow(key);
  });

  it("ignores a cloud key that is set but empty", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.GROQ_API_KEY = "";
    expect(() => assertEdgeSealed()).not.toThrow();
  });

  it("refuses a local model URL that leaves the device", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.MIRA_EDGE_LLM_URL = "http://192.168.4.103:8080/v1/chat/completions";
    expect(() => assertEdgeSealed()).toThrow("MIRA_EDGE_LLM_URL");
  });

  it("never echoes a key's value in the refusal", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.OPENAI_API_KEY = "sk-do-not-print";
    expect(() => assertEdgeSealed()).toThrow(expect.objectContaining({ message: expect.not.stringContaining("sk-do-not-print") }));
  });
});

// Real chunks from FAA-H-8083-1B on the tablet (2026-11-07): the glossary entry,
// the index page that out-ranked the how-to, and the chapter 3 introduction.
const GLOSSARY =
  "G-3 Empty weight center of gravity (EWCG). This is the center of gravity of the aircraft in the empty condition, containing only the items specified in the aircraft empty weight.";
const INDEX_PAGE =
  "3-4 E E6-B flight compute ........................................... 10-1,10-2 effects of weight .............................................................1-3 electronic calculator .....................................................10-2";
const CHAPTER_3 = "3-1 Introduction Chapter 2, Weight and Balance Theory, explained the theory of weight and balance.";
const URL = "hub-upload://wb";
const chunk = (content: string, sourcePage: number) => ({ content, sourceUrl: URL, sourcePage });
const cite = (citationId: string, page: number): EvidenceCitation => ({
  citationId,
  docId: "6b629d79-65ae-4cc2-90ac-b8cc4f28fc43",
  sourceTitle: "FAA-H-8083-1B Weight and Balance",
  page,
  fileId: null,
  quote: null,
});
const Q = "How do I find the empty weight center of gravity of an airplane?";

describe("isNavigationChunk", () => {
  it("flags a table-of-contents/index chunk and keeps prose", () => {
    expect(isNavigationChunk(INDEX_PAGE)).toBe(true);
    expect(isNavigationChunk(GLOSSARY)).toBe(false);
    expect(isNavigationChunk(CHAPTER_3)).toBe(false);
  });
});

describe("selectEdgePassages", () => {
  const chunks = [chunk(GLOSSARY, 107), chunk(INDEX_PAGE, 111), chunk(CHAPTER_3, 33)];
  const citations = [cite("1", 107), cite("2", 111), cite("3", 33)];

  it("pairs each chunk with its citation by page and drops the index page", () => {
    const out = selectEdgePassages(chunks, citations, Q);
    expect(out.map((p) => p.citation.citationId)).toEqual(["1", "3"]);
  });

  it("quotes the chunk verbatim, never rewrites it", () => {
    for (const p of selectEdgePassages(chunks, citations, Q)) {
      expect(chunks.some((c) => c.content.includes(p.text))).toBe(true);
    }
  });

  it("keeps one passage per cited page and at most EDGE_PASSAGE_LIMIT", () => {
    const many = Array.from({ length: 8 }, (_, i) => chunk(`${CHAPTER_3} part ${i}`, 30 + i));
    const manyCites = many.map((c, i) => cite(String(i + 1), c.sourcePage));
    expect(selectEdgePassages([...many, many[0]], manyCites, Q)).toHaveLength(EDGE_PASSAGE_LIMIT);
  });

  it("returns nothing when only navigation chunks were retrieved", () => {
    expect(selectEdgePassages([chunk(INDEX_PAGE, 111)], [cite("1", 111)], Q)).toEqual([]);
  });
});

describe("renderEdgePassages", () => {
  it("leads with the fixed sentence and carries an [n] marker and page per passage", () => {
    const text = renderEdgePassages(selectEdgePassages([chunk(GLOSSARY, 107)], [cite("1", 107)], Q));
    expect(text.startsWith(EDGE_PASSAGES_LEAD)).toBe(true);
    expect(text).toContain(`"${GLOSSARY}" [1]`);
    expect(text).toContain("— FAA-H-8083-1B Weight and Balance, page 107");
  });

  it("says plainly when nothing matched and refers to a qualified person", () => {
    expect(renderEdgePassages([])).toBe(EDGE_NO_PASSAGE_TEXT);
    expect(EDGE_NO_PASSAGE_TEXT).toContain("qualified person");
  });
});
