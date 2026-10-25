# MIRA Blog / Daily SEO Plan (draft, Oct 25, 2026 ET)
Status: plan only. Nothing was posted, filed, messaged or deployed. Source snapshot: /workspace/mira-main-8ca0b52/mira-web.

## 0. Key finding: a blog already exists, so reuse it instead of building a new one
mira-web is a **Bun + Hono** server (`src/server.ts`) that renders HTML on the server and ships as a Docker image (`oven/bun:1.2.10-slim`). It deploys through the repo's GitHub workflows: `deploy-staging.yml` goes to staging.factorylm.com, and prod is the `mira-web` service. These pieces are already live:
| Piece | Where | State |
|---|---|---|
| `/blog`, `/blog/:slug`, `/blog/fault-codes` | server.ts L543-570, `lib/blog-renderer.ts` | Live |
| 9 long-form posts | `src/data/blog-posts.ts` (TS objects, section blocks) | Generic guides, Apr 2026. One is "what-is-cmms" |
| ~51 static fault-code pages | `src/data/fault-codes.ts` | Hand-written generic causes and fixes, **no manual page citations**, multi-brand |
| Drive Commander fault and parameter pages | `/drive-commander/:model/faults/:code` and `/parameters/:pid` from `data/drive-packs/*.json` (PF40, PF525, G120) | **Manual-cited** (provenance: doc + page) |
| DB-backed drafts | `lib/blog-db.ts` reads the Neon `blog_drafts` table, 5-min cache | Table not provisioned yet ("editorial workflow" never shipped) |
| Sitemap | `lib/sitemap.ts`, dynamic, real per-page `lastmod` | Live. Includes all of the above, so roughly 200 URLs |
| JSON-LD | Article + BreadcrumbList on posts, HowTo/TroubleshootingGuide on fault codes | Live. **No FAQPage, no BlogPosting** |
| Canonical + Open Graph | `blog-renderer.ts` head | Live (one shared og-image) |
| llms.txt / llms-full.txt | server.ts L489-500 | Live (good for AI answer engines) |
| Analytics | PostHog via `/posthog-init.js` (`PLG_POSTHOG_KEY`) | Wired. Uses cookies, `person_profiles: identified_only` |
| RSS | none | **Missing** |

### Scaled-content risk in what's already live (Search Steward's ~200 sitemap URLs)
- **Drive Commander pages (manual-cited):** low risk. Each page decodes a real fault from a cited OEM manual page, which makes it useful reference material. Keep them.
- **The 51 `fault-codes.ts` pages:** **medium risk.** They're templated, carry no citations, use generic causes across brands, and are "FactoryLM Engineering"-authored with no reviewer. This is the pattern Google's *scaled content abuse* policy targets, especially if a lot more get added. They also contradict our "cited from the manual" pitch. **Recommendation:** freeze new ones. Over 2–4 weeks, either add a manual citation (doc, edition, page) to each page or `noindex` and merge the thin ones. Don't mass-generate more.
- **The 9 old posts:** fine to keep. Check "what-is-cmms" against the "not a CMMS" positioning, and check any claims against Content Studio's landing audit (T-020).
- `/pricing`, `/buy` and `/assess` are in the sitemap even though we want prices off the public pages (T-020). Mike decides whether they should stay indexed.

## 1. Simplest way to add the daily blog (build on top, ~1 PR, small–medium)
- **Content folder:** `mira-web/content/blog/YYYY-MM-DD-slug.md`, Markdown with front matter (title, description, date, updated, slug, tags, sources[], faq[], status). **Publishing = adding one file.** At startup, a loader parses the folder and merges it into `BLOG_POSTS` using the same `BlogPost` shape (the body renders to sections, or the renderer takes raw HTML). Posts with a future `date` stay hidden until that day, which gives scheduled publishing without a cron job.
- **Reuse:** the existing `/blog` index, `/blog/:slug` and sitemap pick the posts up automatically.
- **Add:**
  - `/blog/tag/:tag` pages
  - `/blog/rss.xml` (and link it in the head)
  - **BlogPosting** JSON-LD (replacing the generic Article) with `citation` entries for each source
  - **FAQPage** JSON-LD from the `faq` front matter
  - A visible "Sources" block (forum thread + manual doc/edition/page)
  - A "Reviewed by <name>, <date>" line
  - Per-post OG image (optional)
  - Internal links: each post → landing page `/` and 2–3 related posts/fault pages; the landing page → `/blog` and the latest 3 posts
