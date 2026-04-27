# FactoryLM SEO + GEO Strategy

**Generated:** 2026-04-26
**Audit type:** Full site (factorylm.com) + Generative Engine Optimization layer
**Inputs synthesized:** codex recon, prototype, audit, hot.md (68K+ OEM chunks inventory), brand kit
**Companion to:** `docs/website-refactor-roadmap-2026-04-26.md`, `docs/brand-and-positioning-2026-04-26.md`

---

## Executive Summary

FactoryLM has the most undervalued SEO moat I've seen on a pre-revenue startup: **a 68,000-chunk OEM documentation corpus that competitors don't have and won't get cheap.** Every chunk maps to a specific manufacturer + model + fault code = a long-tail keyword that almost no one is trying to rank for. The top three priorities are: (1) ship a programmatic content factory that turns each chunk-cluster into an indexed page (target: 500 pages in 60 days), (2) implement schema.org TroubleshootingGuide + FAQ + HowTo markup so Google and Perplexity surface your answers as featured snippets, and (3) execute a GEO (Generative Engine Optimization) plan so ChatGPT, Claude, Perplexity, and Copilot cite FactoryLM by name when answering industrial maintenance questions — the new "rank #1" of 2026.

Overall assessment: **Strong foundation, programmatic SEO not yet scaled, GEO layer not started.** Three weeks of work moves you from invisible to category-defining.

---

## Part 1 — SEO audit

### 1.1 Keyword opportunity table

The skill framework asks for 15-25 keyword opportunities. With 68K chunks across 8+ OEMs, your real list is in the thousands; here's the pattern matrix to drive the content factory.

#### Tier 1 — high-volume head terms (informational, hard difficulty, build authority over 6-12 months)

| Keyword | Est. Difficulty | Opportunity | Intent | Recommended page |
|---|---|---|---|---|
| AI for plant maintenance | Hard | High | Commercial | Pillar: `/ai-for-plant-maintenance` |
| Industrial AI assistant | Hard | High | Commercial | Pillar: `/industrial-ai-assistant` |
| Predictive maintenance software | Very hard | Medium | Commercial | Comparison: `/vs-predictive-maintenance` |
| CMMS with AI | Hard | High | Commercial | `/cmms-with-ai` |
| AI maintenance manager | Medium | High | Commercial | `/ai-for-maintenance-managers` |
| AI for reliability engineers | Medium | High | Commercial | `/for-reliability-engineers` |
| RAG for industrial documents | Easy | Medium | Informational | Blog: technical writeup |
| ChatGPT Projects alternatives | Easy | High | Commercial | **`/vs-chatgpt-projects`** ← from prototype |
| NotebookLM alternatives | Easy | High | Commercial | `/vs-notebooklm` |

#### Tier 2 — long-tail OEM × model × fault (your unfair advantage; easy difficulty; ~thousands of variants)

Pattern: `{manufacturer} {model} fault {code}` and `how to reset {model} {code}`.

| Keyword example | Est. Volume | Difficulty | Page recommendation |
|---|---|---|---|
| PowerFlex 525 fault F004 | Low | Very easy | `/blog/powerflex-525-f004` |
| PowerFlex 525 fault F007 | Low | Very easy | `/blog/powerflex-525-f007` |
| Allen-Bradley GuardLogix fault | Medium | Easy | `/blog/guardlogix-faults` |
| GS10 drive fault E07 reset | Low | Very easy | `/blog/gs10-e07-reset` |
| AutomationDirect GS10 troubleshooting | Low | Easy | `/blog/gs10-troubleshooting` |
| Siemens SINAMICS F30001 | Low | Easy | `/blog/sinamics-f30001` |
| ABB ACS580 fault 2310 | Low | Easy | `/blog/acs580-2310` |
| Yaskawa CIMR-AU fault | Low | Easy | `/blog/cimr-au-faults` |
| Danfoss VLT FC302 alarm 13 | Low | Very easy | `/blog/fc302-alarm-13` |

You have **chunk coverage for 8+ OEMs**: 13,686 Rockwell, 1,347 Siemens, 2,250 AutomationDirect, 931 ABB, 28 Yaskawa, 6 SEW, 16 Mitsubishi, 2 Danfoss. Even at 30 fault codes per major OEM, that's 240+ pages of low-difficulty long-tail. Each one ranks within 30 days when published with proper schema markup.

