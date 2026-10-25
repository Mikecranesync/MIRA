# FactoryLM blog style guide (base version)
Oct 25, 2026. Search Steward, for Mike (request pt12u). Internal. Content Studio owns post wording. This guide sets the rules.

**Goal:** posts that read like an experienced maintenance tech explaining a fix to a peer, and that still rank in search and get quoted by AI answers.

---

## Part 1. What the well-read industrial blogs actually do
All examples below come from pages fetched on Oct 25, 2026. Quotes are short and exact.
- Word counts are rough whole-page counts from curl, so they include some site chrome.
- Schema types come from the page's JSON-LD.

| Blog / example post | Voice | Headline | Intro | Length and structure | Sources, safety, CTA | What makes it human | SEO seen |
|---|---|---|---|---|---|---|---|
| **RealPars**: "How to Test PLC Analog Inputs (Step-by-Step Guide)" https://www.realpars.com/blog/plc-analog-input-troubleshooting | Instructor talking to techs; "we", "Alright", "Ok….back to our problem" | "How to [task] (Step-by-Step Guide)" | A scenario: "A Control Room Operator reports an erroneous analog HMI reading of a tank level…" | ~1,600 words. H2s: concept, worked example, tool. 22 images with descriptive alt text ("The 1756-IF16 module with three current loops sharing a +24V DC power supply.") | Names real modules and terminals. CTA is a free trial and course links. Has an FAQ block | Opinions with numbers ("85% or more of all failures"), dry humor ("unless idle hands have been experimenting"), real terminal numbers ("remove the wire from TB-107") | Article, VideoObject and Breadcrumb schema. "Frequently asked questions" section. Meta describes the symptom: "An analog reading looks wrong. Work through a step-by-step method…" |
| **RealPars**: "Open vs Short Circuits Explained Simply" https://www.realpars.com/blog/open-vs-short-circuits | Peer, a bit cheeky | "[X] vs [Y] Explained Simply" | Calls out a misuse: "…hmmmm it's not working, so there must be a short somewhere…." | Worked fault (SV101, K0 relay, 2 A fuse) | Subhead promises "safely" | Admits a training gap: "most of us didn't receive a solid foundation in troubleshooting skills" | |
| **Control.com** (All About Circuits network): "Troubleshooting PLCs: Recognizing Visual Status Indicators and LEDs" https://control.com/technical-articles/troubleshooting-plcs-recognizing-visual-status-indicators-and-leds/ (curl got 403, WebFetch worked) | Practitioner byline (Shawn Dietrich) | "Troubleshooting [thing]: [specific angle]" | A punchy one-liner: "When automated equipment breaks down, the world stops spinning." | H3 per LED (Power, Status/Error, Run/Stop, Forced I/O). Numbered figures with credit: "Image used courtesy of the author" / "courtesy of Siemens" | Safety in context, as plain fact: forcing I/O "can be extremely dangerous if the equipment is already in production" | Shop slang used correctly: "jokingly called a bricked unit". Photos he took himself | Dek under the title acts as the meta |
| **Electrical Engineering Portal (EEP)**: "Troubleshooting the most typical winding problems of three phase electric motors" https://electrical-engineering-portal.com/troubleshooting-winding-problems-three-phase-electric-motors | Reference manual, authoritative | Long, keyword-literal | Straight to the point: "It's always important to identify the real cause of burned windings and not just to replace the electric motor." | ~4,300 words. Numbered H2s "1. Shorted Turns" through "7." "Estimated Study Time: 24 minutes", "Last updated on November 20th, 2024" | Cites standards (IEEE 43 in a related EEP guide). CTA is premium PDF and subscribe | Field-tested opinion: "A replacement motor can fail sometimes immediately if the in-plant problem isn't corrected." | Article, Breadcrumb, CommentAction schema. Visible "last updated" date. 16 comments |
| **Machinery Lubrication** (Noria): "8 Lubrication Failure Mechanisms for Rolling-Element Bearings" https://www.machinerylubrication.com/Read/31068/bearing-failure-mechanisms | Expert first person: "In this article, I will refer to rolling-element bearings simply as bearings." | Numbered list: "8 [things] for [component]" | Defines scope, then a stakes number: contact pressure "can exceed 500,000 pounds per square inch (psi)" | ~2,000 words. Numbered H2s and a "Bottom Line" H2 | Quotes a named book: Heinz Bloch, *Machinery Failure Analysis and Troubleshooting Vol. 2*. CTA is subscribe | Named byline (Bennett Fitch), with a quoted authority instead of vague "experts say" | Article schema. The meta is just the first paragraph, which is weak |
| **The Automation Blog** (Shawn Tierney): "Micro800, CCW – Create and Download Ladder Logic Programs" https://theautomationblog.com/downloading-programs-to-a-micro800/ | Personal, one expert: "In today's article I'll walk you through…" | "[Product], [Software] – [Task]" | One line saying what you'll do, plus a "Preface" link to the prerequisite post | ~1,100 words. **17 numbered "Step N)" headings, each with a screenshot.** Notes inline ("Note: If no connection path is listed…") | CTA is the paid course and membership | Founder voice and hands-on screenshots. Series hub: "TAB's Micro800 Guide… over 85 of our free articles and videos" (https://theautomationblog.com/micro800-guide/) | Breadcrumb schema only. Strong internal linking through hub pages |
| **Plant Services**: "How to improve your troubleshooting process for rotating equipment" https://www.plantservices.com/equipment/industrial-motors/article/21438795/how-to-improve-your-troubleshooting-process-for-rotating-equipment | Senior practitioner and trade press | "How to improve your [process] for [equipment]" | Proverb hook: "'No news is good news' is always a motto before blowing the first whistle…" | ~1,750 words. Numbered figures. "About the Author" with credentials | Cites a diagnostic chart. CTA is the newsletter | Author bio with real affiliation | NewsArticle schema |
| **Automation World**: "It's 2 a.m. Sunday—Can You Troubleshoot Your PLC Code?" https://www.automationworld.com/products/control/blog/13319254/its-2-am-sundaycan-you-troubleshoot-your-plc-code | Integrator first person, empathetic | **Scene as headline** (time and pain) | "I'm writing this blog on behalf of the maintenance technicians and control engineers who get called in the middle of the night to figure out why the line won't run." | Short opinion blog. Tips list | Author bio with company | Speaks for the night-shift tech: "get back into their warm beds as quickly as possible" | NewsArticle schema. Meta restates the empathy hook |

