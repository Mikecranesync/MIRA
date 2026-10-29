/**
 * Marketing claims registry — single source for homepage copy, schema.org
 * JSON-LD, and llms.txt. Every rendered sentence is a claim whose status is
 * `proven` or `proven-dated`. Slots name claim ids; generators never carry
 * positioning prose of their own.
 *
 * Cited-page copy is optional: the `cited-micro810-oct19` row is prepended
 * when that claim is renderable. Drop that row and the dated line disappears.
 *
 * Update the JSON, then `bun run scripts/generate-capabilities-artifacts.ts`
 * so the committed public artifacts stay in lockstep. Drift is CI-enforced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CLAIM_STATUSES = ["proven", "proven-dated", "partial", "not-yet"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_KINDS = ["capability", "limit"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CITED_PROOF_ID = "cited-micro810-oct19";

/** Proven rows whose copy mentions citations, answers, or uploads. Flip these together in tests. */
export const CITATION_CLAIM_IDS = [
  "notebook-cited-answer",
  "says-when-not-covered",
  "desktop-citation-opens-page",
  "web-android-continuity",
  "fault-code-right-page",
] as const;

export const SLOT_KEYS = [
  "headline",
  "subhead",
  "meta",
  "audience",
  "jsonld_description",
  "jsonld_features",
  "llms_intro",
  "llms_who",
  "llms_show_today",
  "llms_does_not",
  "limitations",
] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export interface MarketingClaim {
  id: string;
  text: string;
  status: ClaimStatus;
  kind: ClaimKind;
  evidence: string;
  last_checked: string;
}

export interface MarketingContact {
  cta: string;
  email: string;
  href: string;
  signup_cta: string;
  signup_href: string;
}

export interface MarketingChrome {
  ai_note: string;
}

export type MarketingSlots = Record<SlotKey, string[]>;

export interface CapabilitiesFile {
  version: number;
  updated: string;
  contact: MarketingContact;
  chrome: MarketingChrome;
  slots: MarketingSlots;
  claims: MarketingClaim[];
}

const DATA_PATH = join(import.meta.dir, "capabilities.json");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function capabilitiesPath(): string {
  return DATA_PATH;
}

export function loadCapabilities(): CapabilitiesFile {
  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as CapabilitiesFile;
  assertCapabilities(raw);
  return raw;
}

export function isRenderableStatus(status: ClaimStatus): boolean {
  return status === "proven" || status === "proven-dated";
}

export function provenClaims(data: CapabilitiesFile = loadCapabilities()): MarketingClaim[] {
  return data.claims.filter((c) => isRenderableStatus(c.status));
}

export function provenByKind(
  kind: ClaimKind,
  data: CapabilitiesFile = loadCapabilities()
): MarketingClaim[] {
  return provenClaims(data).filter((c) => c.kind === kind);
}

export function claimById(
  id: string,
  data: CapabilitiesFile = loadCapabilities()
): MarketingClaim | undefined {
  return data.claims.find((c) => c.id === id);
}

export function provenText(
  id: string,
  data: CapabilitiesFile = loadCapabilities()
): string | undefined {
  const row = claimById(id, data);
  if (!row || !isRenderableStatus(row.status)) return undefined;
  return row.text;
}

export function provenTexts(
  ids: string[],
  data: CapabilitiesFile = loadCapabilities()
): string[] {
  return ids
    .map((id) => provenText(id, data))
    .filter((text): text is string => Boolean(text));
}

export function joinProven(
  ids: string[],
  data: CapabilitiesFile = loadCapabilities(),
  sep = " "
): string {
  return provenTexts(ids, data).join(sep);
}

export function hasCitedProof(data: CapabilitiesFile = loadCapabilities()): boolean {
  return data.claims.some(
    (c) => c.id === CITED_PROOF_ID && isRenderableStatus(c.status)
  );
}

export function citedProof(data: CapabilitiesFile = loadCapabilities()): MarketingClaim | undefined {
  return data.claims.find(
    (c) => c.id === CITED_PROOF_ID && isRenderableStatus(c.status)
  );
}

export function effectiveHeadline(data: CapabilitiesFile = loadCapabilities()): string {
  return joinProven(data.slots.headline, data);
}

