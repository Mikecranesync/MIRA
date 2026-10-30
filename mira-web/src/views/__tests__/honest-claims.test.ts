import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome } from "../home.js";
import { renderCmms, renderSamplePlaceholder } from "../cmms.js";
import { renderLimitations } from "../limitations.js";
import { renderSecurity } from "../security.js";
import { navbar, footer } from "../_topbar.js";
import {
  FEATURES,
  featuresFromRegistry,
  renderFeaturePage,
} from "../../lib/feature-renderer.js";
import {
  renderBlogIndex,
  renderBlogPost,
  renderFaultCodeIndex,
  renderFaultCodePage,
} from "../../lib/blog-renderer.js";
import { BLOG_POSTS, type BlogPost } from "../../data/blog-posts.js";
import { FAULT_CODES, type FaultCode } from "../../data/fault-codes.js";
import { renderPrintsenseLanding } from "../../routes/printsense.js";
import {
  renderDriveLandingPage,
  renderFaultPage,
  renderParameterPage,
} from "../../lib/drive-commander-renderer.js";
import {
  driveCommanderSitemapLocs,
  getFaultEntry,
  getPack,
  listFaults,
  listParameters,
  PACK_MODELS,
  type DrivePackDisplay,
} from "../../lib/drive-pack-data.js";
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

/** Blog fault-code detail pages, rendered from their real data (interpolated fields included). */
function buildFaultCodePages(codes: FaultCode[]): Array<{ name: string; html: string }> {
  return codes.map((fc) => ({
    name: `/blog/${fc.slug}`,
    html: renderFaultCodePage(fc, codes),
  }));
}

/** Drive Commander fault + parameter detail pages, rendered from the real pack data. */
function buildDriveDetailPages(pack: DrivePackDisplay): Array<{ name: string; html: string }> {
  return [
    ...listFaults(pack).map((fault) => ({
      name: `/drive-commander/${pack.modelSlug}/faults/${fault.display}`,
      html: renderFaultPage(pack, fault),
    })),
    ...listParameters(pack).map((param) => ({
      name: `/drive-commander/${pack.modelSlug}/parameters/${param.parameter_id}`,
      html: renderParameterPage(pack, param),
    })),
  ];
}

const faultCodePages = buildFaultCodePages(FAULT_CODES);

