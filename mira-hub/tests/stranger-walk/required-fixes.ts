/**
 * The build-under-test gate (owner decision 2026-10-31). A paid walk measures a build; if the fixes
 * the run is meant to measure are not in the build staging serves, the money buys a number we
 * already have. Before any account, register slot or token is spent, every PR in
 * required-fixes.json must be merged AND its merge commit must be an ancestor of (or equal to) the
 * gitSha staging reports on /api/health. Fails closed: no token, an API error, an unmerged PR or a
 * diverged history all refuse.
 *
 * STRANGER_WALK_REQUIRE_PRS=4900,4901 adds PRs for one run. STRANGER_WALK_BASELINE=<reason>
 * deliberately measures a build without them (a "before" number); the run proceeds and the
 * scorecard says so, with the reason and every missing fix.
 */
import { execFileSync } from "node:child_process";
import requiredJson from "./required-fixes.json";

export type RequiredFix = { pr: number; why: string };
export type FixStatus = { pr: number; why: string; problem: string | null };
export type BuildGate = { ok: boolean; deployedSha: string; fixes: FixStatus[]; baseline: string | null };

export function requiredFixes(env: Record<string, string | undefined> = process.env): RequiredFix[] {
  const listed = (requiredJson as { fixes: RequiredFix[] }).fixes;
  const extra = (env.STRANGER_WALK_REQUIRE_PRS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    if (!/^[1-9][0-9]*$/.test(s)) throw new Error(`STRANGER_WALK_REQUIRE_PRS: "${s}" is not a PR number`);
    return { pr: Number(s), why: "STRANGER_WALK_REQUIRE_PRS" };
  });
  const seen = new Set<number>();
  return [...listed, ...extra].filter((f) => !seen.has(f.pr) && seen.add(f.pr));
}

export function githubToken(env: Record<string, string | undefined> = process.env): string | null {
  const t = env.GH_TOKEN || env.GITHUB_TOKEN || env.GITHUB_PAT;
  if (t) return t;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Is `fix` contained in `deployed`? Reads GitHub's compare (base=deployed, head=fix): the fix is in
 *  the build when the compare says identical or behind (same rule as stranger-walk.yml's main check). */
export async function checkBuildContainsFixes(opts: {
  deployedSha: string;
  fixes: RequiredFix[];
  token: string | null;
  repo?: string;
  baseline?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<BuildGate> {
  const { deployedSha, fixes, token } = opts;
  const repo = opts.repo ?? "Mikecranesync/MIRA";
  const f = opts.fetchImpl ?? fetch;
  const baseline = opts.baseline?.trim() || null;
  const api = async (p: string): Promise<Record<string, unknown>> => {
    const res = await f(`https://api.github.com/repos/${repo}/${p}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) throw new Error(`GitHub ${p.split("/")[0]} ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  const statuses: FixStatus[] = [];
  for (const fix of fixes) {
    let problem: string | null = null;
    if (!/^[0-9a-f]{40}$/.test(deployedSha)) problem = `staging reports no 40-char gitSha (${deployedSha})`;
    else if (!token) problem = "no GitHub token (GH_TOKEN / GITHUB_TOKEN / GITHUB_PAT / gh auth) — cannot prove the fix is deployed";
    else {
      try {
        const pr = await api(`pulls/${fix.pr}`);
        const merge = pr.merge_commit_sha;
        if (pr.merged !== true) problem = "not merged";
        else if (typeof merge !== "string" || !/^[0-9a-f]{40}$/.test(merge)) problem = "merged but GitHub reports no merge commit";
        else {
          const status = (await api(`compare/${deployedSha}...${merge}`)).status;
          if (status !== "identical" && status !== "behind") problem = `merged as ${merge.slice(0, 9)} but not in the staging build ${deployedSha.slice(0, 9)} (compare: ${String(status)})`;
        }
      } catch (e) {
        problem = `could not verify (${(e as Error).message})`;
      }
    }
    statuses.push({ ...fix, problem });
  }
  const missing = statuses.some((s) => s.problem);
  return { ok: !missing || baseline !== null, deployedSha, fixes: statuses, baseline: missing ? baseline : null };
}

export function describeGate(g: BuildGate): string {
  const missing = g.fixes.filter((s) => s.problem);
  if (!missing.length) return `build under test ${g.deployedSha.slice(0, 9)} contains every required fix: ${g.fixes.map((s) => `#${s.pr}`).join(", ") || "(none listed)"}`;
  const list = missing.map((s) => `#${s.pr} (${s.why}): ${s.problem}`).join("; ");
  return g.baseline
    ? `BASELINE run on ${g.deployedSha.slice(0, 9)} without required fixes — reason: ${g.baseline} — missing: ${list}`
    : `refusing a paid walk: the staging build ${g.deployedSha.slice(0, 9)} is missing required fixes — ${list}. Merge and deploy them first, or set STRANGER_WALK_BASELINE=<reason> for a deliberate "before" run.`;
}
