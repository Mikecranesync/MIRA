// Build MIRA Projects PRD
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  ExternalHyperlink, TabStopType, TabStopPosition, PageBreak,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber
} = require('docx');

const NAVY = "1B365D";
const ACCENT = "C9531C";
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
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, color: NAVY, size: 26 })]
  });
}
function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: 22 })]
  });
}
function bullet(children, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { before: 30, after: 30, line: 280 },
    children: Array.isArray(children) ? children : [new TextRun(children)]
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

// metric / row tables
function kvTable(rows, colWidths = [2400, 6960]) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: rows.map((r, i) => new TableRow({
      children: [
        new TableCell({
          borders: cellBorders, width: { size: colWidths[0], type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT_BG : "FFFFFF", type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: r[0], bold: true, size: 18 })] })]
        }),
        new TableCell({
          borders: cellBorders, width: { size: colWidths[1], type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT_BG : "FFFFFF", type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: r[1], size: 18 })] })]
        })
      ]
    }))
  });
}

function reqTable() {
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
  const widths = [780, 1620, 4920, 1020, 1020];
  const rows = [
    ["F-1","Asset record","Every project is rooted in an asset record (tag, OEM, model, install date, criticality, PM schedule). Soft-delete only; assets persist across team turnover.","Must","mira-cmms · mira-mcp"],
    ["F-2","Multi-shelf storage","Project home presents Manuals, Photos, Work Orders, Sensor Streams, Conversations as first-class shelves. Each shelf has its own ingest path.","Must","mira-crawler · mira-ingest · mira-mcp"],
    ["F-3","File state badge","Every file shows one of: Indexed · Partial · OCR-failed · Superseded · Stale. Color + shape (not color alone). Tap-to-rescan or tap-to-diff.","Must","mira-ingest"],
    ["F-4","File supersession","Uploading a new revision marks the old as Superseded but keeps it searchable. Citations to the old rev resolve to a 'this answer was based on rev C, current rev is D' banner.","Must","NeonDB schema"],
    ["F-5","Cited answers","Every answer in a project carries source chips (doc + page, sensor + window, photo + region). Tap chip → opens source with cited region highlighted.","Must","GSDEngine · mira-pipeline"],
    ["F-6","Safety interrupt","Answers touching SAFETY_KEYWORDS halt with a STOP card; user must acknowledge LOTO/PPE/etc before MIRA continues. Reuses existing guardrails module.","Must","mira-bots/shared/guardrails"],
    ["F-7","Sensor stream attach","Project owner can pin PLC tags / vibration channels / SCADA points. AI uses live + historical windows as context for chat answers.","Must","mira-mcp tools (new) · time-series schema"],
    ["F-8","Photo overlay","Photos uploaded to a project can be annotated by AI with overlays linked to manual figures. Native gloves-friendly capture flow on mobile.","Should","mira-ingest · vision pipeline"],
    ["F-9","Crew presence + comments","Show who is in a project right now, who added what, @-mention with notification, comment on any file or chat answer.","Should","new realtime layer (Yjs / Liveblocks / Phoenix Channels)"],
    ["F-10","Shift handoff","One-tap auto-generated 90-sec audio + text handoff at end of shift, listing what changed and what's pending.","Should","mira-pipeline summarizer · TTS"],
    ["F-11","Investigation mode","Time-boxed RCA project: auto-built evidence timeline, hypothesis tracker, signed PDF closeout pushed to Atlas CMMS.","Should","mira-cmms integration · pdf skill"],
    ["F-12","Free → Crew → Plant tier upgrade","Asset count, seat count, sensor-stream count gate the upgrade. In-product nudges trigger at 80% of tier limit.","Should","mira-web (PLG funnel)"],
    ["F-13","Audit export","Plant + Enterprise tiers can export a date-ranged immutable PDF audit log of every Q&A and every safety interrupt for compliance / insurance use.","Could","NeonDB · pdf skill"],
    ["F-14","Mobile-first interaction model","Primary actions in bottom 40% of screen, 56×44pt min tap targets, sun-readable mode toggle, 80 dB voice intake.","Must","mira-web (mobile views) · mira-bots Telegram/Slack mobile flows"],
    ["F-15","On-prem / offline option","Plant + Enterprise can deploy MIRA Projects against the local cascade (qwen2.5vl + Open WebUI) when WAN is down. Files stay on plant network.","Could","INFERENCE_BACKEND=local"],
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ children: [head("ID",widths[0]), head("Capability",widths[1]), head("Description",widths[2]), head("Priority",widths[3]), head("Owner module",widths[4])] }),
      ...rows.map((r, i) => new TableRow({
        children: r.map((v, j) => c(v, widths[j], i % 2 === 0 ? LIGHT_BG : null, j === 0))
      }))
    ]
  });
}

