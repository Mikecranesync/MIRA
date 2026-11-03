/**
 * Regression guard (#5138): an experimental retrieval flag may ADD a lane or REORDER
 * results, but it may not REPLACE the production lexical path.
 *
 * NOTEBOOK_LEXICAL_V2 did exactly that: with it on, every pass went to its own IDF-sum
 * SQL and the production rare-term lane and question-IDF query never ran, so staging
 * measured a different search engine from production (24 -> 18 of 30 on the #5127
 * replay). This file runs retrieveNodeChunks with each declared NOTEBOOK_* retrieval
 * flag on, one at a time and all together, and checks that the production passes
 * still run. Zero tokens: a mocked pg client dispatches on SQL shape, and one fetch
 * stub answers the embedder and the reranker.
 *
 * A flag that skips a mandatory pass must be listed in KNOWN_BYPASS, and its capability
 * record must keep it off in staging and production. The registry stands in for
 * Doppler here (CI cannot read Doppler), so the record must match the real config.
 *
 * Run: npx vitest run src/lib/__tests__/notebook-retrieval-flag-guard.test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const SRC = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const REPO = (p: string) => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

/** Every file whose flags change notebook retrieval. A new one belongs here. */
const RETRIEVAL_SOURCES = [
  "lib/manual-rag.ts",
  "lib/notebook-query.ts",
  "capabilities/hybrid-retrieval.ts",
  "capabilities/reranker.ts",
  "capabilities/query-rewrite.ts",
];

type Kind = "and" | "rare" | "question_idf";
/** The production lexical passes every configuration must still issue. */
const MANDATORY: Kind[] = ["and", "rare", "question_idf"];

const isAnd = (sql: string) =>
  sql.includes("plainto_tsquery('english', $2)") && !sql.includes("replace(") && !sql.includes("names_document") && !sql.includes("quote_literal");
const isOr = (sql: string) => sql.includes("replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')");
const isRare = (sql: string) => sql.includes("string_agg(quote_literal(lex), ' | ')::tsquery");
const isQuestionIdf = (sql: string) => sql.includes("names_document");
const isVector = (sql: string) => sql.includes("<=>");

type Call = { sql: string; params: unknown[] };
type Run = { calls: Call[]; fetched: string[]; rerankPassages: number[] };

/**
 * Each declared flag, the value that turns it on, any companion settings it needs,
 * and an observable effect proving the flag-on run actually engaged (so a flag that
 * silently did nothing could not pass the pass check by default).
 */
const FLAGS: Record<
  string,
  { on: Record<string, string>; rewrite?: boolean; engaged: (r: Run) => boolean }
> = {
  NOTEBOOK_LEXICAL_V2: { on: { NOTEBOOK_LEXICAL_V2: "1" }, engaged: (r) => r.calls.some((c) => c.sql.includes("ln((n.n - df.df + 0.5)")) },
  NOTEBOOK_HYBRID_RETRIEVAL: {
    on: { NOTEBOOK_HYBRID_RETRIEVAL: "1", OLLAMA_BASE_URL: "http://ollama.test" },
    engaged: (r) => r.calls.some((c) => isVector(c.sql)),
  },
  NOTEBOOK_RERANK: {
    on: { NOTEBOOK_RERANK: "1", RERANKER_URL: "http://reranker.test" },
    engaged: (r) => r.fetched.some((u) => u.endsWith("/rerank")),
  },
  NOTEBOOK_RERANK_POOL: {
    on: { NOTEBOOK_RERANK: "1", RERANKER_URL: "http://reranker.test", NOTEBOOK_RERANK_POOL: "6" },
    engaged: (r) => r.rerankPassages.length > 0 && r.rerankPassages.every((n) => n <= 6),
  },
  NOTEBOOK_RERANK_TIMEOUT_MS: {
    on: { NOTEBOOK_RERANK: "1", RERANKER_URL: "http://reranker.test", NOTEBOOK_RERANK_TIMEOUT_MS: "200" },
    engaged: (r) => r.fetched.some((u) => u.endsWith("/rerank")),
  },
  NOTEBOOK_QUERY_REWRITE: {
    on: { NOTEBOOK_QUERY_REWRITE: "1" },
    rewrite: true,
    engaged: (r) => r.calls.some((c) => isOr(c.sql) && c.params[1] === REWRITE),
  },
  NOTEBOOK_RETRIEVAL_DEBUG: {
    on: { NOTEBOOK_RETRIEVAL_DEBUG: "1" },
    engaged: () => vi.mocked(console.log).mock.calls.some((a) => String(a[0]).startsWith("[retrieval-trace]")),
  },
};

/**
 * Flags allowed to skip a mandatory pass, each tied to its capability record. Listing a
 * flag here is not a free pass: the record must keep it off in staging and production.
 */
const KNOWN_BYPASS: Record<string, { capability: string; skips: Kind[] }> = {
  NOTEBOOK_LEXICAL_V2: { capability: "notebook_lexical_idf", skips: ["rare", "question_idf", "and"] },
};

const Q = "what is the maximum output current rating of the relay module";
const REWRITE = "relay output contact rating amperes";

