import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome } from "../../views/home.js";
import { renderLimitations } from "../../views/limitations.js";
import { escHtml } from "../../lib/html.js";
import {
  CITATION_CLAIM_IDS,
  CITED_PROOF_ID,
  effectiveFeatureList,
  effectiveHeadline,
  effectiveJsonLdDescription,
  effectiveMetaDescription,
  effectiveTitle,
  generateJsonLd,
  generateLlmsFullTxt,
  generateLlmsTxt,
  hasCitedProof,
  loadCapabilities,
  provenClaims,
  type CapabilitiesFile,
} from "./index.js";

const PUBLIC = join(import.meta.dir, "../../../public");

function readPricing(): string {
  return readFileSync(join(PUBLIC, "pricing.html"), "utf-8");
}

function publishedSurfaces(data: CapabilitiesFile): string[] {
  const home = renderHome("https://factorylm.com/", data);
  const limitations = renderLimitations("https://factorylm.com/limitations", data);
  const jsonLd = JSON.stringify(generateJsonLd(data));
  const meta = effectiveMetaDescription(data);
  const llms = generateLlmsTxt(data);
  const full = generateLlmsFullTxt(data);
  // Codex F1: /pricing is a public marketing surface. It is static HTML, so it
  // must not carry claim sentences (proven or not); the flip contract still
  // scans it so a leaked unpublished sentence fails the same way home does.
  return [home, limitations, jsonLd, meta, llms, full, readPricing()];
}

// Paraphrases of unpublished notebook claims. capabilities.json marks
// notebook-for-one-crew and notebook-open-lookup-ask-record as partial;
// /pricing used to publish both in other words (Codex F1 on #4570).
const UNPUBLISHED_NOTEBOOK_PARAPHRASES: Array<{
  ids: string[];
  label: string;
  re: RegExp;
}> = [
  {
    ids: ["notebook-for-one-crew"],
    label: "one-crew / your-crew equipment-notebook pitch",
    re: /equipment notebook for (?:your|one) maintenance crew/i,
  },
  {
    ids: ["notebook-for-one-crew"],
    label: "equipment-notebook pilot for one crew",
    re: /equipment-notebook (?:pilot )?for one crew/i,
  },
  {
    ids: ["notebook-open-lookup-ask-record"],
    label: "open / find / ask / record workflow",
    re: /Open the machine's notebook, find the right manual passage, ask a question, and record what fixed it/,
  },
  {
    ids: ["notebook-open-lookup-ask-record"],
    label: "open/find/ask/record fragments",
    re: /Open the machine's notebook|find the right manual passage|record what fixed it/i,
  },
];

