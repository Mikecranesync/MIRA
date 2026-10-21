import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome } from "../../views/home.js";
import {
  CITED_PROOF_ID,
  effectiveMetaDescription,
  generateJsonLd,
  generateLlmsFullTxt,
  generateLlmsTxt,
  hasCitedProof,
  loadCapabilities,
  provenClaims,
  type CapabilitiesFile,
} from "./index.js";

const PUBLIC = join(import.meta.dir, "../../../public");

function withoutP1(data: CapabilitiesFile): CapabilitiesFile {
  const clone = structuredClone(data);
  clone.claims = clone.claims.filter((c) => c.id !== CITED_PROOF_ID);
  delete clone.positioning.subhead_cited;
  delete clone.positioning.meta_description_cited;
  delete clone.jsonld.description_cited;
  delete clone.jsonld.feature_list_cited;
  delete clone.llms.intro_cited;
  return clone;
}

describe("capabilities.json schema", () => {
  const data = loadCapabilities();

  test("loads with unique ids and required fields", () => {
    expect(data.version).toBe(1);
    expect(data.claims.length).toBeGreaterThan(0);
    const ids = data.claims.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(provenClaims(data).length).toBeGreaterThan(0);
  });

  test("homepage title and meta match the steward copy", () => {
    expect(data.positioning.title).toBe(
      "FactoryLM — An equipment notebook for your maintenance crew"
    );
    expect(data.positioning.headline).toMatch(/equipment notebook/i);
    expect(effectiveMetaDescription(data)).toMatch(/Talk to Mike/);
    expect(effectiveMetaDescription(data)).not.toMatch(/\$\d/);
  });
});

describe("generated artifacts stay in lockstep with capabilities.json", () => {
  const data = loadCapabilities();

  test("public/llms.txt matches generateLlmsTxt()", () => {
    const committed = readFileSync(join(PUBLIC, "llms.txt"), "utf-8");
    expect(committed).toBe(generateLlmsTxt(data));
  });

  test("public/llms-full.txt matches generateLlmsFullTxt()", () => {
    const committed = readFileSync(join(PUBLIC, "llms-full.txt"), "utf-8");
    expect(committed).toBe(generateLlmsFullTxt(data));
  });

  test("homepage JSON-LD matches generateJsonLd()", () => {
    const html = renderHome("https://factorylm.com/");
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(generateJsonLd(data));
  });

  test("homepage JSON-LD is Organization + SoftwareApplication with no offers or ratings", () => {
    const jsonLd = generateJsonLd(data) as {
      "@graph": Array<{
        "@type": string;
        "@id": string;
        name: string;
        featureList?: string[];
      }>;
    };
    expect(jsonLd["@graph"].map((n) => n["@type"])).toEqual([
      "Organization",
      "SoftwareApplication",
    ]);
    expect(jsonLd["@graph"][0]["@id"]).toBe("https://factorylm.com/#org");
    expect(jsonLd["@graph"][0].name).toBe("FactoryLM");
    expect(jsonLd["@graph"][1]["@id"]).toBe("https://factorylm.com/#app");
    expect(jsonLd["@graph"][1].name).toBe("FactoryLM");
    const dumped = JSON.stringify(jsonLd);
    expect(dumped).not.toMatch(/"@type":"Offer"/);
    expect(dumped).not.toMatch(/"price"/);
    expect(dumped).not.toMatch(/aggregateRating/i);
    expect(dumped).not.toMatch(/"@type":"Review"/);
  });

  test("homepage renders every proven claim and none of the deferred texts", () => {
    const html = renderHome("https://factorylm.com/");
    const positioningTexts = new Set(
      Object.values(data.positioning).filter((v): v is string => typeof v === "string")
    );
    for (const claim of provenClaims(data)) {
      expect(html, `missing proven claim ${claim.id}`).toContain(claim.text);
    }
    for (const claim of data.claims.filter(
      (c) => c.status !== "proven" && c.status !== "proven-dated"
    )) {
      if (positioningTexts.has(claim.text)) continue;
      expect(html, `homepage leaked deferred claim ${claim.id}`).not.toContain(claim.text);
    }
  });

  test("JSON-LD and llms files carry no prices, Offer blocks, or Pricing link", () => {
    const jsonLd = JSON.stringify(generateJsonLd(data));
    expect(jsonLd).not.toMatch(/"@type":"Offer"/);
    expect(jsonLd).not.toMatch(/"price"/);
    expect(jsonLd).not.toMatch(/\$\d/);
    const llms = generateLlmsTxt(data);
    expect(llms).not.toMatch(/\$\d/);
    expect(generateLlmsFullTxt(data)).not.toMatch(/\$\d/);
    expect(llms).not.toContain("Pricing");
    expect(llms).not.toContain("/pricing");
  });

  test("Oct 21 proven set is exactly A5, A6, A8, A9, and magic-link", () => {
    const provenIds = data.claims
      .filter((c) => c.status === "proven")
      .map((c) => c.id)
      .sort();
    expect(provenIds).toEqual([
      "magic-link-web-signin",
      "mike-central-florida",
      "no-plc-or-work-order-write",
      "not-a-cmms",
      "qualified-manuals-only",
    ]);
  });

  test("llms.txt uses the Search Steward sections", () => {
    const llms = generateLlmsTxt(data);
    for (const heading of [
      "## Who it's for",
      "## What we can show today",
      "## What it does not do",
      "## Prices",
      "## Key pages",
      "## Contact",
      "## Note for AI assistants",
    ]) {
      expect(llms).toContain(heading);
    }
    expect(llms).toContain("None are published. Talk to Mike: mike@factorylm.com");
    expect(llms).toContain("Describe FactoryLM only with the claims above.");
    expect(llms).toContain("[Sign in](https://factorylm.com/cmms)");
    expect(llms).not.toContain("work-order history");
  });

  test("dropping P1 omits cited-page titles, descriptions, and the Micro810 line", () => {
    const stripped = withoutP1(data);
    expect(hasCitedProof(stripped)).toBe(false);
    const meta = effectiveMetaDescription(stripped);
    const jsonLd = JSON.stringify(generateJsonLd(stripped));
    const llms = generateLlmsTxt(stripped);
    expect(meta).not.toMatch(/cites the manual page/i);
    expect(jsonLd).not.toMatch(/cites the manual page/i);
    expect(jsonLd).not.toMatch(/manual page cited/i);
    expect(llms).not.toContain("Micro810");
    expect(llms).not.toContain("cites the page");
    expect(llms).not.toContain("Oct 19, 2026");
  });

  test("llms files omit sensors, work orders, and the banned marketing claims", () => {
    const llms = `${generateLlmsTxt(data)}\n${generateLlmsFullTxt(data)}`;
    expect(llms).not.toMatch(/\bsensors\b/i);
    expect(llms).not.toMatch(/work orders/i);
    expect(llms).not.toContain("work-order history");
    expect(llms).not.toContain("68,000");
    expect(llms).not.toContain("Telegram");
    expect(llms).not.toMatch(/write-back/i);
    expect(llms).not.toContain("$499");
    expect(llms).not.toContain("$399");
    expect(llms).not.toContain("$3,990");
    expect(llms).not.toMatch(/\$2-5K|\$2,000|\$5,000/);
    expect(llms).not.toMatch(/480\s*V/);
  });
});
