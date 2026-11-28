# FactoryLM search and answer-discovery guide

Version 0.3, 2026-10-25 (America/New_York). Draft. Applies to technical articles and their landing-page references. [STYLE-GUIDE](STYLE-GUIDE.md) is the editorial authority; this file does not certify product behavior or a live-site audit.

## 1. Start with a useful answer

Target one real technician question per page. A good page explains the condition, applicable scope, first evidence to collect and limits, then links the exact OEM source. Do not build separate near-duplicate pages for every wording of the same question.

Reference content about a fault is different from a claim that MIRA can diagnose or clear it. The Micro820, S7-1200 and PowerFlex articles may serve a legitimate reference need only after technical review. Their CTA must not promise that the product performs the high-risk task discussed.

Use OEM names and exact model/code terms when needed to identify the subject. Do not turn an article about a manufacturer into a claim of OEM affiliation, endorsement or broad MIRA support. The ban on competitor promotion does not require removing the equipment's identity.

## 2. Search metadata that preserves meaning

| Surface | Rule |
|---|---|
| Title / H1 | Lead with model and reader question. A roughly 50-65 character SEO title is a drafting target, not a search-engine requirement. Preserve qualifiers over a character target. |
| Description | Describe the useful answer and scope in one or two short sentences. Aim for concise copy, roughly 140-160 characters when it fits naturally. No imperative reset recipe or unsupported performance promise. |
| Slug | Stable, descriptive, lowercase, hyphen-separated. Do not change an established slug merely to match a revised title; preserve or redirect existing URLs. |
| Opening answer | Usually two or three self-contained sentences. Include a material consequence or condition if omission would change the decision. No fixed word count guarantees a search snippet or AI citation. |
| Headings | Use actual reader questions when natural. Do not repeat the same exact keyword phrase in every heading. |
| Links | Descriptive anchors to applicable OEM material and useful live related content. Do not invent hubs or link to posts that have not become available. |
| Dates | `datePublished` is actual first publication; `dateModified` reflects a substantive update. A queue filename or review date is not publication. |
| Images / OG | Relevant, readable visual with accurate alt text. A social card may use a shorter title but must not introduce a stronger claim. |

Suggested title directions for the reviewed batch:

- Micro820 flashing red: meaning and fault-clear options.
- S7-1200 factory reset: what it erases and what to check.
- PowerFlex 525 F004 and F005: what to record first.

These are editorial proposals. Validate finished metadata against the corrected article and its sources.

## 3. Structured data: accurate description, no special promises

Use the site's supported `Article` or `BlogPosting` representation plus `BreadcrumbList`. There is no need to change valid Article markup solely to chase a different label. Keep headline, visible attribution, image, canonical URL, dates and description consistent with the page. Include only known facts; omit unknown optional fields rather than inventing a reviewer, credential, screenshot or publication date.

FAQs are optional reader content. Do not create repetitive FAQs or require `FAQPage` markup to launch this series. Google stopped showing FAQ rich results on May 7, 2026 and removed their documentation in June. HowTo rich results were deprecated in September 2023. These facts concern Google feature support; they do not make the underlying Schema.org types invalid. If an existing implementation retains truthful markup for another consumer, document that purpose and keep it synchronized with visible content. [G1], [G2]

Do not require a successful FAQ/HowTo rich-result test as an acceptance gate for features Google no longer supports. Validate syntax, appropriate supported markup and consistency instead. Do not add `Offers`, prices, invented ratings, reviews, credentials or a supported-brand list. Product schema obeys the same claim rules as visible copy. [G3]

## 4. AI answer discovery

Google's published guidance says ordinary SEO practices remain relevant to its AI search features: make the content accessible, useful and understandable. No special AI schema or machine-readable file is required, and eligibility does not guarantee inclusion. Its June 2026 clarification says `llms.txt` does not improve or worsen Google Search rankings. Treat that file, if maintained for other consumers, as an optional accurate summary, not a ranking mechanism. [G1], [G4]

For this series, prioritize clear definitions, source links, explicit scope, original diagnostic value and readable text. Do not promise an AI engine will quote the first paragraph or use a prescribed word count. Do not tell search systems to ignore caveats or assert claims the page cannot support.

## 5. Product claims: resolve the source conflict

The collected draft relied on an external `capabilities.md` snapshot and a can-say list. They were not included in PR #4762. The draft registry in [PR #4570](https://github.com/Mikecranesync/MIRA/pull/4570), inspected at `0315f7ea62adc0c235a5394f6d7d0336560adad5`, uses:

