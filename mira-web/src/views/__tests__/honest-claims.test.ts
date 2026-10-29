import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome } from "../home.js";
import { renderCmms, renderSamplePlaceholder } from "../cmms.js";
import { renderLimitations } from "../limitations.js";
import { renderSecurity } from "../security.js";
import { navbar, footer } from "../_topbar.js";
import { FEATURES, renderFeaturePage } from "../../lib/feature-renderer.js";
import {
  renderBlogIndex,
  renderBlogPost,
  renderFaultCodeIndex,
  renderFaultCodePage,
} from "../../lib/blog-renderer.js";
import type { BlogPost } from "../../data/blog-posts.js";
import type { FaultCode } from "../../data/fault-codes.js";
import { renderPrintsenseLanding } from "../../routes/printsense.js";

const PUBLIC_DIR = join(process.cwd(), "public");
const SRC_DIR = join(process.cwd(), "src");

function readPublic(file: string): string {
  return readFileSync(join(PUBLIC_DIR, file), "utf-8");
}

const RENDERER_POST: BlogPost = {
  slug: "honest-claims-renderer-fixture",
  title: "Renderer fixture",
  description: "Chrome-only fixture for the blog renderer CTA.",
  date: "2026-10-29",
  author: "FactoryLM",
  category: "Guides",
  readingTime: "1 min read",
  heroEmoji: "F",
  sections: [{ type: "paragraph", text: "Fixture body for renderer chrome." }],
  relatedPosts: [],
  relatedFaultCodes: [],
};

const RENDERER_FAULT: FaultCode = {
  slug: "honest-claims-fault-fixture",
  title: "Fixture fault",
  equipment: "Fixture drive",
  manufacturer: "Fixture",
  faultCode: "F000",
  description: "Fixture description.",
  commonCauses: ["Fixture cause"],
  recommendedFix: "Fixture step.",
  relatedCodes: [],
  metaDescription: "Fixture meta.",
};

const publicHtmlPages = readdirSync(PUBLIC_DIR)
  .filter((f) => f.endsWith(".html"))
  .sort()
  .map((f) => ({
    name: `/${f.replace(/\.html$/, "")}`,
    html: readPublic(f),
  }));

const publicLlms = readdirSync(PUBLIC_DIR)
  .filter((f) => /^llms.*\.txt$/.test(f))
  .sort()
  .map((f) => ({ name: `/${f}`, html: readPublic(f) }));

const featurePages = Object.values(FEATURES).map((feature) => ({
  name: `/feature/${feature.slug}`,
  html: renderFeaturePage(feature),
}));

const pages: Array<{ name: string; html: string }> = [
  { name: "/", html: renderHome("https://factorylm.com/") },
  { name: "/cmms", html: renderCmms("https://factorylm.com/cmms") },
  { name: "/limitations", html: renderLimitations("https://factorylm.com/limitations") },
  { name: "/security", html: renderSecurity("https://factorylm.com/security") },
  { name: "/sample", html: renderSamplePlaceholder() },
  { name: "/printsense (route)", html: renderPrintsenseLanding() },
  { name: "/blog (renderer)", html: renderBlogIndex([], 0) },
  {
    name: "/blog/post (renderer)",
    html: renderBlogPost(RENDERER_POST, [RENDERER_POST], []),
  },
  { name: "/blog/fault-codes (renderer)", html: renderFaultCodeIndex([]) },
  {
    name: "/blog/fault (renderer)",
    html: renderFaultCodePage(RENDERER_FAULT, [RENDERER_FAULT]),
  },
  {
    name: "blog-renderer.ts",
    html: readFileSync(join(SRC_DIR, "lib", "blog-renderer.ts"), "utf-8"),
  },
  ...publicHtmlPages,
  ...publicLlms,
  ...featurePages,
  { name: "nav+footer", html: navbar() + footer() },
];

