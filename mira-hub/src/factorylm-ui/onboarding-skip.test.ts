import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shellOnboardingRedirect } from "./onboarding-skip";

// PRD §19.11 (2026-10-07 staging): a six-notebook account was sent to the setup
// wizard on /v3 instead of its conversation. The phone never gates.
type Reply = { ok: boolean; body: unknown } | "throw";

function api(routes: Record<string, Reply>) {
  const asked: string[] = [];
  const getJson = async (path: string) => {
    asked.push(path);
    const r = routes[path];
    if (!r || r === "throw") throw new Error("offline");
    return { ok: r.ok, json: async () => r.body };
  };
  return { getJson, asked };
}

const WIZARD = "/api/wizard/company";
const NOTEBOOKS = "/api/equipment-notebooks/";

describe("shellOnboardingRedirect — a technician with notebooks keeps their conversation", () => {
  it("unfinished wizard + an existing notebook → stays on the shell", async () => {
    const { getJson } = api({
      [WIZARD]: { ok: true, body: { status: "not_started" } },
      [NOTEBOOKS]: { ok: true, body: { notebooks: [{ id: "n1" }] } },
    });
    expect(await shellOnboardingRedirect(getJson)).toBeNull();
  });

  it("control: unfinished wizard + no notebooks → /onboarding (a genuinely new tenant)", async () => {
    const { getJson } = api({
      [WIZARD]: { ok: true, body: { status: "in_progress" } },
      [NOTEBOOKS]: { ok: true, body: { notebooks: [] } },
    });
    expect(await shellOnboardingRedirect(getJson)).toBe("/onboarding");
  });

  it("a failed or malformed notebook read keeps the existing decision", async () => {
    for (const reply of ["throw", { ok: false, body: {} }, { ok: true, body: null }] as Reply[]) {
      const { getJson } = api({ [WIZARD]: { ok: true, body: { status: "not_started" } }, [NOTEBOOKS]: reply });
      expect(await shellOnboardingRedirect(getJson)).toBe("/onboarding");
    }
  });

  it("a completed wizard stays on the shell without reading notebooks", async () => {
    const { getJson, asked } = api({ [WIZARD]: { ok: true, body: { status: "completed" } } });
    expect(await shellOnboardingRedirect(getJson)).toBeNull();
    expect(asked).toEqual([WIZARD]);
  });

  it("is the decision the /v3 gate actually makes", () => {
    const gate = readFileSync(new URL("./onboarding-gate.tsx", import.meta.url), "utf8");
    expect(gate).toMatch(/shellOnboardingRedirect\(/);
    expect(gate).not.toMatch(/\bonboardingRedirect\(/);
  });
});
