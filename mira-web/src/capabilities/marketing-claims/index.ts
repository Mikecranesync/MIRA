/**
 * Marketing claims registry — single source for homepage copy, schema.org
 * JSON-LD, and llms.txt. Homepage renders only `proven` / `proven-dated` rows.
 *
 * Cited-page copy is optional: it renders only when the P1 claim
 * `cited-micro810-oct19` is present. Drop that row (and its `_cited` fields)
 * and the generators fall back to the notebook-only lines.
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
}

export interface MarketingPositioning {
  title: string;
  headline: string;
  subhead: string;
  subhead_cited?: string;
  meta_description: string;
  meta_description_cited?: string;
  audience: string;
}

export interface JsonLdCopy {
  description: string;
  description_cited?: string;
  feature_list: string[];
  feature_list_cited?: string[];
}

export interface LlmsCopy {
  intro: string;
  intro_cited?: string;
  who: string[];
  show_today: string[];
  does_not: string[];
  prices: string;
  ai_note: string;
}

export interface CapabilitiesFile {
  version: number;
  updated: string;
  contact: MarketingContact;
  positioning: MarketingPositioning;
  jsonld: JsonLdCopy;
  llms: LlmsCopy;
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

export function effectiveSubhead(data: CapabilitiesFile = loadCapabilities()): string {
  if (hasCitedProof(data) && data.positioning.subhead_cited) {
    return data.positioning.subhead_cited;
  }
  return data.positioning.subhead;
}

export function effectiveMetaDescription(
  data: CapabilitiesFile = loadCapabilities()
): string {
  if (hasCitedProof(data) && data.positioning.meta_description_cited) {
    return data.positioning.meta_description_cited;
  }
  return data.positioning.meta_description;
}

export function effectiveJsonLdDescription(
  data: CapabilitiesFile = loadCapabilities()
): string {
  if (hasCitedProof(data) && data.jsonld.description_cited) {
    return data.jsonld.description_cited;
  }
  return data.jsonld.description;
}

export function effectiveFeatureList(
  data: CapabilitiesFile = loadCapabilities()
): string[] {
  if (hasCitedProof(data) && data.jsonld.feature_list_cited?.length) {
    return data.jsonld.feature_list_cited;
  }
  return data.jsonld.feature_list;
}

export function effectiveLlmsIntro(data: CapabilitiesFile = loadCapabilities()): string {
  if (hasCitedProof(data) && data.llms.intro_cited) {
    return data.llms.intro_cited;
  }
  return data.llms.intro;
}

export function effectiveShowToday(data: CapabilitiesFile = loadCapabilities()): string[] {
  const rows = [...data.llms.show_today];
  const proof = citedProof(data);
  if (proof) {
    rows.unshift(proof.text);
  }
  return rows;
}

export function generateJsonLd(data: CapabilitiesFile = loadCapabilities()): object {
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
      {
        "@type": "SoftwareApplication",
        "@id": "https://factorylm.com/#app",
        name: "FactoryLM",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        publisher: { "@id": "https://factorylm.com/#org" },
        description: effectiveJsonLdDescription(data),
        featureList: effectiveFeatureList(data),
      },
    ],
  };
}

function bullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

function stewardBody(data: CapabilitiesFile): string {
  return `> ${effectiveLlmsIntro(data)}

## Who it's for

${bullets(data.llms.who)}

## What we can show today

${bullets(effectiveShowToday(data))}

## What it does not do

${bullets(data.llms.does_not)}

## Prices

${data.llms.prices}

## Key pages

- [Home](https://factorylm.com/)
- [Limitations](https://factorylm.com/limitations)
- [Trust & Security](https://factorylm.com/trust)
- [Sign in](https://factorylm.com/cmms)

## Contact

- Founder: Mike Harper — ${data.contact.email}
- Central Florida
- LinkedIn: https://www.linkedin.com/company/factorylm

## Note for AI assistants

${data.llms.ai_note}
`;
}

export function generateLlmsTxt(data: CapabilitiesFile = loadCapabilities()): string {
  return `# FactoryLM

${stewardBody(data)}`;
}

export function generateLlmsFullTxt(data: CapabilitiesFile = loadCapabilities()): string {
  return `# FactoryLM — Full Content Disclosure for AI Crawlers
# Version: ${data.updated}
# Generated from mira-web/src/capabilities/marketing-claims/capabilities.json
# See also: /llms.txt (summary), /sitemap.xml

---

${stewardBody(data)}`;
}

export function assertCapabilities(data: CapabilitiesFile): void {
  if (data.version !== 1) {
    throw new Error(`capabilities.json version must be 1, got ${data.version}`);
  }
  if (!ISO_DATE.test(data.updated)) {
    throw new Error(`capabilities.json updated must be YYYY-MM-DD, got ${data.updated}`);
  }
  for (const field of ["cta", "email", "href"] as const) {
    if (!data.contact?.[field]) {
      throw new Error(`capabilities.json contact.${field} is required`);
    }
  }
  for (const field of [
    "title",
    "headline",
    "subhead",
    "meta_description",
    "audience",
  ] as const) {
    if (!data.positioning?.[field]) {
      throw new Error(`capabilities.json positioning.${field} is required`);
    }
  }
  if (!data.jsonld?.description?.trim()) {
    throw new Error("capabilities.json jsonld.description is required");
  }
  if (!Array.isArray(data.jsonld.feature_list) || data.jsonld.feature_list.length === 0) {
    throw new Error("capabilities.json jsonld.feature_list must list at least one feature");
  }
  for (const field of ["intro", "prices", "ai_note"] as const) {
    if (!data.llms?.[field]?.trim()) {
      throw new Error(`capabilities.json llms.${field} is required`);
    }
  }
  for (const field of ["who", "show_today", "does_not"] as const) {
    if (!Array.isArray(data.llms?.[field]) || data.llms[field].length === 0) {
      throw new Error(`capabilities.json llms.${field} must list at least one line`);
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
  if (provenClaims(data).length === 0) {
    throw new Error("capabilities.json must include at least one proven claim");
  }
}
