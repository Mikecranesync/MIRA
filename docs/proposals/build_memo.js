// Build MIRA Projects Strategy Memo
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  ExternalHyperlink, TabStopType, TabStopPosition, PageBreak,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber
} = require('docx');

// --- Style helpers ---
const NAVY = "1B365D";
const ACCENT = "C9531C";  // industrial orange
const MUTED = "5C6770";
const LIGHT_BG = "F2F4F7";
const RULE = "D0D5DD";

const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const cellBorders = { top: border, bottom: border, left: border, right: border };

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80, line: 300 },
    ...opts,
    children: Array.isArray(text)
      ? text
      : [new TextRun({ text, ...(opts.run || {}) })]
  });
}

function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, bold: true, color: NAVY, size: 36 })]
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [new TextRun({ text, bold: true, color: NAVY, size: 28 })]
  });
}
function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: 24 })]
  });
}

function bullet(children, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { before: 40, after: 40, line: 280 },
    children: Array.isArray(children) ? children : [new TextRun(children)]
  });
}

function pullQuote(quote, source) {
  return new Paragraph({
    spacing: { before: 120, after: 120, line: 300 },
    indent: { left: 360, right: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 12 } },
    children: [
      new TextRun({ text: `\u201C${quote}\u201D`, italics: true, size: 22, color: "23303D" }),
      new TextRun({ text: `  \u2014 ${source}`, size: 18, color: MUTED })
    ]
  });
}

function divider() {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 4 } },
    children: [new TextRun("")]
  });
}

function link(text, url) {
  return new ExternalHyperlink({
    children: [new TextRun({ text, color: "1F4E79", underline: {} })],
    link: url
  });
}

// --- Tables ---
function compareTable() {
  const head = (t) => new TableCell({
    borders: cellBorders,
    width: { size: 1872, type: WidthType.DXA },
    shading: { fill: NAVY, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", size: 18 })] })]
  });
  const cell = (t, w, fill) => new TableCell({
    borders: cellBorders,
    width: { size: w, type: WidthType.DXA },
    ...(fill ? { shading: { fill, type: ShadingType.CLEAR } } : {}),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: t, size: 18 })] })]
  });
  const row = (cells, fill) => new TableRow({
    children: cells.map((t, i) => i === 0
      ? new TableCell({
          borders: cellBorders,
          width: { size: 1872, type: WidthType.DXA },
          ...(fill ? { shading: { fill, type: ShadingType.CLEAR } } : {}),
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 18 })] })]
        })
      : cell(t, 1872, fill))
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1872, 1872, 1872, 1872, 1872],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
            shading: { fill: NAVY, type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: "Capability", bold: true, color: "FFFFFF", size: 18 })] })]
          }),
          head("ChatGPT Projects"), head("Claude Projects"), head("NotebookLM"), head("MIRA Projects")
        ]
      }),
      row(["Citations to source", "Weak", "Weak", "Excellent", "Excellent + photo overlay"]),
      row(["File supersession", "None", "None", "Delete + re-add", "Native (rev tracking)"], LIGHT_BG),
      row(["Time-series / sensor data", "No", "No", "No", "Native"]),
      row(["Loud failure on bad input", "Silent", "Silent", "Partial", "Loud, color-coded"], LIGHT_BG),
      row(["Mobile-first (gloves, dirt, sun)", "Poor", "Poor", "Poor", "Designed for it"]),
      row(["Safety-keyword interrupt", "No", "No", "No", "LOTO/arc/confined STOP"], LIGHT_BG),
      row(["Works offline", "No", "No", "No", "Local cascade option"]),
      row(["Asset is the project (not folder)", "No", "No", "No", "Asset record + lifecycle"], LIGHT_BG),
    ]
  });
}