const DONT_SAY: Array<{ label: string; re: RegExp }> = [
  { label: "every answer / every time", re: /every answer|every time/i },
  { label: "no hallucinations", re: /hallucinat/i },
  { label: "instantly", re: /\binstantly\b/i },
  { label: "in seconds", re: /\bin seconds\b/i },
  { label: "PowerFlex 755 trip-history sample", re: /PowerFlex 755|trip-history|trip history/i },
  { label: "scanned manuals", re: /scanned manuals/i },
  { label: "25 machines", re: /25 machines/i },
  { label: "won't give lockout steps", re: /won'?t give lockout/i },
  { label: "MIRA refuses lockout", re: /refuses lockout/i },
  { label: "68,000+ chunks", re: /68,000/ },
  { label: "CMMS write-back", re: /write-back/i },
  { label: "Telegram as answer surface", re: /Telegram/ },
  { label: "Slack as answer surface", re: /Slack/ },
  { label: "Q3 2026", re: /Q3 2026|2026 Q3/ },
  { label: "Cited every time", re: /Cited every time/i },
  { label: "480 V photo STOP", re: /480\s*V/ },
  { label: "voice notes to RCA", re: /voice notes/i },
  { label: "MIRA flags hazards with a warning", re: /flags hazards/i },
  { label: "OCR claims", re: /\bOCR\b/i },
  { label: "nameplate scanning", re: /nameplate/i },
  { label: "Digital Transformation title", re: /Digital Transformation/i },
  { label: "every safety signal", re: /every safety signal/i },
  { label: "PM history in answers", re: /PM history/i },
  { label: "Start free no credit card", re: /Start free|no credit card/i },
  { label: "active pilot claim", re: /active pilot/i },
  { label: "Enterprise SSO/SAML", re: /\bSAML\b|\bon-prem\b/i },
  { label: "14-day money-back", re: /14-day money-back|money-back guarantee/i },
  { label: "Cooperative/Community/Free tiers", re: /Knowledge Cooperative|Community tier|Free-tier/i },
  { label: "/assess 2.5/5 benchmark", re: /2\.5\s*\/\s*5/ },
  { label: "Book Your Maintenance Assessment", re: /Book Your Maintenance Assessment/i },
  { label: "IT/OT gap closed", re: /IT\/OT/ },
  { label: "Operating Layer", re: /Operating Layer/ },
  { label: "MaintainX", re: /MaintainX/ },
  { label: "Limble", re: /Limble/ },
  { label: "UpKeep", re: /UpKeep/ },
  { label: "Fiix", re: /\bFiix\b/ },
  { label: "unlimited queries", re: /unlimited queries/i },
  { label: "work-order history", re: /work-order history/i },
  { label: "locked $399", re: /\$399(?!\d)/ },
  { label: "locked $3,990", re: /\$3,990|\$3990/ },
  // #4606: per-customer Atlas isolation is not shipped (one shared Atlas user).
  { label: "dedicated Atlas container per customer", re: /own Atlas container|Physical isolation|no shared tables/i },
  // #4606: no required CI check runs a real-DB Tenant A / Tenant B leak test.
  { label: "CI cross-tenant build-fail claim", re: /fails the build if any row leaks|queries as Tenant B/i },
];

function dollarAmounts(html: string): string[] {
  return html.match(/\$[\d,]+/g) ?? [];
}

/** /pricing may publish schema.org price 0 for the free pilot. No other dollar amounts. */
function schemaPriceValues(html: string): string[] {
  return [...html.matchAll(/"price"\s*:\s*"?([^",}\s]+)"?/g)].map((m) => m[1]);
}

function marketingSurface(name: string, html: string): string {
  if (name !== "/llms-full.txt") return html;
  return html.replace(
    /## Not yet claimed[\s\S]*?(?=\n## Full limitations\b)/,
    ""
  );
}