function metricsTable() {
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
  const widths = [3120, 3120, 3120];
  const rows = [
    ["Activation: project created in first session","Plug-it-in test \u2014 we want the wedge","\u2265 70%"],
    ["Time-to-first-cited-answer","Trust forms here","< 90 seconds"],
    ["7-day active project rate","Real workflow, not a try","\u2265 40%"],
    ["Projects with >1 contributor by week 4","Crew tier conversion driver","\u2265 25%"],
    ["Projects with sensor stream attached","Plant tier conversion driver","\u2265 15%"],
    ["Safety-interrupt acknowledgment rate","Trust + safety \u2014 must be high","\u2265 95%"],
    ["NPS at 30 days, paying customers","Differentiation signal","\u2265 50"],
    ["Free \u2192 Crew conversion","Business model proof","\u2265 8% by month 3"],
    ["Crew \u2192 Plant conversion","Expansion proof","\u2265 20% by month 6"],
    ["Logo-level retention at 12 months","Lifetime value","\u2265 90%"],
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ children: [head("Metric",widths[0]), head("Why it matters",widths[1]), head("Target",widths[2])] }),
      ...rows.map((r, i) => new TableRow({
        children: r.map((v, j) => c(v, widths[j], i % 2 === 0 ? LIGHT_BG : null, j === 0))
      }))
    ]
  });
}