function tierTable() {
  const head = (t, w) => new TableCell({
    borders: cellBorders, width: { size: w, type: WidthType.DXA },
    shading: { fill: NAVY, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", size: 18 })] })]
  });
  const c = (t, w, fill, bold) => new TableCell({
    borders: cellBorders, width: { size: w, type: WidthType.DXA },
    ...(fill ? { shading: { fill, type: ShadingType.CLEAR } } : {}),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: t, size: 18, bold: !!bold })] })]
  });
  const widths = [1560, 1560, 2080, 2080, 2080];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ children: [
        head("Tier", widths[0]), head("Price/mo", widths[1]),
        head("Who buys", widths[2]), head("Project ceiling", widths[3]),
        head("Lock-in moat", widths[4])
      ]}),
      new TableRow({ children: [
        c("Tech Free", widths[0], null, true),
        c("$0", widths[1]),
        c("Solo tech, side-shop owner", widths[2]),
        c("3 assets, 25 docs each", widths[3]),
        c("They build a knowledge base they don\u2019t want to leave behind", widths[4])
      ]}),
      new TableRow({ children: [
        c("Crew", widths[0], LIGHT_BG, true),
        c("$39 / seat", widths[1], LIGHT_BG),
        c("2\u201310 person maint. team", widths[2], LIGHT_BG),
        c("25 assets, unlimited docs", widths[3], LIGHT_BG),
        c("Shared crew memory + handoff replays", widths[4], LIGHT_BG)
      ]}),
      new TableRow({ children: [
        c("Plant", widths[0], null, true),
        c("$899 + $19/seat", widths[1]),
        c("Single-site reliability mgr", widths[2]),
        c("Unlimited + sensor ingest", widths[3]),
        c("CMMS work-order link, OEM manuals, Atlas integration", widths[4])
      ]}),
      new TableRow({ children: [
        c("Enterprise", widths[0], LIGHT_BG, true),
        c("Custom", widths[1], LIGHT_BG),
        c("Multi-site, EHS, insurance", widths[2], LIGHT_BG),
        c("Tenant SSO, audit export", widths[3], LIGHT_BG),
        c("Compliance trail, on-prem option, SOC 2", widths[4], LIGHT_BG)
      ]}),
    ]
  });
}