describe("public marketing copy — don't-say list and no published prices", () => {
  for (const page of pages) {
    test(`${page.name}: drops the don't-say list and removed claims`, () => {
      const surface = marketingSurface(page.name, page.html);
      for (const rule of DONT_SAY) {
        expect(surface, `${page.name} still contains: ${rule.label}`).not.toMatch(rule.re);
      }
    });

  }

  for (const page of pages) {
    test(`${page.name}: publishes no dollar price`, () => {
      expect(
        dollarAmounts(page.html),
        `${page.name} still contains a dollar amount`
      ).toEqual([]);
      expect(page.html, `${page.name} still contains $500`).not.toContain("$500");
      expect(page.html, `${page.name} still contains $499`).not.toContain("$499");
      expect(page.html, `${page.name} still contains $399`).not.toContain("$399");
      expect(page.html, `${page.name} still contains $3,990`).not.toMatch(
        /\$3,990|\$3990/
      );
      expect(page.html).not.toMatch(/\$2-5K|\$2,\d{3}|\$5,\d{3}/);
      expect(page.html).not.toMatch(/14-day money-back|money-back guarantee/i);
      const prices = schemaPriceValues(page.html);
      const allowed = page.name === "/pricing" ? ["0"] : [];
      for (const value of prices) {
        expect(allowed, `${page.name} has unapproved schema price ${value}`).toContain(
          value
        );
      }
    });
  }

  test("/security and /trust agree on session and SOC 2", () => {
    const security = pages.find((p) => p.name === "/security")!.html;
    const trust = pages.find((p) => p.name === "/trust")!.html;
    for (const line of [
      "We're not SOC 2 audited yet.",
      "Answers are generated by third-party inference APIs.",
      "Hub sign-in uses a signed session cookie.",
    ]) {
      expect(security).toContain(line);
      expect(trust).toContain(line);
    }
    expect(security).not.toMatch(/sessionStorage|expire in 7 days/);
    expect(trust).not.toMatch(/sessionStorage|expire in 7 days/);
  });

  test("/trust states the Atlas limit, /privacy keeps tenant isolation, both name inference subprocessors", () => {
    const trust = pages.find((p) => p.name === "/trust")!.html;
    const privacy = pages.find((p) => p.name === "/privacy")!.html;
    // #4606 owner wording: no dedicated-Atlas promise, and no replacement guarantee.
    expect(trust).toContain(
      "We do not promise a dedicated Atlas CMMS container, database or storage bucket for each customer."
    );
    expect(trust).not.toContain("every query is scoped by");
    expect(trust).toContain("Sub-processors");
    expect(trust).toMatch(/OpenAI/);
    expect(trust).toMatch(/OpenRouter/);
    expect(trust).toMatch(/Groq/);
    expect(trust).toMatch(/Together/);
    expect(trust).toContain("Anthropic is not in that cascade");
    expect(trust).not.toContain("We don't name providers");
    expect(privacy).toContain("Tenant isolation");
    expect(privacy).toContain("never shared with other tenants");
    // Codex F3 / owner F2=(a): privacy.html is identical to main. Processor
    // list changes need a versioned amendment; do not require OpenAI here.
  });

  test("public pages show no Open CMMS text", () => {
    for (const page of pages) {
      expect(page.html, `${page.name} still says Open CMMS`).not.toContain(
        "Open CMMS"
      );
    }
    expect(renderSamplePlaceholder()).not.toContain("Open CMMS");
  });

  test("/pricing title, meta, and headline omit unpublished notebook claims", () => {
    const pricing = pages.find((p) => p.name === "/pricing")!.html;
    // Codex F1: notebook-for-one-crew and notebook-open-lookup-ask-record are
    // partial in capabilities.json; /pricing must not publish them or a paraphrase.
    expect(pricing).not.toContain("The equipment notebook for your maintenance crew");
    expect(pricing).not.toMatch(/equipment notebook for (?:your|one) maintenance crew/i);
    expect(pricing).not.toMatch(/equipment-notebook (?:pilot )?for one crew/i);
    expect(pricing).not.toContain("Open the machine's notebook");
    expect(pricing).not.toContain("find the right manual passage");
    expect(pricing).not.toContain("record what fixed it");
    expect(pricing).not.toContain("Find reliable answers in your own equipment manuals");
    expect(pricing).toMatch(/<h1>\s*Start with a <em>free 30-day pilot\.<\/em>\s*<\/h1>/);
    expect(pricing).toContain("https://app.factorylm.com/signup");
    expect(pricing).toContain("Talk to Mike");
    expect(pricing).not.toContain("<title>Pricing — FactoryLM</title>");
    expect(pricing).not.toMatch(/<h1>\s*Talk to Mike\s*<\/h1>/);
    expect(pricing).not.toMatch(/<h1>\s*Pricing\s*<\/h1>/);
    expect(pricing).not.toContain(">Pricing<");
  });

  test("/pricing and /buy point at the free pilot request, with no paid Offer", () => {
    for (const name of ["/pricing", "/buy"] as const) {
      const html = pages.find((p) => p.name === name)!.html;
      expect(html, `${name} is missing Talk to Mike`).toContain("Talk to Mike");
      expect(html, `${name} is missing the signup CTA`).toContain(
        "https://app.factorylm.com/signup"
      );
      expect(html, `${name} is missing the free-pilot request`).toContain(
        "Request a free 30-day pilot"
      );
      expect(html, `${name} links to a checkout`).not.toMatch(/href="[^"]*(checkout|stripe)/i);
      expect(html, `${name} still has $499`).not.toContain("$499");
      expect(html, `${name} still has $500`).not.toContain("$500");
      expect(html, `${name} still has $2-5K`).not.toMatch(/\$2-5K|\$2,\d{3}|\$5,\d{3}/);
      if (name === "/buy") {
        expect(html, `${name} still has an Offer block`).not.toMatch(
          /"@type"\s*:\s*"Offer"/
        );
        expect(html, `${name} still has a schema price`).not.toMatch(/"price"/);
      } else {
        expect(html, `${name} is missing the free Offer`).toMatch(
          /"@type"\s*:\s*"Offer"/
        );
        expect(schemaPriceValues(html)).toEqual(["0"]);
      }
    }
  });

  test("/pricing states the free 30-day pilot offer with no dollar amounts", () => {
    const pricing = pages.find((p) => p.name === "/pricing")!.html;
    const body = pricing.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
    expect(body, "/pricing has no <main> body").not.toBe("");
    expect(body).toContain("Free 30 days");
    expect(body).toContain("first five teams");
    expect(body).toContain("MIRA works from manuals on its own");
    expect(body).toContain("https://app.factorylm.com/signup");
    expect(body).not.toContain("$500");
    expect(pricing).not.toContain("Find reliable answers in your own equipment manuals");
  });

  test("/llms.txt omits sensors and work orders", () => {
    const llms = pages.find((p) => p.name === "/llms.txt")!.html;
    const full = pages.find((p) => p.name === "/llms-full.txt")!.html;
    for (const body of [llms, full]) {
      expect(body).not.toMatch(/\bsensors\b/i);
      expect(body).not.toMatch(/work orders/i);
    }
  });

  test("covers every public HTML file, llms*.txt, feature pages, PrintSense, terms, and the blog renderer", () => {
    const names = pages.map((p) => p.name);
    for (const file of readdirSync(PUBLIC_DIR).filter((f) => f.endsWith(".html"))) {
      expect(names).toContain(`/${file.replace(/\.html$/, "")}`);
    }
    for (const file of readdirSync(PUBLIC_DIR).filter((f) => /^llms.*\.txt$/.test(f))) {
      expect(names).toContain(`/${file}`);
    }
    expect(names).toContain("/terms");
    expect(names).toContain("/printsense");
    expect(names).toContain("/printsense (route)");
    expect(names).toContain("/feature/fault-diagnosis");
    expect(names).toContain("/feature/cmms-integration");
    expect(names).toContain("/feature/voice-vision");
    expect(names).toContain("blog-renderer.ts");
    expect(names).toContain("/blog (renderer)");
  });

  test("primary CTA is the free-pilot signup; Talk to Mike and Sign in stay reachable", () => {
    const chrome = navbar() + footer();
    expect(chrome).toContain("Request a free 30-day pilot");
    expect(chrome).toContain("https://app.factorylm.com/signup");
    expect(chrome).toContain("Talk to Mike");
    expect(chrome).toContain("Sign in");
    expect(chrome).not.toContain("Book $500");
    expect(chrome).not.toContain("Get Started");
    expect(chrome).not.toContain(">CMMS<");
    expect(chrome).not.toContain(">Pricing<");
    expect(chrome).not.toContain("/assess");
  });
});
