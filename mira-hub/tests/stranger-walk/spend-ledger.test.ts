import { describe, expect, it } from "vitest";
import { bookExternalSpend, CAMPAIGN, campaignTotal, entryBody, reserveWalkSpend, settleWalkSpend, tally, type Campaign, type Comment } from "./spend-ledger";

const C: Campaign = { campaign: "test-campaign", capUsd: 11.52, issue: 1, authors: ["owner"] };

/** An in-memory issue: GET pages its comments, POST appends one with the next id. `onPost` lets a
 *  test slip a concurrent writer's comment in between our post and our re-read. */
function fakeGitHub(seed: Comment[] = [], opts: { failRead?: number; onPost?: (all: Comment[]) => void } = {}) {
  const comments = [...seed];
  let next = Math.max(100, ...comments.map((c) => c.id)) + 1;
  const impl = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const c: Comment = { id: next++, user: { login: "owner" }, body: JSON.parse(String(init.body)).body, html_url: `https://x/${next}` };
      comments.push(c);
      opts.onPost?.(comments);
      return new Response(JSON.stringify(c), { status: 201 });
    }
    if (opts.failRead) return new Response("nope", { status: opts.failRead });
    const page = Number(new URL(url).searchParams.get("page"));
    return new Response(JSON.stringify(comments.slice((page - 1) * 100, page * 100)), { status: 200 });
  }) as typeof fetch;
  return { comments, impl, gh: { token: "t", fetchImpl: impl, campaign: C } };
}
const entry = (id: number, entryId: string, kind: "reservation" | "settle" | "external", usd: number, login = "owner"): Comment =>
  ({ id, user: { login }, body: entryBody(C, entryId, kind, usd, "seed") });

describe("spend-ledger.json", () => {
  it("declares the owner's campaign cap and a ledger issue", () => {
    expect(CAMPAIGN.capUsd).toBe(11.52);
    expect(CAMPAIGN.issue).toBeGreaterThan(0);
    expect(CAMPAIGN.authors.length).toBeGreaterThan(0);
  });
});

describe("tally", () => {
  it("a settle replaces its reservation; a crashed reservation stays counted; externals count", () => {
    const t = tally([entry(1, "run-a", "reservation", 4.5), entry(2, "run-a", "settle", 3.7656), entry(3, "run-b", "reservation", 4.5), entry(4, "phone", "external", 0.1536)], C);
    expect(t.problems).toEqual([]);
    expect(t.totalUsd).toBeCloseTo(3.7656 + 4.5 + 0.1536, 6);
  });
  it("ignores other campaigns, untrusted authors and ordinary comments", () => {
    const other = { id: 5, user: { login: "owner" }, body: entryBody({ ...C, campaign: "older" }, "x", "external", 9, "n") };
    const t = tally([other, entry(6, "y", "external", 9, "stranger"), { id: 7, user: { login: "owner" }, body: "nice run" }], C);
    expect(t).toMatchObject({ totalUsd: 0, problems: [] });
  });
  it.each([
    ["a bad usd", `[WALK-SPEND]\ncampaign: test-campaign\nentry_id: r\nkind: reservation\nusd: lots\nnote: x`],
    ["a bad kind", `[WALK-SPEND]\ncampaign: test-campaign\nentry_id: r\nkind: refund\nusd: 1\nnote: x`],
    ["no campaign", `[WALK-SPEND]\nentry_id: r\nkind: external\nusd: 1`],
    ["an unreadable line", `[WALK-SPEND]\ncampaign: test-campaign\nentry_id: r\nkind: external\nusd: 1\nthis is prose`],
  ])("fails closed on %s", (_n, body) => {
    expect(tally([{ id: 9, user: { login: "owner" }, body }], C).problems).toHaveLength(1);
  });
  it("fails closed on a duplicate entry and on a settle without a reservation", () => {
    expect(tally([entry(1, "r", "reservation", 1), entry(2, "r", "reservation", 1)], C).problems[0]).toMatch(/duplicate reservation/);
    expect(tally([entry(1, "r", "settle", 1)], C).problems[0]).toMatch(/settle without a reservation/);
  });
});