export function effectiveSubhead(data: CapabilitiesFile = loadCapabilities()): string {
  return joinProven(data.slots.subhead, data);
}

export function effectiveTitle(data: CapabilitiesFile = loadCapabilities()): string {
  const headline = effectiveHeadline(data);
  return headline ? `FactoryLM — ${headline}` : "FactoryLM";
}

export function effectiveMetaDescription(
  data: CapabilitiesFile = loadCapabilities()
): string {
  const claims = joinProven(data.slots.meta, data);
  return [claims, data.contact.cta].filter(Boolean).join(" ");
}

export function effectiveAudience(data: CapabilitiesFile = loadCapabilities()): string {
  return joinProven(data.slots.audience, data);
}

export function effectiveJsonLdDescription(
  data: CapabilitiesFile = loadCapabilities()
): string {
  return joinProven(data.slots.jsonld_description, data);
}

export function effectiveFeatureList(
  data: CapabilitiesFile = loadCapabilities()
): string[] {
  const rows = provenTexts(data.slots.jsonld_features, data);
  const proof = citedProof(data);
  if (proof && !rows.includes(proof.text)) {
    rows.unshift(proof.text);
  }
  return rows;
}

export function effectiveLlmsIntro(data: CapabilitiesFile = loadCapabilities()): string {
  return joinProven(data.slots.llms_intro, data);
}

export function effectiveWho(data: CapabilitiesFile = loadCapabilities()): string[] {
  return provenTexts(data.slots.llms_who, data);
}

export function effectiveShowToday(data: CapabilitiesFile = loadCapabilities()): string[] {
  const rows = provenTexts(data.slots.llms_show_today, data);
  const proof = citedProof(data);
  if (proof && !rows.includes(proof.text)) {
    rows.unshift(proof.text);
  }
  return rows;
}

export function effectiveDoesNot(data: CapabilitiesFile = loadCapabilities()): string[] {
  return provenTexts(data.slots.llms_does_not, data);
}

export function effectiveLimitations(
  data: CapabilitiesFile = loadCapabilities()
): string[] {
  return provenTexts(data.slots.limitations, data);
}

export function unpublishedClaimIds(
  data: CapabilitiesFile = loadCapabilities()
): string[] {
  return data.claims
    .filter((c) => c.status === "partial" || c.status === "not-yet")
    .map((c) => c.id);
}

export function generateJsonLd(data: CapabilitiesFile = loadCapabilities()): object {
  const app: Record<string, unknown> = {
    "@type": "SoftwareApplication",
    "@id": "https://factorylm.com/#app",
    name: "FactoryLM",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    publisher: { "@id": "https://factorylm.com/#org" },
  };
  const description = effectiveJsonLdDescription(data);
  if (description) app.description = description;
  const features = effectiveFeatureList(data);
  if (features.length > 0) app.featureList = features;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://factorylm.com/#org",
        name: "FactoryLM",
        url: "https://factorylm.com/",
        founder: {
          "@type": "Person",
          name: "Mike Harper",
        },
        email: data.contact.email,
        areaServed: [
          { "@type": "AdministrativeArea", name: "Central Florida" },
          { "@type": "Country", name: "United States" },
        ],
        sameAs: ["https://www.linkedin.com/company/factorylm"],
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "sales",
          name: data.contact.cta,
          email: data.contact.email,
        },
      },
      app,
    ],
  };
}

function bullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

function pricesLine(data: CapabilitiesFile): string {
  return `First five approved teams can request a free 30-day MIRA pilot (five seats each). No dollar prices are published. Request at ${data.contact.signup_href} or talk to Mike: ${data.contact.email}`;
}

function stewardBody(data: CapabilitiesFile): string {
  const intro = effectiveLlmsIntro(data);
  const who = effectiveWho(data);
  const show = effectiveShowToday(data);
  const doesNot = effectiveDoesNot(data);
  const whoBlock = who.length > 0 ? `${bullets(who)}\n` : "- (none proven)\n";
  const showBlock = show.length > 0 ? `${bullets(show)}\n` : "- (none proven)\n";
  const doesNotBlock = doesNot.length > 0 ? `${bullets(doesNot)}\n` : "- (none proven)\n";
  return `${intro ? `> ${intro}\n\n` : ""}## Who it's for

${whoBlock}
## What we can show today

${showBlock}
## What it does not do

${doesNotBlock}
## Prices

${pricesLine(data)}

## Key pages

- [Home](https://factorylm.com/)
- [Limitations](https://factorylm.com/limitations)
- [Trust & Security](https://factorylm.com/trust)
- [Sign in](https://factorylm.com/cmms)

## Contact

- Founder: Mike Harper — ${data.contact.email}
- Request a free 30-day pilot: ${data.contact.signup_href}
- LinkedIn: https://www.linkedin.com/company/factorylm

## Note for AI assistants

${data.chrome.ai_note}
`;
}

