import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome } from "../home.js";
import { renderCmms, renderSamplePlaceholder } from "../cmms.js";
import { renderLimitations } from "../limitations.js";
import { renderSecurity } from "../security.js";
import { navbar, footer } from "../_topbar.js";

const PUBLIC_DIR = join(process.cwd(), "public");

function readPublic(file: string): string {
  return readFileSync(join(PUBLIC_DIR, file), "utf-8");
}

const pages: Array<{ name: string; html: string }> = [
  { name: "/", html: renderHome("https://factorylm.com/") },
  { name: "/cmms", html: renderCmms("https://factorylm.com/cmms") },
  { name: "/limitations", html: renderLimitations("https://factorylm.com/limitations") },
  { name: "/security", html: renderSecurity("https://factorylm.com/security") },
  { name: "/pricing", html: readPublic("pricing.html") },
  { name: "/buy", html: readPublic("buy.html") },
  { name: "/trust", html: readPublic("trust.html") },
  { name: "/privacy", html: readPublic("privacy.html") },
  { name: "/sample", html: renderSamplePlaceholder() },
  { name: "/assess", html: readPublic("assess.html") },
  // /terms is deliberately absent: it is a contract, changed only by a versioned,
  // owner-approved amendment with notice (Codex F2 on #4570), never by this suite.
  { name: "/llms.txt", html: readPublic("llms.txt") },
  { name: "/llms-full.txt", html: readPublic("llms-full.txt") },
  { name: "nav+footer", html: navbar() + footer() },
];

const DONT_SAY: Array<{ label: string; re: RegExp }> = [
  { label: "every answer / every time", re: /every answer|every time/i },
  { label: "no hallucinations", re: /hallucinat/i },
  { label: "instantly", re: /\binstantly\b/i },
  { label: "fault codes as a feature", re: /fault codes?|F005/i },
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
  { label: "OCR-confidence claims", re: /OCR confidence/i },
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

// Owner decision D1 (2026-10-27): $500 per site for 30 days, one maintenance team,
// no automatic renewal, no self-serve checkout. It is the only price any page may publish,
// and only on /pricing. The follow-on $399 / $3,990 price was not decided.
const D1_PRICE = "$500";
const D1_PHRASES = [
  "$500 per site for 30 days",
  "One maintenance team",
  "No automatic renewal",
  "No self-serve checkout",
];

function dollarAmounts(html: string): string[] {
  return html.match(/\$[\d,]+/g) ?? [];
}

function marketingSurface(name: string, html: string): string {
  if (name !== "/llms-full.txt") return html;
  return html.replace(
    /## Not yet claimed[\s\S]*?(?=\n## Full limitations\b)/,
    ""
  );
}

describe("public marketing copy — don't-say list and only the D1 price", () => {
  for (const page of pages) {
    test(`${page.name}: drops the don't-say list and removed claims`, () => {
      const surface = marketingSurface(page.name, page.html);
      for (const rule of DONT_SAY) {
        expect(surface, `${page.name} still contains: ${rule.label}`).not.toMatch(rule.re);
      }
    });

  }

  for (const page of pages) {
    test(`${page.name}: publishes no price except D1 on /pricing`, () => {
      const allowed = page.name === "/pricing" ? [D1_PRICE] : [];
      for (const amount of dollarAmounts(page.html)) {
        expect(allowed, `${page.name} contains an unapproved price ${amount}`).toContain(amount);
      }
      expect(page.html, `${page.name} still contains $399`).not.toContain("$399");
      expect(page.html, `${page.name} still contains $3,990`).not.toMatch(
        /\$3,990|\$3990/
      );
      expect(page.html).not.toMatch(/14-day money-back|money-back guarantee/i);
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
    expect(privacy).toMatch(/OpenAI/);
    expect(privacy).toContain("The full and current list lives at");
    expect(privacy).not.toContain("We don't name providers");
    expect(privacy).not.toContain("We don't publish an inference-provider list");
  });

  test("public pages show no Open CMMS text", () => {
    for (const page of pages) {
      expect(page.html, `${page.name} still says Open CMMS`).not.toContain(
        "Open CMMS"
      );
    }
    expect(renderSamplePlaceholder()).not.toContain("Open CMMS");
  });

  test("/pricing title, meta, and headline lead with the equipment notebook", () => {
    const pricing = pages.find((p) => p.name === "/pricing")!.html;
    expect(pricing).toContain(
      "<title>FactoryLM — The equipment notebook for your maintenance crew</title>"
    );
    expect(pricing).toMatch(
      /<meta name="description" content="[^"]*equipment notebook[^"]*Talk to Mike[^"]*"/i
    );
    expect(pricing).toMatch(
      /<h1>\s*The equipment notebook for your maintenance crew\s*<\/h1>/
    );
    expect(pricing).toContain('data-cta="pricing-talk">Talk to Mike</a>');
    expect(pricing).not.toContain("<title>Pricing — FactoryLM</title>");
    expect(pricing).not.toMatch(/<h1>\s*Talk to Mike\s*<\/h1>/);
    expect(pricing).not.toMatch(/<h1>\s*Pricing\s*<\/h1>/);
  });

  test("/pricing and /buy are Talk to Mike only, with no Offer prices in JSON-LD or meta", () => {
    for (const name of ["/pricing", "/buy"] as const) {
      const html = pages.find((p) => p.name === name)!.html;
      expect(html, `${name} is missing Talk to Mike`).toContain("Talk to Mike");
      expect(html, `${name} still has an Offer block`).not.toMatch(
        /"@type"\s*:\s*"Offer"/
      );
      expect(html, `${name} still has a schema price`).not.toMatch(/"price"/);
      const allowed = name === "/pricing" ? [D1_PRICE] : [];
      for (const amount of dollarAmounts(html)) {
        expect(allowed, `${name} has an unapproved price ${amount}`).toContain(amount);
      }
      expect(html, `${name} links to a checkout`).not.toMatch(/href="[^"]*(checkout|stripe)/i);
      expect(html, `${name} still has $499`).not.toContain("$499");
      expect(html, `${name} still has $2-5K`).not.toMatch(/\$2-5K|\$2,\d{3}|\$5,\d{3}/);
    }
  });

  test("/pricing states Mike's D1 pilot offer exactly (2026-10-27)", () => {
    const pricing = pages.find((p) => p.name === "/pricing")!.html;
    // The visible page body, not just meta tags, must carry the offer.
    const body = pricing.match(/<main[\s\S]*?<\/main>/)?.[0] ?? "";
    expect(body, "/pricing has no <main> body").not.toBe("");
    for (const phrase of D1_PHRASES) {
      expect(body, `/pricing body is missing D1 wording: ${phrase}`).toContain(phrase);
    }
    expect(pricing).not.toContain("no published price");
    expect(pricing).not.toContain("not published here");
  });

  test("/llms.txt omits sensors and work orders", () => {
    const llms = pages.find((p) => p.name === "/llms.txt")!.html;
    const full = pages.find((p) => p.name === "/llms-full.txt")!.html;
    for (const body of [llms, full]) {
      expect(body).not.toMatch(/\bsensors\b/i);
      expect(body).not.toMatch(/work orders/i);
    }
  });

  test("primary CTA is Talk to Mike; self-signup is Sign in only", () => {
    const chrome = navbar() + footer();
    expect(chrome).toContain("Talk to Mike");
    expect(chrome).toContain("Sign in");
    expect(chrome).not.toContain("Book $500");
    expect(chrome).not.toContain("Get Started");
    expect(chrome).not.toContain(">CMMS<");
    expect(chrome).not.toContain("/assess");
  });
});
