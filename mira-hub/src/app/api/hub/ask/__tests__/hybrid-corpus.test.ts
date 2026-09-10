import { describe, expect, it } from "vitest";
import { selectCitations } from "../route";
import type { ManualChunk } from "@/lib/manual-rag";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * #2178 regression guard for `/api/hub/ask`.
 *
 * `knowledge_entries` is a HYBRID corpus: the shared OEM library lives under
 * the system tenant with `is_private = false`, and `retrieveManualChunks`
 * filters `(is_private = false OR tenant_id = $1)`.
 *
 * `withTenantContext` issues `SET LOCAL ROLE factorylm_app`, activating the RLS
 * policy `tenant_id = current_setting('app.current_tenant_id')`
 * (003_kb_hardening.sql:52). RLS ANDs on top of the hybrid predicate and
 * collapses it to `tenant_id = $caller`, hiding every OEM row. A customer then
 * sees ZERO manuals for every manufacturer and MIRA refuses politely.
 *
 * The first version of this route did exactly that, copied from
 * `/api/quickstart/ask` — a shape that is safe there ONLY because quickstart
 * passes `quickstartTenantId()`, so it is the corpus owner and RLS returns its
 * own rows. This route passes the CUSTOMER's tenant, where the identical call
 * has the opposite effect.
 *
 * Why this is a source-level assertion rather than a query test: the defect is
 * invisible at the SQL layer. The predicate is correct in both versions — what
 * differs is the CONNECTION the query runs on. A test that mocks the client
 * cannot see it, which is precisely why #2178 shipped once already.
 */
const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(resolve(here, "../route.ts"), "utf8");
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("/api/hub/ask — the hybrid corpus must stay visible (#2178)", () => {
  it("the comment stripper actually strips (positive control)", () => {
    // Without this, every assertion below would be scanning documentation that
    // deliberately NAMES the forbidden call.
    expect(route).toContain("#2178");
    expect(code).not.toContain("#2178");
  });

  it("does NOT run retrieval through withTenantContext", () => {
    expect(code).not.toContain("withTenantContext");
  });

  it("takes its client from the raw owner pool", () => {
    expect(code).toContain("pool.connect()");
  });

  it("still passes the CALLER's tenant as the predicate argument", () => {
    // The hybrid predicate supplies tenant scoping; bypassing RLS must not
    // bypass tenancy. Dropping this argument would make it a global read.
    expect(code).toMatch(/retrieveManualChunks\(\s*client,\s*ctx\.tenantId/);
  });

  it("documents that the approval gate still admits this tenant's private uploads", () => {
    // retrieveManualChunks owns the SQL; this route must not re-impose a
    // blanket verified=true that would hide folder=brain uploads.
    expect(route).toMatch(/is_private = true/);
    expect(code).not.toMatch(/AND verified = true/);
  });

  it("releases the client on every path", () => {
    expect(code).toContain("finally");
    expect(code).toContain("client.release()");
  });

  it("does not swallow the tenant into a hardcoded corpus owner", () => {
    // The inverse failure: scoping to the system tenant would show every
    // customer the library but hide their own uploads.
    expect(code).not.toContain("quickstartTenantId");
    expect(code).not.toContain("SHARED_TENANT_ID");
  });
});

/**
 * Adversarial review round 1 on #3682 (F3 citation numbering, F4 phantom
 * citations beside a refusal, F5 unmetered paid cascade).
 *
 * These live in this file rather than a new one on purpose: every file under
 * `mira-hub/src/app/**` is guarded by the UI lifecycle guard, so a second test
 * file would double this PR's attestation surface for no benefit. The subject
 * is the same route.
 *
 * F3/F4 are behavioural — `selectCitations` is the function the route calls.
 * F5 is order-sensitive rather than presence-only: a limiter that runs AFTER
 * the paid call is not a limiter.
 */
describe("/api/hub/ask — citations follow the numbering contract (F3/F4)", () => {
  const chunk = (over: Partial<ManualChunk>): ManualChunk =>
    ({
      title: "manual",
      content: "text",
      manufacturer: "Rockwell",
      modelNumber: "PowerFlex 525",
      sourceUrl: "https://example.test/a.pdf",
      sourcePage: 4,
      verified: true,
      ...over,
    }) as ManualChunk;

  // Two excerpts from the SAME document page, then a distinct source. The
  // context builder numbers these [1], [1], [2] — by unique source, not by chunk.
  const dupes: ManualChunk[] = [
    chunk({}),
    chunk({ content: "second excerpt, same page" }),
    chunk({ sourceUrl: "https://example.test/b.pdf", sourcePage: 9, title: "other" }),
  ];

  it("deduplicates a repeated source instead of numbering raw chunks", () => {
    const cards = selectCitations(dupes, "Cause is X [1]. See also [2].");
    expect(cards.map((c) => c.index)).toEqual([1, 2]);
    // The pre-fix code emitted three cards from three chunks, so the model's
    // [2] pointed at the duplicate and a phantom [3] appeared.
    expect(cards.length).toBe(2);
  });

  it("returns only the sources the answer actually cited", () => {
    const cards = selectCitations(dupes, "Only the first matters [1].");
    expect(cards.map((c) => c.index)).toEqual([1]);
  });

  it("ships NO citations beside a refusal, whatever its wording", () => {
    // The old check matched one quickstart-specific sentence, so this route's
    // own phrasings went undetected and shipped every retrieved card.
    for (const refusal of [
      "I don't have supporting documentation for that yet.",
      "The knowledge base does not contain enough information to answer.",
      "I can't answer that from the manuals on file.",
      "No tengo documentación para eso.",
    ]) {
      expect(selectCitations(dupes, refusal)).toEqual([]);
    }
  });

  it("still cites normally when markers are present (positive control)", () => {
    // Without this, a selectCitations that always returned [] would satisfy
    // every assertion above while removing citations from the product.
    expect(selectCitations(dupes, "Grounded answer [1][2].").length).toBe(2);
  });
});

describe("/api/hub/ask — the paid cascade is metered (F5)", () => {
  it("rate-limits BEFORE retrieval and before the paid completion", () => {
    const limitAt = code.indexOf("rateLimited(");
    const retrieveAt = code.indexOf("retrieveManualChunks(");
    const cascadeAt = code.indexOf("cascadeComplete(");
    expect(limitAt).toBeGreaterThan(-1);
    expect(retrieveAt).toBeGreaterThan(-1);
    expect(cascadeAt).toBeGreaterThan(-1);
    // Order, not presence. A limiter after the spend is not a limiter.
    expect(limitAt).toBeLessThan(retrieveAt);
    expect(limitAt).toBeLessThan(cascadeAt);
  });

  it("meters by tenant AND by client, not by one of them", () => {
    // Tenant alone lets one compromised session drain the workspace; IP alone
    // lets one account spread across addresses.
    expect(code).toContain('rateLimited("hub-ask-tenant", ctx.tenantId');
    expect(code).toContain('rateLimited("hub-ask-ip"');
  });

  it("answers 429 rather than a 500 or a silent drop", () => {
    expect(code).toContain("status: 429");
  });
});
