/**
 * Shared harness for the adversarial SSE soak (two tiers).
 *
 * Fuzzes the canonical stream reader — `readNotebookStream`, the ADR-0038
 * rule-6 code path that landed in #3539 — with randomized frame sequences and
 * randomized chunk boundaries, asserting the conversation-state invariants
 * that must hold no matter how badly the wire behaves.
 *
 * Deterministic: every case is generated from an explicit seed, so any
 * violation reported here reproduces exactly by re-running that seed.
 *
 * Not a test file itself (no `.test.ts` suffix) — it is imported by:
 *   - stream-soak.test.ts       fast deterministic tier, runs on every PR
 *   - stream-soak.soak.test.ts  full 128k+ tier, nightly / on demand
 */
import { readNotebookStream } from "../notebook-chat-utils";

// ---------------------------------------------------------------- seeded RNG

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
export function rng(seed: number): () => number {
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

export type Delivered = {
  contents: string[];
  statuses: string[];
  safeties: string[];
  sourcesSets: unknown[][];
};

export const STATUSES = ["answered", "error", "refused", "insufficient_evidence", "stopped"];
const TRIGGERS = ["loto", "arc_flash", "confined_space"];

/** Build one `data: {...}\n\n` SSE frame. */
export const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

/**
 * Generate an adversarial frame sequence plus a record of what was genuinely
 * delivered, so assertions compare the reader's output against ground truth
 * rather than against itself.
 */
export function generateStream(r: () => number): { wire: string; delivered: Delivered } {
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
export function chunkedReader(wire: string, r: () => number): ReadableStreamDefaultReader<Uint8Array> {
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


/** Runs one generated stream and returns any invariant violations.
 *  Shared by both tiers so the rules can never drift between them. */
export async function checkOneStream(
  r: () => number,
  run: number,
  read: typeof import("../notebook-chat-utils").readNotebookStream,
): Promise<string[]> {
  const v: string[] = [];
  const { wire, delivered } = generateStream(r);
  const reader = chunkedReader(wire, r);

  let out;
  try {
    out = await read(reader, () => {});
  } catch (err) {
    return [`run ${run}: reader threw: ${String(err)}`];
  }

  // I2 (ADR-0038 rule 6) — no terminal status => never a completed answer.
  if (!delivered.statuses.length) {
    if (out.sawStatus) v.push(`run ${run}: sawStatus true with no status frame delivered`);
    if (out.status === "answered") v.push(`run ${run}: truncated stream resolved as "answered"`);
  } else {
    if (!out.sawStatus) v.push(`run ${run}: status frame delivered but sawStatus false`);
    const last = delivered.statuses[delivered.statuses.length - 1];
    if (out.status !== last) v.push(`run ${run}: status ${out.status} != last delivered ${last}`);
  }

  // I3/I4 — a delivered safety determination is sticky, including on truncation.
  if (delivered.safeties.length) {
    if (!out.safetyNotice) v.push(`run ${run}: safety frame delivered but safetyNotice null`);
    else if (out.safetyNotice.kind !== "safety_notice") v.push(`run ${run}: safety identity collapsed`);
    if (!out.sawStatus && !out.safetyNotice) v.push(`run ${run}: safety lost on truncated stream`);
  } else if (out.safetyNotice) {
    v.push(`run ${run}: safetyNotice fabricated with no safety frame`);
  }

  // I5 — content is exactly what was delivered.
  const expectedContent = delivered.contents.join("");
  if (out.content !== expectedContent) {
    v.push(`run ${run}: content mismatch (got ${JSON.stringify(out.content)} want ${JSON.stringify(expectedContent)})`);
  }

  // I6 — citations are exactly the last delivered sources set.
  if (!delivered.sourcesSets.length) {
    if (out.citations.length) v.push(`run ${run}: citations fabricated with no sources frame`);
  } else {
    const lastSet = delivered.sourcesSets[delivered.sourcesSets.length - 1];
    if (JSON.stringify(out.citations) !== JSON.stringify(lastSet)) {
      v.push(`run ${run}: citations != last delivered sources set`);
    }
  }

  // I7 — status is always a known terminal value.
  if (!STATUSES.includes(out.status)) v.push(`run ${run}: unknown status ${out.status}`);
  return v;
}

/** Run a whole tier. Returns every violation found. */
export async function runTier(seeds: number[], runsPerSeed: number,
  read: typeof import("../notebook-chat-utils").readNotebookStream): Promise<string[]> {
  const all: string[] = [];
  for (const seed of seeds) {
    const r = rng(seed);
    for (let run = 0; run < runsPerSeed; run++) {
      const v = await checkOneStream(r, run, read);
      if (v.length) all.push(...v.map((m) => `seed ${seed} ${m}`));
    }
  }
  return all;
}