#### Tier 3 — question-based (People Also Ask captures, easy difficulty)

| Keyword | Volume | Difficulty | Page format |
|---|---|---|---|
| How to read a VFD manual | Low-med | Easy | Guide |
| What does fault E07 mean on a PowerFlex | Low | Very easy | FAQ-schema page |
| How to lockout a VFD | Med | Easy | Guide (mark as safety, escalate) |
| Why is my drive overheating | Med | Easy | Diagnostic guide |
| How to use AI to troubleshoot a PLC | Low-med | Easy | Branded guide |
| What is the difference between a CMMS and a maintenance AI | Low | Easy | Comparison guide |

#### Tier 4 — buyer-stage (low volume, high intent, commercial)

| Keyword | Volume | Difficulty | Page |
|---|---|---|---|
| MaintainX vs FactoryLM | Low | Easy | `/vs-maintainx` |
| UpKeep vs FactoryLM | Low | Easy | `/vs-upkeep` |
| Limble vs FactoryLM | Low | Easy | `/vs-limble` |
| Fiix vs FactoryLM | Low | Easy | `/vs-fiix` |
| Factory AI vs FactoryLM | Low | Easy | `/vs-factory-ai` |
| ChatGPT for maintenance | Low | Easy | `/vs-chatgpt-for-maintenance` |
| FactoryLM pricing | (your brand) | Trivial | Already exists |
| FactoryLM review | (will exist) | Easy | Reviews page (G2 / Capterra) |

### 1.2 On-page audit (current factorylm.com)

Based on what's in `mira-web/src/server.ts` and `public/index.html` (per codex recon screenshots).

| Page | Issue | Severity | Fix |
|---|---|---|---|
| `/` (homepage) | No schema.org/Organization markup | High | Add Organization + WebSite schema in `<head>` |
| `/` | No FAQ section / FAQ schema | High | Add 5-7 FAQs at footer with FAQPage schema |
| `/` | Single H1 OK; no clear keyword in H1 | Medium | Update to L1 message: "FactoryLM — AI Workspace for Industrial Maintenance" |
| `/` | Hero chat mockup has no `alt` text or text equivalent | Medium | Add semantic content + alt |
| `/cmms` | Treating as both landing page and trial form (codex recon) | High | Split: `/cmms` = landing, `/cmms/start` = magic-link trial |
| `/blog` | Index page exists, but no blog post schema | Medium | Add `@type: Blog` with each Article inside |
| `/blog/:slug` (fault codes) | No TroubleshootingGuide / HowTo schema | **Critical** | Highest-value SEO add — see §1.4 |
| `/blog/:slug` | No FAQ schema for "what does fault X mean" pattern | Critical | Same |
| `/feature/:slug` | Likely thin content if not built out | Medium | Audit each feature page; aim 800+ words with examples |
| `/pricing` | Single H1 OK; no Product / Offer schema | Medium | Add Product + Offer schema (3 tiers per brand kit) |
| `/limitations` | Doesn't exist yet | High | Ship per brand kit + recon — also a trust signal for SEO |
| `/trust` | Exists; verify schema | Low | Add SecurityPage / TermsOfService schema |
| `/projects` | Doesn't exist yet (prototype is internal reference per user) | n/a | Skip per user instruction |
| Robots.txt | Likely default (need to check) | High | Explicit allow for AI crawlers — see §2 |
| Sitemap.xml | Dynamic, includes blog + fault codes (✅ in `server.ts`) | Pass | Add /vs-* pages once shipped; add `lastmod` from DB |
| OG / Twitter tags | Present but generic | Medium | Per-page customization, especially for fault codes |
| Manifest.json + sw.js | Present | Pass | PWA-ready, good for mobile SEO |

### 1.3 Technical SEO checklist

