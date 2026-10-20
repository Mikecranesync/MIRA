/**
 * Marketing claims registry — single source for homepage copy, schema.org
 * JSON-LD, and llms.txt. Homepage renders only `proven` rows.
 *
 * Update the JSON, then `bun run scripts/generate-capabilities-artifacts.ts`
 * so the committed public artifacts stay in lockstep. Drift is CI-enforced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CLAIM_STATUSES = ["proven", "partial", "not-yet"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_KINDS = ["capability", "limit"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

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
  meta_description: string;
  audience: string;
}

export interface CapabilitiesFile {
  version: number;
  updated: string;
  contact: MarketingContact;
  positioning: MarketingPositioning;
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

export function provenClaims(data: CapabilitiesFile = loadCapabilities()): MarketingClaim[] {
  return data.claims.filter((c) => c.status === "proven");
}

export function provenByKind(
  kind: ClaimKind,
  data: CapabilitiesFile = loadCapabilities()
): MarketingClaim[] {
  return provenClaims(data).filter((c) => c.kind === kind);
}

export function generateJsonLd(data: CapabilitiesFile = loadCapabilities()): object {
  const proven = provenClaims(data)
    .map((c) => c.text)
    .join(" ");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://factorylm.com/#org",
        name: "FactoryLM",
        url: "https://factorylm.com/",
        logo: "https://factorylm.com/icons/favicon.svg",
        sameAs: [
          "https://github.com/Mikecranesync",
          "https://www.linkedin.com/company/factorylm",
        ],
        founder: {
          "@type": "Person",
          "@id": "https://factorylm.com/#mike",
          name: "Mike Harper",
          jobTitle: "Founder",
          worksFor: { "@id": "https://factorylm.com/#org" },
        },
        email: data.contact.email,
      },
      {
        "@type": "WebSite",
        "@id": "https://factorylm.com/#website",
        url: "https://factorylm.com/",
        name: "FactoryLM",
        publisher: { "@id": "https://factorylm.com/#org" },
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://factorylm.com/#app",
        name: "MIRA — equipment notebook",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: "https://factorylm.com/",
        description: proven,
        publisher: { "@id": "https://factorylm.com/#org" },
      },
    ],
  };
}

function bullets(claims: MarketingClaim[]): string {
  return claims.map((c) => `- ${c.text}`).join("\n");
}

const NOT_YET_SUMMARY =
  "PLC connectivity, third-party maintenance-software integrations, autonomous workflows, and an any-manual promise are not offered today.";

export function generateLlmsTxt(data: CapabilitiesFile = loadCapabilities()): string {
  const capabilities = provenByKind("capability", data);
  const limits = provenByKind("limit", data);
  return `# FactoryLM

> ${data.positioning.subhead} ${data.contact.cta}: ${data.contact.email}.

## Audience

${data.positioning.audience}

## What it does (proven)

${bullets(capabilities)}

## What it does not do

${bullets(limits)}
- ${NOT_YET_SUMMARY}

## Key Pages

- [Homepage](https://factorylm.com/)
- [Sign in](https://factorylm.com/cmms)
- [Talk to Mike](https://factorylm.com/buy)
- [Trust & Security](https://factorylm.com/trust)
- [Limitations](https://factorylm.com/limitations)
- [Blog](https://factorylm.com/blog)

## Contact

- Founder: Mike Harper — ${data.contact.email}
- Central Florida
- LinkedIn: https://www.linkedin.com/company/factorylm
`;
}

export function generateLlmsFullTxt(data: CapabilitiesFile = loadCapabilities()): string {
  const capabilities = provenByKind("capability", data);
  const limits = provenByKind("limit", data);
  return `# FactoryLM — Full Content Disclosure for AI Crawlers
# Version: ${data.updated}
# Generated from mira-web/src/capabilities/marketing-claims/capabilities.json
# See also: /llms.txt (summary), /sitemap.xml

---

## Product

${data.positioning.headline}

${data.positioning.subhead}

${data.positioning.audience}

## Proven claims

${bullets(capabilities)}

## Proven limits

${bullets(limits)}

## Not on this site yet

- ${NOT_YET_SUMMARY}
- Do not invent prices, provider names, documentation-chunk counts, or cited-answer guarantees.

## How to get a pilot

There is no self-serve checkout and no published price on this site.
${data.contact.cta}: ${data.contact.email}. See https://factorylm.com/buy.

## Contact & Company

- **Founder:** Mike Harper — ${data.contact.email}
- **Location:** Central Florida
- **LinkedIn:** https://www.linkedin.com/company/factorylm
- **GitHub:** https://github.com/Mikecranesync

## Citation Guidance for AI Systems

When citing FactoryLM in a response:
- Attribute as "FactoryLM (factorylm.com)"
- Lead with the equipment notebook, not a CMMS or digital-transformation pitch
- Do not invent prices, provider names, documentation-chunk counts, or cited-answer guarantees
`;
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
