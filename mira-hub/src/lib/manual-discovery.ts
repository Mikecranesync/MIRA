/**
 * manual-discovery — thin, best-effort client for the mira-ask manual-discovery
 * router (`POST {MIRA_ASK_URL}/manual-discovery/search`).
 *
 * Honesty contract: this module NEVER fabricates a URL, synthesizes a candidate,
 * or guesses an OEM documentation link when the service is unavailable. A
 * timeout, a non-200, or a malformed body all degrade to a typed result whose
 * `reason` the UI can show verbatim ("search service unavailable"). The caller
 * distinguishes "we looked and found nothing" from "we could not look" — those
 * are different truths and the technician deserves the difference.
 *
 * Call pattern mirrors the existing drive-pack pre-check in
 * src/app/api/assets/[id]/chat/route.ts: MIRA_ASK_URL default, optional
 * X-Mira-Key (from MANUAL_DISCOVERY_API_KEY), AbortSignal.timeout, any failure
 * falls through.
 */

export interface DiscoveryIdentity {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
}

/**
 * Who is asking (#4160 S4, PRD R13/R14) — required so the router can reserve
 * the provider query against per-user/tenant/global Postgres caps. userId is
 * nullable in the TYPE (callers without a signed-in session exist) but a null
 * value means the search never runs — see discoverManual().
 */
export interface DiscoveryContext {
  tenantId: string;
  userId: string | null;
}

export interface DiscoveryCandidate {
  url: string;
  title: string;
  host: string;
  score: number;
  docType: string | null;
  isDirectPdf: boolean;
  validated: boolean;
}

export interface DiscoveryResult {
  /** The search service answered (whether or not it found anything). */
  serviceAvailable: boolean;
  found: boolean;
  candidate: DiscoveryCandidate | null;
  validated: boolean;
  isDirectPdf: boolean;
  oemHost: boolean;
  /** Host is on the general curated distributor/OEM-CDN list — a ranking and
   * review signal only. NEVER sufficient for auto-verification (that is
   * oemHost, which is strictly the confirmed manufacturer's own domains). */
  trustedDistributorHost: boolean;
  /** Technician-facing, already honest. Safe to render as-is. */
  reason: string;
  /** The manufacturer's own manual-request page, validated live by the
   * discovery service (200 right now) — the official next step when nothing
   * could be found or trusted. */
  oemRequestUrl: string | null;
  /** The search service answered with reason="quota_exceeded" — a per-user,
   * per-tenant, or global daily/monthly cap is at capacity RIGHT NOW (#4160
   * S4). This is NEVER the same as "no manual exists" (PRD R5) — the caller
   * must say "limit reached", not "not found". */
  quotaExceeded: boolean;
}

function requestUrl(body: Record<string, unknown> | null | undefined): string | null {
  const u = body?.oem_request_url;
  return typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}

const DEFAULT_ASK_URL = "http://mira-ask:8011";
// 60s (was 12s): mira-ask now reads the top candidate PDFs before choosing
// (model-judged, 2026-08-26); its own budget is MANUAL_DISCOVERY_TIMEOUT=50s.
const DISCOVERY_TIMEOUT_MS = 60_000;

const NO_MANUAL = "no official manual found";
const UNAVAILABLE = "search service unavailable";

function unavailable(reason = UNAVAILABLE): DiscoveryResult {
  return {
    serviceAvailable: false,
    found: false,
    candidate: null,
    validated: false,
    isDirectPdf: false,
    oemHost: false,
    trustedDistributorHost: false,
    reason,
    oemRequestUrl: null,
    quotaExceeded: false,
  };
}

function notFound(reason = NO_MANUAL): DiscoveryResult {
  return {
    serviceAvailable: true,
    found: false,
    candidate: null,
    validated: false,
    isDirectPdf: false,
    oemHost: false,
    trustedDistributorHost: false,
    reason,
    oemRequestUrl: null,
    quotaExceeded: false,
  };
}

