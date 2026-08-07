/**
 * prod-settle.globalSetup.ts — wait for the production surface to settle before
 * the deploy gate judges it (#3082).
 *
 * ## Why this exists
 *
 * `smoke-test.yml` runs against LIVE production on every push to main and every
 * PR. Merging to main triggers `deploy-vps.yml`, which restarts the prod
 * containers — so any smoke run that lands in that window hits a real,
 * seconds-long outage. #3035 documents the human-checklist version of this and
 * frames it correctly: it is **a real 502 from a real outage, not a flaky
 * assertion**.
 *
 * That framing constrains the fix. The gate must NOT learn to tolerate
 * failures. It waits for the surface to actually come back, then judges it
 * normally — and still fails when it never comes back. A restart resolves in
 * seconds; a genuine outage burns the budget and fails, which is the correct
 * answer for a deploy gate.
 *
 * ## Why not just add retries
 *
 * `retries: 1` was ALREADY set in playwright.smoke.config.ts when #3082 was
 * filed, and the failure happened anyway: Playwright retries immediately with
 * no backoff, so both attempts landed inside the same window. More retries
 * multiplies the cost of genuine failures without reliably clearing a restart.
 *
 * ## Why this probes page routes, not just /api/health
 *
 * A health endpoint can answer 200 while the app is still warming, and the
 * observed failures were on PAGE routes — `/`, `/pricing`, `/cmms` here, and
 * `/quickstart` in #3035 — not on `/api/health`. Gating on health alone would
 * pass and let the suite hit the window anyway. So each origin is probed on
 * both a page route and its health endpoint, and all four must be good before
 * the suite starts.
 *
 * ## Scope
 *
 * Wired into BOTH configs that `smoke-test.yml` runs — playwright.smoke.config.ts
 * and playwright.signup.config.ts. They target the same origins in the same job,
 * so gating only one leaves the job just as red.
 *
 * ## Cost
 *
 * Happy path is one round of four parallel HEAD/GET probes — ~1s on an already
 * settled surface, which is every run outside a deploy window. The job takes
 * ~65s today against a 10-minute timeout, so even a fully exhausted budget on
 * both configs stays well inside it.
 *
 * Env:
 *   SMOKE_SETTLE_TIMEOUT_MS  budget in ms (default 90_000)
 *   SMOKE_SETTLE_INTERVAL_MS poll interval in ms (default 3_000)
 *   SMOKE_SETTLE_SKIP=1      bypass entirely (local runs against a static target)
 */

const WEB = (process.env.WEB_URL ?? "https://factorylm.com").replace(/\/$/, "");
const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "");

const BUDGET_MS = Number(process.env.SMOKE_SETTLE_TIMEOUT_MS ?? 90_000);
const INTERVAL_MS = Number(process.env.SMOKE_SETTLE_INTERVAL_MS ?? 3_000);

type Probe = {
  label: string;
  url: string;
  /** Statuses that mean "this route is serving". */
  ok: number[];
  /** Optional extra assertion on the body (health endpoints report status:ok). */
  body?: (text: string) => boolean;
};

/**
 * Page routes come first in each pair — they are what actually broke. The
 * health endpoints are kept because they are the cheapest signal that the app,
 * not just nginx, is up.
 *
 * HUB "/" redirects to /login (nginx 302, #1113); redirect: "follow" means we
 * see the FINAL status, so 200 is the expected value and the 307/308 tolerance
 * in smoke.spec.ts does not need mirroring here.
 */
const PROBES: Probe[] = [
  { label: "web /", url: `${WEB}/`, ok: [200] },
  {
    label: "web /api/health",
    url: `${WEB}/api/health`,
    ok: [200],
    body: (t) => {
      try {
        return JSON.parse(t).status === "ok";
      } catch {
        return false;
      }
    },
  },
  { label: "hub /login", url: `${HUB}/login`, ok: [200] },
  {
    label: "hub /api/health",
    url: `${HUB}/api/health`,
    ok: [200],
    body: (t) => {
      try {
        return JSON.parse(t).status === "ok";
      } catch {
        return false;
      }
    },
  },
];

const PROBE_TIMEOUT_MS = 10_000;

async function checkProbe(p: Probe): Promise<string | null> {
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter
  // is fine on Node 20 at runtime but is not in this project's configured
  // `lib` (dom + esnext), and tsconfig `include` covers **/*.ts, so it would
  // be a type error in `next build`. This form is portable.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(p.url, {
      redirect: "follow",
      signal: ctl.signal,
      headers: { "user-agent": "factorylm-smoke-settle/1.0" },
    });
    if (!p.ok.includes(res.status)) return `${p.label}: HTTP ${res.status}`;
    if (p.body) {
      const text = await res.text();
      if (!p.body(text)) return `${p.label}: body assertion failed`;
    }
    return null;
  } catch (err) {
    return `${p.label}: ${(err as Error).message}`;
  } finally {
    clearTimeout(timer);
  }
}

export default async function globalSetup(): Promise<void> {
  if (process.env.SMOKE_SETTLE_SKIP === "1") {
    console.log("[settle] SMOKE_SETTLE_SKIP=1 — skipping settle gate");
    return;
  }

  const started = Date.now();
  let attempt = 0;
  let failures: string[] = [];

  while (Date.now() - started < BUDGET_MS) {
    attempt++;
    const results = await Promise.all(PROBES.map(checkProbe));
    failures = results.filter((r): r is string => r !== null);

    if (failures.length === 0) {
      const waited = Date.now() - started;
      console.log(
        attempt === 1
          ? `[settle] surface already settled (${PROBES.length}/${PROBES.length} probes OK)`
          : `[settle] surface settled after ${Math.round(waited / 1000)}s (${attempt} attempts) — ` +
              `a deploy was almost certainly in flight`,
      );
      return;
    }

    console.log(
      `[settle] attempt ${attempt}: ${failures.length}/${PROBES.length} not ready — ${failures.join("; ")}`,
    );
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  // Budget exhausted. This is NOT a restart window — it is an outage, and the
  // deploy gate should fail. Throwing here fails the run before any test
  // reports, so the cause reads as "prod never came back", not as a scattering
  // of assertion failures.
  throw new Error(
    `[settle] production did not settle within ${Math.round(BUDGET_MS / 1000)}s — ` +
      `treating as a real outage, not a deploy window.\n` +
      `Still failing: ${failures.join("; ")}\n` +
      `WEB=${WEB} HUB=${HUB}`,
  );
}
