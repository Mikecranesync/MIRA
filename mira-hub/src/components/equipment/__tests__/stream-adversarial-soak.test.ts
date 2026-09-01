/**
 * Overnight adversarial SSE soak (2026-09-01).
 *
 * Fuzzes the canonical stream reader — `readNotebookStream`, the ADR-0038
 * rule-6 code path that landed in #3539 — with randomized frame sequences and
 * randomized chunk boundaries, asserting the conversation-state invariants
 * that must hold no matter how badly the wire behaves.
 *
 * Deterministic: every case is generated from an explicit seed, so any
 * violation reported here reproduces exactly by re-running that seed.
 *
 * This file is soak/verification only. It is NOT part of the merge train and
 * is not merged tonight.
 */
import { describe, expect, it } from "vitest";

import { readNotebookStream } from "../notebook-chat-utils";

// ---------------------------------------------------------------- seeded RNG

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ------------------------------------------------------------ frame builders

type Delivered = {
  contents: string[];
  statuses: string[];
  safeties: string[];
  sourcesSets: unknown[][];
};

const STATUSES = ["answered", "error", "refused", "insufficient_evidence", "stopped"];
const TRIGGERS = ["loto", "arc_flash", "confined_space"];

/** Build one `data: {...}\n\n` SSE frame. */
const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

/**
 * Generate an adversarial frame sequence plus a record of what was genuinely
 * delivered, so assertions compare the reader's output against ground truth
 * rather than against itself.
 */
function generateStream(r: () => number): { wire: string; delivered: Delivered } {
  const delivered: Delivered = { contents: [], statuses: [], safeties: [], sourcesSets: [] };
  const parts: string[] = [];
  const n = int(r, 1, 14);

  for (let i = 0; i < n; i++) {
    switch (pick(r, [
      "content", "content", "content", // weight content higher — it is the common case
      "sources", "evidence", "safety", "followups", "status",
      "malformed", "garbage", "done", "empty", "not-data",
    ])) {
      case "content": {
        // include multibyte + newlines so chunk splitting can land mid-codepoint
        const text = pick(r, ["Check the ", "VFD—", "réf ", "日本語 ", "line\nbreak ", "…tail "]);
        parts.push(frame({ kind: "content", content: text }));
        delivered.contents.push(text);
        break;
      }
      case "sources": {
        const cites = [{ index: int(r, 1, 5), title: "Manual", url: null, page: int(r, 1, 99) }];
        parts.push(frame({ kind: "sources", citations: cites }));
        delivered.sourcesSets.push(cites);
        break;
      }
      case "evidence":
        parts.push(frame({ kind: "evidence", basis: pick(r, ["documents", "machine", "mixed"]), machineEvidence: null, visualEvidence: null }));
        break;
      case "safety": {
        const trigger = pick(r, TRIGGERS);
        parts.push(frame({ kind: "safety", trigger }));
        delivered.safeties.push(trigger);
        break;
      }
      case "followups":
        parts.push(frame({ kind: "followups", suggestions: ["What next?"] }));
        break;
      case "status": {
        const s = pick(r, STATUSES);
        parts.push(frame({ kind: "status", status: s }));
        delivered.statuses.push(s);
        break;
      }
      // ---- adversarial noise: must be ignored, must never throw ----
      case "malformed":
        parts.push(`data: {"kind":"content","content":\n\n`); // truncated JSON
        break;
      case "garbage":
        parts.push(`data: ${pick(r, ["null", "[]", '"str"', "42", "{}", '{"kind":"nope"}'])}\n\n`);
        break;
      case "done":
        parts.push(`data: [DONE]\n\n`);
        break;
      case "empty":
        parts.push(`\n\n`);
        break;
      case "not-data":
        parts.push(`event: ping\n\n`);
        break;
    }
  }
  return { wire: parts.join(""), delivered };
}

/** A reader that hands the bytes over in randomly-sized chunks (may split
 *  mid-frame and mid-UTF8-codepoint). */
