# Promo Director Playbook

**Version:** 1.0 (2026-04-27)
**Audience:** anyone (or any agent) producing a MIRA / FactoryLM promo or demo video.
**Single source of truth.** The `.claude/skills/promo-director` skill reads this doc; future manifests inherit its defaults; reviewers grade against it.

Grounded in 30+ cited videos across three research streams: B2B SaaS & dev-tools (Stripe, Linear, Vercel, Supabase, OpenAI GPT-4o launch, Loom, Figma, Notion, Apple, Tesla), industrial / blue-collar (UpKeep, MaintainX, Fiix, Tractian, Augury, Inductive Automation, Fluke, Milwaukee), and direct-response (Dropbox, YC demo day, Hormozi, ProductHunt #1 launches). When sources disagreed, industrial conventions win — that's our buyer.

---

## The 6-step formula

Every promo video produced under this playbook follows the same six steps.
Length brackets scale time budgets but never the structure.

| Step    | 60s default | 30s social | 90s YouTube | What's locked |
|---------|-------------|------------|-------------|---------------|
| Hook    | 0–5s        | 0–3s       | 0–6s        | One concrete pain sentence with a specific number; UI before logo; never "Hi, I'm…" |
| Pain    | 5–14s       | 3–10s      | 6–20s       | Cost of inaction in dollars or hours; "you" not "many companies" |
| Reveal  | 14–22s      | 10–15s     | 20–30s      | Product name + one focused UI shot; 3 explicit value components, not "everything" |
| Demo    | 22–48s      | 15–22s     | 30–70s      | 3–4 sequential UI shots, 4–5s each; outcome-narration not feature-narration |
| Proof   | 48–54s      | 22–26s     | 70–82s      | One specific verifiable claim — named OEM, named fault code, named hours saved |
| CTA     | 54–60s      | 26–30s     | 82–90s      | Single URL; price anchor before trial framing; 6 full seconds on screen |

### Step-by-step rules

**1. Hook (first 5 seconds — the only seconds you're guaranteed)**
- Open in the viewer's world by second 3. UI moving, fault code on screen, equipment in frame — never the company logo.
- One sentence. Pain-first. Contains a number ("11 seconds," "200 feet of cable," "F012 on a PowerFlex 525").
- No music ramp-up. No greeting. No "today I'm going to show you."

**2. Pain (5–14s)**
- Name the cost of inaction in concrete units — hours of downtime, dollars, work orders backlogged. Not "frustration."
- Speak in second person ("your techs," "your line"). Never "many companies struggle."
- One sentence. The viewer already has the problem; you're not educating them.

**3. Reveal (14–22s)**
- Product name on screen, plus one clean focused UI shot.
- One sentence describing what the product does. No superlatives.
- Stack three specific value components ("it searches your manuals, your work-order history, your equipment data"). Three things, not "everything."

**4. Demo (22–48s)**
- 3–4 sequential UI shots, 4–5 seconds each.
- Outcome-narration: "it tells you which page the answer is on" — not "the citation field appears below the response."
- 70% show / 30% say. If you're narrating a feature, show it simultaneously.
- Remove one objection inside this step ("works on YOUR manuals — your equipment, your specs").

**5. Proof (48–54s)**
- One verifiable claim. Named OEM, named fault, named hours, or a one-line quote with name + title + company.
- Connect the claim back to what was just shown ("that's not a sandbox — that's your manuals running live").
- "Customers love it" is worth zero. Specificity is currency.

**6. CTA (54–60s)**
- Solid dark background, one URL, nothing else.
- Spoken once. On screen for 6 full seconds.
- Price anchor *before* trial framing: "$97/mo. Start free for 14 days. factorylm.com/demo."
- One door. Not "or schedule a demo, or download the case study."

---

## Universal rules (every video, every length)

1. Open in the viewer's world by second 3 — never with logo or greeting
2. ≤8 words per on-screen caption line
3. Show output before input — final answer first, mechanism second
4. Music serves, never performs (-18 to -20 dB under VO; absent during demo)
5. Single CTA — one URL, one date, one word
6. 3–5 seconds per shot for industrial UI; never under 2 seconds
7. Proof beats claim — name the fault code, name the manual, name the hours saved
8. Voice register: "senior engineer who respects your time" — 130–140 wpm, no enthusiasm performance

## Industrial overrides (locked for MIRA's audience)

- Open or close on physical equipment if you have footage. UI-bookended-with-real-equipment outperforms UI-only with maintenance techs.
- Use trade vocabulary verbatim — fault code, amp draw, PM, MTBF, VFD, OPC UA, MQTT. Never explain the abbreviations; if you do, you signal the audience doesn't know them.
- **Banned phrases** (every one of these costs trust with skeptical industrial buyers):
  - "AI-powered"
  - "game-changing" / "revolutionary" / "next-gen"
  - "seamless" / "seamlessly integrates"
  - "unlock" / "leverage" / "harness"
  - "synergy" / "empower" / "streamline"
  - "data-driven decisions" (without specific numbers)
  - "smarter" (without a comparison)
  - "easy" (industrial people know nothing's easy)
- Specificity is currency. Replace "fast diagnostics" with "11 seconds." Replace "many manuals" with "25,000 OEM manuals." Replace "saves time" with "cut my troubleshooting from 40 minutes to 8 — Mike H., maintenance supervisor."
- No music during the technical demo segment. Silence reads as real.
- Named OEMs build trust: Allen-Bradley, Rockwell, Siemens, Yaskawa, Fanuc, ABB, Eaton, Schneider, Danfoss, GS20, PowerFlex, ControlLogix, Micro 820. Use them when relevant.

## Direct-response overrides (when conversion matters)

- Lead with proof, not promise. First Reveal-step sentence is a credential or result, not a vision.
- Stack value components explicitly in Reveal — three named things, not "everything."
- In CTA: price anchor *before* trial framing. "$97/mo. Start free for 14 days." not "Free trial, $97/mo after."
- Remove one objection *inside* the Demo, not after. The most common industrial objection: "It won't have my equipment in it." Counter inline: "MIRA works on the manuals you upload — your equipment, your specs."
- Make the cost of inaction visible with a number in Pain. "Every hour the line is down costs more than a year of MIRA."

---

## Anti-patterns (never do these)

1. **Logo → company name → "We're excited to announce…"** — the documented worst opening across every research stream. Spends your only guaranteed 5 seconds on the wrong thing.
2. **Founder-narrated "Hi, I'm [Name] and today I want to show you…"** — works only when the founder is already famous. For an unknown industrial-AI startup, it loads the freight of "the viewer doesn't know or care who you are."
3. **Feature enumeration** — "MIRA includes AI diagnostics, RAG search, QR asset tagging, Excel export, and more." Lists convert worse than single demonstrations. Pick the one feature that produces the clearest "aha" and show that fully.
4. **Slick over real** — drone shots, jib swings, lens flares signal you're compensating for thin substance. Industrial buyers' filter for this is sharp. Authenticity of content beats production polish.
5. **Multiple CTAs** — "Start trial, schedule demo, download case study, follow on LinkedIn." That's a menu. Decision paralysis is well-documented in conversion research. Pick one action.
6. **Captions duplicating VO word-for-word** — reduces trust. Signals you don't trust the viewer to hear the VO.
7. **Animated text entries** (slide-in, typewriter) — desyncs caption from VO and reads as 2015 corporate training video.
8. **Stock footage of factories** — every maintenance tech can spot it. A real screenshot of your product in your customer's plant beats a $5,000 stock clip every time.

---

## Voiceover prompt (locked — pass verbatim as `instructions` to gpt-4o-mini-tts)

```
Adult male, 40s, calm and direct. Sounds like a senior field engineer who
has worked in heavy manufacturing for 15 years — knowledgeable without
being academic, confident without being aggressive. Does not perform
enthusiasm. States facts and lets the listener draw conclusions.

Pacing: 130–140 words per minute. Steady. Slight pause after key claims —
functional, not dramatic. No acceleration on product names or feature
callouts; treat them as nouns, not reveals.

Tone: neutral American accent, no regional markers. Clean consonants.
Comfortable with industrial vocabulary (fault codes, torque specs, PLC,
CMMS, VFD, MTBF). Does not soften or inflate language. Says "this finds the
answer" not "this amazingly intelligent AI instantly surfaces the precise
answer you need."

Avoid: upward inflection on statements, marketing superlatives, breathless
pacing on product reveals, hesitation fillers, reading the style brief
itself aloud.
```

**Defaults:** model `gpt-4o-mini-tts`, voice `onyx`. Use `tts-1-hd` only if
`gpt-4o-mini-tts` is unavailable, and in that case drop the style instruction
(tts-1-hd ignores it and concatenating it into `input` makes it spoken).

---

## ffmpeg + assembly defaults (locked)

These are the defaults `multi_image_assembler.py` uses for any manifest produced under this playbook.

| Parameter             | Value                                  | Why |
|-----------------------|----------------------------------------|-----|
| Resolution            | 1920×1080                              | 16:9 default; landscape product demos |
| Frame rate            | 30 fps                                 | smooth motion without inflating file size |
| Codec                 | h264 high profile, level 4.0           | universal phone/desktop playback |
| Pixel format          | yuv420p                                | required for web/QuickTime |
| Audio codec           | AAC 192 kbps stereo, 48 kHz            | clean voiceover at small file size |
| `-movflags`           | `+faststart`                           | streaming-ready (the upload step depends on this) |
| Per-shot duration     | 4.0–5.0s (industrial UI), 2.5–3.0s (hook punctuation) | matches "let them read it" rule |
| zoompan zoom rate     | +0.0008 / frame (≈1.4% over 5s)        | barely-perceptible motion; never exceed +0.001 |
| Zoom direction        | toward the primary action (cited field, button being pressed, result appearing) | guides the eye |
| Pan + zoom combined?  | **never** on the same shot             | compound motion on a still reads cheap |
| Default transition    | 12-frame (0.4s) cross-dissolve         | reads deliberate; cuts read either punchy or sloppy |
| Exception transition  | direct cut between high-contrast UI states (fault screen → diagnostic screen) | the contrast IS the point |
| Banned transitions    | spin, swoosh, page-curl, zoom-to-black | dates the video; signals low intent |
| Music level           | -18 to -20 dB under VO when present    | infrastructure, not performance |
| Music presence        | absent during demo segment             | silence reads as real |

---

## Typography rules

- **Font:** geometric sans-serif — Inter, DM Sans, Neue Haas. Avoid Arial / Helvetica (read as unintentional defaults).
- **Full-screen statement:** 80–100 pt at 1920px. Single line. ≤6 words.
- **Lower-third:** 32 pt, left-aligned, bottom-quarter. White text, 40% opacity dark fill behind text only.
- **Animation:** fade in as a block (150 ms). Fade out the same way. Never animate individual letters.
- **Hold time:** ≥2 seconds per line. If VO is speaking the same words, hold for VO duration + 0.5s.
- **Anchoring:** never put captions over moving UI elements — they compete. Anchor below or above the primary action zone.

When captions help: VO is absent (social, muted-viewing), a technical term needs anchoring (caption "F012" while VO says it), or a workflow step needs labeling.

When captions hurt: they duplicate VO word-for-word, they appear faster than they can be read, the font is small enough that reading requires effort.

---

## Length brackets

| Bracket   | Where it lives                       | Must do                                                             | VO required? | Music role |
|-----------|--------------------------------------|---------------------------------------------------------------------|--------------|------------|
| <30s      | LinkedIn, X, Reddit, Slack share     | Stop the scroll, prove one fact. Caption-carry (80% watched muted). | No           | Critical (carries pacing) |
| 30–60s    | Homepage hero, ProductHunt launch    | Full 6-step. One CTA. Most-watched format.                          | Yes          | Secondary to VO |
| 60–120s   | YouTube, email campaign, Loom share  | Full 6-step + one extra proof point or testimonial.                 | Yes          | Background only |
| 2–4 min   | Sales enablement, conference, deep dive | Full arc + objection-handling + differentiation.                  | Yes          | Optional, slower tempo |

Never stretch a 30s concept to 60s — Mike's audience reads quickly and gets impatient. Cut harder, not longer.

---

## Vocabulary register (industrial-specific)

**Use freely (signals domain credibility):**
fault code · amp draw · nameplate · PM schedule · PM · WO · OEE · MTBF · MTTR · downtime · uptime · work order · asset · bearing wear · bearing failure · VFD · variable frequency drive · motor · induction motor · 3-phase · 460V · 480V · compressor · heat signature · thermography · lubrication interval · rotating equipment · root cause · corrective maintenance · reactive · predictive · vibration · misalignment · imbalance · cavitation · torque spec · ground fault · arc flash · LOTO · NFPA 70E · PLC · ladder logic · structured text · OPC UA · Modbus · EtherNet/IP · CIP · SCADA · HMI · Allen-Bradley · Rockwell · Siemens · Yaskawa · Fanuc · ABB · GS20 · PowerFlex · ControlLogix · Micro 820

**Avoid (filtered as marketing-speak):**
game-changing · revolutionary · next-gen · state-of-the-art · seamless · unlock · leverage · empower · synergy · cutting-edge · disruptive · transform · streamline · optimize · scale · supercharge · turbocharge · 10x · paradigm shift · "data-driven" (without numbers) · "smart" (as adjective for product) · easy · simple · intuitive · effortless · friction-free

---

## Trust-building moves (industrial promos that work — copy these)

1. **Named failure modes before features.** "Unbalance, looseness, lubrication issues, wear" (Tractian). The vocabulary signals you belong in the conversation.
2. **Specific numbers with specific equipment.** "53% reduction in corrective motor repair on 150 HP motors at Kraft Heinz." Asset class + metric + dollar/hour figure.
3. **Hands in the shot.** Real hands on real equipment. The recognition is instantaneous to a tech.
4. **Worker speaks first, product second.** Quote the maintenance tech, not the Director of Facilities.
5. **No soundtrack during technical demo.** Silence during the hands-on segment communicates: this is real, not produced.

## What B2B SaaS does that DOESN'T translate to industrial

1. UI-only footage from start to end (techs need physical equipment to anchor the abstract software)
2. Outcome language without numbers ("chaos into clarity")
3. Corporate VO with marketing vocabulary
4. Testimonials from titles, not trades ("Director of Facilities" instead of "the tech doing the wrenching")
5. Abstract animation as primary footage (signals you don't have real-plant footage)

---

## Generation outputs (per run)

Every run by the skill creates a folder under `marketing/videos/<YYYY-MM-DD>-<gen-id>/`:

```
2026-04-27-<gen-id>/
├── 01-product-brief.md       # ICP, customer voice, 4 psych pillars (Tyler step 1)
├── 02-competitor-analysis.md # gaps to exploit, saturated angles, winning angles (cached weekly)
├── 03-creative-briefs.md     # 2–3 brief variants — different angles, awareness stages
├── 04-reference-images/      # any external images fetched via Tavily or generated via gpt-image-1
├── 05-manifests/
│   ├── variant-a-icp-pain-led.yaml
│   ├── variant-b-proof-led.yaml
│   └── variant-c-walkthrough-led.yaml
├── 06-renders/
│   ├── variant-a.mp4
│   ├── variant-b.mp4
│   ├── variant-c.mp4
│   └── voiceover-*.mp3
└── README.md                 # one-page summary linking back to brief, briefs, decisions
```

---

## How to violate this playbook

If you have a specific reason to break a rule (an unusual audience, a planned anti-anti-pattern, a stylistic experiment), document it in the manifest's `playbook_overrides` block:

```yaml
playbook_overrides:
  - rule: "≤8 words per caption"
    why: "Specifically testing a 12-word headline against the playbook default for a longer-attention sales-enablement video."
```

The skill flags overrides in the run README so future you knows what was deliberate vs accidental.

---

## Sources (the corpus this playbook is grounded in)

**B2B SaaS / dev tools / launches:**
- Stripe — Introducing Stripe Atlas (2016) — https://www.youtube.com/watch?v=1WxV-ellcKk
- Linear — Quality series — https://www.youtube.com/@LinearApp / https://linear.app/quality
- Vercel / Next.js Conf trailers — https://www.youtube.com/c/Vercel
- Supabase — Launch Week feature videos — https://www.youtube.com/c/supabase
- OpenAI — Introducing GPT-4o (May 2024) — https://www.youtube.com/watch?v=DQacCB9tDaw
- Loom — AI Workflows (2024)
- Figma — Config 2024 / 2025 keynote — https://www.youtube.com/watch?v=5q8YAUTYAyk
- Notion — Agents (2024)
- Apple — product reveal segments
- Tesla — Cybertruck / Optimus Gen 2

**Industrial / blue-collar:**
- UpKeep Nova — https://www.youtube.com/watch?v=28woOmOfQuQ
- MaintainX — "5 Work Orders in 5 Minutes" — https://www.youtube.com/watch?v=vSEFxvfcOmk
- Fiix — Product Overview — https://www.youtube.com/watch?v=EW_yY6ilzig
- Tractian — Smart Trac — https://www.youtube.com/watch?v=ulMah82maPE
- Augury — Auguscope — https://www.youtube.com/watch?v=BkqUYNAUV2k
- Inductive Automation — "What is Ignition?" — https://www.youtube.com/watch?v=hYXUZeLw5ek
- Fluke — Mike-on-camera multimeter how-tos
- Milwaukee Tool — Solving Jobsite Problems

**Direct-response / launch:**
- Dropbox MVP explainer (2007 — Drew Houston)
- Y Combinator Demo Day pitches (60-second format)
- Alex Hormozi offer mechanics ($100M Offers)
- ProductHunt #1 launches (2024)
- Tyler Germain — "Claude Can Make Meta Ads Now?" — https://youtu.be/2jQEEJxJxPQ — the 6-step skill structure that this whole pipeline mirrors

---

**Living document.** Update when a rule fails in production. Mark the date and the failure. The point is to be more right next quarter than this quarter.