describe("capabilities.json schema", () => {
  const data = loadCapabilities();

  test("loads with unique ids and required fields", () => {
    expect(data.version).toBe(1);
    expect(data.claims.length).toBeGreaterThan(0);
    const ids = data.claims.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(provenClaims(data).length).toBeGreaterThan(0);
  });

  test("homepage title and meta come from proven claim slots", () => {
    expect(effectiveTitle(data)).toBe(`FactoryLM — ${effectiveHeadline(data)}`);
    expect(effectiveHeadline(data)).toMatch(/equipment notebook/i);
    expect(effectiveHeadline(data)).toMatch(/cites the page/i);
    expect(effectiveHeadline(data)).not.toMatch(/every answer/i);
    expect(effectiveMetaDescription(data)).toMatch(/Talk to Mike/);
    expect(effectiveMetaDescription(data)).not.toMatch(/\$\d/);
    expect(data.contact.signup_cta).toMatch(/free 30-day pilot/i);
    expect(data.contact.signup_href).toContain("app.factorylm.com/signup");
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
    for (const claim of provenClaims(data)) {
      expect(html, `missing proven claim ${claim.id}`).toContain(escHtml(claim.text));
    }
    for (const claim of data.claims.filter(
      (c) => c.status !== "proven" && c.status !== "proven-dated"
    )) {
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

  test("Oct 29 proven set is P1–P10 (notebook cited answer, limits, manuals, P7–P10)", () => {
    const provenIds = data.claims
      .filter((c) => c.status === "proven")
      .map((c) => c.id)
      .sort();
    expect(provenIds).toEqual([
      "desktop-citation-opens-page",
      "equipment-notebook-not-cmms",
      "fault-code-right-page",
      "magic-link-web-signin",
      "mike-central-florida",
      "no-plc-or-work-order-write",
      "not-a-cmms",
      "notebook-cited-answer",
      "qualified-manuals-only",
      "says-when-not-covered",
      "web-android-continuity",
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
    expect(llms).toContain("First five approved teams can request a free 30-day MIRA pilot");
    expect(llms).toContain("No dollar prices are published");
    expect(llms).toContain("Describe FactoryLM only with the claims above.");
    expect(llms).toContain("[Sign in](https://factorylm.com/cmms)");
    expect(llms).toContain("https://app.factorylm.com/signup");
    expect(llms).not.toContain("work-order history");
    expect(llms).not.toMatch(/\$\d/);
  });

  test("/pricing is a published surface and drops unpublished notebook claims", () => {
    const pricing = readPricing();
    expect(publishedSurfaces(data)).toContain(pricing);
    for (const claim of data.claims.filter(
      (c) => c.status === "partial" || c.status === "not-yet"
    )) {
      expect(pricing, `/pricing leaked unpublished ${claim.id}`).not.toContain(
        claim.text
      );
    }
    for (const rule of UNPUBLISHED_NOTEBOOK_PARAPHRASES) {
      expect(pricing, `/pricing still has ${rule.label}`).not.toMatch(rule.re);
    }
    // D1 offer stays; this test only gates capability claims.
    expect(pricing).not.toMatch(/\$[\d,]+/);
    expect(pricing).toContain("free 30-day pilot");
    expect(pricing).toContain("https://app.factorylm.com/signup");
    expect(pricing).not.toContain("Find reliable answers in your own equipment manuals");
  });

  test("/pricing JSON-LD, body, and FAQ are backed by approved offers and connectors_note", () => {
    const pricing = readPricing();
    expect(data.chrome.connectors_note).toMatch(/optional/i);
    expect(data.chrome.connectors_note).toMatch(/not yet available/i);
    expect(data.chrome.connectors_note).toMatch(/MIRA stands alone/i);
    expect(pricing).toContain(data.chrome.connectors_note);
    for (const offer of data.offers.filter((o) => o.status === "approved")) {
      expect(pricing, `/pricing missing offer ${offer.id}`).toContain(offer.text);
    }
    const lifetime = data.offers.find((o) => o.id === "limited-free-lifetime-credit");
    expect(lifetime?.text).toMatch(/limited free lifetime credit/i);
    expect(lifetime?.text).not.toMatch(/\$\d/);
  });

  test("without citation claims, generated surfaces drop cites/answers-from wording", () => {
    const stripped = structuredClone(data);
    for (const id of CITATION_CLAIM_IDS) {
      const row = stripped.claims.find((c) => c.id === id);
      expect(row, `missing citation claim ${id}`).toBeDefined();
      row!.status = "partial";
    }
    const optional = stripped.claims.find((c) => c.id === CITED_PROOF_ID);
    if (optional) optional.status = "partial";
    expect(hasCitedProof(stripped)).toBe(false);
    for (const claim of provenClaims(stripped)) {
      expect(claim.text, `proven ${claim.id} uses answers/cites/uploads`).not.toMatch(
        /\banswers\b|\bcites?\b|\buploads?\b/i
      );
    }
    const generated = [
      JSON.stringify(generateJsonLd(stripped)),
      effectiveMetaDescription(stripped),
      generateLlmsTxt(stripped),
      generateLlmsFullTxt(stripped),
      renderHome("https://factorylm.com/", stripped),
      renderLimitations("https://factorylm.com/limitations", stripped),
    ];
    for (const surface of generated) {
      expect(surface, "without citation claims leaked cites").not.toMatch(/\bcites?\b/i);
      expect(surface, "without citation claims leaked answers from").not.toMatch(
        /answers from/i
      );
      expect(surface, "without citation claims leaked uploaded-manual answers").not.toMatch(
        /uploaded manual/i
      );
    }
    expect(effectiveFeatureList(stripped).join("\n")).not.toMatch(/cites|answers from/i);
    expect(generateLlmsTxt(stripped)).not.toContain("Micro810");
    expect(generateLlmsFullTxt(stripped)).not.toContain("Micro810");
  });

  test("llms-full.txt is fuller than llms.txt: unpublished ids plus proven limitations", () => {
    const summary = generateLlmsTxt(data);
    const full = generateLlmsFullTxt(data);
    expect(full.length).toBeGreaterThan(summary.length);
    expect(full).toContain("## Not yet claimed");
    expect(full).toContain("## Full limitations");
    expect(full).toContain(summary.replace(/^# FactoryLM\n\n/, ""));
    for (const claim of data.claims.filter(
      (c) => c.status === "partial" || c.status === "not-yet"
    )) {
      expect(full, `llms-full missing unpublished id ${claim.id}`).toContain(
        `- ${claim.id}`
      );
      expect(full, `llms-full leaked unpublished text ${claim.id}`).not.toContain(
        claim.text
      );
    }
    for (const claim of data.claims.filter(
      (c) => c.kind === "limit" && (c.status === "proven" || c.status === "proven-dated")
    )) {
      expect(full, `llms-full missing limitation ${claim.id}`).toContain(claim.text);
    }
    expect(full).not.toMatch(/\$\d/);
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

describe("flipping a claim to partial removes its sentence from every published surface", () => {
  const data = loadCapabilities();

  for (const claim of data.claims) {
    test(`${claim.id} disappears from home, limitations, JSON-LD, meta, llms, and /pricing when partial`, () => {
      const flipped = structuredClone(data);
      const row = flipped.claims.find((c) => c.id === claim.id);
      expect(row).toBeDefined();
      row!.status = "partial";
      for (const surface of publishedSurfaces(flipped)) {
        expect(surface, `${claim.id} still published after flip`).not.toContain(
          claim.text
        );
        for (const rule of UNPUBLISHED_NOTEBOOK_PARAPHRASES) {
          if (!rule.ids.includes(claim.id)) continue;
          expect(
            surface,
            `${claim.id} paraphrase still published after flip: ${rule.label}`
          ).not.toMatch(rule.re);
        }
      }
      expect(effectiveHeadline(flipped)).not.toContain(claim.text);
      expect(effectiveTitle(flipped)).not.toContain(claim.text);
      expect(effectiveJsonLdDescription(flipped)).not.toContain(claim.text);
      expect(effectiveFeatureList(flipped).join("\n")).not.toContain(claim.text);
    });
  }
});