export function generateLlmsTxt(data: CapabilitiesFile = loadCapabilities()): string {
  return `# FactoryLM

${stewardBody(data)}`;
}

export function generateLlmsFullTxt(data: CapabilitiesFile = loadCapabilities()): string {
  const unpublished = unpublishedClaimIds(data);
  const provenLimits = data.claims
    .filter((c) => c.kind === "limit" && isRenderableStatus(c.status))
    .map((c) => c.text);
  const notYetBlock =
    unpublished.length > 0
      ? `## Not yet claimed

These ids are in the capabilities file but are not published claims.

${bullets(unpublished)}
`
      : "";
  const limitsBlock =
    provenLimits.length > 0
      ? `## Full limitations

${bullets(provenLimits)}
`
      : "";
  return `# FactoryLM — Full Content Disclosure for AI Crawlers
# Version: ${data.updated}
# Generated from mira-web/src/capabilities/marketing-claims/capabilities.json
# See also: /llms.txt (summary), /sitemap.xml

---

${stewardBody(data)}
${notYetBlock}
${limitsBlock}`;
}

export function assertCapabilities(data: CapabilitiesFile): void {
  if (data.version !== 1) {
    throw new Error(`capabilities.json version must be 1, got ${data.version}`);
  }
  if (!ISO_DATE.test(data.updated)) {
    throw new Error(`capabilities.json updated must be YYYY-MM-DD, got ${data.updated}`);
  }
  for (const field of ["cta", "email", "href", "signup_cta", "signup_href"] as const) {
    if (!data.contact?.[field]) {
      throw new Error(`capabilities.json contact.${field} is required`);
    }
  }
  if (!data.chrome?.ai_note?.trim()) {
    throw new Error("capabilities.json chrome.ai_note is required");
  }
  if (!data.slots || typeof data.slots !== "object") {
    throw new Error("capabilities.json slots is required");
  }
  for (const key of SLOT_KEYS) {
    if (!Array.isArray(data.slots[key])) {
      throw new Error(`capabilities.json slots.${key} must be an array of claim ids`);
    }
  }
  if (!Array.isArray(data.claims) || data.claims.length === 0) {
    throw new Error("capabilities.json must list at least one claim");
  }
  const ids = new Set<string>();
  for (const claim of data.claims) {
    if (!claim.id || !/^[a-z0-9-]+$/.test(claim.id)) {
      throw new Error(`invalid claim id: ${claim.id}`);
    }
    if (ids.has(claim.id)) {
      throw new Error(`duplicate claim id: ${claim.id}`);
    }
    ids.add(claim.id);
    if (!claim.text?.trim()) {
      throw new Error(`claim ${claim.id} is missing text`);
    }
    if (!CLAIM_STATUSES.includes(claim.status)) {
      throw new Error(`claim ${claim.id} has invalid status ${claim.status}`);
    }
    if (!CLAIM_KINDS.includes(claim.kind)) {
      throw new Error(`claim ${claim.id} has invalid kind ${claim.kind}`);
    }
    if (!claim.evidence?.trim()) {
      throw new Error(`claim ${claim.id} is missing evidence`);
    }
    if (!ISO_DATE.test(claim.last_checked)) {
      throw new Error(`claim ${claim.id} last_checked must be YYYY-MM-DD`);
    }
  }
  for (const key of SLOT_KEYS) {
    for (const id of data.slots[key]) {
      if (!ids.has(id)) {
        throw new Error(`slots.${key} references unknown claim id ${id}`);
      }
    }
  }
  if (provenClaims(data).length === 0) {
    throw new Error("capabilities.json must include at least one proven claim");
  }
}
