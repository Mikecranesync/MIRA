/**
 * The acquisition candidate trail (Golden Walk 2026-10-05): parsed from
 * mira-ask's additive `candidate_trail`, persisted on the notebook's
 * acquisition record. Observability only — nothing here decides anything.
 *
 * Run: npx vitest run src/capabilities/__tests__/acquisition-candidate-trail.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  parseCandidateTrail,
  TRAIL_ROWS_PERSISTED,
} from "@/lib/manual-discovery";
import { recordFromOutcome } from "@/capabilities/notebook-manual-acquisition";

function row(i: number, extra: Record<string, unknown> = {}) {
  return {
    rank: i,
    url: `https://oem.example.test/docs/m${i}.pdf?x-sign=SECRET${i}#page=2`,
    host: "oem.example.test",
    title: `Manual ${i}`,
    score: 185 - i,
    pass: "q1",
    read: "judged",
    read_reason: null,
    not_queued: null,
    is_manual: true,
    doc_type: "user_manual",
    scope: "complete",
    lists_fault_codes: i === 0,
    language: "en",
    text_language: "en",
    confidence: 0.9,
    provider: "groq",
    selected: i === 0,
    ...extra,
  };
}

describe("parseCandidateTrail", () => {
  it("parses rows, strips signed query strings, and keeps the winner", () => {
    const t = parseCandidateTrail({
      candidate_trail: {
        version: 1,
        stop: "ideal_match",
        candidate_count: 2,
        queries: [{ pass: "q1", query: "q", result: "sent", hits: 2 }],
        candidates: [row(0), row(1)],
      },
    });
    expect(t?.stop).toBe("ideal_match");
    expect(t?.candidates.map((c) => c.url)).toEqual([
      "https://oem.example.test/docs/m0.pdf",
      "https://oem.example.test/docs/m1.pdf",
    ]);
    expect(JSON.stringify(t)).not.toContain("SECRET");
    expect(t?.candidates[0]).toMatchObject({
      selected: true,
      listsFaultCodes: true,
      textLanguage: "en",
      readReason: null,
    });
    expect(t?.queries).toEqual([
      { pass: "q1", query: "q", result: "sent", hits: 2 },
    ]);
  });

  it("caps the persisted rows", () => {
    const t = parseCandidateTrail({
      candidate_trail: {
        version: 1,
        candidates: Array.from({ length: 25 }, (_, i) => row(i)),
      },
    });
    expect(t?.candidates).toHaveLength(TRAIL_ROWS_PERSISTED);
  });

  it("keeps only known primitive fields", () => {
    const t = parseCandidateTrail({
      candidate_trail: {
        version: 1,
        candidates: [
          row(0, {
            evidence_quote: "page text",
            is_manual: "yes",
            injected: { a: 1 },
          }),
        ],
      },
    });
    const c = t?.candidates[0] as unknown as Record<string, unknown>;
    expect(c.isManual).toBeNull();
    expect("evidence_quote" in c).toBe(false);
    expect("injected" in c).toBe(false);
  });

  it("is null for an old mira-ask or a malformed body", () => {
    expect(parseCandidateTrail({})).toBeNull();
    expect(parseCandidateTrail({ candidate_trail: "x" })).toBeNull();
    expect(
      parseCandidateTrail({ candidate_trail: { candidates: "x" } }),
    ).toBeNull();
    expect(parseCandidateTrail(null)).toBeNull();
  });

  it("drops a row whose URL does not parse", () => {
    const t = parseCandidateTrail({
      candidate_trail: { candidates: [row(0, { url: "not a url" }), row(1)] },
    });
    expect(t?.candidates.map((c) => c.rank)).toEqual([1]);
  });
});

describe("recordFromOutcome persists the trail", () => {
  const trail = parseCandidateTrail({
    candidate_trail: { version: 1, stop: "ideal_match", candidates: [row(0)] },
  });

  it("writes candidate_trail when the outcome carries one", () => {
    const rec = recordFromOutcome("K", null, {
      status: "no_manual_found",
      payload: {},
      candidateTrail: trail,
    });
    expect(rec.candidate_trail).toEqual(trail);
  });

  it("leaves the record unchanged when there is no trail", () => {
    const rec = recordFromOutcome("K", null, {
      status: "no_manual_found",
      payload: {},
    });
    expect("candidate_trail" in rec).toBe(false);
  });
});