function chunkedReader(wire: string, r: () => number): ReadableStreamDefaultReader<Uint8Array> {
  const bytes = new TextEncoder().encode(wire);
  const chunks: Uint8Array[] = [];
  let i = 0;
  while (i < bytes.length) {
    const size = int(r, 1, Math.max(1, Math.floor(bytes.length / int(r, 1, 6)) || 1));
    chunks.push(bytes.slice(i, i + size));
    i += size;
  }
  let k = 0;
  return {
    read: async () => (k < chunks.length ? { done: false, value: chunks[k++] } : { done: true, value: undefined }),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

// ------------------------------------------------------------------ the soak

const SEEDS = Array.from({ length: 64 }, (_, i) => 1 + i * 7919); // 64 distinct seeds
const RUNS_PER_SEED = 2000;

describe("adversarial SSE soak — conversation-state invariants", () => {
  for (const seed of SEEDS) {
    it(`holds every invariant across ${RUNS_PER_SEED} randomized streams (seed ${seed})`, async () => {
      const r = rng(seed);
      const violations: string[] = [];

      for (let run = 0; run < RUNS_PER_SEED; run++) {
        const { wire, delivered } = generateStream(r);
        const reader = chunkedReader(wire, r);

        let out;
        try {
          // I1 — a malformed / duplicated / out-of-order wire must never throw.
          out = await readNotebookStream(reader, () => {});
        } catch (err) {
          violations.push(`run ${run}: reader threw: ${String(err)}`);
          continue;
        }

        // I2 (ADR-0038 rule 6) — no terminal status frame means the turn may
        // NEVER resolve as a completed, cited answer.
        if (!delivered.statuses.length) {
          if (out.sawStatus) violations.push(`run ${run}: sawStatus true with no status frame delivered`);
          if (out.status === "answered") violations.push(`run ${run}: truncated stream resolved as "answered"`);
        } else {
          if (!out.sawStatus) violations.push(`run ${run}: status frame delivered but sawStatus false`);
          // server is authoritative: last status wins
          const last = delivered.statuses[delivered.statuses.length - 1];
          if (out.status !== last) violations.push(`run ${run}: status ${out.status} != last delivered ${last}`);
        }

        // I3 — a safety determination the server actually sent must survive to
        // the end of the stream, including truncation (sticky safety).
        if (delivered.safeties.length) {
          if (!out.safetyNotice) violations.push(`run ${run}: safety frame delivered but safetyNotice null`);
          else if (out.safetyNotice.kind !== "safety_notice") violations.push(`run ${run}: safety identity collapsed`);
        } else if (out.safetyNotice) {
          violations.push(`run ${run}: safetyNotice fabricated with no safety frame`);
        }

        // I4 — safety identity must not be lost merely because the tail was cut.
        if (delivered.safeties.length && !out.sawStatus && !out.safetyNotice) {
          violations.push(`run ${run}: safety lost on truncated stream`);
        }

        // I5 — content is exactly what was delivered; never fabricated, never dropped.
        const expectedContent = delivered.contents.join("");
        if (out.content !== expectedContent) {
          violations.push(`run ${run}: content mismatch (got ${JSON.stringify(out.content)} want ${JSON.stringify(expectedContent)})`);
        }

        // I6 — citations are exactly the last delivered sources set, never invented.
        if (!delivered.sourcesSets.length) {
          if (out.citations.length) violations.push(`run ${run}: citations fabricated with no sources frame`);
        } else {
          const lastSet = delivered.sourcesSets[delivered.sourcesSets.length - 1];
          if (JSON.stringify(out.citations) !== JSON.stringify(lastSet)) {
            violations.push(`run ${run}: citations != last delivered sources set`);
          }
        }

        // I7 — status is always a known terminal value.
        if (!STATUSES.includes(out.status)) violations.push(`run ${run}: unknown status ${out.status}`);
      }

      expect(violations, `seed ${seed} violations:\n${violations.slice(0, 10).join("\n")}`).toEqual([]);
    });
  }

  // Targeted regression pins for the specific shapes the orders call out.
  it("a stream cut immediately after citations never presents as a cited answer", async () => {
    const wire =
      frame({ kind: "sources", citations: [{ index: 1, title: "Manual", url: null, page: 12 }] }) +
      frame({ kind: "content", content: "Partial answer" });
    const out = await readNotebookStream(chunkedReader(wire, rng(5)), () => {});
    expect(out.sawStatus).toBe(false);
    expect(out.status).not.toBe("answered");
    expect(out.citations.length).toBe(1); // reader keeps them; the consumer must drop them
  });

  it("safety survives a truncated tail", async () => {
    const wire = frame({ kind: "safety", trigger: "loto" }) + frame({ kind: "content", content: "Stop work." });
    const out = await readNotebookStream(chunkedReader(wire, rng(6)), () => {});
    expect(out.safetyNotice).toEqual({ kind: "safety_notice", trigger: "loto" });
    expect(out.sawStatus).toBe(false);
    expect(out.status).not.toBe("answered");
  });

  it("[DONE] alone is not a terminal marker", async () => {
    const wire = frame({ kind: "content", content: "hi" }) + "data: [DONE]\n\n";
    const out = await readNotebookStream(chunkedReader(wire, rng(7)), () => {});
    expect(out.sawStatus).toBe(false);
    expect(out.status).not.toBe("answered");
  });

  it("a duplicate late status frame is server-authoritative (last wins), not ignored", async () => {
    const wire =
      frame({ kind: "status", status: "answered" }) + frame({ kind: "status", status: "error" });
    const out = await readNotebookStream(chunkedReader(wire, rng(8)), () => {});
    expect(out.sawStatus).toBe(true);
    expect(out.status).toBe("error");
  });
});
