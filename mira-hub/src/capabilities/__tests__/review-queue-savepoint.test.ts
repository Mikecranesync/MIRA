/**
 * #4649 — GET /api/admin/review/queue must not 500 when relationship_proposals
 * is missing (schema-behind) or when pg returns timestamptz as Date.
 *
 * Same class as the hybrid-vector-lane SAVEPOINT in manual-rag.ts (#4487):
 * a swallowed query error inside withTenantContext aborts the transaction,
 * then COMMIT raises 25P02. Fence fetchProposals in SAVEPOINT
 * review_queue_proposals; report schema_behind only for 42P01 / 42703.
 *
 * Lives under capabilities/__tests__ (ungated). Do not put this under
 * src/lib/__tests__ or src/app/** — those buckets fail closed in the
 * Legacy UI Lifecycle Guard.
 * Run: npx vitest run src/capabilities/__tests__/review-queue-savepoint.test.ts
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { getReviewQueue } from "../../lib/review-queue";

const TENANT = "11111111-2222-3333-4444-555555555555";
const ROOT = "/tmp/review-queue-empty-064d";
const CARTOON_NAME = "keep-me.png";

/**
 * A client that models Postgres transaction state: once a statement fails
 * inside a transaction every later statement fails with 25P02 until a
 * ROLLBACK TO SAVEPOINT restores the savepoint taken before the failure.
 */
function txnClient(opts: {
  inTransaction: boolean;
  proposalError?: string;
  proposalRows?: Array<Record<string, unknown>>;
  savepointError?: string;
  rollbackFails?: boolean;
}) {
  const calls: string[] = [];
  let aborted = false;
  let savepointTaken = false;
  const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });
  const query = vi.fn(async (sql: string) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
    if (/^\s*SAVEPOINT/i.test(sql)) {
      if (opts.savepointError) throw pgError(opts.savepointError, `SAVEPOINT failed (${opts.savepointError})`);
      if (!opts.inTransaction) throw pgError("25P01", "SAVEPOINT can only be used in transaction blocks");
      savepointTaken = true;
      return { rows: [] };
    }
    if (/^\s*ROLLBACK TO SAVEPOINT/i.test(sql)) {
      if (!savepointTaken) throw pgError("3B001", "savepoint does not exist");
      if (opts.rollbackFails) {
        throw pgError("25P02", "current transaction is aborted, commands ignored until end of transaction block");
      }
      aborted = false;
      return { rows: [] };
    }
    if (/^\s*RELEASE SAVEPOINT/i.test(sql)) return { rows: [] };
    if (/^\s*COMMIT/i.test(sql)) {
      if (aborted) throw pgError("25P02", "current transaction is aborted, commands ignored until end of transaction block");
      return { rows: [] };
    }
    if (aborted) throw pgError("25P02", "current transaction is aborted, commands ignored until end of transaction block");
    if (sql.includes("relationship_proposals")) {
      if (opts.proposalError) {
        if (opts.inTransaction) aborted = true;
        throw pgError(opts.proposalError, `proposal query failed (${opts.proposalError})`);
      }
      return { rows: opts.proposalRows ?? [] };
    }
    return { rows: [] };
  });
  const client = { query } as unknown as PoolClient;
  return { client, calls, isAborted: () => aborted };
}