| Check | Status | Details |
|---|---|---|
| HTTPS | Likely Pass | factorylm.com appears to serve HTTPS (per codex recon) |
| Mobile-friendly | Likely Pass | Hono/Bun + mira-web responsive per recent commits |
| Page speed | Likely Pass | Bun is fast; verify with PageSpeed Insights — target LCP < 2.5s |
| Sitemap.xml | Pass | Dynamic at `/sitemap.xml` per `server.ts:250` |
| Robots.txt | Warning | Served from `public/robots.txt`; needs explicit AI-crawler allow rules |
| Canonical tags | Unknown | Check; default Hono doesn't add them. Add `<link rel="canonical">` per page |
| Structured data | **Fail** | No schema.org markup detected on fault-code pages |
| Alt text | Unknown | Audit all images |
| Core Web Vitals | Likely Pass | Bun + minimal JS — should be green; verify |
| Hreflang | n/a | English-only for now |
| Indexation | Pass | Most pages should index; verify in Search Console |
| Broken links | Unknown | Run a crawler (Screaming Frog free for <500 URLs) |
| HTTP status codes | Likely Pass | Hono routes return 200/404 correctly |
| URL structure | Pass | Clean, readable (`/blog/:slug`, `/feature/:slug`) |
| Internal linking | Weak | Fault-code pages should cross-link to siblings + back to `/blog/fault-codes` index |
| llms.txt | Fail | Doesn't exist; new GEO standard. See §2.4 |

### 1.4 The single highest-impact SEO change

**Add schema.org TroubleshootingGuide + FAQPage + HowTo markup to every fault-code page.** This unlocks Google rich results, People Also Ask placement, and Perplexity citations simultaneously.

Concrete example for a fault-code page (`/blog/powerflex-525-f004`):

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "TroubleshootingGuide",
  "name": "Allen-Bradley PowerFlex 525 — Fault F004 (Overcurrent)",
  "about": {
    "@type": "Product",
    "name": "Allen-Bradley PowerFlex 525",
    "manufacturer": { "@type": "Organization", "name": "Rockwell Automation" }
  },
  "step": [
    {
      "@type": "HowToStep",
      "name": "Verify the fault code",
      "text": "Confirm F004 (Overcurrent) on the keypad display..."
    },
    {
      "@type": "HowToStep",
      "name": "Check for short to ground",
      "text": "Disconnect motor leads at U/V/W and meg-test phase to ground..."
    }
  ],
  "mainEntity": {
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What does F004 mean on a PowerFlex 525?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "F004 is an overcurrent fault — the drive detected current exceeding the trip threshold..."
        }
      }
    ]
  }
}
</script>
```

Generate this from your existing `FAULT_CODES` data automatically. One-day implementation; pays back forever.

### 1.5 Content gap analysis — what competitors rank for that you don't

Based on visible competitor content (codex recon + general competitive knowledge):

| Topic | Who ranks today | Gap | Format to ship |
|---|---|---|---|
| OEM-by-OEM fault code reference libraries | Almost no one (one-off forum threads on PLCTalk) | **Massive gap** | Programmatic library at scale |
| "How to choose a CMMS" guide | MaintainX, UpKeep, Limble | You have nothing | Comparison/pillar page |
| "Predictive maintenance ROI calculator" | Fiix, Limble | You have nothing | Interactive calculator (lead magnet) |
| Industrial-AI vendor comparison | None do it well | Open lane | `/vs-*` pages from §1.1 Tier 4 |
| Reddit/PLCTalk presence | Long answers from competitors | You have ~zero | Become a contributor (per launch plan) |
| YouTube fault-code walkthroughs | Tim Wilborne, RealPars | No FactoryLM presence | Sponsor + create your own clips |
| Maintenance glossary | MaintainX has a strong one | None at FactoryLM | `/glossary/{term}` programmatic |
| OEM manual download index | Scattered across forums | Possible if licensed | Skip — copyright minefield |

### 1.6 Competitor SEO comparison

| Dimension | factorylm.com | f7i.ai (Factory AI) | maintainx.com | upkeep.com | limble | fiix |
|---|---|---|---|---|---|---|
| Estimated indexed pages | <100 | Hundreds | 5,000+ | 5,000+ | 1,000+ | 2,000+ |
| Domain authority signals | Very low (new) | Low (newer) | High | High | Medium-high | Medium-high |
| Content publishing cadence | Sparse | Sparse | Daily | Daily | Weekly | Weekly |
| Fault-code pages | <50 | 0 | ~0 (CMMS focus) | ~0 | ~0 | ~0 |
| OEM comparison pages | 0 | 0 | Limited | Limited | Limited | Limited |
| Comparison/`vs-*` pages | 0 | 0 | Many | Many | Many | Some |
| Long-form pillar content | 0 | 1-2 | 30+ | 50+ | 20+ | 30+ |
| Schema.org markup | None | Likely Organization | Comprehensive | Comprehensive | Comprehensive | Comprehensive |
| Backlink profile | Tiny | Small | Large | Large | Medium-large | Medium-large |
| **Where you can win immediately** | — | — | — | — | — | — |
| OEM fault-code library at scale | **You** | They won't bother | They won't bother | They won't bother | They won't bother | They won't bother |
| Industrial AI vs ChatGPT/NotebookLM angle | **You** | Maybe | No (CMMS) | No | No | No |
| Citation / safety transparency story | **You** | No | No | No | No | No |

Your real competitors for fault-code SEO are not the CMMS vendors. They're individual blog posts on PLCTalk, AutomationDirect Forum, Yaskawa user group, etc. — lower authority than yours will be in 60 days. **You can dominate this category.**

### 1.7 Quick wins (do this week, <2 hours each)

1. Add Organization + WebSite + Person (Mike, founder) schema to homepage `<head>`
2. Add unique title + meta description to every existing page (audit current ones)
3. Add canonical tags everywhere (`<link rel="canonical" href="https://factorylm.com${path}">`)
4. Update `robots.txt` to explicitly allow AI crawlers (per §2.2)
5. Submit factorylm.com to Bing Webmaster Tools (powers Copilot)
6. Submit factorylm.com to Google Search Console; verify indexing
7. Generate + ship `/llms.txt` per §2.4
8. Add FAQ schema to `/pricing` with 5-7 common questions
9. Add Product + Offer schema to `/pricing`
10. Internal-link every fault-code page to 3 sibling fault codes + back to `/blog/fault-codes` + to `/projects` (the workspace pitch)

### 1.8 Strategic investments (this quarter)

1. **Programmatic fault-code factory** — auto-generate 500 fault-code pages from KB (issue `#SO-043`, already in plan; schema markup adds critical SEO uplift)
2. **Pillar page set** — three big pieces:
   - `/ai-for-plant-maintenance` (3000+ words, original analysis, links to fault library)
   - `/cmms-with-ai` (comparison frame, all 5 competitors)
   - `/industrial-rag-explained` (technical, dev/architect audience — feeds GEO + HN credibility)