function depTable() {
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
  const widths = [2080, 4160, 3120];
  const rows = [
    ["mira-mcp","Equipment diagnostic tools, NeonDB recall, sensor read tools","New tool: project_query, file_state, sensor_window"],
    ["mira-pipeline","GSDEngine wrapper that calls Anthropic API with project context","Add project_id scope param + citation rendering"],
    ["mira-cmms (Atlas)","Asset registry, work orders, PM schedule","Project = asset record join. Push RCA closeout WO."],
    ["mira-crawler","KB ingest + manual chunker","Reuse for project doc shelf. Add supersession schema."],
    ["mira-ingest","Photo + PDF pipeline","Add file_state badge + tap-to-rescan endpoint"],
    ["mira-web","PLG funnel, Stripe","Add Projects pricing tier UI + upgrade nudges"],
    ["mira-bots/shared/guardrails","Safety keywords + intent classifier","Wire SAFETY_KEYWORDS into Project answer pipeline"],
    ["NeonDB","Schema","New tables: projects, project_files, project_revisions, project_streams, project_chats, project_acks"],
    ["New: realtime layer","Presence, comments, @-mention","Recommend Phoenix Channels (Apache 2.0) over commercial Liveblocks. Decision needed."],
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ children: [head("Module",widths[0]), head("Today's role",widths[1]), head("Change required",widths[2])] }),
      ...rows.map((r, i) => new TableRow({
        children: r.map((v, j) => c(v, widths[j], i % 2 === 0 ? LIGHT_BG : null, j === 0))
      }))
    ]
  });
}

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
      children: [new TextRun({ text: "MIRA Projects \u00B7 PRD v1.0 \u00B7 2026-04-22", color: MUTED, size: 16 })]
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
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: "PRODUCT REQUIREMENTS DOCUMENT", bold: true, color: ACCENT, size: 18 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: "MIRA Projects v1", bold: true, color: NAVY, size: 50 })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 240 },
      children: [new TextRun({ text: "Workspace, knowledge base, and live operating layer for an industrial asset.", italics: true, color: MUTED, size: 22 })]
    }),
    divider(),
    P([
      new TextRun({ text: "Author: ", bold: true, size: 18, color: MUTED }),
      new TextRun({ text: "Mike Harper, FactoryLM    ", size: 18, color: MUTED }),
      new TextRun({ text: "Status: ", bold: true, size: 18, color: MUTED }),
      new TextRun({ text: "Draft for review    ", size: 18, color: MUTED }),
      new TextRun({ text: "Target ship: ", bold: true, size: 18, color: MUTED }),
      new TextRun({ text: "Asset Page (v1) by 2026-05-22 \u00b7 Crew Workspace by 2026-06-21 \u00b7 Investigation by 2026-07-19", size: 18, color: MUTED })
    ]),

    // 1 PROBLEM
    H1("1. Problem"),
    P("Industrial maintenance technicians and reliability managers do not have a workspace that holds equipment context across time. The information they need to fix a machine \u2014 OEM manuals, repair history, sensor trends, photos of past failures, conversations with the OEM and with previous shifts \u2014 lives in five different systems and walks out the door when a tech changes jobs."),
    P("Generic AI \u201Cprojects\u201D features (ChatGPT, Claude, Grok, Perplexity, NotebookLM) attempt to solve a related problem for knowledge workers. They fail in industrial settings for seven well-documented reasons: silent file failures, no source citations, no version control, no sensor data, no safety guardrails, no real collaboration, and a UX built for a desk and a quiet room. (Citations and detail: see companion Strategy Memo, Section 1.)"),
    P("MIRA Projects is the answer for the maintenance audience: a workspace that treats the asset \u2014 not the folder \u2014 as the unit of value, with traceability, safety, and sensor-data awareness as core primitives, not features."),

    // 2 USERS
    H1("2. Users"),
    H3("Primary \u2014 Maintenance technician (\u201CCarlos\u201D)"),
    P("8\u201320 years on the floor, journeyman-level. Uses MIRA on a phone in greasy gloves between calls. Has zero patience for software that doesn't work. Trusts the AI when it shows him the manual page. Stops trusting the AI immediately the first time it makes something up."),
    H3("Primary \u2014 Reliability / maintenance manager (\u201CDana\u201D)"),
    P("Buyer of the Plant tier. Needs the audit trail, the cross-asset view, the shift-handoff replay, and the report she can hand to insurance after a near-miss. Cares about uptime hours, MTBF, safety recordables, and her team\u2019s ability to onboard a new tech in days, not weeks."),
    H3("Secondary \u2014 OEM service / vendor (\u201CTaylor\u201D)"),
    P("Visiting tech from the equipment manufacturer. Wants temporary scoped access to a single asset's project to read history, look at photos, and post a finding. Logs out at end of visit; access auto-revokes."),
    H3("Secondary \u2014 EHS / Insurance reviewer (\u201CRiley\u201D)"),
    P("Reads the audit export quarterly. Wants every safety-keyword interrupt with a timestamp and acknowledgment. Wants to know that the AI never told a tech to bypass a procedure."),

    new Paragraph({ children: [new PageBreak()] }),

    // 3 GOALS
    H1("3. Goals & Non-Goals"),
    H3("Goals"),
    bullet("Ship Direction A (Asset Page) end-to-end by 2026-05-22 with a paying pilot plant using it daily."),
    bullet("Establish three product rules \u2014 file-state visibility, source citation on every answer, safety interrupt on every safety keyword \u2014 as the things customers tell each other about us."),
    bullet("Build a free tier that solo techs adopt as their personal knowledge base, creating viral spread when they change jobs."),
    bullet("Achieve > 90% logo retention at 12 months in the Plant tier."),
    H3("Non-Goals (v1)"),
    bullet("Multi-tenant cross-customer search. Each tenant\u2019s projects are isolated."),
    bullet("Generic file storage / Dropbox-like browsing. Only project-scoped storage."),
    bullet("AR overlays / HUD integration (archived per ADR-0005, not in MVP)."),
    bullet("Modbus / PLC driver work (deferred to Config 4 per existing roadmap)."),
    bullet("Public sharing / community projects. Single-tenant only at v1."),

    // 4 USER STORIES
    H1("4. User Stories (top 12)"),
    bullet([new TextRun({ text: "US-1 ", bold: true }), new TextRun("As Carlos, I open MIRA on my phone and tap one tile to land in EX-3-04\u2019s project, so I never browse for context.")]),
    bullet([new TextRun({ text: "US-2 ", bold: true }), new TextRun("As Carlos, I ask \u201Cwhat torque\u201D and get a number with the manual page chip beneath it, so I trust the answer in under 5 seconds.")]),
    bullet([new TextRun({ text: "US-3 ", bold: true }), new TextRun("As Carlos, when I ask anything about a lockout, MIRA halts and walks me through LOTO before answering, so I cannot accidentally bypass safety.")]),
    bullet([new TextRun({ text: "US-4 ", bold: true }), new TextRun("As Carlos, when an upload's OCR fails, MIRA tells me loudly and offers a one-tap rescan, so I never get an answer based on a partial read.")]),
    bullet([new TextRun({ text: "US-5 ", bold: true }), new TextRun("As Carlos, I can swipe to a sensor shelf and see the live trace for any tag pinned to this asset, so I correlate \u201Cwhy is this happening\u201D in one screen.")]),
    bullet([new TextRun({ text: "US-6 ", bold: true }), new TextRun("As Carlos, I drop a photo of the part and MIRA overlays the matching figure from the manual, so I can confirm the part number without leaving the field.")]),
    bullet([new TextRun({ text: "US-7 ", bold: true }), new TextRun("As Dana, I open the Crew Workspace at shift change and the 90-second audio handoff plays, so I am up to speed walking from the parking lot.")]),
    bullet([new TextRun({ text: "US-8 ", bold: true }), new TextRun("As Dana, I see who has touched which asset today, with comment threads and outstanding mentions, so I can run my morning huddle from one screen.")]),
    bullet([new TextRun({ text: "US-9 ", bold: true }), new TextRun("As Dana, when an incident opens, an Investigation project auto-builds an evidence timeline from sensors + emails + photos, so the RCA writes itself.")]),
    bullet([new TextRun({ text: "US-10 ", bold: true }), new TextRun("As Taylor (OEM), I receive a time-bounded link that lets me read history and post a finding to one specific asset, so I help without getting full access to the plant.")]),
    bullet([new TextRun({ text: "US-11 ", bold: true }), new TextRun("As Riley (EHS), I export a quarterly PDF audit of every safety interrupt, so I can demonstrate due diligence to insurance.")]),
    bullet([new TextRun({ text: "US-12 ", bold: true }), new TextRun("As Carlos, when an OEM ships a manual revision, MIRA marks the old revision Superseded and surfaces a one-line diff, so I know what changed before I act.")]),

    new Paragraph({ children: [new PageBreak()] }),

    // 5 REQUIREMENTS
    H1("5. Functional Requirements"),
    P("Priority follows MoSCoW. Owner module references the existing MIRA repo modules listed in the root CLAUDE.md."),
    reqTable(),

    new Paragraph({ children: [new PageBreak()] }),

    // 6 NON-FUNC
    H1("6. Non-Functional Requirements"),
    kvTable([
      ["Latency","Cited answer < 4s p50, < 8s p95 from question to first source chip rendered. Voice intake to text < 1s p95."],
      ["Mobile","Works on iOS 16+, Android 12+, and progressive web app. Sun-readable mode reduces text contrast use of color and increases stroke weight."],
      ["Offline","Plant + Enterprise tiers degrade gracefully when WAN is down: cascade falls through to local Open WebUI + qwen2.5vl. File reads continue from local cache."],
      ["Security","Per-project ACL + tenant SSO + Doppler-managed secrets. No file leaves the tenant boundary unless the user enables OEM share. SOC 2 Type 1 by 2026-Q4."],
      ["Compliance","Immutable audit log for every Q&A and every safety interrupt. Exportable as signed PDF (Plant+) for insurance and EHS use."],
      ["Licensing","All new dependencies Apache 2.0 or MIT. Realtime layer choice (F-9) must satisfy this constraint \u2014 see Open Decisions."],
      ["Container model","One service per project surface (project-api, project-realtime). Pinned versions, healthcheck, restart: unless-stopped \u2014 per existing security-boundaries.md."],
      ["PII / data sovereignty","Reuse existing InferenceRouter.sanitize_context() to strip IPs/MACs/serials from any prompt that leaves the tenant."],
      ["Accessibility","WCAG 2.1 AA on the web. Voice flows usable with no visual feedback (eyes-on-the-machine work)."],
    ]),

    // 7 ARCH
    H1("7. Architecture & Module Dependencies"),
    P("MIRA Projects is a thin coordination layer over existing MIRA modules. It introduces one new schema family in NeonDB, three new mira-mcp tools, one new realtime service, and small additions to mira-pipeline (citation rendering) and mira-web (PLG tier UI)."),
    depTable(),
    H3("Data model (NeonDB \u2014 abridged)"),
    P("New tables: projects, project_assets, project_files, project_revisions (file supersession), project_streams (sensor pins), project_chats, project_messages, project_citations, project_acks (safety acknowledgments), project_members. All scoped by tenant_id. file_state enum: indexed | partial | failed | superseded | stale."),

    new Paragraph({ children: [new PageBreak()] }),

    // 8 SUCCESS METRICS
    H1("8. Success Metrics"),
    P("Quantitative targets at 90 days post-GA, measured per tenant and rolled up. We instrument from day one \u2014 no metric is added retroactively."),
    metricsTable(),

    H3("Qualitative signals"),
    bullet("Customers tell other customers about file-state badges, the safety STOP card, or the citation chips \u2014 unprompted."),
    bullet("\u201CYour AI didn't lose my file\u201D appears in customer testimonials within 60 days of launch."),
    bullet("OEMs proactively ask to be \u201CMIRA-ready\u201D \u2014 distribution channel proof."),

    // 9 PHASING
    H1("9. Phasing"),
    H3("Phase 1 \u2014 Asset Page (v1) \u2014 Days 0\u201330"),
    bullet("F-1, F-2, F-3, F-4, F-5, F-6, F-7, F-14, F-15."),
    bullet("Two engineers + one design contractor. Pilot plant uses it daily by day 25."),
    bullet("Exit criteria: pilot plant logs >5 cited answers per tech per shift for 7 consecutive days."),
    H3("Phase 2 \u2014 Crew Workspace \u2014 Days 31\u201360"),
    bullet("F-9, F-10, F-12. Add presence, comments, @-mention, audio handoff."),
    bullet("Exit criteria: >50% of pilot plant\u2019s techs in a project simultaneously at shift change at least 3 days a week."),
    H3("Phase 3 \u2014 Investigation \u2014 Days 61\u201390"),
    bullet("F-8, F-11, F-13. Add photo overlay, RCA timeline + signed PDF, audit export."),
    bullet("Exit criteria: pilot plant uses Investigation for at least one P1 incident with the AI report accepted by insurance."),

    // 10 RISKS
    H1("10. Risks & Mitigations"),
    bullet([new TextRun({ text: "R-1 \u2014 Citation accuracy. ", bold: true }), new TextRun("Risk: AI cites the wrong page. Mitigation: every cite renders the actual highlighted region; user can flag and we use that as eval data. Hard target: < 2% mis-cite rate measured weekly.")]),
    bullet([new TextRun({ text: "R-2 \u2014 Realtime layer license. ", bold: true }), new TextRun("Risk: chosen realtime stack violates Apache/MIT constraint. Mitigation: pre-flight Phoenix Channels and Yjs against license + ops complexity before any code. Decision in week 1.")]),
    bullet([new TextRun({ text: "R-3 \u2014 Sensor stream complexity. ", bold: true }), new TextRun("Risk: pinning live tags introduces sprawling integration with SCADA/Ignition. Mitigation: v1 only consumes data we are already ingesting via mira-relay. No new connectors in v1.")]),
    bullet([new TextRun({ text: "R-4 \u2014 Safety interrupt fatigue. ", bold: true }), new TextRun("Risk: too-frequent STOP cards train users to dismiss. Mitigation: keyword list curated weekly; track ack-rate vs. dismissal-rate; tune thresholds.")]),
    bullet([new TextRun({ text: "R-5 \u2014 Mobile design debt. ", bold: true }), new TextRun("Risk: building tablet-first then mobile-second produces a cramped phone view. Mitigation: design every screen on a phone first, prove it, then scale up. Sun-readable mode is a checkpoint, not an afterthought.")]),

    // 11 OPEN DECISIONS
    H1("11. Open Decisions"),
    bullet([new TextRun({ text: "D-1 \u2014 Realtime stack. ", bold: true }), new TextRun("Phoenix Channels (Apache 2.0, ops cost) vs. Yjs+websocket (MIT, complexity in conflict resolution) vs. Liveblocks (commercial, fastest, license-incompatible). Decision by 2026-04-29.")]),
    bullet([new TextRun({ text: "D-2 \u2014 Pricing. ", bold: true }), new TextRun("Memo proposes $0 / $39 seat / $899+$19 / custom. Validate with three pilot conversations before Phase 1 ships.")]),
    bullet([new TextRun({ text: "D-3 \u2014 OEM share model. ", bold: true }), new TextRun("Time-bounded magic link (no account) vs. lightweight OEM account on our side. Default to magic link unless an OEM partner asks otherwise.")]),
    bullet([new TextRun({ text: "D-4 \u2014 Investigation closeout format. ", bold: true }), new TextRun("Push to Atlas CMMS as a structured WO closeout (preferred) vs. a PDF attachment (faster). v1 ships PDF; CMMS structured push in v1.1.")]),

    // 12 OUT OF SCOPE
    H1("12. Out of Scope (v1)"),
    bullet("Cross-tenant search or marketplace for shared project templates."),
    bullet("Mobile native apps (web-first via PWA; native is a v2 decision)."),
    bullet("Multi-language UI (English only at v1; Spanish at v1.1 \u2014 high demand from pilot plant)."),
    bullet("AI-suggested PM schedule changes (read-only on PM data at v1)."),
    bullet("Auto-ordering of spare parts (out of scope until OEM partnerships mature)."),

    // 13 RELATED
    H1("13. Related Documents"),
    bullet([new TextRun({ text: "Strategy memo: ", bold: true }), new TextRun("docs/proposals/MIRA-Projects-Strategy-Memo.docx \u2014 customer-facing positioning, competitor pain, GTM.")]),
    bullet([new TextRun({ text: "Interactive prototype: ", bold: true }), new TextRun("docs/proposals/MIRA-Projects-Prototype.html \u2014 three UX directions in one page.")]),
    bullet([new TextRun({ text: "Existing PRD: ", bold: true }), new TextRun("docs/PRD_v1.0.md \u2014 MIRA platform PRD, Config tier definitions.")]),
    bullet([new TextRun({ text: "Active 90-day plan: ", bold: true }), new TextRun("docs/plans/2026-04-19-mira-90-day-mvp.md \u2014 must reconcile in-flight work before Phase 1 starts.")]),
    bullet([new TextRun({ text: "Customer interviews: ", bold: true }), new TextRun("docs/customer-interviews.md \u2014 morning report (#466) signal validates the Crew Workspace handoff feature.")]),
    bullet([new TextRun({ text: "Coding rules: ", bold: true }), new TextRun(".claude/rules/python-standards.md, .claude/rules/security-boundaries.md.")]),
    divider(),
    P([new TextRun({ text: "Document version: v1.0 \u00b7 2026-04-22 \u00b7 FactoryLM CONFIDENTIAL", color: MUTED })]),
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
        run: { size: 26, bold: true, color: NAVY, font: "Arial" },
        paragraph: { spacing: { before: 260, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, color: ACCENT, font: "Arial" },
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

const out = path.join(__dirname, "MIRA-Projects-PRD-v1.docx");
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log("Wrote", out);
});
