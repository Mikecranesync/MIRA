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
} from "../../lib/blog-renderer.js";
import { BLOG_POSTS, type BlogPost } from "../../data/blog-posts.js";
import { FAULT_CODES } from "../../data/fault-codes.js";
import { renderPrintsenseLanding } from "../../routes/printsense.js";
import { renderDriveLandingPage } from "../../lib/drive-commander-renderer.js";
import { getPack, PACK_MODELS } from "../../lib/drive-pack-data.js";
import {
  loadCapabilities,
  type CapabilitiesFile,
} from "../../capabilities/marketing-claims/index.js";

const PUBLIC_DIR = join(process.cwd(), "public");
const SRC_DIR = join(process.cwd(), "src");

function readPublic(rel: string): string {
  return readFileSync(join(PUBLIC_DIR, rel), "utf-8");
}

function walkPublicHtml(
  dir: string,
  rel = "",
): Array<{ name: string; html: string }> {
  const out: Array<{ name: string; html: string }> = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkPublicHtml(abs, childRel));
      continue;
    }
    if (ent.name.endsWith(".html")) {
      out.push({
        name: `/${childRel.replace(/\.html$/, "")}`,
        html: readFileSync(abs, "utf-8"),
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const publicHtmlPages = walkPublicHtml(PUBLIC_DIR);

const publicLlms = readdirSync(PUBLIC_DIR)
  .filter((f) => /^llms.*\.txt$/.test(f))
  .sort()
  .map((f) => ({ name: `/${f}`, html: readPublic(f) }));

const featurePages = Object.values(FEATURES).map((feature) => ({
  name: `/feature/${feature.slug}`,
  html: renderFeaturePage(feature),
}));

const blogPostPages = BLOG_POSTS.map((post) => ({
  name: `/blog/${post.slug}`,
  html: renderBlogPost(post, BLOG_POSTS, FAULT_CODES),
}));

const drivePages = PACK_MODELS.map((slug) => {
  const pack = getPack(slug);
  if (!pack) throw new Error(`missing drive pack ${slug}`);
  return {
    name: `/drive-commander/${slug}`,
    html: renderDriveLandingPage(pack),
  };
});

const RENDERER_SOURCES = [
  "lib/blog-renderer.ts",
  "lib/drive-commander-renderer.ts",
  "lib/feature-renderer.ts",
  "routes/printsense.ts",
  "views/home.ts",
  "views/cmms.ts",
  "views/limitations.ts",
  "views/security.ts",
] as const;

const rendererSources = RENDERER_SOURCES.map((rel) => ({
  name: rel,
  html: readFileSync(join(SRC_DIR, rel), "utf-8"),
}));

const pages: Array<{ name: string; html: string }> = [
  { name: "/", html: renderHome("https://factorylm.com/") },
  { name: "/cmms", html: renderCmms("https://factorylm.com/cmms") },
  { name: "/limitations", html: renderLimitations("https://factorylm.com/limitations") },
  { name: "/security", html: renderSecurity("https://factorylm.com/security") },
  { name: "/sample", html: renderSamplePlaceholder() },
  { name: "/printsense (route)", html: renderPrintsenseLanding() },
  { name: "/blog (renderer)", html: renderBlogIndex(BLOG_POSTS, FAULT_CODES.length) },
  { name: "/blog/fault-codes (renderer)", html: renderFaultCodeIndex(FAULT_CODES) },
  ...blogPostPages,
  ...drivePages,
  ...publicHtmlPages,
  ...publicLlms,
  ...featurePages,
  ...rendererSources,
  { name: "nav+footer", html: navbar() + footer() },
];

type ClaimRule = { category: string; label: string; re: RegExp };

/** Semantic categories Codex round 2 required: auto+CMMS, any $, timing promises. */
const CLAIM_CATEGORIES: ClaimRule[] = [
  {
    category: "auto-cmms",
    label: "automatic CMMS / work-order creation",
    re: /automat(?:ic(?:ally)?|es?)\b[\s\S]{0,80}\b(?:CMMS|work[- ]orders?)|\bauto[- ]?(?:creat(?:e|es|ed|ing)|generat(?:e|es|ed|ing))\b[\s\S]{0,80}\b(?:CMMS|work[- ]orders?|\bWO\b)|\b(?:CMMS|work[- ]orders?)\b[\s\S]{0,80}\bautomat(?:ic(?:ally)?|es?)/i,
  },
  {
    category: "timing",
    label: "timing promise (in seconds / instantly)",
    re: /\bin seconds\b|\binstantly\b|\bin the next \d+ seconds\b/i,
  },
  {
    category: "price",
    label: "any dollar amount",
    re: /\$[\d,]+/,
  },
];

const DONT_SAY: ClaimRule[] = [
  { category: "overclaim", label: "every answer / every time", re: /every answer|every time/i },
  { category: "overclaim", label: "no hallucinations", re: /hallucinat/i },
  { category: "timing", label: "instantly", re: /\binstantly\b/i },
  { category: "timing", label: "in seconds", re: /\bin seconds\b/i },
  { category: "overclaim", label: "PowerFlex 755 trip-history sample", re: /PowerFlex 755|trip-history|trip history/i },
  { category: "overclaim", label: "scanned manuals", re: /scanned manuals/i },
  { category: "overclaim", label: "25 machines", re: /25 machines/i },
  { category: "overclaim", label: "won't give lockout steps", re: /won'?t give lockout/i },
  { category: "overclaim", label: "MIRA refuses lockout", re: /refuses lockout/i },
  { category: "overclaim", label: "68,000+ chunks", re: /68,000/ },
  { category: "overclaim", label: "CMMS write-back", re: /write-back/i },
  { category: "adapter", label: "Telegram as answer surface", re: /Telegram/ },
  { category: "adapter", label: "Slack as answer surface", re: /Slack/ },
  { category: "overclaim", label: "Q3 2026", re: /Q3 2026|2026 Q3/ },
  { category: "overclaim", label: "Cited every time", re: /Cited every time/i },
  { category: "overclaim", label: "480 V photo STOP", re: /480\s*V/ },
  { category: "overclaim", label: "voice notes to RCA", re: /voice notes/i },
  { category: "overclaim", label: "MIRA flags hazards with a warning", re: /flags hazards/i },
  { category: "overclaim", label: "OCR claims", re: /\bOCR\b/i },
  { category: "overclaim", label: "nameplate scanning", re: /nameplate[- ]?scanning|scans? (?:the )?nameplate/i },
  { category: "overclaim", label: "Digital Transformation title", re: /Digital Transformation/i },
  { category: "overclaim", label: "every safety signal", re: /every safety signal/i },
  { category: "overclaim", label: "PM history in answers", re: /PM history/i },
  { category: "overclaim", label: "Start free no credit card", re: /Start free|no credit card/i },
  { category: "overclaim", label: "active pilot claim", re: /active pilot/i },
  { category: "overclaim", label: "Enterprise SSO/SAML", re: /\bSAML\b|\bon-prem\b/i },
  { category: "price", label: "14-day money-back", re: /14-day money-back|money-back guarantee/i },
  { category: "overclaim", label: "Cooperative/Community/Free tiers", re: /Knowledge Cooperative|Community tier|Free-tier/i },
  { category: "overclaim", label: "/assess 2.5/5 benchmark", re: /2\.5\s*\/\s*5/ },
  { category: "overclaim", label: "Book Your Maintenance Assessment", re: /Book Your Maintenance Assessment/i },
  { category: "overclaim", label: "IT/OT gap closed", re: /IT\/OT/ },
  { category: "overclaim", label: "Operating Layer", re: /Operating Layer/ },
  { category: "competitor", label: "MaintainX", re: /MaintainX/ },
  { category: "competitor", label: "Limble", re: /Limble/ },
  { category: "competitor", label: "UpKeep", re: /UpKeep/ },
  { category: "competitor", label: "Fiix", re: /\bFiix\b/ },
  { category: "overclaim", label: "unlimited queries", re: /unlimited queries/i },
  { category: "overclaim", label: "work-order history", re: /work-order history/i },
  { category: "price", label: "locked $399", re: /\$399(?!\d)/ },
  { category: "price", label: "locked $3,990", re: /\$3,990|\$3990/ },
  { category: "overclaim", label: "dedicated Atlas container per customer", re: /own Atlas container|Physical isolation|no shared tables/i },
  { category: "overclaim", label: "CI cross-tenant build-fail claim", re: /fails the build if any row leaks|queries as Tenant B/i },
];

const ALL_BANS: ClaimRule[] = [...CLAIM_CATEGORIES, ...DONT_SAY];

function dollarAmounts(html: string): string[] {
  return html.match(/\$[\d,]+/g) ?? [];
}

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

/** Shared scanner used by per-page tests and mutation tests. */
function claimHits(name: string, html: string): string[] {
  const surface = marketingSurface(name, html);
  return ALL_BANS.filter((rule) => rule.re.test(surface)).map(
    (rule) => `${rule.category}: ${rule.label}`,
  );
}

describe("public marketing copy — don't-say list and no published prices", () => {
  for (const page of pages) {
    test(`${page.name}: drops the don't-say list and removed claims`, () => {
      const hits = claimHits(page.name, page.html);
      expect(hits, `${page.name} still contains: ${hits.join("; ")}`).toEqual([]);
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

  test("covers recursive public HTML, every real blog post, Drive Commander, and all marketing renderers", () => {
    const names = pages.map((p) => p.name);
    for (const page of walkPublicHtml(PUBLIC_DIR)) {
      expect(names).toContain(page.name);
    }
    for (const file of readdirSync(PUBLIC_DIR).filter((f) => /^llms.*\.txt$/.test(f))) {
      expect(names).toContain(`/${file}`);
    }
    expect(BLOG_POSTS.length).toBeGreaterThan(1);
    for (const post of BLOG_POSTS) {
      expect(names).toContain(`/blog/${post.slug}`);
    }
    expect(names).not.toContain("/blog/post (renderer)");
    expect(names).not.toContain("/blog/fault (renderer)");
    for (const slug of PACK_MODELS) {
      expect(names).toContain(`/drive-commander/${slug}`);
    }
    expect(names).toContain("/drive-commander/powerflex-525");
    expect(names).toContain("/legal/dpa");
    expect(names).toContain("/terms");
    expect(names).toContain("/printsense");
    expect(names).toContain("/printsense (route)");
    expect(names).toContain("/feature/fault-diagnosis");
    expect(names).toContain("/feature/cmms-integration");
    expect(names).toContain("/feature/voice-vision");
    expect(names).toContain("lib/blog-renderer.ts");
    expect(names).toContain("lib/drive-commander-renderer.ts");
    expect(names).toContain("lib/feature-renderer.ts");
    expect(names).toContain("routes/printsense.ts");
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

  test("planted $197/yr on /buy is caught by the price scanner", () => {
    const buy = pages.find((p) => p.name === "/buy")!.html;
    expect(claimHits("/buy", buy)).toEqual([]);
    const planted = buy.replace("</main>", "<p>Unlock Pro — $197/yr</p></main>");
    const hits = claimHits("/buy", planted);
    expect(dollarAmounts(planted)).toContain("$197");
    expect(hits.some((h) => h.includes("any dollar amount"))).toBe(true);
    expect(hits.some((h) => h.includes("locked $399"))).toBe(false);
  });

  test("planted automatic CMMS work-order claim in a blog post is caught", () => {
    const source = BLOG_POSTS.find((p) => p.slug === "what-is-cmms");
    expect(source).toBeDefined();
    const clean = renderBlogPost(source!, BLOG_POSTS, FAULT_CODES);
    expect(claimHits("/blog/what-is-cmms", clean)).toEqual([]);
    const planted: BlogPost = {
      ...source!,
      sections: [
        ...source!.sections,
        {
          type: "paragraph",
          text: "FactoryLM automatically creates CMMS work orders from the diagnosis.",
        },
      ],
    };
    const html = renderBlogPost(planted, BLOG_POSTS, FAULT_CODES);
    const hits = claimHits("/blog/what-is-cmms", html);
    expect(hits.some((h) => h.includes("automatic CMMS / work-order creation"))).toBe(
      true,
    );
  });
});

describe("unproven registry claims are suppressed, not replaced with fallback copy", () => {
  test("downgrading notebook-cited-answer to partial removes it from PrintSense and the blog CTA", () => {
    const data = loadCapabilities();
    const row = data.claims.find((c) => c.id === "notebook-cited-answer");
    expect(row).toBeDefined();
    const text = row!.text;
    expect(text.length).toBeGreaterThan(20);

    expect(renderPrintsenseLanding(data)).toContain(text);
    expect(renderBlogPost(BLOG_POSTS[0]!, BLOG_POSTS, FAULT_CODES, data)).toContain(
      text,
    );

    const flipped: CapabilitiesFile = structuredClone(data);
    const flippedRow = flipped.claims.find((c) => c.id === "notebook-cited-answer");
    expect(flippedRow).toBeDefined();
    flippedRow!.status = "partial";

    const ps = renderPrintsenseLanding(flipped);
    const blog = renderBlogPost(BLOG_POSTS[0]!, BLOG_POSTS, FAULT_CODES, flipped);
    const cta = blog.match(/<div class="cta-card[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(cta, "blog CTA card missing").not.toBe("");
    expect(ps).not.toContain(text);
    expect(cta).not.toContain(text);
    expect(blog).not.toContain(text);
  });
});