function quotaExceededResult(reason: string, oemRequestUrl: string | null): DiscoveryResult {
  return {
    serviceAvailable: true,
    found: false,
    candidate: null,
    validated: false,
    isDirectPdf: false,
    oemHost: false,
    trustedDistributorHost: false,
    reason,
    oemRequestUrl,
    quotaExceeded: true,
  };
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Ask the router for an official manual for this identity. Best-effort:
 * resolves to a typed result, never throws.
 *
 * `ctx` identifies the caller (#4160 S4, PRD R13/R14) — every search is
 * reserved against per-user/tenant/global Postgres caps on the router side,
 * so a caller with no signed-in user is refused HERE, before any request:
 * never invent an identity to let a search through.
 */
export async function discoverManual(
  identity: DiscoveryIdentity,
  ctx: DiscoveryContext,
): Promise<DiscoveryResult> {
  const manufacturer = str(identity.manufacturer);
  const model = str(identity.model);
  const catalogNumber = str(identity.catalogNumber);
  if (!(model || catalogNumber)) {
    return notFound("a model or part number is required to search for a manual");
  }

  const tenantId = str(ctx.tenantId);
  const userId = str(ctx.userId);
  if (!tenantId || !userId) {
    return unavailable("a signed-in user is required to search for a manual");
  }

  const base = (process.env.MIRA_ASK_URL ?? DEFAULT_ASK_URL).replace(/\/+$/, "");
  let raw: unknown;
  try {
    const resp = await fetch(`${base}/manual-discovery/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Required identity (#4160 S4) — the router 400s without it.
        "X-Mira-Tenant": tenantId,
        "X-Mira-User": userId,
        // The router's own key (#4160 S2) — not the shared ASK_API_KEY, which
        // belongs to the kiosk-facing endpoints. Unset → the router answers
        // 503, which lands below as "search service unavailable".
        ...(process.env.MANUAL_DISCOVERY_API_KEY
          ? { "X-Mira-Key": process.env.MANUAL_DISCOVERY_API_KEY }
          : {}),
      },
      body: JSON.stringify({
        ...(manufacturer ? { manufacturer } : {}),
        ...(model ? { model } : {}),
        ...(catalogNumber ? { catalog_number: catalogNumber } : {}),
      }),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!resp.ok) return unavailable();
    raw = await resp.json();
  } catch {
    // Timeout, DNS failure, connection refused, malformed JSON — all the same
    // truth to the technician: we could not look. Never invent a candidate.
    return unavailable();
  }

  const body = (raw ?? {}) as Record<string, unknown>;
  if (body.reason === "quota_exceeded") {
    // A cap denial must NEVER look like "no manual exists" (PRD R5) — a
    // distinct, named outcome so the caller says "limit reached".
    return quotaExceededResult(
      str(body.reason_detail) || "manual-search limit reached",
      requestUrl(body),
    );
  }
  if (body.reason === "search_unavailable") {
    // Pre-existing defect fixed here (#4160 S4 code review): the router
    // answers HTTP 200 with found=false, reason="search_unavailable" for BOTH
    // a timeout/exception AND quota_unavailable — an infra miss, not "we
    // looked and found nothing". The generic found!==true branch below used
    // to map this to notFound() (serviceAvailable:true), which acquireManualForIdentity
    // then turned into "no_manual_found" — indistinguishable from a genuine
    // miss. This must read as "could not look" — but still carry the OEM
    // request link when the router sent one (every _NO_RESULT-shaped router
    // response includes oem_request_url; the bare unavailable() default of
    // null would otherwise silently drop it, same spread pattern as the
    // notFound() branch below).
    return { ...unavailable(str(body.reason_detail) || UNAVAILABLE), oemRequestUrl: requestUrl(body) };
  }
  const c = (body.candidate ?? null) as Record<string, unknown> | null;
  const url = c ? str(c.url) : null;
  if (body.found !== true || !url) {
    // Prefer the judge's human line ("Read the PDF: a newspaper article…") over
    // the code ("judged_not_applicable") — the phone renders this verbatim.
    return {
      ...notFound(str(body.reason_detail) || str(body.reason) || NO_MANUAL),
      oemRequestUrl: requestUrl(body),
    };
  }
  let host = c ? (str(c.host) ?? "") : "";
  if (!host) {
    try {
      host = new URL(url).hostname;
    } catch {
      return notFound("the search result was not a usable URL");
    }
  }

  const candidate: DiscoveryCandidate = {
    url,
    title: (c ? str(c.title) : null) ?? url,
    host,
    score: typeof c?.score === "number" ? c.score : 0,
    docType: c ? str(c.doc_type) : null,
    isDirectPdf: c?.is_direct_pdf === true,
    validated: c?.validated === true,
  };

  return {
    serviceAvailable: true,
    found: true,
    candidate,
    validated: body.validated === true || candidate.validated,
    isDirectPdf: body.is_direct_pdf === true || candidate.isDirectPdf,
    oemHost: body.oem_host === true,
    trustedDistributorHost: body.trusted_distributor_host === true,
    reason: str(body.reason_detail) || str(body.reason) || "candidate manual found",
    oemRequestUrl: requestUrl(body),
    quotaExceeded: false,
  };
}

// ── Download allowlist ───────────────────────────────────────────────────────

/**
 * Known OEM documentation hosts, used only to WIDEN the redirect allowlist for
 * a candidate that is already on one of them (e.g. literature.rockwellautomation.com
 * → rockwellautomation.com is a legitimate hop). It is never used to guess a
 * URL — discovery is the only source of URLs.
 */
const OEM_HOSTS: Record<string, string[]> = {
  "allen-bradley": ["rockwellautomation.com"],
  "allen bradley": ["rockwellautomation.com"],
  rockwell: ["rockwellautomation.com"],
  "rockwell automation": ["rockwellautomation.com"],
  automationdirect: ["automationdirect.com"],
  "automation direct": ["automationdirect.com"],
  durapulse: ["automationdirect.com"],
  siemens: ["siemens.com"],
  abb: ["abb.com"],
  "schneider electric": ["schneider-electric.com", "se.com"],
  schneider: ["schneider-electric.com", "se.com"],
  "sew-eurodrive": ["sew-eurodrive.com"],
  danfoss: ["danfoss.com"],
  yaskawa: ["yaskawa.com"],
  omron: ["omron.com"],
  festo: ["festo.com"],
  // SMC documentation lives on regional first-party hosts (static.smc.eu,
  // smcworld.com, content2.smcetech.com), not only smcusa.com.
  smc: ["smcusa.com", "smc.eu", "smcworld.com", "smcetech.com"],
  sick: ["sick.com"],
  banner: ["bannerengineering.com"],
  "mitsubishi electric": ["mitsubishielectric.com"],
  mitsubishi: ["mitsubishielectric.com"],
  parker: ["parker.com"],
  emerson: ["emerson.com"],
  "eaton": ["eaton.com"],
  wago: ["wago.com"],
  phoenix: ["phoenixcontact.com"],
  "phoenix contact": ["phoenixcontact.com"],
};

/**
 * The shared OEM maker table, read-only, for corpus-independent maker
 * recognition (Manual-First PRD R1, candidate-identity.ts). One table: the
 * same entries decide which hosts count as a maker's own documentation.
 */
export function oemMakerTable(): ReadonlyArray<{ name: string; domains: readonly string[] }> {
  return Object.entries(OEM_HOSTS).map(([name, domains]) => ({ name, domains }));
}

/**
 * Can WE independently confirm that `host` is this manufacturer's own
 * documentation domain — without taking the discovery service's word for it?
 *
 * This is a security gate, not a convenience (#3400). The confirm route uses it
 * to decide whether an UNVALIDATED candidate may be handed to safeDownloadPdf
 * at all. `allowedHostsForCandidate` below deliberately trusts the candidate's
 * own host, which is correct for a candidate that discovery already validated —
 * but it is NOT an independent check, so it cannot be the thing that authorises
 * relaxing the gate. This re-derives the answer from our own OEM table.
 *
 * Matching is exact-host or dot-suffix ONLY, so `notsiemens.com` and
 * `siemens.com.evil.net` both fail where a naive `endsWith` would pass.
 */
export function isOemDocumentationHost(
  manufacturer: string | null | undefined,
  host: string | null | undefined,
): boolean {
  const h = (host ?? "").trim().toLowerCase();
  const mfr = (manufacturer ?? "").trim().toLowerCase();
  if (!h || !mfr) return false;
  for (const [key, domains] of Object.entries(OEM_HOSTS)) {
    if (mfr !== key && !mfr.includes(key)) continue;
    for (const d of domains) {
      if (h === d || h.endsWith(`.${d}`)) return true;
    }
  }
  return false;
}

/**
 * The host allowlist for downloading ONE discovered candidate. Always includes
 * the candidate's own host (so subdomain redirects on that host are fine) plus
 * the manufacturer's known documentation domains — nothing else. A redirect off
 * this list is rejected by safeDownloadPdf.
 */
export function allowedHostsForCandidate(
  identity: DiscoveryIdentity,
  candidate: Pick<DiscoveryCandidate, "host">,
): string[] {
  const hosts = new Set<string>();
  const h = (candidate.host ?? "").trim().toLowerCase();
  if (h) {
    hosts.add(h);
    // The registrable parent of the candidate host, so `literature.oem.com` can
    // redirect to `oem.com`. Two labels only — deliberately conservative.
    const labels = h.split(".");
    if (labels.length > 2) hosts.add(labels.slice(-2).join("."));
  }
  const mfr = (identity.manufacturer ?? "").trim().toLowerCase();
  if (mfr) {
    for (const [key, domains] of Object.entries(OEM_HOSTS)) {
      if (mfr === key || mfr.includes(key)) domains.forEach((d) => hosts.add(d));
    }
  }
  return [...hosts];
}
