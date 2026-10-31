import { describe, expect, it } from "vitest";
import { checkBuildContainsFixes, describeGate, requiredFixes } from "./required-fixes";

const DEPLOYED = "a".repeat(40);
const MERGE = "b".repeat(40);

/** A fake GitHub: `prs` maps a PR number to its pulls/N body; `compare` is the compare status. */
function github(prs: Record<number, Record<string, unknown> | number>, compare: string | number = "behind") {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
    const pull = /\/pulls\/(\d+)$/.exec(url);
    if (pull) {
      const pr = prs[Number(pull[1])];
      return typeof pr === "number" ? json({}, pr) : json(pr ?? {}, pr ? 200 : 404);
    }
    if (/\/compare\//.test(url)) return typeof compare === "number" ? json({}, compare) : json({ status: compare });
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const merged = { merged: true, merge_commit_sha: MERGE };
const fix = { pr: 1, why: "the fix" };

describe("build-under-test gate (required fixes)", () => {
  it("passes when every fix is merged and in the deployed build (behind or identical)", async () => {
    for (const status of ["behind", "identical"]) {
      const gh = github({ 1: merged }, status);
      const g = await checkBuildContainsFixes({ deployedSha: DEPLOYED, fixes: [fix], token: "t", fetchImpl: gh.impl });
      expect(g.ok).toBe(true);
      expect(gh.calls[1]).toContain(`/compare/${DEPLOYED}...${MERGE}`);
      expect(describeGate(g)).toMatch(/contains every required fix: #1/);
    }
  });

  it("refuses when the fix is merged but staging serves an older build (compare ahead)", async () => {
    const g = await checkBuildContainsFixes({ deployedSha: DEPLOYED, fixes: [fix], token: "t", fetchImpl: github({ 1: merged }, "ahead").impl });
    expect(g.ok).toBe(false);
    expect(g.fixes[0].problem).toMatch(/not in the staging build/);
    expect(describeGate(g)).toMatch(/^refusing a paid walk/);
  });

  it("refuses on a diverged history, an unmerged PR, a missing merge commit or an API error", async () => {
    const cases: [Record<number, Record<string, unknown> | number>, string | number, RegExp][] = [
      [{ 1: merged }, "diverged", /compare: diverged/],
      [{ 1: { merged: false, merge_commit_sha: MERGE } }, "behind", /not merged/],
      [{ 1: { merged: true, merge_commit_sha: null } }, "behind", /no merge commit/],
      [{ 1: 500 }, "behind", /could not verify \(GitHub pulls 500\)/],
      [{ 1: merged }, 403, /could not verify \(GitHub compare 403\)/],
    ];
    for (const [prs, compare, problem] of cases) {
      const g = await checkBuildContainsFixes({ deployedSha: DEPLOYED, fixes: [fix], token: "t", fetchImpl: github(prs, compare).impl });
      expect(g.ok).toBe(false);
      expect(g.fixes[0].problem).toMatch(problem);
    }
  });

  it("fails closed with no token or no 40-char deployed sha, without calling GitHub", async () => {
    const gh = github({ 1: merged });
    expect((await checkBuildContainsFixes({ deployedSha: DEPLOYED, fixes: [fix], token: null, fetchImpl: gh.impl })).fixes[0].problem).toMatch(/no GitHub token/);
    expect((await checkBuildContainsFixes({ deployedSha: "unknown", fixes: [fix], token: "t", fetchImpl: gh.impl })).fixes[0].problem).toMatch(/no 40-char gitSha/);
    expect(gh.calls).toHaveLength(0);
  });

  it("a declared baseline proceeds but names its reason and every missing fix", async () => {
    const g = await checkBuildContainsFixes({ deployedSha: DEPLOYED, fixes: [fix, { pr: 2, why: "other" }], token: "t", baseline: "before number", fetchImpl: github({ 1: merged, 2: { merged: false } }, "ahead").impl });
    expect(g.ok).toBe(true);
    expect(describeGate(g)).toMatch(/^BASELINE run .* reason: before number .* #1 .* #2 \(other\): not merged/);
    const blank = await checkBuildContainsFixes({ deployedSha: DEPLOYED, fixes: [fix], token: "t", baseline: "  ", fetchImpl: github({ 1: { merged: false } }).impl });
    expect(blank.ok).toBe(false);
  });

  it("the checked-in list is non-empty and STRANGER_WALK_REQUIRE_PRS adds (deduped) PRs", () => {
    const listed = requiredFixes({});
    expect(listed.length).toBeGreaterThan(0);
    const more = requiredFixes({ STRANGER_WALK_REQUIRE_PRS: `${listed[0].pr}, 9999` });
    expect(more.map((f) => f.pr)).toEqual([...listed.map((f) => f.pr), 9999]);
    expect(() => requiredFixes({ STRANGER_WALK_REQUIRE_PRS: "abc" })).toThrow(/not a PR number/);
  });
});