**Patterns that repeat across them:**
1. **Specific scene or symptom first.** The 2 a.m. call, the operator report, the bricked unit. Nobody opens with market talk.
2. **Real part numbers, terminals and values** (1756-IF16, TB-107, 2 A fuse, 500,000 psi). Specifics are what make them sound human.
3. **One opinion per post, backed by a number or experience** ("70–80% of faults originate with field devices").
4. **Numbered steps with a screenshot or photo per step** (The Automation Blog, Control.com), and image credits.
5. **Named author with credentials.** "Last updated" dates (EEP).
6. **Safety appears in context as plain fact** ("can be extremely dangerous if…"), not as boilerplate.
7. **SEO:** Article or NewsArticle plus Breadcrumb schema is standard. Only RealPars ships a visible FAQ. Meta descriptions are often weak (just the first paragraph, as on EEP and Machinery Lubrication), so we can beat them there. Hub pages and series beat one-off posts.

**What we won't copy:** course and subscription upsells, the "Start Your 7-day free trial" panels, and stats with no source.

---

## Part 2. Rules for FactoryLM posts

### 2.1 Voice: an experienced tech talking to a peer
- **Talk like the person who has stood in front of the cabinet.** Short sentences. Use "you". Use "we" only for things FactoryLM actually did.
- **Use real nouns:** catalog numbers, LED names, menu paths exactly as printed (**Online & Diagnostics > Functions > Reset to factory settings**), terminal labels, file names (`ConfigMeFirst.txt`).
- **Use jargon correctly, and only jargon techs actually say:** "bricked", "power-cycle", "go online", "download/upload" (get the direction right). Don't invent slang.
- **One honest opinion per post** is fine if you can back it up ("Check the SD LED before you blame the card."). Label it as experience, not as the manual.
- **Credit the forum asker** ("a tech on PLCtalk…") and link the thread. Never invent a story, customer or quote. If Mike has a real first-hand story, use it with his OK and mark it as his.
- **Say it once, plainly.** Don't hedge everything. One "check your manual edition" beats five "may"s.

