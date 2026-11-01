/**
 * Work Packet (#4982) — draft builder, pure (no I/O).
 *
 * `buildDraftPacket` assembles a `WorkPacket` from the manufacturer documents attached to a
 * notebook plus a technician's work-order text. It imports the two document parsers by name
 * (`./catpumps-datasheet`, `./catpumps-service-manual` — written in parallel by other agents);
 * this module never duplicates their parsing logic, and this module's own tests never depend on
 * their real implementation (they `vi.mock` both modules and hand-build `DataSheet`/
 * `ServiceManual` fixtures — see `./__tests__/draft.test.ts`).
 *
 * Zero model calls. Every value in the returned packet is either read verbatim from a cited
 * document line ("verified"), selected/derived by the logic below ("proposed"), or absent
 * ("unknown") — `./verify.ts` checks that invariant on the assembled packet before it is
 * returned, and this module downgrades (never drops silently) anything that check flags.
 */

import type {
  DataSheet,
  DocText,
  DraftInput,
  DraftRefusal,
  DraftResult,
  Field,
  Identity,
  ModelScope,
  PacketDocument,
  PacketMeasurement,
  PacketPart,
  PacketStep,
  ServiceManual,
  SourceRef,
  Topic,
  WorkPacket,
} from "./types";
import { documentRevision } from "./revision";
import { isSupportedManufacturer, manufacturerRefusalMessage } from "./manufacturer";
import { parseCatPumpsDataSheet, sheetModelFor } from "./catpumps-datasheet";
import { parseCatPumpsServiceManual } from "./catpumps-service-manual";
import { collectFields, verifyPacket } from "./verify";

const DISCLAIMER =
  "DRAFT prepared from the manufacturer documents attached to this notebook. It is not an " +
  "approved procedure and not a diagnosis. A qualified person must review every line before " +
  "work starts. Your site owns isolation and lockout.";

// ─────────────────────────────────────────────── selectTopics

export interface TopicMatch {
  topic: Topic;
  matched: string;
}

interface TopicPattern {
  re: RegExp;
  topics: Topic[];
}

// Order doesn't affect the result — every pattern is tried and all matches are collected — but
// the combination words (reseal/rebuild/overhaul) are listed first for readability since they
// expand to two topics at once.
const TOPIC_PATTERNS: readonly TopicPattern[] = [
  { re: /reseal/gi, topics: ["seals", "valves"] },
  { re: /rebuild/gi, topics: ["seals", "valves"] },
  { re: /overhaul/gi, topics: ["seals", "valves"] },
  { re: /v-packing/gi, topics: ["seals"] },
  { re: /lo-pressure/gi, topics: ["seals"] },
  { re: /hi-pressure/gi, topics: ["seals"] },
  { re: /packing/gi, topics: ["seals"] },
  { re: /seal/gi, topics: ["seals"] },
  { re: /valve/gi, topics: ["valves"] },
  { re: /plunger/gi, topics: ["plungers"] },
  { re: /oil seal/gi, topics: ["crankcase"] },
  { re: /crankcase/gi, topics: ["crankcase"] },
  { re: /bearing/gi, topics: ["crankcase"] },
  { re: /connecting rod/gi, topics: ["crankcase"] },
  { re: /crankshaft/gi, topics: ["crankcase"] },
  { re: /oil change/gi, topics: ["lubrication"] },
  { re: /lubricat/gi, topics: ["lubrication"] },
];