const driveDetailPages = PACK_MODELS.flatMap((slug) => {
  const pack = getPack(slug);
  if (!pack) throw new Error(`missing drive pack ${slug}`);
  return buildDriveDetailPages(pack);
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
  ...faultCodePages,
  ...drivePages,
  ...driveDetailPages,
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
    category: "timing",
    label: "timing promise (in/within about N seconds/minutes)",
    re: /(?<!\b(?:expires?|again|retry|wait)\s)\b(?:in|within)\s+(?:(?:about|around|roughly|under|less than|just|only|a few|a couple(?: of)?)\s+)*(?:\d+|an?|one|two|three|four|five|ten|fifteen|thirty|few)\s*(?:-\s*)?(?:seconds?|secs?|minutes?|mins?)\b/i,
  },
  {
    category: "testimonial",
    label: "unbacked user-reaction claim (most/many/all ... users)",
    re: /\b(?:most|many|all|every|nearly all|almost all)\s+(?:of\s+)?(?:our\s+|the\s+)?(?:beta|pilot|early|real|current)?\s*(?:users|customers|testers|technicians|techs|crews)\b/i,
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

/**
 * The free-pilot / lifetime-credit offer is new presentation and must not appear on any
 * frozen legacy surface, llms artifacts included (Codex iteration 3 F1, owner decision
 * 2026-10-30). It belongs in the canonical FactoryLM shell, not this PR.
 */
const OFFER_RULE: ClaimRule = {
  category: "offer",
  label: "free-pilot / lifetime-credit offer on a legacy surface",
  re: /free 30-day|30-day (?:MIRA )?pilot|lifetime credit|first five (?:approved )?teams|app\.factorylm\.com\/signup|data-cta="[^"]*-pilot"/i,
};

const ALL_BANS: ClaimRule[] = [...CLAIM_CATEGORIES, ...DONT_SAY, OFFER_RULE];

/**
 * /terms is byte-identical to main (Codex iteration 3 F3: Terms changes need a dated
 * amendment, not an edit in this PR). Its pre-amendment claims are pinned exactly, so any
 * NEW claim or price on /terms still fails.
 */
const TERMS_MAIN_SHA256 = "265519dc9e77574bcfa7b46e5c4f03f96687d08f4b8431437808f8c859002bfd";
const TERMS_KNOWN_HITS = [
  "price: any dollar amount",
  "overclaim: CMMS write-back",
  "adapter: Telegram as answer surface",
  "adapter: Slack as answer surface",
  "overclaim: Digital Transformation title",
  "overclaim: Operating Layer",
];
const TERMS_KNOWN_DOLLARS = ["$500", "$2,000", "$5,000", "$499"];

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
  test("/terms is byte-identical to main and carries only its known pre-amendment claims", () => {
    const terms = pages.find((p) => p.name === "/terms")!.html;
    expect(createHash("sha256").update(readPublic("terms.html")).digest("hex")).toBe(
      TERMS_MAIN_SHA256,
    );
    expect(claimHits("/terms", terms)).toEqual(TERMS_KNOWN_HITS);
    expect(dollarAmounts(terms)).toEqual(TERMS_KNOWN_DOLLARS);
    expect(schemaPriceValues(terms)).toEqual([]);
  });

  for (const page of pages) {
    if (page.name === "/terms") continue;
    test(`${page.name}: drops the don't-say list and removed claims`, () => {
      const hits = claimHits(page.name, page.html);
      expect(hits, `${page.name} still contains: ${hits.join("; ")}`).toEqual([]);
    });
  }

  for (const page of pages) {
    if (page.name === "/terms") continue;
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
      expect(prices, `${page.name} has a schema price`).toEqual([]);
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
    expect(pricing).not.toMatch(/free 30-day pilot/i);
    expect(pricing).not.toContain("https://app.factorylm.com/signup");
    expect(pricing).toContain("Talk to Mike");
    expect(pricing).not.toContain("<title>Pricing — FactoryLM</title>");
    expect(pricing).not.toMatch(/<h1>\s*Talk to Mike\s*<\/h1>/);
    expect(pricing).not.toMatch(/<h1>\s*Pricing\s*<\/h1>/);
    expect(pricing).not.toContain(">Pricing<");
  });

  test("/pricing and /buy carry no offer, no checkout, and no schema Offer — Talk to Mike only", () => {
    for (const name of ["/pricing", "/buy"] as const) {
      const html = pages.find((p) => p.name === name)!.html;
      expect(html, `${name} is missing Talk to Mike`).toContain("Talk to Mike");
      expect(html, `${name} is missing the contact mailto`).toContain("mailto:mike@factorylm.com");
      expect(html, `${name} still links the pilot signup`).not.toContain(
        "https://app.factorylm.com/signup"
      );
      expect(html, `${name} still offers the free pilot`).not.toMatch(
        /free 30-day|30-day pilot|lifetime credit|first five/i
      );
      expect(html, `${name} links to a checkout`).not.toMatch(/href="[^"]*(checkout|stripe)/i);
      expect(html, `${name} still has an Offer block`).not.toMatch(/"@type"\s*:\s*"Offer"/);
      expect(html, `${name} still has a schema price`).not.toMatch(/"price"/);
      expect(dollarAmounts(html)).toEqual([]);
    }
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
    // Every Drive Commander landing, fault, and parameter URL in the sitemap is rendered + scanned.
    const dcLocs = driveCommanderSitemapLocs();
    expect(dcLocs.some((l) => l.includes("/faults/"))).toBe(true);
    expect(dcLocs.some((l) => l.includes("/parameters/"))).toBe(true);
    for (const loc of dcLocs) {
      expect(names, `Drive Commander page ${loc} is not scanned`).toContain(loc);
    }
    // Every blog fault-code page is rendered from real data + scanned.
    expect(FAULT_CODES.length).toBeGreaterThan(1);
    for (const fc of FAULT_CODES) {
      expect(names, `fault-code page /blog/${fc.slug} is not scanned`).toContain(`/blog/${fc.slug}`);
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

  test("nav + footer carry no offer CTA; Talk to Mike and Sign in stay reachable", () => {
    const chrome = navbar() + footer();
    expect(chrome).not.toMatch(/free 30-day|30-day pilot|lifetime credit/i);
    expect(chrome).not.toContain("https://app.factorylm.com/signup");
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

  test("planted $197/yr in a fault's recommendedFix fails the rendered fault-code page scan", () => {
    const target = FAULT_CODES[0]!;
    const clean = buildFaultCodePages(FAULT_CODES).find((p) => p.name === `/blog/${target.slug}`)!;
    expect(claimHits(clean.name, clean.html)).toEqual([]);
    expect(dollarAmounts(clean.html)).toEqual([]);
    const mutated = FAULT_CODES.map((fc) =>
      fc.slug === target.slug
        ? { ...fc, recommendedFix: `${fc.recommendedFix}\n9. Unlock the full fix with Pro for $197/yr.` }
        : fc,
    );
    const page = buildFaultCodePages(mutated).find((p) => p.name === `/blog/${target.slug}`)!;
    expect(dollarAmounts(page.html)).toContain("$197");
    expect(claimHits(page.name, page.html).some((h) => h.includes("any dollar amount"))).toBe(true);
  });

  test("planted $197/yr in a Drive Commander remedy step fails the rendered fault detail scan", () => {
    const pack = PACK_MODELS.map((slug) => getPack(slug)!).find((p) => p.faultEntries.length > 0);
    expect(pack, "no Drive Commander pack has cited fault entries").toBeDefined();
    const fault = listFaults(pack!).find((f) => getFaultEntry(pack!, f.key) !== null)!;
    expect(fault).toBeDefined();
    const entry = getFaultEntry(pack!, fault.key)!;
    const name = `/drive-commander/${pack!.modelSlug}/faults/${fault.display}`;
    const clean = buildDriveDetailPages(pack!).find((p) => p.name === name)!;
    expect(claimHits(name, clean.html)).toEqual([]);
    expect(clean.html).toContain(entry.remedy_steps[0]!);
    const mutatedPack: DrivePackDisplay = {
      ...pack!,
      faultEntries: pack!.faultEntries.map((e) =>
        e === entry ? { ...e, remedy_steps: [...e.remedy_steps, "Pro unlock: $197/yr"] } : e,
      ),
    };
    const page = buildDriveDetailPages(mutatedPack).find((p) => p.name === name)!;
    expect(claimHits(name, page.html).some((h) => h.includes("any dollar amount"))).toBe(true);
  });

  test("a planted pilot / lifetime-credit offer is caught on any legacy surface; contact copy passes", () => {
    for (const planted of [
      '<a href="https://app.factorylm.com/signup">Request a free 30-day pilot</a>',
      "<p>First five approved teams can request a free 30-day MIRA pilot (five seats each).</p>",
      "<p>Early adopters among the first five can lock in limited free lifetime credit.</p>",
      '<a href="mailto:mike@factorylm.com" data-cta="hero-pilot">Go</a>',
    ]) {
      const hits = claimHits("/", `<main>${planted}</main>`);
      expect(hits.some((h) => h.startsWith("offer:")), planted).toBe(true);
    }
    for (const control of [
      '<a href="mailto:mike@factorylm.com" data-cta="hero-talk">Talk to Mike</a>',
      '<a class="ps-cta-ghost" href="#pilot">Analyze my complete machine package</a>',
    ]) {
      const hits = claimHits("/", `<main>${control}</main>`).filter((h) => h.startsWith("offer:"));
      expect(hits, control).toEqual([]);
    }
  });

  test("timing promises like 'in about two minutes' are caught; neutral copy passes", () => {
    for (const planted of [
      "Upload one equipment manual and Mira starts answering fault codes from it in about two minutes.",
      "PDFs land in your knowledge base in about two minutes.",
      "Answers within 30 seconds.",
      "Get a cited answer in under 5 minutes.",
    ]) {
      const hits = claimHits("/activated", `<p>${planted}</p>`);
      expect(hits.some((h) => h.startsWith("timing:")), planted).toBe(true);
    }
    for (const control of [
      "Upload one equipment manual. Ingest time depends on the manual's size.",
      "Cooldown — wait a minute",
      "Check the drive after 5 minutes of run time.",
      "Your magic link is on its way (it expires in 10 minutes).",
      "You requested a link recently. Try again in a minute.",
    ]) {
      const hits = claimHits("/activated", `<p>${control}</p>`).filter((h) =>
        h.startsWith("timing:"),
      );
      expect(hits, control).toEqual([]);
    }
  });

  test("testimonial claims like 'most beta users' are caught; neutral copy passes", () => {
    for (const planted of [
      'This is where most beta users have their "oh, this is different" moment.',
      "Many of our customers cut downtime in half.",
      "Most technicians love it.",
    ]) {
      const hits = claimHits("/activated", `<p>${planted}</p>`);
      expect(hits.some((h) => h.startsWith("testimonial:")), planted).toBe(true);
    }
    for (const control of ["Upload one equipment manual to start.", "Ask Mira a question."]) {
      const hits = claimHits("/activated", `<p>${control}</p>`).filter((h) =>
        h.startsWith("testimonial:"),
      );
      expect(hits, control).toEqual([]);
    }
  });

  test("/activated drops the ingest-timing promises and the beta-user reaction claim", () => {
    const activated = pages.find((p) => p.name === "/activated")!.html;
    expect(activated).not.toMatch(/about two minutes/i);
    expect(activated).not.toMatch(/most beta users/i);
    expect(activated).not.toMatch(/oh, this is different/i);
    expect(claimHits("/activated", activated)).toEqual([]);
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
  test("downgrading notebook-cited-answer to partial removes every citation claim from PrintSense and the blog renderers", () => {
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

    // Absence of ANY citation claim, not just the exact registry sentence: every
    // surface that renders the notebook-cited-answer slot must drop "cites the page"
    // (or "cites" near "page"/"manual") once the claim is downgraded.
    const surfaces: Array<{ name: string; html: string }> = [
      { name: "/printsense (route)", html: ps },
      ...BLOG_POSTS.map((post) => ({
        name: `/blog/${post.slug}`,
        html: renderBlogPost(post, BLOG_POSTS, FAULT_CODES, flipped),
      })),
      ...FAULT_CODES.map((fc) => ({
        name: `/blog/${fc.slug}`,
        html: renderFaultCodePage(fc, FAULT_CODES, flipped),
      })),
      { name: "/blog (renderer)", html: renderBlogIndex(BLOG_POSTS, FAULT_CODES.length, flipped) },
      { name: "/blog/fault-codes (renderer)", html: renderFaultCodeIndex(FAULT_CODES, flipped) },
    ];
    // Feature pages hardcode citation captions; they fail closed (throw) instead of rendering.
    expect(() => featuresFromRegistry(flipped)).toThrow();

    for (const surface of surfaces) {
      const claims = citationClaims(surface.html);
      expect(claims, `${surface.name} still claims citations: ${claims.join(" | ")}`).toEqual([]);
    }
  });

  test("the citation-claim detector catches the surviving CTA heading and wording variants", () => {
    for (const planted of [
      "<h3>Ask Mira — it cites the page</h3>",
      "<p>MIRA cites the exact manual page.</p>",
      "<p>Answers cite the page in your manual.</p>",
      "<p>Every answer is cited to the page.</p>",
      "<p>An equipment notebook that cites the attached OEM page puts the passage in front of you.</p>",
      "<p>You get the cited passage from the manual you attached.</p>",
    ]) {
      expect(citationClaims(planted).length, planted).toBeGreaterThan(0);
    }
    for (const control of [
      '<div class="ps-cites"><span class="ps-cite">duplicate-identifier check</span></div>',
      "<p>Ask Mira a question.</p>",
    ]) {
      expect(citationClaims(control), control).toEqual([]);
    }
  });
});

/** Visible-text citation claims ("cites the page", "cited to the page", "cite ... manual page"). */
function citationClaims(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ");
  return (
    text.match(/\bcit(?:e|es|ed|ing)\b[^.!?]{0,40}\b(?:pages?|manuals?)\b/gi) ?? []
  );
}