- [`mira-web/src/capabilities/marketing-claims/capabilities.json`](https://github.com/Mikecranesync/MIRA/blob/0315f7ea62adc0c235a5394f6d7d0336560adad5/mira-web/src/capabilities/marketing-claims/capabilities.json)
- [`mira-web/docs/capabilities.md`](https://github.com/Mikecranesync/MIRA/blob/0315f7ea62adc0c235a5394f6d7d0336560adad5/mira-web/docs/capabilities.md)

That branch keeps generalized cited-answer and stranger-upload claims partial. PR #4570 is a draft, so its contents do not establish what is deployed. This refinement does not promote or demote product capabilities. It identifies a conflict that the claim owner must reconcile using current production evidence and existing approvals.

Until reconciled, use the modest contact invitation in STYLE-GUIDE section 9. Do not copy the old guide's blanket answer/refusal, Android continuity, processing-time, live-pilot or work-order statements into public text or schema. A narrow demonstration is not a universal promise. A product may be able to do more than the approved wording; prove and approve the specific wording before using it.

No prices or dollar amounts anywhere in this guide set, including historical audit quotes. Describe a problematic heading as “a public paid-assessment heading.” Do not quote its amount. No pricing FAQ is required for these technical articles.

## 6. Technical checks for an approved release

These are acceptance requirements for the publishing implementation, not claims that it already exists:

- Article HTML contains the useful content, links and source text; essential meaning is not only in an image or client-side decoration.
- Canonical URL, title, description, social metadata and structured data describe the same released article.
- Index, related links, sitemap, RSS if implemented, and the direct route agree on visibility. An unapproved or future post must not leak through another route or feed.
- Links resolve to the intended document/version/page. A 200 response alone does not verify content; record manual inspection when a site blocks automated checks rather than bypassing it.
- Public pages are indexable only when intended. Confirm robots rules, meta/header indexing controls and canonical behavior; a sitemap entry alone does not prove indexing.
- Sitemap `lastmod` changes with meaningful content updates. Do not rewrite all dates daily for perceived freshness.
- Inspect phone rendering, keyboard access, text zoom and the actual downloadable PDF. PDF internal links must be absolute HTTPS, not `file:///`.
- Assess real browser behavior before making page-experience claims. Server response time alone does not establish Core Web Vitals or phone usability.
- Use the existing publishing and analytics stack where possible. RSS and IndexNow are optional delivery improvements, not reasons to delay correcting unsafe content or promises of Google indexing.

## 7. Content quality and topic clusters

Group genuinely useful pages by equipment family as the collection grows. Create a hub only when it helps navigation and has real content to link. Do not publish empty tag/hub pages to increase URL count.

Google defines scaled content abuse around producing many pages mainly to manipulate rankings while adding little value, regardless of how they were created. AI authorship, daily cadence or a template alone does not establish a violation; a human-review checkbox alone does not establish quality. A fault-code page needs applicable source support and useful interpretation, not just another title. [G5]

Retain useful existing pages; audit unverified causes, resets and claims individually. Consolidation, redirects or `noindex` should follow actual findings and approved site changes. Do not blanket-remove an entire technical subject because product marketing cannot promise it.

## 8. Historical landing-page audit: follow-up record

Grokbot's collected draft reported the following on October 25. This refinement did not re-run that live-site audit, and the findings below must not be represented as newly measured or fixed:

| Reported concern | Next evidence needed |
|---|---|
| Public paid-assessment heading and commercial offer markup | Inspect current released HTML/JSON-LD and verify removal under the approved no-price policy. |
| Positioning and metadata out of sync | Compare current visible copy, title, social cards and approved claim record. |
| Old `llms.txt`/`llms-full.txt` claims | Confirm current content and generating source. |
| Sitemap links to legacy commercial pages and thin technical pages | Inventory live URLs and judge value/claims per page. |
| Confusing sign-in route/name | Verify current navigation; preserve working URLs or use an approved redirect plan. |
| No inspected real product screenshot | Verify an appropriate current image and honest caption before adding one. |
| Mobile, redirects and Core Web Vitals unmeasured | Perform the relevant browser/HTTP measurements and record limitations. |

No runtime, redirect, analytics, schema or indexing changes are made by this docs PR.

## 9. Measurement without invented targets

The [learning pilot](BLOG-PLAN.md#8-what-to-measure) measures product answer quality, technician usefulness and qualified inquiries separately. Search performance helps explain discovery; it does not prove that MIRA improved, a technician repaired equipment or a buyer wants the product. The three reviewed questions begin as development cases, not an independent reliability benchmark.

Record a baseline before release where measurement is available; otherwise mark it unknown. In each agreed reporting period, distinguish search impressions, search clicks, visits, article-to-contact clicks and actual qualified inquiries. A mailto click is not proof of a sent email or a pilot lead. Device/browser counts are estimates, not an exact count of people. Record the tool definition and time window.

Search Console, Bing Webmaster Tools and site analytics can inform topic choices once access and instrumentation are verified. Do not invent search volumes, rankings, AI citations or conversion rates. Keep raw customer content and identifiable details out of marketing reports; use approved aggregate reporting. Do not claim a tracker is automatically exempt from consent requirements merely because it is cookieless.

## Primary search references

Checked 2026-10-25. Recheck when the search implementation changes.

[G1]: https://developers.google.com/search/updates
[G2]: https://developers.google.com/search/blog/2023/08/howto-faq-changes
[G3]: https://developers.google.com/search/docs/appearance/structured-data/article
[G4]: https://developers.google.com/search/docs/appearance/ai-features
[G5]: https://developers.google.com/search/docs/essentials/spam-policies#scaled-content

- [G1: Google Search documentation updates](https://developers.google.com/search/updates), May 8 and June 15, 2026 entries.
- [G2: Changes to HowTo and FAQ rich results](https://developers.google.com/search/blog/2023/08/howto-faq-changes), including the September 14, 2023 update.
- [G3: Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article).
- [G4: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features).
- [G5: Spam policies, scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content).