- **Keep** canonical = `https://factorylm.com/blog/<slug>`. Add **IndexNow** pings to Bing/Yandex on deploy (free).
- Tests: the loader parses all files, the sitemap contains new slugs, RSS validates, JSON-LD validates (run the Rich Results test manually on staging), and future-dated posts return 404.

## 2. Unique-visitor tracking
**Recommendation: Cloudflare Web Analytics (cookieless, free) if factorylm.com is behind Cloudflare. Otherwise self-host Umami** (MIT license, cookieless, one container plus Postgres, which we already run). Keep PostHog for in-app funnels and CTA clicks. Cookieless tracking avoids a cookie banner for the blog.
Also: **Google Search Console** and **Bing Webmaster Tools** (impressions, clicks, queries, indexing). Bing feeds ChatGPT search and Copilot, so it matters for GEO.
| Mike does (needs his accounts) | Foreman builds |
|---|---|
| Create Cloudflare WA site (or approve an Umami host + subdomain) | Add the beacon script to the shared head, behind an env var |
| Verify factorylm.com in Search Console (DNS TXT record) and Bing (import from GSC) | Weekly report script: unique visitors, top /blog pages, referrers (plctalk, reddit, google, bing, chatgpt.com, perplexity) |
| Submit `/sitemap.xml` in both | UTM convention for links we share ourselves |
| Put the WA token / Umami ID in Doppler | |
Rule: analytics data and any customer data never go to free LLM models. Reports use aggregates only.

## 3. Daily publishing workflow (**needs Mike's decision**)
Only Mike merges, and Foreman builds. Options:
- **A (recommended): a weekly batch PR with daily scheduled dates.** Each Friday, Content Studio drafts 7 posts, Search Steward checks them, and Foreman opens **one PR** with 7 future-dated files. Mike reviews and merges once a week, and the posts go live one per day on their own (the date gate in §1). That's one tap a week, every post human-reviewed, and still a daily post.
- **B: one PR per day.** Mike merges each morning. It's the most control but the easiest to miss.
- **C: a CMS / `blog_drafts` table that Mike approves in a UI.** Content changes wouldn't need a deploy, but it's more to build and puts publishing outside code review.
Either way, a post can't ship unless the front matter has `status: approved` plus a reviewer name. CI fails if `sources` is empty or a link doesn't return 200.

## 4. Post format (SEO + GEO) and policy guardrails
- **One real technician question per post** (a fault code or symptom). The title is the question in plain words, and the first ~50 words are the direct answer, which is what AI engines quote.
- Then the steps, citing the **OEM manual, edition and page**, with a "watch out for" section.
- A **link out to the public thread** it came from (summarize the question, never copy replies), plus the OEM doc link where it's public.
- A safety note where relevant, in catalog-only form ("follow your lockout procedure"). Never a step-by-step for energized or safety-function work.
- No prices, no competitor names, no unverified claims. The MIRA mention is one honest line at the end.
- A 3–5 Q FAQ goes into FAQPage JSON-LD.
- **Google policies:** *scaled content abuse* (many pages made mainly to rank, AI-generated or not) and *site reputation abuse*. Daily posts are fine **only if** each one is useful, accurate and human-reviewed. No mass-generated pages, no spun variants, no keyword-stuffed tag pages.
- **What "cross-linking" means here:** we link **out** to the real threads and manuals, which adds credibility, and we **earn** links back by being the best answer. No link schemes, no paid links, no PBNs, no spam or self-promo comments on PLCtalk, MrPLC or Reddit. If Mike posts a helpful answer on a forum himself, he discloses he's affiliated, and a link goes in only where the forum's rules allow. Most forums ban self-promotion.
- **What "old school SEO, most powerful version" means honestly:**
  - Consistent daily fresh content
  - Tight topic clusters: a Micro800 hub page, an S7-1200 hub, a TP700 hub and a drives hub, each linking to its posts
  - Strong internal linking
  - Sitemap + RSS + IndexNow
  - Search Console / Bing submission
  - Fast server-rendered pages (already the case)
  - Earned links from OEM-user communities and newsletters