### 2.2 Banned patterns (any of these means the post goes back)
- **Filler openers:** "In today's fast-paced…", "In the world of industrial automation…", "Are you struggling with…?", "Let's dive in", "Picture this…" (unless it's a real scene).
- **Robot words:** delve, leverage, seamless, robust, unlock, empower, game-changer, navigate the complexities, it's important to note, in conclusion, ultimately, whether you're X or Y.
- **Tidy triples** ("fast, simple, and reliable"; three bullets that each restate the same thing). Use the number of items the facts give you.
- **Over-hedging:** "may potentially", "could possibly help", "in some cases it might". Use one qualifier at most, and only where the manual hedges.
- **Generic conclusions:** "By following these steps, you can ensure…", "Troubleshooting doesn't have to be hard". End on the next action or the edge case instead.
- **Em-dashes** (Content Studio's existing rule). Use a full stop, comma or colon.
- **Unsourced statistics, invented quotes, fake reviews or testimonials.**
- **Prices, competitor names**, and any claim not in `capabilities.md` PROVEN plus the can-say list.

### 2.3 Templates
**A. Troubleshooting post (symptom → fix)**
```
Title: [Model] [symptom]: [what fixes it] ([doc number])
Intro (2–4 sentences): the symptom as the tech sees it + the one-line answer + "per [manual], p.X".
## What [the LED / the code / the message] means        (quote the table, cite the page)
## How to fix it                                       (numbered steps; one action per step; page cites)
## If that doesn't work                                (next branch, with a cite; no guesses)
## Watch out for                                       (gotchas from the manual: data loss, passwords, editions)
> OEM safety quote with cite, OR > Publisher's note (see 2.7)
## Questions techs ask                                 (2–4 FAQs, each ≤ 50 words)
Source list: forum thread(s) + manual title, pub no., edition, pages
CTA (2.8)
```
**B. How-to (task)**
```
Title: How to [task] on a [model] ([what it changes or deletes])
Intro: when you'd need this + what it costs you (what gets erased) + cite.
## Before you start   (requirements from the manual)
## Steps              (numbered; exact menu names in bold; one screenshot per 2–3 steps)
## What it changes    (table: item | erased? | page)
## When it won't work (common blockers, attributed)
Safety block, FAQ, sources, CTA
```
**C. Explainer (concept)**
```
Title: [Thing] explained: [the practical question it answers]
Intro: the confusion as techs hit it on the floor, then the plain definition.
## [Question form H2s]: What is X? How do I tell X from Y? What does the manual say about X on [model]?
A table or diagram is mandatory. A worked example with real values is mandatory.
FAQ, sources, CTA
```

### 2.4 Headline and meta formulas
- **Title (≤ 60 characters where possible; put the model and symptom first):**
  - `[Model] [symptom]: how to [fix]`, e.g. "Micro820 flashing red fault: clear it from the microSD card"
  - `How to [task] on a [model] (and what it deletes)`
  - `[Model] [code/LED] meaning, per the [doc number] manual`
  - Avoid: "Ultimate guide", "Everything you need to know", question-only titles with no model.
- **Meta description (140–155 chars):** symptom, then the answer in one clause, then the source. No CTA fluff.
  - "Flashing red fault LED on a Micro820 means a recoverable fault. Clear it at power-up with [CF] in ConfigMeFirst.txt, per Rockwell 2080-UM005 p.120."
- **Slug:** model-symptom-fix, lowercase, no dates.

### 2.5 Intro hook: lead with the symptom
Within the first 100 words, cover four things:
1. **The symptom in the tech's words.** The LED, the message, what won't work.
2. **The direct answer in one or two sentences**, quotable on its own.
3. **The source**: manual title or pub number and page.
4. **(Optional) where the question came from**: "Asked on PLCtalk" plus the link.

No backstory before the answer. Context goes after.

### 2.6 Visuals
- **Real first.** Use our own photos of real hardware (with Mike's OK, and no customer names, serials or GPS data), or screenshots from software we ran. Never AI-generated images of real products.
- **Diagrams:** draw LED-state diagrams and tables ourselves (SVG or HTML table) from the manual's table. Write "Based on 2080-UM005 Table 63, p.149" under the diagram. Don't paste the OEM's figures. Link to the OEM PDF instead.
- **Screenshots:** crop to the dialog, highlight the click target, and keep version info visible when it matters.
- **Alt text:** describe what the image shows plus the key value. Example: "Micro820 front panel with the fault LED flashing red and all other status LEDs off." Not "image1" and not keyword stuffing.
- **Captions:** a numbered figure, one sentence, with a credit line ("Photo: FactoryLM", "Based on Siemens A5E02486680-AQ, p.1057").
- Set width and height on every image to avoid layout shift.

**Tech-sheet and manual images (copyright rule from Content Studio, Oct 25, 2026):**
- **Redraw by default.** Rebuild the relevant table rows as our own clean graphic, using only the cited values plus a highlight on the row that matters. Caption it "Diagram: FactoryLM, based on [pub no.] [table/section], p.X."
- **Real crops only when the figure itself matters** (a wiring diagram, a terminal layout, a front-panel drawing). Keep them small: just the relevant rows or figure, never a full page.
- **Credit the source and page in every caption.** Example: "Crop: Rockwell 520-UM001O-EN-E, p.161."
- **No OEM logos** in any crop, and no cover pages or headers that carry a logo.
- **Link to the OEM's official PDF at the exact page** (e.g. `...520-um001_-en-e.pdf#page=161`), and confirm the linked file's edition matches the cited one before publishing.

### 2.7 Manual citations
- **First mention:** full title, publication number, edition and date. Example: *Micro820 Programmable Controllers User Manual, 2080-UM005H-EN-E (Sep 2025)*.
- **Inline after that:** `(2080-UM005, Table 45, p.120)` or `(System Manual §15.9, p.1057)`. Use the **printed** page number, and confirm it matches the PDF before publishing.
- Quote short exact phrases in quotation marks when the wording matters ("Power up and attempt to clear fault").
- Attribute forum advice to the forum ("posters in that thread suggest…"). Never pass it off as the manual.
- Every post gets a **Sources** list: forum URLs plus manual entries (title, pub number, edition, pages). A fact check must open every cited page.

### 2.8 Safety notes
- **Allowed form 1: an OEM quote** with the manual and page: `> Rockwell 2080-UM005, p.37: "WARNING: Before you install and wire any device, disconnect power to the controller system."` Only use a quote that fits the task.
- **Allowed form 2: a labelled publisher's note:** `> Publisher's note: Follow your site's lockout procedure and the OEM manual.`
- **Never:** "MIRA recommends…", "MIRA will warn you…", or any safety instruction that sounds like it comes from the product. Safety framing in MIRA is PARTIAL (`capabilities.md` R3).
- **High-risk topics** (fault reset, restart, factory reset, energized work, safety PLCs) **must** carry one of the two forms, and they get an extra fact-check pass.
- Never write a safety procedure ourselves (lockout steps, arc flash PPE, safety-relay logic). Point to the site procedure and the OEM document.

### 2.9 CTA rules
- **Default closing line** (approved): `MIRA answers from the manual you attach and cites the page. Not for fault resets or restart steps.`
  - On low-risk topics (calibration, wiring lookup), Content Studio may propose a variant. It must stay inside PROVEN claims, and Search Steward checks it.
- **Link** to the homepage with descriptive anchor text, e.g. `[Ask a manual and see the cited page](/)`. Never "click here" or "See how it works".
- **Contact:** "Talk to Mike" (mike@factorylm.com). No prices, discounts, trials or "book a demo" language.
- **Never:** competitor names, work-order or CMMS features (not PROVEN), fault-code help, "works on your phone", consistency claims, customer logos or testimonials.

### 2.10 SEO and AI-answer checklist (run on every post)
- [ ] **One target query** written at the top of the draft (e.g. "micro820 flashing red fault"). The title, H1, slug and first sentence all contain the model and symptom.
- [ ] **Quotable answer in the first 100 words.** 40–60 words that make sense on their own, with the page cite.
- [ ] **H2s phrased the way techs ask** where it reads naturally ("What does flashing red mean?", "How do I clear it without CCW?"). Steps stay as steps.
- [ ] **FAQ block** of 2–4 questions, each with a 25–50 word answer and a cite. These map to **FAQPage** JSON-LD (on factorylm.com only).
- [ ] **Schema:** `TechArticle` (or `Article`) with author "Mike Harper" or a real named author, plus `datePublished`, `dateModified`, `BreadcrumbList` and `FAQPage`. No ratings, reviews or offers.
- [ ] **Visible "Last checked against [manual edition] on [date]"** line (the EEP pattern; it builds trust with Google and AI).
- [ ] **Internal links (2–4):** one to the model's hub page (e.g. `/blog/micro800`), one to a related post, one to the homepage (2.9). Use descriptive anchors.
- [ ] **External links:** the forum thread and the official OEM manual page (Rockwell Literature Library, Siemens support).
- [ ] **Length:** troubleshooting 700–1,200 words, how-to 800–1,500, explainer 1,200–2,000. Shorter is fine if it fully answers. Never pad.
- [ ] **Images:** at least 1 real image or diagram, with alt text, width and height.
- [ ] **Meta description** follows 2.4. `og:title`, `og:description` and `og:image` are set.
- [ ] **Banned-pattern scan** (2.2), including em-dashes, done.
- [ ] **Fact check approved:** every page cite opened, every URL loads, claims match `capabilities.md` and the can-say list.
- [ ] **Hubs:** group posts into model hubs (Micro800, S7-1200, Comfort Panels), the way The Automation Blog does its Micro800 guide.

### 2.11 Hub pages (planned)
Planned model hubs: `/blog/micro800`, `/blog/s7-1200`, `/blog/comfort-panels`. **Don't link to them until they exist.** Until then, related links may only point to posts that ship in the same PR, and those posts must be marked `ship_together` in the front matter.

---

### 2.12 Tech sheet format (Mike, Oct 25, 2026)
Every troubleshooting post is a printable tech sheet a maintenance tech can scan at the machine. Reference build: the 4 posts in `queue/` dated Oct 27-30 and `tools/posts.py`.

**Layout skeleton (in this order)**
1. **H1** with model + fault code or symptom (same words in the slug and meta). Keep a separate `seo_title` of about 60 characters for the `<title>` tag.
2. **Quotable answer in the first 2 sentences**, bold, with the manual pub no., page and a `#page=N` link.
3. **The question, from the forum:** a short quote (1-3 sentences) of the original post, then the poster's handle and the thread link.
4. **At a glance** table: Symptom / Likely cause / Fix / Manual + page.
5. "Last checked against [pub no.] on [date]."
6. **Question-shaped H2s** that match real search phrasing and "People also ask" variants (What does X mean on [model]? How do I... without...? Why is... off? Does X delete...?).
7. **Quick-reference table** with manual values only, page cited under it.
8. **What you need** list, then **numbered steps** (one action per step, menu names in bold).
9. **Check before you call it fixed** as a checklist. Only manual meanings (LED states, saved values). Never a new reset or restart step.
10. **Gotchas**: manual gotchas with a page, then thread gotchas attributed by handle ("From the thread, damica1: ...").
11. Safety box: verbatim OEM quote with page, or a labelled "Publisher's note". Nothing else.
12. **FAQ** (H2 "[Model] [topic] questions techs ask"), 4-5 Q&As, each answer self-contained with a cite. Mirrors the FAQPage JSON-LD exactly.
13. **Sources** (every page linked), **Related tech sheets** (only posts shipping in the same PR), closing MIRA line, pilot CTA last.

**Closing line (Product, Oct 25):** "Attach a manual on the web; it's ready within a few minutes. MIRA answers from the manual you attach, when the manual covers it, and cites the page." Add "Not for fault resets or restart steps." on high-risk posts (faults, resets, drives, power). The "within a few minutes" part rests on the can-say list (row 22, staging walk #4732 not yet passed). Drop it if that list changes.

**Pilot CTA:** there is no pilot sign-up page yet. Use the site's live Talk to Mike mailto with the UTM string in the body, plus `data-cta="blog-pilot-<slug>"` for PostHog. Switch to `https://factorylm.com/<pilot-page>?utm_source=blog&utm_medium=post&utm_campaign=tech-sheet&utm_content=<slug>` once a real page exists. No prices.

**Front matter:** `status`, `seo_title`, `dateModified`, `author: null` and `publisher: null` (neutral until Mike decides), `sources` with URLs and pages, `images`, `related`, `hubs_planned`, `cta`, `publish_checklist` (sitemap, RSS, indexable/no noindex, JSON-LD renders, images in PR), `ship_together`, `factcheck`, and `schema_jsonld` (TechArticle, HowTo when there are steps, FAQPage, BreadcrumbList Home > Blog > post).

**Visual spec (tech-sheet template v1, Oct 25, 2026).** Research: `research/spec-sheet-design-2026-10-25.md` (13 makers checked, 10 with sample PDFs, Rockwell product profiles as the main model). Code: `tools/techsheet/techsheet.css` (reusable by the blog: wrap a post in `<article class="ts">`), `tools/techsheet/render.py` (markdown post to HTML, no text changes), `tools/techsheet/print.js` (Letter PDF with footer and page numbers).
- **Page:** US Letter, margins 0.5in top / 0.55in sides / 0.6in bottom. One main column plus a 2.15in sidebar on page 1 only. Target 3-4 printed pages.
- **Type:** Archivo for headings, labels and chips; Fira Sans for body (10pt, 1.42 line height); Fira Code for file names and settings. Web fallbacks: Segoe UI, Helvetica Neue, Arial. Don't use Barlow (Rockwell's face) or any other maker's brand font.
- **Colour:** navy `#17324d` (band, table heads, step numbers), navy-2 `#24486b` (links, labels), ink `#1d2733`, muted `#5b6876`, rules `#d6dde5`, zebra `#f4f6f9`, amber `#e8a200` accent with `#fff6dc` fill (Fix cell, safety, highlights). Amber is the only accent. No maker's brand colours.
- **Header band:** navy, kicker "FACTORYLM TECH SHEET · [maker family]", H1 (19pt), chips for model, fault code or symptom (amber chip) and manual pub no. A 4px strip under it, amber then navy.
- **At-a-glance panel:** 4 cells right under the band (Symptom, Likely cause, Fix, Manual + page), each with a small line icon. The Fix cell has the amber fill.
- **Top block:** the 2-sentence answer as the lead (10.6pt), then the forum quote card (pale slate, large quote mark), then "Last checked". Quick facts sidebar on the right: equipment, manual (linked), pages used, forum thread(s), last modified.
- **H2s:** navy, 12.5pt, with a thin rule above and a 44px amber tab at its left end.
- **Tables:** solid navy header row, zebra body, bold first column, "Source: ... p.N" line in small muted text under each table.
- **Steps:** round navy number + a line icon by step type (file, card, power, touch, gauge, menu, check). A dashed rule between steps. Sub-options stay as nested bullets, never as extra numbers.
- **"What you need" / "Steps"** become small-caps labels, not bold paragraphs.
- **Checklist:** "Check before you call it fixed" renders as boxed tick squares, printable for pen use.
- **Safety callout:** amber left bar (6px), pale amber fill, triangle icon, tag "SAFETY · FROM THE MANUAL" or "SAFETY · PUBLISHER'S NOTE". Text is the OEM quote or the labelled note, unchanged.
- **Figures:** full column width, at most 2.4in tall in print, thin rule border, caption in small muted text with an amber left rule. Never split across pages.
- **End block:** sources list, related sheets in a zebra strip, then the closing line beside a navy CTA box (amber link).
- **Footer (every page):** "FactoryLM tech sheet · [slug] · Source: [pub no.] · dateModified [date]" left, "Page N of M" right.
- **Preview-only box:** seo_title, meta and CTA URL print at the end of preview PDFs. The blog must not render it.
- **Never:** logos, product photos, maker trade dress, or changing copy, claims, cites or links to make the layout fit. White space at the bottom of page 1 is fine when the next figure doesn't fit.

**Image house style (at least 2 per sheet)**
- 1200x630 PNG, white background, navy (#1f3a5f) top bar and title, grey (#eef2f6) source strip at the bottom with "FactoryLM tech sheet".
- Highlight = amber (#e8a200) 4px box with pale amber (#fff3d1) row fill. One amber arrow with a short label saying why it matters ("Your symptom: flashing red only").
- Build with `tools/house.py` (canvas, table, highlight, arrow, box) so every sheet looks the same.
- Every image gets a caption "Figure N. [what]. Source: [title], [pub no.], [table/section], p.N. Diagram: FactoryLM." and alt text that names the model, the content and what is highlighted.
- Check every image with Read before shipping (text overlap, cut-off labels, values against the page).

**Copyright rules**
- Redraw by default, using only the cited values. Label schematics of software screens "schematic, not a screenshot".
- Use a small real crop (pdftoppm + PIL) only when the figure itself matters (wiring, terminals, front panel). Show only the relevant rows or figure, never a full page, and include no OEM logos, covers or headers.
- Quote forum posts briefly (1-3 sentences) with the handle and link.

**Link rules**
- OEM links go to the official PDF with `#page=N`. Confirm the edition on the cover matches the cite, and confirm PDF page = printed page (pdftotext on the downloaded file). If they differ, use the PDF page number in the anchor.
- Forum links go to the exact thread. Credit the handle.
- No hub links until the hubs exist (2.11). List them under `hubs_planned`.

## Part 3. Before/after example
Source paragraph: the "Short answer" in `/workspace/marketing/blog/queue/2026-10-27-micro820-flashing-red-fault-clear.md`. This is an illustration only. I didn't edit the post.

**Before (current):**
> A **flashing red** fault LED on a Micro820 means a **recoverable** fault. **Solid red** means a non-recoverable fault that needs a power cycle (2080-UM005, Table 63, p.149). Without CCW, you can clear the fault from the microSD card. Put a `ConfigMeFirst.txt` file in the root of the card with the `[CF]` setting, which tells the controller to "power up and attempt to clear fault" (Table 45, p.120).

**After (suggested):**
> Flashing red with nothing else lit is the good news: Rockwell calls that a recoverable fault. Solid red is the one that needs a power cycle (2080-UM005, Table 63, p.149). No laptop with CCW handy? Put a `ConfigMeFirst.txt` in the root of a 2080-SD-2GB card with two lines, `[CF]` and `[END]`, and power the controller back up. Per the manual, `[CF]` makes it "power up and attempt to clear fault" (Table 45, p.120).

**Why it's better:**
- It opens on what the tech is actually looking at ("nothing else lit").
- It adds the plain-English stakes ("the good news").
- It answers the real constraint (no CCW) in the tech's terms.
- It folds in the [END] line and the supported card so the steps work first time.
- It keeps every page cite, adds no claims and uses no em-dashes.
- It's still quotable on its own for AI answers (about 75 words).

---

## Part 4. Process
1. Content Studio drafts using this guide and writes the target query at the top.
2. Search Steward fact-checks (claims, URLs, pages, safety, CTA, SEO checklist) and sets `status:` in the front matter.
3. Mike approves before anything is published. Nothing goes live from this guide.

Revisit this guide after the first 10 posts, using real Search Console data once we have access.