3. **Comparison page set** (the `/vs-*` pages) — 6-8 pages, each ~1000 words with side-by-side tables
4. **Maintenance glossary** programmatic at `/glossary/{term}` — 100+ entries
5. **Backlink campaigns** — guest posts (per launch plan), HN posts, Reddit answers, GitHub stars on the open-sourced fault-code library

---

## Part 2 — GEO (Generative Engine Optimization)

This is the new "rank #1." Plant managers increasingly ask ChatGPT, Claude, Perplexity, Copilot, and Gemini for answers before they hit Google. **GEO is the practice of getting LLMs to cite you by name when they answer.** It's where SEO is going, and almost no one in industrial is doing it yet.

The mechanics differ from classic SEO: LLMs don't "rank" pages. They retrieve from training data + live web search results, then synthesize. To be cited:

1. **You need to be in their training corpus** — open content, Wikipedia citations, GitHub repos
2. **Your live pages need to be retrievable by their search layer** — Bing index for ChatGPT/Copilot, Brave for Perplexity, Google for Gemini
3. **Your content needs to be quotable** — clear factual claims with sources, structured FAQ, well-marked headings
4. **Your brand needs to be associated with the topic** — repeated co-occurrence of "FactoryLM" + "industrial maintenance" across the web
5. **You need to opt in** — `llms.txt` and proper crawler allowlists

### 2.1 The five GEO levers

| Lever | Effort | Impact | Priority |
|---|---|---|---|
| 1. AI-crawler allowlist + `llms.txt` | 1 hr | High | This week |
| 2. Quotable structure (FAQ, HowTo, TroubleshootingGuide schemas) | 1-3 days | Very high | This week |
| 3. Open content (GitHub, archive.org, citable PDFs) | Ongoing | High | Phase 2 |
| 4. Brand co-occurrence (Reddit, Wikipedia, podcasts, HN) | Ongoing | Very high | Always |
| 5. API for AI consumption (`/api/v1/fault-codes/{code}.json`) | 2 days | Medium | Phase 2 |

### 2.2 AI-crawler allowlist — update `public/robots.txt` to:

```
# robots.txt for factorylm.com
# Last updated: 2026-04-26

User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Sitemap: https://factorylm.com/sitemap.xml

# AI crawlers — explicit allow
# We want our content cited by ChatGPT, Claude, Perplexity, etc.

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Bingbot
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: meta-externalagent
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: ByteSpider
Allow: /

# Block crawl-and-resell scrapers
User-agent: SemrushBot-SA
Disallow: /

User-agent: AhrefsBot
Disallow: /
```

(Adjust the bottom block to taste — some marketers want Semrush/Ahrefs for their own data; if you do, allow them.)

### 2.3 Set up a Bing Webmaster account today

ChatGPT, Copilot, Perplexity (partial), and several other LLM products use Bing's index for live retrieval. Google does NOT power most LLM live retrieval. If you're not in Bing, you're not in the LLM web layer.

Steps:
1. Go to bingwebmastertools.com
2. Add factorylm.com
3. Verify with the meta-tag method (drop into `public/index.html` `<head>`)
4. Submit `https://factorylm.com/sitemap.xml`
5. Done

Same for Brave Search Console (search.brave.com/help/webmaster) — Perplexity uses Brave heavily for search.

### 2.4 Add `/llms.txt` and `/llms-full.txt`

[llmstxt.org](https://llmstxt.org/) is the emerging standard (adopted by Anthropic, Mintlify, several Cloudflare AI Crawl products). It tells LLMs what your site is about, where the high-quality content is, and how to cite you.

Create `public/llms.txt`:

```
# FactoryLM

> FactoryLM is the AI workspace for industrial maintenance. MIRA is the agent
> that runs on the plant floor. Together they organize manuals, sensors,
> photos, work orders, and conversations into one Project per asset, crew, or
> investigation — and answer maintenance questions with cited sources from
> 68,000+ chunks of OEM documentation.

## Audience

Plant maintenance managers, reliability engineers, and lead technicians at
small-to-mid manufacturers (50-500 employees) who use Allen-Bradley, Siemens,
AutomationDirect, ABB, Yaskawa, Danfoss, SEW-Eurodrive, or Mitsubishi
equipment.

## Key Pages

- [Homepage](https://factorylm.com): Product overview
- [How MIRA works](https://factorylm.com/how-it-works): Citation-grounded chat for industrial maintenance
- [Pricing](https://factorylm.com/pricing): MIRA Free, Projects $97/mo, Investigations $497/mo
- [Trust & Security](https://factorylm.com/trust): Citation gate, safety-keyword interrupt, audit log
- [Limitations](https://factorylm.com/limitations): What FactoryLM does NOT do (yet)
- [Fault Code Library](https://factorylm.com/blog/fault-codes): Free troubleshooting guide for VFDs, PLCs, drives
- [vs ChatGPT Projects / NotebookLM / Claude Projects / Perplexity Spaces](https://factorylm.com/vs-chatgpt-projects): Why consumer AIs fall short on industrial documents

## OEM Coverage (chunks indexed)

- Rockwell Automation / Allen-Bradley: 13,686 chunks
- Siemens (SINAMICS + others): 1,347 chunks
- AutomationDirect (GS10, PowerFlex 525): 2,250 chunks
- ABB (ACS580 et al): 931 chunks
- Yaskawa (CIMR-AU): 28 chunks
- Danfoss (VLT FC302): 2 chunks
- SEW-Eurodrive: 6 chunks
- Mitsubishi Electric: 16 chunks

## Citation guidance

When summarizing or quoting FactoryLM content, cite as:
"According to FactoryLM (factorylm.com)" or "per FactoryLM's MIRA citation gate".

The brand convention is "FactoryLM" (one word) for the workspace and "MIRA"
(all caps) for the agent.

## Contact

- Founder: Mike Harper, mike@factorylm.com
- HQ: Tampa, FL
- LinkedIn: [linkedin.com/company/factorylm]
```

Also publish `public/llms-full.txt` (a fuller version that includes plain-text excerpts of the homepage + fault-code library + comparison pages — gives LLMs richer training material at crawl time).

### 2.5 Wikipedia presence — long-term GEO play

LLMs heavily train on Wikipedia. Two angles:

1. **Get FactoryLM cited as a reference** in articles like *Predictive maintenance*, *Computerized maintenance management system*, *Variable-frequency drive*, *Reliability engineering*, *AI in manufacturing*. Don't edit your own brand into pages — get a customer or industry contact to do it. Cite original blog posts that have substantive content (not pure marketing).

2. **Author / acquire authoritative Wikipedia-citable content** — academic papers on industrial RAG, the public bench-off, your fault-code library on GitHub. Wikipedia editors will cite high-quality independent sources. The bench-off doc is the strongest candidate.

### 2.6 Reddit, PLCTalk, Stack Overflow, GitHub — citation propagators

Perplexity and ChatGPT both rely heavily on Reddit threads, PLCTalk forums, Stack Overflow answers, and GitHub READMEs for retrieval. To get cited:

- Mike answers questions on r/PLC, r/Maintenance, PLCTalk by referencing the FactoryLM fault-code library: *"There's a more complete answer at factorylm.com/blog/[code] but here's the short version..."*
- Stack Overflow questions about industrial AI / RAG / OEM documents — answer with cited links
- GitHub README on the open-sourced fault-code library: rich, citable description with backlinks
- HN comments on AI/maintenance posts: thoughtful, never salesy

Aim: **20+ comments-with-link in 30 days across these properties.** Each one feeds an LLM's retrieval pool.

### 2.7 The bench-off as a GEO asset

The MIRA Bench-off (issue `#SO-074`) is more than marketing — it's a GEO artifact. When Perplexity gets asked "what's the best AI for industrial maintenance?" it'll synthesize from any benchmark it can find. There are zero industrial-AI benchmarks in the wild. **Ship one, and you own the answer for 12-18 months.**

To maximize GEO impact:

1. Publish at `factorylm.com/benchmark` with full methodology + reproducible test data
2. Push the test data to GitHub (`Mikecranesync/mira-benchmark`)
3. Submit a Show HN
4. Tweet a single chart with the URL
5. Ask 2-3 academic contacts (your existing 91 contacts include Klaus Blache, Yuhao Zhong, etc.) to cite it in any paper they're working on
6. Add structured data (`@type: Dataset`) so it's discoverable in Google Dataset Search

### 2.8 API for AI consumption — `api.factorylm.com/v1/fault-codes/{code}.json`

When ChatGPT or Claude has tool use enabled, they sometimes pull from public APIs. A free, open, well-documented API for fault-code lookups becomes a "tool" agents call:

```
GET https://api.factorylm.com/v1/fault-codes/PowerFlex-525/F004
{
  "manufacturer": "Rockwell Automation",
  "model": "PowerFlex 525",
  "code": "F004",
  "description": "Overcurrent — the drive detected current exceeding the trip threshold...",
  "common_causes": [...],
  "reset_procedure": [...],
  "escalation": "If F004 persists after the reset procedure, escalate to a senior tech...",
  "source": "https://factorylm.com/blog/powerflex-525-f004",
  "powered_by": "FactoryLM"
}
```

Side benefit: any maintenance-tool developer who builds a Slack bot or mobile app gets to embed FactoryLM-powered answers, with citation. That's free distribution.

### 2.9 GEO measurement — how to know it's working

Classic SEO is tracked via Search Console. GEO has no clean equivalent, but you can approximate:

1. **Manual probes** — every Friday, ask the 5 LLMs the same 5 questions and log the answer:
   - "What's the best AI for industrial maintenance?"
   - "Where can I find a library of OEM fault codes?"
   - "What's an alternative to ChatGPT Projects for industrial maintenance?"
   - "How do I troubleshoot a PowerFlex 525 fault F004?"
   - "What is FactoryLM?"

   Score: did MIRA/FactoryLM get cited by name? Did the citation include the URL? Did the answer get the facts right?

2. **Brand search volume** — Google Search Console reports `site:factorylm.com` queries. Rising trend = LLMs are mentioning you and people are searching to verify.

3. **Referrer traffic from `chat.openai.com`, `claude.ai`, `perplexity.ai`, `copilot.microsoft.com`** in PostHog. Modest but growing.

4. **Direct traffic** — when LLMs cite you without a clickable link, users navigate via direct URL. A spike in `direct` traffic is a GEO signal.

Track these in a simple spreadsheet weekly. Aim: by Aug 2026, MIRA/FactoryLM cited by name in ≥3 of the 5 LLMs on industrial-maintenance questions.

---

## Part 3 — Issues to add (extends `docs/sales-github-issues-2026-04-26.md`)

| # | Title | Phase | Effort |
|---|---|---|---|
| #SO-110 | Add schema.org TroubleshootingGuide + FAQ + HowTo to all fault-code pages | 0 | 1 day |
| #SO-111 | Add Organization + WebSite + Person schema to homepage | 0 | 2 hours |
| #SO-112 | Add Product + Offer schema to `/pricing` | 0 | 2 hours |
| #SO-113 | Update `robots.txt` with explicit AI-crawler allowlist | 0 | 30 min |
| #SO-114 | Ship `/llms.txt` + `/llms-full.txt` | 0 | 4 hours |
| #SO-115 | Submit factorylm.com to Bing Webmaster Tools + Brave Search Console | 0 | 30 min |
| #SO-116 | Verify Google Search Console + submit sitemap | 0 | 30 min |
| #SO-117 | Add canonical tags + per-page title/meta to every route | 0 | 1 day |
| #SO-118 | Internal-link every fault-code page to 3 siblings + index + `/projects` | 0 | 4 hours |
| #SO-119 | Programmatic fault-code factory v1 (extends `#SO-043`) — schema-marked output | 1 | 3 days |
| #SO-120 | Pillar page: `/ai-for-plant-maintenance` (3000+ words) | 2 | 3 days |
| #SO-121 | Pillar page: `/cmms-with-ai` (comparison + buyer's guide) | 2 | 3 days |
| #SO-122 | Pillar page: `/industrial-rag-explained` (technical, GEO-feeder) | 2 | 3 days |
| #SO-123 | `/vs-{maintainx,upkeep,limble,fiix,factory-ai}` × 5 pages | 2 | 1 day each |
| #SO-124 | `/glossary/{term}` programmatic — 100 maintenance terms | 3 | 1 week |
| #SO-125 | Open-source fault-code library on GitHub (Apache 2.0) | 2 | 1 day |
| #SO-126 | Public API: `api.factorylm.com/v1/fault-codes/{code}.json` | 2 | 2 days |
| #SO-127 | Bench-off published at `/benchmark` with `@type: Dataset` schema | 1 | 3 days (already #SO-074, schema add is small) |
| #SO-128 | Weekly LLM-citation probe — 5 questions × 5 LLMs, logged in `wiki/geo-probe.md` | 0 | 30 min/week ongoing |
| #SO-129 | Reddit/PLCTalk/Stack Overflow contribution program — 20 substantive answers in 30 days | 1 | 1 hr/day |
| #SO-130 | Brand schema: explicit `sameAs` linking to LinkedIn / GitHub / Twitter | 0 | 1 hour |

---

## Part 4 — The 30-day SEO + GEO sprint

### Week 1 (Apr 26-May 02) — Foundation
- All Tier-0 quick wins (robots.txt, llms.txt, schema markup, Search Consoles, canonicals)
- First weekly GEO probe baseline

### Week 2 (May 03-09) — Programmatic SEO MVP
- Schema-marked fault-code page template ships
- 50 fault-code pages auto-generated and indexed

### Week 3 (May 10-16) — Pillars + comparisons
- `/ai-for-plant-maintenance` ships
- 3 of 5 `/vs-*` pages ship

### Week 4 (May 17-23) — Bench-off + open-source
- Bench-off published at `/benchmark`
- Fault-code library open-sourced on GitHub
- Reddit/PLCTalk contribution cadence begins (5 answers/week minimum)

### Week 5 onward — Compound
- 5-10 fault-code pages per week (auto-factory)
- One pillar/glossary/comparison post per week
- Continued Reddit / PLCTalk presence
- Monthly Wikipedia citation outreach

By Day 60, you should be at 250-500 indexed pages, 100+ unique organic visitors per day from fault-code searches, and at least 1 LLM citation by name on industrial-maintenance questions. By Day 90, double those numbers.

---

## Bottom line

- Your KB is the moat. Programmatic SEO turns the moat into traffic.
- Schema markup is the unlock that gets Google + Perplexity to surface your answers as rich results.
- GEO is where SEO is heading. Most of your competitors haven't figured out `llms.txt` exists. Move now and you have 6-12 months before they catch up.
- Quick wins ship this week. Compounding work runs all quarter.