const row = (page: number) => ({
  content: `page ${page}: relay output current rating table`,
  doc_id: "d-1",
  source_url: "node-doc/d-1/manual.pdf",
  source_page: page,
  page_start: page,
  page_label: null,
  section_path: null,
  filename: "manual.pdf",
  document_heading: "Relay Module User Manual",
  verified: true,
  rank: 1 / page,
  lexemes: ["relay", "output", "current", "rate"],
});
const ROWS = Array.from({ length: 9 }, (_, i) => row(i + 1));

async function retrieve(env: Record<string, string>, rewrite: boolean): Promise<Run> {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const run: Run = { calls: [], fetched: [], rerankPassages: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      run.fetched.push(String(url));
      const body = JSON.parse(String(init.body)) as { passages?: string[] };
      if (String(url).endsWith("/rerank")) {
        run.rerankPassages.push(body.passages?.length ?? 0);
        return new Response(JSON.stringify({ scores: (body.passages ?? []).map((_, i) => -i) }), { status: 200 });
      }
      return new Response(JSON.stringify({ embedding: Array.from({ length: 768 }, () => 0.01) }), { status: 200 });
    }),
  );
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    run.calls.push({ sql, params });
    if (isAnd(sql) || isVector(sql)) return { rows: ROWS };
    return { rows: [] };
  });
  await retrieveNodeChunks({ query } as unknown as PoolClient, "t-1", Q, {
    nodeId: "n-1",
    unsPath: null,
    topK: 6,
    docIds: ["d-1"],
    rawQuery: Q,
    validatedDocScope: true,
    ...(rewrite ? { rewrittenQuery: REWRITE } : {}),
  });
  return run;
}

const issued = (r: Run): Kind[] =>
  MANDATORY.filter((k) =>
    r.calls.some((c) => (k === "and" ? isAnd(c.sql) && c.params[1] !== REWRITE : k === "rare" ? isRare(c.sql) : isQuestionIdf(c.sql))),
  );
const bypassed = (r: Run): Kind[] => MANDATORY.filter((k) => !issued(r).includes(k));

/** environments.staging / environments.production of one CAPABILITY_CLOSURE record. */
function registryEnvs(capability: string): { staging: string; production: string } {
  const yaml = readFileSync(REPO("docs/architecture/convergence/CAPABILITY_CLOSURE.yaml"), "utf8");
  const start = yaml.indexOf(`  - id: ${capability}\n`);
  expect(start, `capability ${capability} missing from CAPABILITY_CLOSURE.yaml`).toBeGreaterThanOrEqual(0);
  const next = yaml.indexOf("\n  - id: ", start + 1);
  const block = yaml.slice(start, next === -1 ? undefined : next);
  const env = (name: string) => {
    const m = block.match(new RegExp(`^ {6}${name}: *("?)([^"#\\s]*)\\1`, "m"));
    expect(m, `${capability}.environments.${name} missing`).not.toBeNull();
    return (m as RegExpMatchArray)[2];
  };
  return { staging: env("staging"), production: env("production") };
}

beforeEach(() => {
  for (const k of [...Object.keys(FLAGS), "OLLAMA_BASE_URL", "RERANKER_URL"]) vi.stubEnv(k, "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("experimental retrieval flags keep the production lexical passes (#5138)", () => {
  it("every NOTEBOOK_* flag the retrieval sources read is declared here", () => {
    const read = new Set<string>();
    for (const f of RETRIEVAL_SOURCES) {
      for (const m of readFileSync(SRC(f), "utf8").matchAll(/process\.env\.(NOTEBOOK_[A-Z0-9_]+)/g)) read.add(m[1]);
    }
    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((f) => !(f in FLAGS)).sort(), "declare the new flag in FLAGS").toEqual([]);
  });

  it("control: with every flag off, all mandatory passes run", async () => {
    const r = await retrieve({}, false);
    expect(issued(r)).toEqual(MANDATORY);
  });

  for (const [flag, spec] of Object.entries(FLAGS)) {
    it(`${flag} on: engages, and skips no mandatory pass unless it is a known, disabled bypass`, async () => {
      const r = await retrieve(spec.on, spec.rewrite === true);
      expect(spec.engaged(r), `${flag} on had no observable effect; the check below would prove nothing`).toBe(true);
      const skipped = bypassed(r);
      if (skipped.length === 0) return;
      const known = KNOWN_BYPASS[flag];
      expect(known, `${flag} skips the production pass(es) ${skipped.join(", ")}`).toBeDefined();
      expect(skipped.every((k) => known.skips.includes(k)), `${flag} skips ${skipped.join(", ")}`).toBe(true);
      const envs = registryEnvs(known.capability);
      expect(envs.staging, `${known.capability} must stay off in staging while it bypasses production passes`).not.toBe("1");
      expect(envs.production, `${known.capability} must stay off in production while it bypasses production passes`).not.toBe("1");
    });
  }

  it("all additive flags on together still run every mandatory pass", async () => {
    const env = Object.fromEntries(
      Object.entries(FLAGS)
        .filter(([f]) => !(f in KNOWN_BYPASS))
        .flatMap(([, s]) => Object.entries(s.on)),
    );
    const r = await retrieve(env, true);
    expect(bypassed(r)).toEqual([]);
  });

  it("NOTEBOOK_LEXICAL_V2 is a real bypass (the exception is earned, not stale)", async () => {
    const r = await retrieve(FLAGS.NOTEBOOK_LEXICAL_V2.on, false);
    expect(bypassed(r).length).toBeGreaterThan(0);
  });
});