## 5. 30-day topic seed list
Verified on Oct 25, 2026 ET. **"200"** means curl loaded the page from the box today. **"T-013"** means it was verified in `/workspace/marketing/research/plc-question-gaps-2026-10-25.md` (Reddit and SiePortal pages are only confirmed via the search index; open them in a browser before publishing). **"301"** means the link redirects to a live canonical URL.
| Day | Product | Question | Source URL | Check | Manual on box |
|---|---|---|---|---|---|
| 1 | Micro820 | Flashing red fault after failed download, clear without CCW (**drafted**) | https://www.plctalk.net/forums/threads/micro820-fault-help.106371/ | 200 | 2080-UM005 |
| 2 | S7-1200 | How to factory reset (**drafted**) | https://www.plctalk.net/forums/threads/siemens-s7-1200-factory-reset.122271/ | 301→200 | S7-1200 SM |
| 3 | TP700 | Comfort losing all touch (**drafted**) | https://www.plctalk.net/forums/threads/siemens-tp700-comfort-losing-all-touch.117233/ | 200 | Comfort OI |
| 4 | PowerFlex 525 | F004 followed by F005 | https://www.plctalk.net/forums/threads/powerflex-525-f004-followed-by-f005.140604/ | 200 | Drive pack (520-UM001) |
| 5 | S7-1200 | Unlock CPU protection / lost password | https://www.plctalk.net/forums/threads/unlock-s7-1200-cpu-protection.146988/ | 200 | S7-1200 SM §6.5 |
| 6 | Micro820 | Failed downloads "brick" the unit | https://www.plctalk.net/forums/threads/micro820-failed-downloads-lead-to-a-bricked-unit.134972/page-2 | T-013 200 | UM005 App. C |
| 7 | Conveyor/VFD | Conveyor motors humming, overload on start | https://www.plctalk.net/forums/threads/motor-seizing-on-startup.139619/ | 200 | general (non-PF drive; no named brand in post) |
| 8 | PowerFlex 525 | Beginner: drive overload on run (motor data) | https://www.plctalk.net/forums/threads/powerflex-525-beginner-help.149269/ | 200 | Drive pack |
| 9 | S7-1200 | HMI shows #### instead of values (1212C) | https://www.plctalk.net/forums/threads/siemens-s7-1212c-tia-portal-on-hmi-appears-instead-of-real-values.150120/ | 200 | S7-1200 SM / Basic Panels OI |
| 10 | Micro820 | New unit: what's its IP? Not found | https://www.reddit.com/r/PLC/comments/1nr4ba0/micro820_configuration_issues/ | T-013 indexed | UM005 [IPA] p.120 |
| 11 | S7-1200 | Flashing LEDs, can't reset or connect | https://www.plctalk.net/forums/threads/s7-1200-flashing-leds-cant-reset-it-cant-connect.110799/ | T-013 200 | S7-1200 SM |
| 12 | PowerFlex 4 | F012 HW overcurrent at power-up | https://www.plctalk.net/forums/threads/powerflex4-fault.52470/ | 200 | needs PF4 manual |
| 13 | TP700 | Factory reset without TIA after failed OS update | https://sieportal.siemens.com/en-ww/support/forum/posts/factory-reset-tp700-comfort-without-tia-portal/130297 | T-013 indexed | Comfort OI §5.7 + FAQ 19701610 |
| 14 | Micro850 | USB connection not working | https://mrplc.com/forums/topic/45935-micro850-usb-connection/ | 200 | 2080-UM001 (on box) |
| 15 | S7-1200 | MTP700 Unified Basic can't write to PLC | https://www.plctalk.net/forums/threads/mtp700-unifi-basic-hmi-cannot-write-commands-to-siemens-s7-1200-plc.150135/ | 200 | missing (Unified Basic) |
| 16 | Micro820 | Can't connect over Ethernet, flashing fault | https://www.reddit.com/r/PLC/comments/13su0o2/micro_820_cant_connect/ | T-013 indexed | UM005 |
| 17 | Conveyor | Cabinet of PowerFlex 4s won't power up | https://www.plctalk.net/forums/threads/power-flex-4-powerup-problems.60771/ | 301→200 | needs PF4 manual |
| 18 | S7-1200 | CPU went to STOP, won't take program | https://www.reddit.com/r/PLC/comments/1h8ank0/stop_on/ | T-013 indexed | S7-1200 SM (diag buffer) |
| 19 | TP700 | Stuck at SIMATIC HMI boot screen | https://sieportal.siemens.com/en-ww/support/forum/posts/tp700-comfort-the-os-does-not-boot/168455 | T-013 indexed | Comfort OI + FAQ |
| 20 | Micro820 | Wiring sensors to inputs | https://www.plctalk.net/forums/threads/allen-bradley-micro820-plc-sensors.134162/ | T-013 200 | UM005 |
| 21 | GS20 drive | Runs over EtherNet/IP? FWD lit but won't run | https://www.plctalk.net/forums/threads/command-over-ethernet-ip-sysmac-studio-and-automation-direct-gs20.139484/ | 200 | GS20 manual App. B (public PDF, fetch) |
| 22 | Micro800 + PF | Micro830 to PowerFlex comms | https://www.plctalk.net/forums/threads/micro830-to-powerflex-communications-i-though-this-was-supposed-to-be-easy.75028/ | 200 | UM001 + drive pack |
| 23 | TP700 | ProSave reset stuck "Please boot the HMI device" | https://sieportal.siemens.com/en-ww/support/forum/posts/-/251724 | T-013 indexed | FAQ 19701610 |
| 24 | GS-series VFD | VFD on high-leg delta supply | https://www.plctalk.net/forums/threads/vfd-and-high-leg.150105/ | 200 | needs GS4 manual; safety-heavy, catalog-only |
| 25 | Micro820 | Analog input for a discrete device | https://electronics.stackexchange.com/questions/298909/can-i-use-an-analog-input-for-a-discrete-signal-field-device-on-the-a-b-micro820 | T-013 indexed | UM005 |
| 26 | Conveyor | Sudden "motor fault" but overload not tripped | https://www.plctalk.net/forums/threads/question-about-sudden-motor-faults.72781/ | 301→200 | general + 3RV2 MSP manual (on box) |
| 27 | PowerFlex 755 | Reserved "web enable" parameter | https://mrplc.com/forums/topic/45860-powerflex-755-reserved-web-enable-parameter/ | 200 | missing |
| 28 | Comfort panel | TP1200 "HmiRTm.exe serious error" | https://mrplc.com/forums/topic/45898-hmi-tp1200-comfort-panel-error-application-hmirtmexe-encountered-a-serious-error-and-must-shutdown/ | 200 | Comfort OI |
| 29 | S7-1200 G2 | Bogus analog values | https://www.reddit.com/r/PLC/comments/1pn65nj/im_getting_bogus_values_from_reading_analog_card/ | T-013 indexed | G2 manual missing |
| 30 | GS20 | Control GS20 frequency over EtherNet/IP (beginner) | https://community.automationdirect.com/s/question/0D5PE00000HQXgf0AH/help-a-beginner-control-gs20-frequency-via-ethernet-ip | search index only | GS20 App. B |
Manuals missing for days 12, 15, 17, 24, 27 and 29. Ask the Librarian, or move those topics later. Day 24 covers supply voltage and grounding, so keep it catalog-only and refer readers to a qualified electrician.

## 6. Example posts (in `queue/`, status draft-needs-human-review)
- `2026-10-27-micro820-flashing-red-fault-clear.md`: 2080-UM005H pp.118, 120, 149
- `2026-10-28-s7-1200-reset-to-factory-settings.md`: S7-1200 SM V4.7 §15.9 pp.1057–1058
- `2026-10-29-tp700-comfort-touch-calibration.md`: Comfort OI §4.3.5.6 pp.91–92. The "external USB mouse" hint and `CalibrateTouchScreen` are **UNVERIFIED** against the manual, so check them before publishing.

## 7. Measuring payoff
Weekly: unique visitors to /blog/* (CF WA/Umami), GSC impressions/clicks/indexed count, Bing clicks, referrals from forums and AI engines, and blog → landing → signup clicks (PostHog `cta_click`). Baseline it before post #1 ships.
