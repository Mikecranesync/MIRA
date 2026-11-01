/**
 * Fidelity-harness plumbing (ADR-0038, #4439): session cookie + the declared
 * network surface. Every request either hits a declared handler served from
 * the oracle, or is recorded + aborted — a non-empty `unrecognized` list fails
 * the run (AC2).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { encode } from "next-auth/jwt";
import type { BrowserContext, Page, Request } from "@playwright/test";

export const oracle = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/oracle.json"), "utf8"),
);
export const { NB, DOC, FILE, NODE } = oracle.ids as Record<string, string>;
export type Scenario = "G" | "S";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";

/** A next-auth v4 JWE signed with the run's throwaway secret (config). */
export async function addSessionCookie(context: BrowserContext, baseURL: string) {
  const secret = process.env.FIDELITY_AUTH_SECRET;
  if (!secret) throw new Error("FIDELITY_AUTH_SECRET unset — run via playwright.fidelity.config.ts");
  const value = await encode({
    secret,
    token: {
      sub: USER, tenantId: TENANT, status: "active",
      name: "Fidelity Harness", email: "fidelity@example.invalid",
    },
  });
  await context.addCookies([{ name: "next-auth.session-token", value, url: baseURL }]);
}

// The smallest valid PDF: one blank page. Enough for a viewer to open.
const TINY_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n";

export type Capture = {
  chatBodies: Record<string, unknown>[];
  fileRequests: string[];
  unrecognized: string[];
  /** Lets held post-turn detail GETs through (see installRoutes). */
  release: () => void;
};

/**
 * Serve the oracle for one scenario. Detail GETs return `detailEmpty` until
 * the chat POST has been answered, then `<scenario>.detailAfter` — so a reload
 * after the turn hydrates exactly what the chat route persisted.
 *
 * Post-turn detail GETs are HELD until `release()`: the clone swaps its live
 * turn for the persisted row as soon as that refetch lands, so without the
 * hold the "live" record would silently be the hydrated one (AC6 needs both).
 */
export async function installRoutes(page: Page, scenario: Scenario) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const cap: Capture = { chatBodies: [], fileRequests: [], unrecognized: [], release };
  let answered = false;
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/**", async (route) => {
    const req: Request = route.request();
    // Match on pathname only: basePath stripped, query ignored, trailing slash folded.
    const p = new URL(req.url()).pathname.replace(/^\/hub/, "").replace(/(.)\/$/, "$1");
    const m = req.method();
    const nbPath = `/api/equipment-notebooks/${NB}`;

    if (m === "GET" && p === "/api/me") {
      return route.fulfill(json({ id: USER, tenantId: TENANT, status: "active", name: "Fidelity Harness", email: "fidelity@example.invalid" }));
    }
    // next-auth client (SessionProvider): session read + its client logger.
    if (m === "GET" && p === "/api/auth/session") {
      return route.fulfill(json({ user: { name: "Fidelity Harness", email: "fidelity@example.invalid" }, expires: "2099-01-01T00:00:00.000Z" }));
    }
    if (m === "POST" && p === "/api/auth/_log") {
      return route.fulfill(json({}));
    }
    if (m === "GET" && p === "/api/equipment-notebooks") {
      return route.fulfill(json(oracle.list));
    }
    if (m === "GET" && p === nbPath) {
      if (!answered) return route.fulfill(json(oracle.detailEmpty));
      await released;
      return route.fulfill(json(oracle[scenario].detailAfter)).catch(() => undefined);
    }
    if (m === "POST" && p === `${nbPath}/chat`) {
      cap.chatBodies.push(req.postDataJSON());
      answered = true;
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: oracle[scenario].sse });
    }
    if (m === "GET" && p === `${nbPath}/sources/${DOC}`) {
      const src = oracle.detailEmpty.sources.find((s: { docId: string }) => s.docId === DOC);
      return route.fulfill(json({ filename: src.filename, fileId: src.fileId, originFileId: src.originFileId }));
    }
    if (m === "GET" && p === `/api/namespace/node/${NODE}/files`) {
      return route.fulfill(json({ files: [] }));
    }
    if (m === "GET" && p.startsWith(`/api/namespace/files/${FILE}`)) {
      cap.fileRequests.push(req.url());
      return route.fulfill({ status: 200, contentType: "application/pdf", body: TINY_PDF });
    }
    // WP-1 guided troubleshooting (#4573): the panel reads availability for the open notebook.
    // Off in this harness, as the route is when NOTEBOOK_GUIDED_PROCEDURE is unset.
    if (m === "GET" && p === `${nbPath}/procedure`) {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_enabled" }) });
    }
    // Mission 001 (#5088): the Machine state panel reads observed state for the open notebook.
    // Off in this harness, as the route is when MIRA_OBSERVATION_STATE is unset; the panel hides.
    if (m === "GET" && p === `${nbPath}/observations`) {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "observations_disabled" }) });
    }
    if (m === "GET" && p === "/api/assets") {
      return route.fulfill(json([]));
    }
    cap.unrecognized.push(`${m} ${p}`);
    return route.abort();
  });
  return cap;
}