// --- Build ---
const sections = [{
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
    }
  },
  headers: {
    default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "MIRA Projects \u00b7 Strategy Memo \u00b7 v1.0", color: MUTED, size: 16 })]
    })]})
  },
  footers: {
    default: new Footer({ children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: "FactoryLM \u00b7 CONFIDENTIAL", color: MUTED, size: 16 }),
        new TextRun({ text: "\tPage ", color: MUTED, size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 })
      ]
    })]})
  },
  children: [
    // Title block
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: "STRATEGY MEMO", bold: true, color: ACCENT, size: 18 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: "MIRA Projects", bold: true, color: NAVY, size: 56 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 240 },
      children: [new TextRun({ text: "The workspace built for the people who keep plants running.", italics: true, color: MUTED, size: 24 })]
    }),
    divider(),
    new Paragraph({
      spacing: { before: 120, after: 240 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: "Author: Mike Harper, FactoryLM   \u00b7   Date: April 22, 2026", size: 18, color: MUTED }),
        new TextRun({ text: "\tAudience: Customers, Sales, Partners", size: 18, color: MUTED })
      ]
    }),

    // EXEC SUMMARY
    H1("Executive Summary"),
    P("Every consumer AI \u2014 ChatGPT, Claude, Grok, Perplexity, NotebookLM \u2014 has shipped a \u201Cprojects\u201D feature in the last eighteen months. None of them work for the people who actually fix machines. They are knowledge-worker tools dressed up in a chat box: silent file failures, no source citations, no version control, no sensor data, no safety guardrails, and a UX designed for a desk \u2014 not a noisy factory floor with gloves on."),
    P("MIRA Projects fixes seven specific failures that the entire category shares, and adds three things none of them can: live sensor streams, photo-evidence overlays, and a safety interrupt on every answer that touches LOTO, arc flash, or confined-space work. We are not building a better notebook. We are building the operating layer for an industrial asset \u2014 the place where its manuals, its repair history, its sensor data, its photos, and the conversations about it all live and answer questions together, for twenty years, on a phone, with one tap."),
    P("This memo is a sales-and-positioning argument first, a product blueprint second. The pitch we ship to plants is short: \u201CYour competitors\u2019 AI forgets your file by message ten. MIRA remembers your asset for its lifetime.\u201D"),

    // SECTION 1
    H1("1. The Category Is Broken \u2014 We Have the Receipts"),
    P("We pulled customer complaints from Reddit, the OpenAI developer community, XDA Developers, the NotebookLM help forum, and seven other sources across the four largest AI \u201Cprojects\u201D products. The same seven problems appear in every product, with users now actively switching tools to escape them. Each is a wedge for MIRA."),

    H2("Failure #1 \u2014 The AI \u201Cforgets\u201D the file mid-conversation"),
    P("Users upload a manual to a project, then watch the model invent section numbers and procedures by message fifteen. A widely-circulated GitHub issue from October 2025 documents project instructions being honored perfectly before context compaction and violated 100% of the time after. This is structural, not a bug \u2014 it is what every long-context model does when its window fills."),
    pullQuote(
      "Claude told me our service interval is 500 hours. I have 12 PDFs in the project. Which one said that? No idea. Can\u2019t trust it for compliance work.",
      "r/ClaudeAI, paraphrased — recurring complaint pattern"
    ),
    P([
      new TextRun({ text: "Sources: ", bold: true, size: 18, color: MUTED }),
      link("Claude Code Forgets Your Project (DEV)", "https://dev.to/kiwibreaksme/claude-code-keeps-forgetting-your-project-heres-the-fix-2026-3flm"),
      new TextRun({ text: " \u00b7 ", size: 18, color: MUTED }),
      link("Claude Saves Tokens, Forgets Everything", "https://golev.com/post/claude-saves-tokens-forgets-everything/"),
    ]),

    H2("Failure #2 \u2014 Silent file failures"),
    P("ChatGPT Pro users report a documented silent-truncation bug where uploads >30\u201360 KB are partially read while the model claims to have ingested the whole file. The official 20-file project limit is enforced as a 10-file limit by the UI; uploads of files 11+ freeze indefinitely. Users only discover the failure when an answer is wrong."),
    P([
      new TextRun({ text: "Sources: ", bold: true, size: 18, color: MUTED }),
      link("GPT-5.1 silently truncates uploaded documents (OpenAI Community)", "https://community.openai.com/t/critical-gpt-5-1-silently-truncates-uploaded-documents-30-60-kb-limit-while-claiming-full-read-confirmed-by-4-major-ai-models/1368746"),
      new TextRun({ text: " \u00b7 ", size: 18, color: MUTED }),
      link("Pro user hitting 10-file limit (OpenAI Community)", "https://community.openai.com/t/pro-user-hitting-10-file-limit-in-chatgpt-projects-uploads-freeze-edits-fail-despite-20-file-allowance-anyone-else-experiencing-this/1304217"),
    ]),

    H2("Failure #3 \u2014 No source citations on uploaded files"),
    P("Outside NotebookLM, none of the major projects features cite which file or page produced an answer. Users have no way to verify a claim against the document they paid to upload. NotebookLM users tolerate the 50-source cap and the missing API specifically because of citations \u2014 a clear signal that traceability is the table-stakes feature of the next generation."),
    P([
      new TextRun({ text: "Source: ", bold: true, size: 18, color: MUTED }),
      link("NotebookLM Limitations: 8 Gaps Google Won't Tell You (Atlas)", "https://www.atlasworkspace.ai/blog/notebooklm-limitations"),
    ]),

    H2("Failure #4 \u2014 No file supersession or version control"),
    P("All five products treat uploads as immutable. To replace a manual revision you delete and re-add, which orphans every saved citation and chat reference to the old file. This is fine for one-off research; it is catastrophic for a maintained asset where the manual revision changes every year and the wrong revision is a safety incident."),
    P([
      new TextRun({ text: "Source: ", bold: true, size: 18, color: MUTED }),
      link("NotebookLM source limit is its biggest problem (XDA)", "https://www.xda-developers.com/notebooklms-source-limit-is-its-biggest-problem/"),
    ]),

    H2("Failure #5 \u2014 Sharing is read-only theater, not collaboration"),
    P("\u201CSharing a project\u201D today means a read-only link or a seat-based invite. There is no @-mention, no comment, no presence indicator, no notification when a teammate adds a critical document, no attribution of which technician contributed which finding. Plant maintenance is a relay race \u2014 day-shift to night-shift, tech to manager, in-house to OEM \u2014 and these tools were built for a single user with a laptop."),

    H2("Failure #6 \u2014 Sensor and time-series data are absent"),
    P("Every projects product is document-centric: PDFs, web pages, transcripts. None of them ingest a vibration trend, a temperature curve, a fault-code history, or a Modbus tag stream. For maintenance, the document and the data are the same conversation \u2014 \u201Cwhy did this bearing fail?\u201D requires both the OEM bearing manual and the last 90 days of vibration. The category cannot answer that."),

    H2("Failure #7 \u2014 The UX assumes a desk and a quiet room"),
    P("Tap targets sized for a mouse. Filename lists nine columns wide. Citation chips that require a hover. Voice input that doesn\u2019t work over compressor noise. A maintenance tech holding a phone in a greasy glove, in 95\u00B0F sun, next to a running line, will abandon every one of these products inside ten minutes. None of them have ever been used in our customers\u2019 environment by anyone designing them."),

    new Paragraph({ children: [new PageBreak()] }),

    H1("2. Why These Failures Are Worse for Maintenance"),
    P("Knowledge workers shrug at silent failures because they re-read the source. A welder doesn\u2019t. A reliability tech doesn\u2019t. An apprentice on a 12-hour swing shift trying to restart an extruder at 3 a.m. doesn\u2019t. Three things make the consumer-AI failure modes far more dangerous in our market:"),
    bullet([new TextRun({ text: "Asset lifetime, not session lifetime. ", bold: true }), new TextRun("A Claude Project usually lives for one report. A MIRA project is Line 3 Extruder #4 \u2014 it lives for twenty years, gets manual revisions, gets PLC reprograms, gets parts substitutions, and gets twelve different techs touching it. The category\u2019s storage model breaks at week three.")]),
    bullet([new TextRun({ text: "Wrong answer = injury, not embarrassment. ", bold: true }), new TextRun("\u201CTorque to 45 Nm\u201D from the wrong revision of the manual is a gasket blowout. \u201CDe-energize at MCC-3\u201D from the wrong panel drawing is an arc-flash. The cost of an unsourced answer is not a bad email; it is an OSHA recordable.")]),
    bullet([new TextRun({ text: "Trust collapses fast in non-technical users. ", bold: true }), new TextRun("A developer notices when ChatGPT silently dropped a file and debugs it. A maintenance tech trusts the answer, executes it, and never opens the app again. We get one shot.")]),

    H1("3. The MIRA Projects Answer \u2014 Three Design Principles"),

    H2("Principle 1: An asset, not a folder"),
    P("Every MIRA project is rooted in an asset record \u2014 tag number, OEM, model, install date, criticality, PM schedule. Documents, sensor streams, photos, work orders, and chats hang off that record. This is not a UI difference; it is the data model. Every other product in the category is a folder of files with a chat glued on. That is why every other product has the same seven complaints."),

    H2("Principle 2: Loud failure, traceable answer"),
    P("Three product rules make MIRA feel different from the first ten seconds:"),
    bullet([new TextRun({ text: "Every file shows its state \u2014 ", bold: true }), new TextRun("Indexed \u00b7 Partially indexed \u00b7 OCR failed \u00b7 Superseded \u00b7 Stale. Color-coded. Visible from the project home. Tap-to-rescan.")]),
    bullet([new TextRun({ text: "Every answer carries a source chip \u2014 ", bold: true }), new TextRun("Manual rev, page, paragraph. For sensor answers: trace ID, time window. For photos: tap to overlay the original with the AI\u2019s annotation.")]),
    bullet([new TextRun({ text: "Every safety-keyword answer halts \u2014 ", bold: true }), new TextRun("LOTO, arc flash, confined space, hot work, lockout. The model returns a STOP card with the relevant procedure and the responsible person\u2019s contact. No guessing.")]),

    H2("Principle 3: One thumb, gloves on, sun overhead"),
    P("MIRA Projects ships mobile-first by an unusual measure: every primary action is reachable in the bottom 40% of the screen, every tap target is at least 56\u00D744 pt, every file state is announced by color and shape (not just color, for sun-readability), and every project has a one-tap voice intake that works over 80 dB of plant noise. Most of our competitors\u2019 features look identical on a phone and a laptop. Ours don\u2019t."),

    new Paragraph({ children: [new PageBreak()] }),

    H1("4. Three Solution Directions"),
    P("We see three plausible product shapes for MIRA Projects. They are not mutually exclusive; the recommendation at the end of this memo bundles them in sequence."),

    H3("Direction A \u2014 \u201CThe Asset Page\u201D (recommended for v1)"),
    P("Every project is a single, scrollable page for one piece of equipment. Top: the asset hero card (tag, OEM, criticality, current health, next PM). Below: tabbed shelves for Manuals, Photos, Work Orders, Sensor Streams, and Conversations. Right rail: a persistent chat that knows it is grounded in this asset \u2014 ask anything, get cited answers. Why this wins: it matches how a tech already thinks (\u201Clet me pull up Extruder 4\u201D), it makes the asset the unit of value, and it is the easiest thing to demo in a 90-second sales loop."),

    H3("Direction B \u2014 \u201CThe Crew Workspace\u201D"),
    P("A project is the team\u2019s working surface for a multi-asset job: shutdown week, line install, recurring PM route. Multiple assets pinned, tasks assigned, comments threaded, handoff replays at shift change. Why this wins: it sells to the manager (the buyer), shows ROI per shift in pass-down time saved, and makes the second user (the manager) the champion of MIRA inside the plant."),

    H3("Direction C \u2014 \u201CThe Investigation\u201D"),
    P("A project is a time-boxed root cause investigation \u2014 RCA after a failure, warranty case against an OEM, vendor escalation, EHS incident. Files, sensor windows, photos, interview notes, and AI hypotheses all attached. Closes with a generated report (PDF, signed, exportable to CMMS). Why this wins: every plant has incidents. It is the highest-emotion, highest-budget moment in our customer\u2019s month, and a delightful tool for it earns permanent loyalty."),

    H1("5. How MIRA Compares Today, Side-by-Side"),
    compareTable(),

    new Paragraph({ children: [new PageBreak()] }),

    H1("6. Pricing & Packaging"),
    P("Four tiers. The free tier is the wedge: a solo tech building knowledge for their own equipment becomes our champion when they change jobs and their next employer asks how they got so productive."),
    tierTable(),

    H1("7. How We Take It to Market"),
    bullet([new TextRun({ text: "Wedge: ", bold: true }), new TextRun("Free tier in maintenance Slack/Discord/Reddit communities (r/maintenance, r/PLC, r/Reliability). Lead with one product video: \u201CWatch ChatGPT Lose Your Manual\u201D \u2014 we record the silent-truncation bug, side-by-side with MIRA loudly catching the same file. 90 seconds. Posted weekly.")]),
    bullet([new TextRun({ text: "Land: ", bold: true }), new TextRun("Free tier converts to Crew when a second tech on the same team signs up. Built-in invite + crew handoff feature drives this. We do not sell to the team \u2014 the team self-organizes around the existing user.")]),
    bullet([new TextRun({ text: "Expand: ", bold: true }), new TextRun("Crew converts to Plant when (a) the team starts ingesting sensor data or (b) the manager wants the audit trail. Both happen by month three for active teams.")]),
    bullet([new TextRun({ text: "Lock: ", bold: true }), new TextRun("Plant converts to Enterprise when EHS, insurance, or corporate reliability ask for the audit export and SOC 2 \u2014 events we trigger by selling the plant manager a six-page \u201Cwhy your insurance carrier will love this\u201D one-pager every quarter.")]),
    bullet([new TextRun({ text: "Channel: ", bold: true }), new TextRun("OEM partnerships. Every equipment manufacturer ships a 200-page manual and resents the fact that nobody reads it. We give them a co-branded \u201CMIRA-ready\u201D badge in exchange for them shipping their manuals into MIRA pre-indexed. They sell more spare parts; we get distribution.")]),

    H1("8. The 90-Day Plan"),
    bullet([new TextRun({ text: "Days 0\u201330: ", bold: true }), new TextRun("Ship Direction A (Asset Page) end-to-end on top of the existing mira-mcp + Atlas CMMS + mira-pipeline stack. One paying pilot plant. One sales video per week. Three OEM conversations open.")]),
    bullet([new TextRun({ text: "Days 31\u201360: ", bold: true }), new TextRun("Add Direction B (Crew Workspace) primitives \u2014 handoff replay, comment, presence. Convert pilot plant to Crew. Launch free tier publicly.")]),
    bullet([new TextRun({ text: "Days 61\u201390: ", bold: true }), new TextRun("Add Direction C (Investigation) and the audit export. First Plant-tier paying customer. SOC 2 Type 1 kickoff. First OEM partnership signed.")]),

    H1("9. The Ask \u2014 What This Funds"),
    P("Two engineers for ninety days, focused exclusively on Projects. One growth marketer to ship the weekly \u201CWatch ChatGPT Lose Your Manual\u201D series and run the Reddit/Discord wedge. One design contractor for the mobile-glove pass on shipped screens. Estimated cost \u2014 see attached PRD, Section 9. Estimated outcome \u2014 a paid tier that prices a plant\u2019s reliability function at less than the cost of one unplanned hour of downtime per month, and a free tier that builds a moat the consumer AIs cannot follow us into."),

    divider(),
    P([new TextRun({ text: "Companion artifacts: ", bold: true, color: NAVY }),
       new TextRun({ text: "(1) Interactive prototype \u2014 mira-projects-prototype.html. (2) Product Requirements Document \u2014 MIRA-Projects-PRD-v1.docx. Both saved in /docs/proposals/.", color: MUTED })]),
    P([new TextRun({ text: "Document version: ", color: MUTED }),
       new TextRun({ text: "v1.0 \u00b7 2026-04-22 \u00b7 FactoryLM CONFIDENTIAL", color: MUTED })]),
  ]
}];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, color: NAVY, font: "Arial" },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, color: NAVY, font: "Arial" },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, color: ACCENT, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
        ] }
    ]
  },
  sections
});

const out = path.join(__dirname, "MIRA-Projects-Strategy-Memo.docx");
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log("Wrote", out);
});