describe("reserveWalkSpend (#5081 acceptance)", () => {
  it("two sequential runs whose reservations pass the cap: the second is refused", async () => {
    const f = fakeGitHub([entry(1, "phone", "external", 3)]);
    const first = await reserveWalkSpend({ ...f.gh, entryId: "run-1", usd: 4.5, note: "n" });
    expect(first).toMatchObject({ ok: true, totalUsd: 7.5 });
    const second = await reserveWalkSpend({ ...f.gh, entryId: "run-2", usd: 4.5, note: "n" });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toMatch(/would pass the \$11\.52 cap/);
    expect(f.comments.filter((c) => c.body.includes("run-2"))).toHaveLength(0); // refused before writing
  });
  it("a restart does not reset the total: settled and crashed runs both stay booked", async () => {
    const f = fakeGitHub();
    const a = await reserveWalkSpend({ ...f.gh, entryId: "run-a", usd: 4.5, note: "n" });
    if (!a.ok) throw new Error(a.reason);
    await settleWalkSpend({ ...f.gh, entryId: "run-a", reservedUsd: 4.5, bookedUsd: 3.8, note: "done" });
    await reserveWalkSpend({ ...f.gh, entryId: "run-b", usd: 4.5, note: "crashed, never settled" });
    // A new process (a restart) sees 3.8 + 4.5 = 8.3: a third full run would pass 11.52.
    expect((await campaignTotal(f.gh)).totalUsd).toBeCloseTo(8.3, 6);
    expect((await reserveWalkSpend({ ...f.gh, entryId: "run-c", usd: 4.5, note: "n" })).ok).toBe(false);
    expect((await reserveWalkSpend({ ...f.gh, entryId: "run-c", usd: 3.2, note: "n" })).ok).toBe(true);
  });
  it("refuses, spending nothing, when the ledger cannot be read", async () => {
    const f = fakeGitHub([], { failRead: 502 });
    const r = await reserveWalkSpend({ ...f.gh, entryId: "run-1", usd: 1, note: "n" });
    expect(r).toMatchObject({ ok: false });
    expect(f.comments).toHaveLength(0);
    expect((await reserveWalkSpend({ ...f.gh, token: null, entryId: "run-1", usd: 1, note: "n" })).ok).toBe(false);
  });
  it("refuses an unwritable run id or amount without posting anything", async () => {
    const f = fakeGitHub();
    expect((await reserveWalkSpend({ ...f.gh, entryId: "has space", usd: 1, note: "n" })).ok).toBe(false);
    expect((await reserveWalkSpend({ ...f.gh, entryId: "ok", usd: Number.NaN, note: "n" })).ok).toBe(false);
    expect(f.comments).toHaveLength(0);
  });
  it("refuses when the ledger is malformed, and when the run id is already booked", async () => {
    const bad = fakeGitHub([{ id: 1, user: { login: "owner" }, body: "[WALK-SPEND]\ncampaign: test-campaign\nentry_id: x\nkind: external\nusd: ?" }]);
    expect((await reserveWalkSpend({ ...bad.gh, entryId: "run-1", usd: 1, note: "n" })).ok).toBe(false);
    const dup = fakeGitHub([entry(1, "run-1", "reservation", 1)]);
    expect((await reserveWalkSpend({ ...dup.gh, entryId: "run-1", usd: 1, note: "n" })).ok).toBe(false);
  });
  it("a concurrent reservation posted first wins; ours is released at $0 and refused", async () => {
    let raced = false;
    const f = fakeGitHub([entry(1, "earlier", "external", 6)], {
      onPost: (all) => {
        if (raced) return;
        raced = true;
        // A second walk's reservation that reached the issue just BEFORE ours (lower id).
        const ours = all.pop()!;
        all.push(entry(ours.id - 0.5, "other-walk", "reservation", 4.5), ours);
      },
    });
    const r = await reserveWalkSpend({ ...f.gh, entryId: "mine", usd: 4.5, note: "n" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/concurrent reservation/);
    expect((await campaignTotal(f.gh)).totalUsd).toBeCloseTo(6 + 4.5, 6); // ours released to 0
  });
});

describe("settle and external", () => {
  it("settle never exceeds the reservation", async () => {
    const f = fakeGitHub([entry(1, "r", "reservation", 4.5)]);
    await settleWalkSpend({ ...f.gh, entryId: "r", reservedUsd: 4.5, bookedUsd: 99, note: "n" });
    expect((await campaignTotal(f.gh)).totalUsd).toBe(4.5);
  });
  it("an external check books its full cost and refuses a reused id", async () => {
    const f = fakeGitHub();
    await bookExternalSpend({ ...f.gh, entryId: "phone-q1-q2", usd: 0.1536, note: "two Pixel questions" });
    expect((await campaignTotal(f.gh)).totalUsd).toBeCloseTo(0.1536, 6);
    await expect(bookExternalSpend({ ...f.gh, entryId: "phone-q1-q2", usd: 0.1536, note: "again" })).rejects.toThrow(/already/);
  });
});