beforeEach(async () => {
  process.env.REVIEW_REPO_ROOT = ROOT;
  await mkdir(path.join(ROOT, "marketing/cartoons"), { recursive: true });
  await writeFile(path.join(ROOT, "marketing/cartoons", CARTOON_NAME), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  delete process.env.REVIEW_REPO_ROOT;
  await rm(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("review queue — schema-behind proposals must not abort the caller transaction (#4649)", () => {
  it("42P01 on relationship_proposals → empty proposals, schema_behind notice, other sources kept, COMMIT succeeds", async () => {
    const { client, calls, isAborted } = txnClient({ inTransaction: true, proposalError: "42P01" });
    const out = await getReviewQueue(client, TENANT);
    expect(out.items.filter((i) => i.type === "proposal")).toEqual([]);
    expect(out.items.some((i) => i.type === "cartoon" && i.title === CARTOON_NAME)).toBe(true);
    expect(out.counts.cartoon).toBeGreaterThanOrEqual(1);
    expect(out.notice?.code).toBe("schema_behind");
    expect(out.notice?.message).toMatch(/#3355|#3952/);
    expect(out.notice?.sqlstate).toBe("42P01");
    expect(calls).toContain("SAVEPOINT review_queue_proposals");
    expect(calls.indexOf("ROLLBACK TO SAVEPOINT")).toBeGreaterThan(
      calls.indexOf("SAVEPOINT review_queue_proposals"),
    );
    expect(isAborted()).toBe(false);
    await expect(client.query("COMMIT")).resolves.toEqual({ rows: [] });
  });

  it("control: raw query 42P01 without savepoint recovery → COMMIT raises 25P02", async () => {
    const { client, isAborted } = txnClient({ inTransaction: true, proposalError: "42P01" });
    await expect(client.query("SELECT 1 FROM relationship_proposals", [])).rejects.toMatchObject({
      code: "42P01",
    });
    expect(isAborted()).toBe(true);
    await expect(client.query("COMMIT")).rejects.toMatchObject({ code: "25P02" });
  });

  it("57014 timeout after SAVEPOINT → getReviewQueue throws, no schema_behind, COMMIT still possible", async () => {
    const { client, isAborted } = txnClient({ inTransaction: true, proposalError: "57014" });
    await expect(getReviewQueue(client, TENANT)).rejects.toMatchObject({ code: "57014" });
    expect(isAborted()).toBe(false);
    await expect(client.query("COMMIT")).resolves.toEqual({ rows: [] });
  });

  it("42501 GRANT miss after SAVEPOINT → getReviewQueue throws, no schema_behind, COMMIT still possible", async () => {
    const { client, isAborted } = txnClient({ inTransaction: true, proposalError: "42501" });
    await expect(getReviewQueue(client, TENANT)).rejects.toMatchObject({ code: "42501" });
    expect(isAborted()).toBe(false);
    await expect(client.query("COMMIT")).resolves.toEqual({ rows: [] });
  });

  it("ROLLBACK TO failure → getReviewQueue throws, COMMIT still 25P02 (not schema_behind)", async () => {
    const { client, isAborted } = txnClient({
      inTransaction: true,
      proposalError: "42P01",
      rollbackFails: true,
    });
    await expect(getReviewQueue(client, TENANT)).rejects.toMatchObject({ code: "25P02" });
    expect(isAborted()).toBe(true);
    await expect(client.query("COMMIT")).rejects.toMatchObject({ code: "25P02" });
  });

  it("SAVEPOINT 25P02 (already aborted) → getReviewQueue throws, does not claim schema_behind", async () => {
    const { client } = txnClient({
      inTransaction: true,
      savepointError: "25P02",
    });
    await expect(getReviewQueue(client, TENANT)).rejects.toMatchObject({ code: "25P02" });
  });

  it("successful proposal with Date created_at → ISO string, no throw, no notice, counts.proposal=1", async () => {
    const { client, isAborted } = txnClient({
      inTransaction: true,
      proposalRows: [
        {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          source_entity_type: "equipment",
          target_entity_type: "document",
          relationship_type: "documented_by",
          confidence: 0.91,
          status: "proposed",
          created_by: "system",
          reasoning: "from ingest",
          created_at: new Date("2026-10-23T12:10:00.000Z"),
          source_name: "GS10",
          target_name: "manual",
        },
      ],
    });
    const out = await getReviewQueue(client, TENANT);
    const proposals = out.items.filter((i) => i.type === "proposal");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.createdAt).toBe("2026-10-23T12:10:00.000Z");
    expect(typeof proposals[0]?.createdAt).toBe("string");
    expect(out.notice).toBeUndefined();
    expect(out.counts.proposal).toBe(1);
    expect(out.items.some((i) => i.type === "cartoon" && i.title === CARTOON_NAME)).toBe(true);
    expect(isAborted()).toBe(false);
    await expect(client.query("COMMIT")).resolves.toEqual({ rows: [] });
  });

  it("Invalid Date created_at → epoch ISO, COMMIT succeeds", async () => {
    const { client, isAborted } = txnClient({
      inTransaction: true,
      proposalRows: [
        {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          source_entity_type: "equipment",
          target_entity_type: "document",
          relationship_type: "documented_by",
          confidence: 0.5,
          status: "proposed",
          created_by: "system",
          reasoning: null,
          created_at: new Date("not-a-date"),
          source_name: "GS10",
          target_name: "manual",
        },
      ],
    });
    const out = await getReviewQueue(client, TENANT);
    expect(out.items.find((i) => i.type === "proposal")?.createdAt).toBe(new Date(0).toISOString());
    expect(isAborted()).toBe(false);
    await expect(client.query("COMMIT")).resolves.toEqual({ rows: [] });
  });
});