/** Every (topic, matched word) pair found in free text — a work order's title + description. */
export function selectTopics(text: string): TopicMatch[] {
  const out: TopicMatch[] = [];
  for (const { re, topics } of TOPIC_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      for (const topic of topics) out.push({ topic, matched: m[0] });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return out;
}

// ─────────────────────────────────────────────── model matching helpers

/** Case/space/dash-insensitive exact match — no prefix matching (mirrors `sheetModelFor`). */
function normalizeModel(s: string): string {
  return s.toUpperCase().replace(/[\s-]+/g, "");
}

function modelsMatch(a: string, b: string): boolean {
  return normalizeModel(a) === normalizeModel(b);
}

function modelScopeAdmits(scope: ModelScope, model: string): boolean {
  if (scope.unresolved) return false;
  if (!model) return scope.include.length === 0;
  if (scope.exclude.some((m) => modelsMatch(m, model))) return false;
  if (scope.include.length > 0) return scope.include.some((m) => modelsMatch(m, model));
  return true;
}

// ─────────────────────────────────────────────── verbatim-line search (for citations + modelFoundOn)

function normalizeLine(s: string): string {
  return s.trim().toUpperCase();
}

function pagesContaining(doc: DocText, needle: string): number[] {
  const n = normalizeLine(needle);
  if (!n) return [];
  const pages: number[] = [];
  for (const p of doc.pages) {
    if (p.text.split("\n").some((l) => normalizeLine(l).includes(n))) pages.push(p.page);
  }
  return pages;
}

function firstVerbatimSource(doc: DocText, needle: string): SourceRef | null {
  const n = normalizeLine(needle);
  if (!n) return null;
  for (const p of doc.pages) {
    for (const rawLine of p.text.split("\n")) {
      if (normalizeLine(rawLine).includes(n)) {
        return { docId: doc.docId, fileId: doc.fileId, filename: doc.filename, page: p.page, line: rawLine.trim() };
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────── parsing the attached documents

interface ParsedDoc {
  doc: DocText;
  dataSheet: DataSheet | null;
  manual: ServiceManual | null;
}

function parseAll(docs: readonly DocText[]): ParsedDoc[] {
  return docs.map((doc) => ({
    doc,
    dataSheet: parseCatPumpsDataSheet(doc),
    manual: parseCatPumpsServiceManual(doc),
  }));
}

function identityKeys(identity: Identity): string[] {
  const keys: string[] = [];
  if (identity.model) keys.push(identity.model);
  if (identity.catalogNumber) keys.push(identity.catalogNumber);
  return keys;
}

function toPacketDocument(p: ParsedDoc, modelKey: string | null): PacketDocument {
  const role: PacketDocument["role"] = p.dataSheet ? "datasheet" : p.manual ? "service_manual" : "other";
  return {
    docId: p.doc.docId,
    fileId: p.doc.fileId,
    filename: p.doc.filename,
    role,
    modelFoundOn: modelKey ? pagesContaining(p.doc, modelKey) : [],
    via: p.doc.via,
    revision: documentRevision(p.doc),
  };
}

// ─────────────────────────────────────────────── kit helpers

function findNbrStdKey(byMaterial: Record<string, string | null>): string | undefined {
  const keys = Object.keys(byMaterial);
  return keys.find((k) => /NBR/i.test(k) && /STD|standard/i.test(k)) ?? keys.find((k) => /NBR/i.test(k));
}

const TOPIC_TORQUE_RE: Record<Topic, RegExp | null> = {
  valves: /valve/i,
  seals: /manifold|retainer|head/i,
  plungers: /plunger/i,
  crankcase: /connecting rod|bearing|rear cover|oil gauge|crankcase/i,
  lubrication: null,
};

const TOOL_WORDS: readonly string[] = [
  "torque wrench",
  "snap ring pliers",
  "feeler gauge",
  "hex key",
  "allen key",
  "socket wrench",
  "screwdriver",
  "pliers",
  "puller",
  "wrench",
  "press",
  "vise",
  "mallet",
  "hammer",
  "gauge",
];

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function refuse(reason: DraftRefusal, message: string): DraftResult {
  return { ok: false, reason, message };
}

export function buildDraftPacket(input: DraftInput): DraftResult {
  const { identity, workOrder, docs, hazardFlags } = input;

  if (identity.status !== "user_confirmed" && identity.status !== "verified") {
    return refuse("identity_not_confirmed", "Confirm the equipment's identity (manufacturer and model) before drafting a job packet.");
  }
  if (!isSupportedManufacturer(identity.manufacturer)) {
    return refuse("manufacturer_not_supported", manufacturerRefusalMessage(identity.manufacturer));
  }
  if (docs.length === 0) {
    return refuse(
      "no_documents",
      "Attach this equipment's manufacturer documents — a data sheet and/or a service manual — to the notebook before drafting a job packet.",
    );
  }

  const parsed = parseAll(docs);
  const dataSheets = parsed.filter((p): p is ParsedDoc & { dataSheet: DataSheet } => p.dataSheet !== null);
  const manuals = parsed.filter((p): p is ParsedDoc & { manual: ServiceManual } => p.manual !== null);
  if (dataSheets.length === 0 && manuals.length === 0) {
    return refuse(
      "unsupported_documents",
      "None of the attached documents could be read as a CAT Pumps data sheet or service manual, so a job packet cannot be drafted from them.",
    );
  }

  const modelKey = identity.model ?? identity.catalogNumber ?? null;
  const applicableDataSheets = modelKey ? dataSheets.filter((p) => sheetModelFor(identity, p.dataSheet.models) !== null) : [];
  const applicableManuals = modelKey
    ? manuals.filter((p) => identityKeys(identity).some((k) => p.manual.modelsCovered.some((m) => modelsMatch(m, k))))
    : [];
  if (applicableDataSheets.length === 0 && applicableManuals.length === 0) {
    return refuse(
      "model_not_in_documents",
      `"${modelKey ?? "This equipment's model"}" does not appear in any attached data sheet or service manual, so a job packet cannot be drafted for it. Attach the correct document, or confirm the model.`,
    );
  }

  // The identifier the documents actually name (Codex #5062 F10): model and section/torque
  // restrictions are judged against it, never against a family name the documents don't list.
  const namedInDocs = (k: string) =>
    applicableManuals.some((p) => p.manual.modelsCovered.some((m) => modelsMatch(m, k))) ||
    applicableDataSheets.some((p) => p.dataSheet.models.some((m) => modelsMatch(m, k)));
  const matchedKeys = identityKeys(identity).filter(namedInDocs);
  if (matchedKeys.length > 1 && !modelsMatch(matchedKeys[0], matchedKeys[1])) {
    return refuse(
      "identity_not_confirmed",
      `The model "${matchedKeys[0]}" and catalog number "${matchedKeys[1]}" name different pumps in the attached documents. Confirm which one this pump is before drafting a job packet.`,
    );
  }
  const scopeKey = matchedKeys[0] ?? modelKey ?? "";

  const matches = selectTopics(`${workOrder.title} ${workOrder.description}`);
  const selectedTopics = Array.from(new Set(matches.map((m) => m.topic)));
  if (selectedTopics.length === 0) {
    return refuse(
      "no_task_matched",
      "The work order doesn't name a task this tool recognizes (seals, valves, plungers, crankcase, or lubrication). Describe the work more specifically.",
    );
  }

  // ---- documents ----
  const documents: PacketDocument[] = parsed.map((p) => toPacketDocument(p, modelKey));

  // ---- equipment ----
  const modelSource = modelKey ? parsed.map((p) => firstVerbatimSource(p.doc, modelKey)).find((s) => s !== null) ?? null : null;
  const manufacturerSource = identity.manufacturer
    ? parsed.map((p) => firstVerbatimSource(p.doc, identity.manufacturer as string)).find((s) => s !== null) ?? null
    : null;

  const manufacturer: Field = identity.manufacturer
    ? manufacturerSource
      ? { value: identity.manufacturer, label: "verified", source: manufacturerSource, basis: "manufacturer name appears verbatim in an attached document" }
      : { value: identity.manufacturer, label: "proposed", source: null, basis: "confirmed equipment identity" }
    : { value: null, label: "unknown", source: null, basis: "manufacturer not provided" };

  const model: Field = modelKey
    ? modelSource
      ? { value: modelKey, label: "verified", source: modelSource, basis: "model appears verbatim in an attached document" }
      : { value: modelKey, label: "proposed", source: null, basis: "confirmed equipment identity" }
    : { value: null, label: "unknown", source: null, basis: "model not provided" };

  const serial: Field = identity.serialNumber
    ? { value: identity.serialNumber, label: "proposed", source: null, basis: "from nameplate, unconfirmed" }
    : { value: null, label: "unknown", source: null, basis: "serial number not provided" };

  // ---- scope ----
  const scope: Field[] = selectedTopics.map((topic) => {
    const words = Array.from(new Set(matches.filter((m) => m.topic === topic).map((m) => m.matched)));
    return { value: topic, label: "proposed", source: null, basis: `work order mentions: ${words.join(", ")}` };
  });

  // ---- safety ----
  const cautions: Field[] = applicableManuals.flatMap((p) =>
    p.manual.cautions.map((c) => ({
      value: c.text,
      label: "verified" as const,
      source: c.source,
      basis: `${c.kind} — ${p.doc.filename ?? p.doc.docId}`,
    })),
  );
  const siteIsolation: Field = { value: null, label: "unknown", source: null, basis: "the site owns isolation and lockout" };

  // ---- parts & kits ----
  const parts: PacketPart[] = [];
  const unknowns: Field[] = [];
  const wantSeals = selectedTopics.includes("seals");
  const wantValves = selectedTopics.includes("valves");

  for (const p of applicableDataSheets) {
    const sheetModel = sheetModelFor(identity, p.dataSheet.models);
    for (const kit of p.dataSheet.kits) {
      if (kit.kind === "seal" && !wantSeals) continue;
      if (kit.kind === "valve" && !wantValves) continue;
      // A kit row names the pump models it fits; another model on the same sheet never gets it.
      const kitNumbers = kit.kitNumbers.filter((kn) => kn.models.length === 0 || (sheetModel !== null && kn.models.some((m) => modelsMatch(m, sheetModel))));
      if (kitNumbers.length === 0) {
        unknowns.push({
          value: null,
          label: "unknown",
          source: kit.kitNumbers[0]?.source ?? kit.perPumpSource,
          basis: `No ${kit.kind} kit for model ${sheetModel ?? modelKey} is listed on the data sheet (kits listed for: ${kit.kitNumbers.map((kn) => kn.models.join(", ")).join("; ") || "none"}).`,
        });
        continue;
      }

      const qty: Field =
        kit.perPump !== null && kit.perPumpSource
          ? { value: String(kit.perPump), label: "verified", source: kit.perPumpSource, basis: "stated per pump on the data sheet" }
          : { value: kit.perPump !== null ? String(kit.perPump) : null, label: "unknown", source: null, basis: "kit quantity per pump not stated on a single line" };

      for (const kn of kitNumbers) {
        const nbrKey = findNbrStdKey(kn.byMaterial);
        const nbrPart = nbrKey !== undefined ? kn.byMaterial[nbrKey] : null;
        const otherMaterials = Object.entries(kn.byMaterial)
          .filter(([k]) => k !== nbrKey)
          .map(([k, v]) => `${k} ${v ?? "—"}`)
          .join(", ");
        const partNumber: Field = nbrPart
          ? {
              value: nbrPart,
              label: "proposed",
              source: kn.source,
              basis: `Standard material (${nbrKey ?? "NBR (STD)"}); this pump's seal material is unknown. Other materials for this kit: ${otherMaterials || "none listed"}.`,
            }
          : { value: null, label: "unknown", source: kn.source, basis: `Standard-material kit number not listed for models ${kn.models.join(", ")}.` };
        parts.push({
          kit: kit.kind,
          item: null,
          partNumber,
          description: { value: `${kit.kind === "seal" ? "Seal" : "Valve"} kit (${kn.models.join(", ")})`, label: "proposed", source: kn.source, basis: "kit number row" },
          qty,
        });
      }

      for (const ki of kit.items) {
        const nbrKey = findNbrStdKey(ki.partsByMaterial);
        const nbrPart = nbrKey !== undefined ? ki.partsByMaterial[nbrKey] : null;
        let partNumber: Field;
        if (nbrPart) {
          partNumber = { value: nbrPart, label: "verified", source: ki.source, basis: "kit item list, NBR column" };
        } else {
          partNumber = { value: null, label: "unknown", source: ki.source, basis: "NBR part number not listed for this item on the sheet" };
          unknowns.push({
            value: null,
            label: "unknown",
            source: ki.source,
            basis: `Kit item ${ki.item ?? "?"} (${ki.description}) has no NBR part number on the sheet.`,
          });
        }
        parts.push({
          kit: kit.kind,
          item: ki.item,
          partNumber,
          description: { value: ki.description, label: "verified", source: ki.source, basis: "kit item list" },
          qty: { value: ki.qtyRaw, label: "verified", source: ki.source, basis: "kit item list" },
        });
      }
    }
  }

  // ---- steps ----
  const steps: PacketStep[] = [];
  for (const p of applicableManuals) {
    for (const section of p.manual.sections) {
      if (section.topic === "other") continue;
      if (!selectedTopics.includes(section.topic)) continue;
      if (section.models.unresolved && section.steps.length > 0) {
        unknowns.push({
          value: null,
          label: "unknown",
          source: section.steps[0].source,
          basis: `${section.heading} — ${section.subheading ?? "section"}: the manual limits these steps to some models or hardware variants and this tool cannot tell whether this pump is one. Steps left out; use the manual directly for this part.`,
        });
        continue;
      }
      if (!modelScopeAdmits(section.models, scopeKey)) continue;
      for (const step of section.steps) {
        steps.push({
          section: section.heading,
          topic: section.topic,
          text: {
            value: step.text,
            label: "verified",
            source: step.source,
            basis: section.subheading ? `${section.heading} — ${section.subheading}` : section.heading,
          },
        });
      }
    }
  }

  // Sections the parser detected but had to leave out (Codex #5062 F12): the packet says which
  // work is missing instead of quietly showing only the part that survived extraction.
  for (const p of applicableManuals) {
    for (const o of p.manual.omitted ?? []) {
      if (o.topic === "other" || !selectedTopics.includes(o.topic)) continue;
      if (!o.models.unresolved && !modelScopeAdmits(o.models, scopeKey)) continue;
      unknowns.push({
        value: null,
        label: "unknown",
        source: o.source,
        basis: `${o.heading} — ${o.subheading ?? "section"} (p.${o.page}): these steps could not be read reliably from the manual (${o.reason}). Steps left out; use the manual directly for this part.`,
      });
    }
  }

  // ---- measurements + lubrication ----
  const measurements: PacketMeasurement[] = [];
  const torqueTools = new Map<string, Field>();

  // Torque rows from every applicable manual are resolved together (Codex #5062 F8): a
  // model-specific row ("Model 8560 Only") replaces the general row for that model, and two
  // different values left for one item — in one manual or across manuals — are never shown.
  const torqueKey = (item: string) => item.toUpperCase().replace(/\s+/g, " ").trim();
  const admitted = applicableManuals.flatMap((p) => p.manual.torque.filter((row) => modelScopeAdmits(row.models, scopeKey)));
  const overridden = new Set(admitted.filter((r) => r.models.include.length > 0).map((r) => torqueKey(r.item)));
  const effective = admitted.filter((r) => r.models.include.length > 0 || !overridden.has(torqueKey(r.item)));
  const valuesByItem = new Map<string, Set<string>>();
  for (const r of effective) {
    const k = torqueKey(r.item);
    if (!valuesByItem.has(k)) valuesByItem.set(k, new Set());
    valuesByItem.get(k)!.add(`${r.inLbs}|${r.ftLbs}|${r.nm}`);
  }
  const reportedConflict = new Set<string>();
  const emittedItem = new Set<string>();
  {
    for (const row of effective) {
      const conflictKey = torqueKey(row.item);
      if ((valuesByItem.get(conflictKey)?.size ?? 0) > 1) {
        if (!reportedConflict.has(conflictKey)) {
          reportedConflict.add(conflictKey);
          unknowns.push({
            value: null,
            label: "unknown",
            source: row.source,
            basis: `Torque chart gives more than one value for '${row.item}' that could apply to this pump — not used as a measurement.`,
          });
        }
        continue;
      }
      const relevant = selectedTopics.some((t) => {
        const re = TOPIC_TORQUE_RE[t];
        return re ? re.test(row.item) : false;
      });
      if (!relevant) continue;
      if (!row.consistent) {
        unknowns.push({
          value: null,
          label: "unknown",
          source: row.source,
          basis: `Torque row '${row.item}' is inconsistent between in-lbs/ft-lbs/Nm — not used as a measurement.`,
        });
        continue;
      }
      if (emittedItem.has(torqueKey(row.item))) continue; // same value from a second manual
      emittedItem.add(torqueKey(row.item));
      const valueParts = [row.inLbs ? `${row.inLbs} in-lbs` : null, row.ftLbs ? `${row.ftLbs} ft-lbs` : null, row.nm ? `${row.nm} Nm` : null].filter(
        (v): v is string => v !== null,
      );
      measurements.push({
        name: { value: row.item, label: "verified", source: row.source, basis: "torque chart" },
        value: { value: valueParts.join(" / "), label: "verified", source: row.source, basis: "torque chart" },
        tool: row.tool
          ? { value: row.tool, label: "verified", source: row.source, basis: "torque chart tool column" }
          : { value: null, label: "unknown", source: null, basis: "tool not listed on this torque row" },
      });
      if (row.tool && !torqueTools.has(row.tool)) {
        torqueTools.set(row.tool, { value: row.tool, label: "verified", source: row.source, basis: "torque chart tool column" });
      }
    }
  }

  if (selectedTopics.includes("lubrication")) {
    for (const p of applicableDataSheets) {
      const spec = p.dataSheet.specs.find((s) => s.key === "crankcase_capacity");
      if (spec) {
        measurements.push({
          name: { value: spec.label, label: "verified", source: spec.source, basis: "data sheet spec" },
          value: { value: spec.value, label: "verified", source: spec.source, basis: "data sheet spec" },
          tool: { value: null, label: "unknown", source: null, basis: "not a torque item" },
        });
      }
    }
  }

  // ---- tools ----
  const tools: Field[] = Array.from(torqueTools.values());
  const seenTools = new Set(tools.map((t) => (t.value ?? "").toLowerCase()));
  for (const step of steps) {
    const lower = (step.text.value ?? "").toLowerCase();
    for (const word of TOOL_WORDS) {
      if (lower.includes(word) && !seenTools.has(word)) {
        seenTools.add(word);
        tools.push({
          value: titleCase(word),
          label: "proposed",
          source: step.text.source,
          basis: `found in step text (p.${step.text.source?.page ?? "?"})`,
        });
      }
    }
  }
  if (measurements.length > 0 && !seenTools.has("torque wrench")) {
    tools.push({ value: "Torque wrench", label: "proposed", source: null, basis: "torque values specified" });
  }

  // ---- unknowns (always-present entries) ----
  unknowns.push(
    identity.serialNumber
      ? { value: identity.serialNumber, label: "proposed", source: null, basis: "serial — from nameplate, unconfirmed" }
      : { value: null, label: "unknown", source: null, basis: "serial — not in the attached documents" },
    { value: null, label: "unknown", source: null, basis: "this pump's seal material is unknown — confirm against the nameplate suffix" },
    { value: null, label: "unknown", source: null, basis: "site isolation / lockout — the site owns isolation and lockout" },
    { value: null, label: "unknown", source: null, basis: "functional-test acceptance limits are not specified in the attached documents" },
    { value: null, label: "unknown", source: null, basis: "technician qualification is not specified in the attached documents" },
  );
  // A half-documented machine must say so: without its service manual there are no steps, tools,
  // torque values or manual cautions; without its data sheet there are no parts or kits.
  if (applicableManuals.length === 0) {
    unknowns.push({ value: null, label: "unknown", source: null, basis: "no service manual for this model is attached — disassembly steps, tools, torque values and the manual's cautions are unknown" });
  }
  if (applicableDataSheets.length === 0) {
    unknowns.push({ value: null, label: "unknown", source: null, basis: "no data sheet for this model is attached — part numbers and kits are unknown" });
  }

  const packet: WorkPacket = {
    version: 1,
    packetId: input.packetId,
    generatedAt: input.now,
    notebookId: input.notebookId,
    disclaimer: DISCLAIMER,
    equipment: { manufacturer, model, serial, identityStatus: identity.status },
    workOrder,
    documents,
    scope,
    safety: { cautions, siteIsolation, hazardFlags },
    parts,
    tools,
    steps,
    measurements,
    unknowns,
    approval: {
      technicianReview: { state: "draft", entries: [] },
      supervisor: { state: "pending", by: null, at: null },
    },
  };

  const warnings: string[] = [];
  const problems = verifyPacket(packet);
  if (problems.length > 0) {
    const fieldsByPath = new Map(collectFields(packet).map((f) => [f.path, f.field]));
    const handled = new Set<string>();
    for (const problem of problems) {
      const sep = problem.indexOf(":");
      const path = sep === -1 ? problem : problem.slice(0, sep);
      if (handled.has(path)) continue;
      handled.add(path);
      const field = fieldsByPath.get(path);
      if (field) {
        const note = sep === -1 ? problem : problem.slice(sep + 2);
        field.value = null;
        field.label = "unknown";
        field.basis = `${field.basis} — downgraded: ${note}`;
      }
      warnings.push(problem);
    }
  }

  return { ok: true, packet, warnings };
}
