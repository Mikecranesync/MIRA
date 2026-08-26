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
 * X-Mira-Key, AbortSignal.timeout, any failure falls through.
 */

export interface DiscoveryIdentity {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
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
 */
export async function discoverManual(identity: DiscoveryIdentity): Promise<DiscoveryResult> {
  const manufacturer = str(identity.manufacturer);
  const model = str(identity.model);
  const catalogNumber = str(identity.catalogNumber);
  if (!manufacturer || !(model || catalogNumber)) {
    return notFound("manufacturer and model are required to search for a manual");
  }

  const base = (process.env.MIRA_ASK_URL ?? DEFAULT_ASK_URL).replace(/\/+$/, "");
  let raw: unknown;
  try {
    const resp = await fetch(`${base}/manual-discovery/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ASK_API_KEY ? { "X-Mira-Key": process.env.ASK_API_KEY } : {}),
      },
      body: JSON.stringify({
        manufacturer,
        model: model ?? catalogNumber,
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
  const c = (body.candidate ?? null) as Record<string, unknown> | null;
  const url = c ? str(c.url) : null;
  if (body.found !== true || !url) {
    return notFound(str(body.reason) ?? NO_MANUAL);
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
