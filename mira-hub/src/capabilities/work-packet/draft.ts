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
  JhaRow,
  PacketDocument,
  PacketFigure,
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
import { captionApplicability, modelScopeAdmits, modelsMatch } from "./applicability";
import { buildProcedure } from "./procedure";

/** A caution about starting the pump back up (e.g. "Do not lubricate wicks at initial start-up …"). */
const STARTUP_RE = /\bstart-?\s?up\b/i;
/** A caution that says what to do once service is done ("After servicing is completed, …"). */
const AFTER_SERVICE_RE = /\bafter servic(?:e|ing)\b/i;

const WORD_STOP = new Set(["the", "and", "of", "a", "an", "to", "from", "with", "in", "on", "for", "or", "by", "at", "per", "each", "all", "model", "models", "only", "into", "over", "back", "this", "that"]);
/** Caption words that say what kind of picture it is, not what it shows. */
const FIGURE_STOP = new Set(["removal", "arrangement", "assembly", "layout", "design", "view", "installation"]);
/** Lower-case content words, plural "s" folded ("Screws" → "screw"), for matching items/captions to steps. */
function significantWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter((w) => w.length > 1 && !WORD_STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

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
// the combination words are listed first for readability. A reseal is seal work only (V2: V1 also
// pulled in valve work and a valve kit); rebuild/overhaul still mean seals and valves.
const TOPIC_PATTERNS: readonly TopicPattern[] = [
  { re: /reseal/gi, topics: ["seals"] },
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
  // What a clause rules out ("no valve service", "without removing the valves") adds nothing
  // (Codex EGM F40): each clause is cut at its first negation word, keeping the work asked for
  // before it. Clauses split at sentence ends, semicolons, commas and "but".
  text = text
    .split(/[.;,!?]|\bbut\b/i)
    .map((c) => c.split(/\b(?:no|not|don't|never|without|except|excluding)\b/i)[0])
    .join(" . ");
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

// Model matching helpers (`modelsMatch`, `modelScopeAdmits`) live in ./applicability.ts.

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

function cite(ref: SourceRef): string {
  return `${ref.filename ?? "document"} p.${ref.page}`;
}

/** One data-sheet item (oil capacity, a rating) for the confirmed pump, across every applicable
 *  sheet (Codex #5062 F19/F20). A value printed under a block that names other models is not used.
 *  Verified only when every remaining printing agrees; otherwise a cited unknown, never a pick. */
function resolveSpec(sheets: readonly ParsedDoc[], key: string, basis: string, models: readonly string[]): { label: string; field: Field } | null {
  const all = sheets.flatMap((p) => p.dataSheet?.specs.filter((sp) => sp.key === key) ?? []);
  if (all.length === 0) return null;
  const label = all[0].label;
  // A value the sheet prints under model blocks but that cannot be tied to one may belong to this
  // model and contradict its own block, so it makes the rating Unknown for every model (Codex #5062 F19).
  const loose = all.find((sp) => sp.scopeUnresolved);
  if (loose) {
    return { label, field: { value: null, label: "unknown", source: loose.source, basis: `the data sheet prints ${label} ${loose.value} (${cite(loose.source)}) where it cannot be tied to a model — check the value for this model` } };
  }
  const specs = all.filter((sp) => !sp.models || sp.models.some((m) => models.some((k) => modelsMatch(m, k))));
  if (specs.length === 0) {
    const named = Array.from(new Set(all.flatMap((sp) => sp.models ?? []))).join(", ");
    return { label, field: { value: null, label: "unknown", source: all[0].source, basis: `the data sheet gives ${label} only for other models (${named}) — check the value for this model` } };
  }
  const first = specs[0];
  const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
  const other = specs.find((sp) => norm(sp.value) !== norm(first.value));
  if (other) {
    return { label, field: { value: null, label: "unknown", source: first.source, basis: `the attached data sheets print more than one ${label} for this model: ${first.value} (${cite(first.source)}) vs ${other.value} (${cite(other.source)}) — check the value` } };
  }
  return { label, field: { value: first.value, label: "verified", source: first.source, basis } };
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
  // ---- procedure (V2): removal → requested work → reinstall, notes beside their steps ----
  const procedure = buildProcedure(applicableManuals, selectedTopics, scopeKey);
  const unknowns: Field[] = [...procedure.unknowns];
  const leftOut: Field[] = [...procedure.leftOut];
  const blockers: Field[] = [...procedure.blockers];

  // Safety holds the manufacturer's cautions/warnings once each. A NOTE printed inside a procedure
  // is shown beside its step instead (or left out with its other-model block), not repeated here.
  const seenCaution = new Set<string>();
  const cautions: Field[] = applicableManuals.flatMap((p) =>
    p.manual.cautions
      .filter((c) => !procedure.placed.has(c) && !(c.kind === "NOTE" && c.context))
      .filter((c) => {
        if (seenCaution.has(c.text)) return false;
        seenCaution.add(c.text);
        return true;
      })
      .map((c) => ({
        value: c.text,
        label: "verified" as const,
        source: c.source,
        basis: `${c.kind} — ${p.doc.filename ?? p.doc.docId}`,
      })),
  );
  // A caution the parser could not read in full is listed in Safety as unknown, never dropped.
  // An unreadable NOTE is listed here but is not a hazard row in the JHA (a NOTE is not a hazard).
  const unreadNotes = new Set<number>();
  for (const p of applicableManuals) {
    for (const c of p.manual.omittedCautions ?? []) {
      if (c.kind === "NOTE") unreadNotes.add(cautions.length);
      cautions.push({
        value: null,
        label: "unknown",
        source: c.source,
        basis: `${c.kind} on p.${c.source.page} of ${p.doc.filename ?? p.doc.docId} ${c.reason}. Read it in the manual before work starts.`,
      });
    }
  }
  const siteIsolation: Field = { value: null, label: "unknown", source: null, basis: "the site owns isolation and lockout" };

  // ---- parts & kits ----
  const parts: PacketPart[] = [];
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

  // ---- steps ---- (built above by ./procedure.ts)
  const steps: PacketStep[] = procedure.steps;

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
  // V2: a torque row is shown when a step in this packet tightens it — the step says "torque" and it
  // (or the step just before it, in the same block) names every word of the item. The link is a
  // proposal. Only when no step mentions torque at all does the V1 topic rule decide.
  const anyTorqueStep = steps.some((st) => /\btorque\b/i.test(st.text.value ?? ""));
  const linkedSteps = (item: string): number[] => {
    const want = significantWords(item);
    if (want.length === 0) return [];
    const out: number[] = [];
    steps.forEach((st, i) => {
      if (!/\btorque\b/i.test(st.text.value ?? "")) return;
      const prev = steps[i - 1];
      const sameBlock = prev && prev.section === st.section && prev.subheading === st.subheading;
      const have = new Set([...significantWords(st.text.value ?? ""), ...(sameBlock ? significantWords(prev.text.value ?? "") : [])]);
      if (want.every((w) => have.has(w))) out.push(i);
    });
    return out;
  };
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
      const linked = anyTorqueStep ? linkedSteps(row.item) : [];
      const relevant = anyTorqueStep
        ? linked.length > 0
        : selectedTopics.some((t) => {
            const re = TOPIC_TORQUE_RE[t];
            return re ? re.test(row.item) : false;
          });
      if (!relevant) {
        if (anyTorqueStep && !emittedItem.has(torqueKey(row.item)) && !leftOut.some((f) => f.value === row.item)) {
          leftOut.push({ value: row.item, label: "proposed", source: row.source, basis: "torque chart row that no step in this packet tightens" });
        }
        continue;
      }
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
      const m: PacketMeasurement = {
        name: { value: row.item, label: "verified", source: row.source, basis: "torque chart" },
        value: { value: valueParts.join(" / "), label: "verified", source: row.source, basis: "torque chart" },
        tool: row.tool
          ? { value: row.tool, label: "verified", source: row.source, basis: "torque chart tool column" }
          : { value: null, label: "unknown", source: null, basis: "tool not listed on this torque row" },
      };
      if (linked.length > 0) {
        m.steps = linked;
        m.link = {
          value: `used at ${linked.map((i) => `step ${i + 1}`).join(", ")} of this packet`,
          label: "proposed",
          source: steps[linked[0]].text.source,
          basis: `the step says to torque and names the ${row.item}`,
        };
      }
      measurements.push(m);
      if (row.tool && !torqueTools.has(row.tool)) {
        torqueTools.set(row.tool, { value: row.tool, label: "verified", source: row.source, basis: "torque chart tool column" });
      }
    }
  }

  if (selectedTopics.includes("lubrication")) {
    const capacity = resolveSpec(applicableDataSheets, "crankcase_capacity", "data sheet spec", identityKeys(identity));
    if (capacity) {
      measurements.push({
        name: { value: capacity.label, label: "verified", source: capacity.field.source, basis: "data sheet spec" },
        value: capacity.field,
        tool: { value: null, label: "unknown", source: null, basis: "not a torque item" },
      });
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

  // ---- figures: the manufacturer's photos on the pages the packet's steps are printed on ----
  // Only a kept original PDF has them (document-text.ts). V2: a photo whose caption lists other
  // models (or a model the cover does not list) is left out; a kept photo sits with the step on its
  // page that shares the most caption words (a proposal), otherwise with that page's first section.
  const figures: PacketFigure[] = [];
  const figurePages = new Set<string>();
  for (const step of steps) {
    const src = step.text.source;
    if (!src) continue;
    const key = `${src.docId}#${src.page}`;
    if (figurePages.has(key)) continue;
    figurePages.add(key);
    const owner = applicableManuals.find((p) => p.doc.docId === src.docId);
    const page = owner?.doc.pages.find((pg) => pg.page === src.page);
    for (const f of page?.figures ?? []) {
      const captionText = f.caption.filter((c) => c.trim().length > 0).join(" | ");
      const a = captionApplicability(f.caption, scopeKey, owner?.manual.modelsCovered ?? []);
      if (a.kind === "other_models" || a.kind === "unresolved") {
        leftOut.push({
          value: captionText || "(photo without caption)",
          label: "proposed",
          source: { docId: src.docId, fileId: src.fileId, filename: src.filename, page: src.page, line: f.caption.join(" ") },
          basis: a.kind === "other_models" ? `figure on p.${src.page} for other models (${a.reason})` : `figure on p.${src.page}: ${a.reason} — left out rather than guessed`,
        });
        continue;
      }
      const want = new Set(f.caption.flatMap((c) => significantWords(c)).filter((w) => !FIGURE_STOP.has(w)));
      let best = -1;
      let bestShared: string[] = [];
      steps.forEach((st, i) => {
        if (st.text.source?.docId !== src.docId || st.text.source?.page !== src.page) return;
        const shared = Array.from(new Set(significantWords(st.text.value ?? ""))).filter((w) => want.has(w));
        if (shared.length >= 2 && shared.length > bestShared.length) {
          best = i;
          bestShared = shared;
        }
      });
      const fig: PacketFigure = { section: best >= 0 ? steps[best].section : step.section, docId: src.docId, filename: src.filename, page: src.page, image: f.image, caption: f.caption, step: best >= 0 ? best : null };
      if (best >= 0) fig.placement = { value: `shown with step ${best + 1}`, label: "proposed", source: steps[best].text.source, basis: `caption and step share: ${bestShared.join(", ")}` };
      figures.push(fig);
    }
  }

  // ---- job hazard analysis ----
  // One row per manufacturer caution (verbatim, cited) and per work-order hazard flag. The controls —
  // PPE, isolation, permits — are the site's decision: always unknown, never generated.
  const siteControls = (): Field => ({ value: null, label: "unknown", source: null, basis: "controls, PPE and isolation — the site defines them" });
  const jha: JhaRow[] = [
    ...cautions.flatMap((c, i) => (unreadNotes.has(i) ? [] : [{
      task: { value: c.source ? `Manual p.${c.source.page}` : "Manual", label: "proposed" as const, source: c.source, basis: "where the manual prints this caution" },
      hazard: { ...c, copyOf: `safety.cautions[${i}]` },
      controls: siteControls(),
    }])),
    ...hazardFlags.map((flag) => ({
      task: { value: workOrder.title || workOrder.id, label: "proposed" as const, source: null, basis: "the work order" },
      hazard: { value: flag, label: "proposed" as const, source: null, basis: "raised by the Hub's safety classifier on the work-order text" },
      controls: siteControls(),
    })),
  ];

  const qualifications: Field[] = [
    { value: null, label: "unknown", source: null, basis: "technician qualification is not specified in the attached documents — the site defines who may do this job" },
  ];

  // ---- restoration / return to service ----
  // The manual's start-up check-list (cited by its heading), its start-up cautions, and the data
  // sheet's oil capacity and ratings — all verbatim. Pass/fail limits are not in the documents.
  const restoration: Field[] = [];
  for (const p of applicableManuals) {
    for (const ref of p.manual.startupChecklist ?? []) {
      restoration.push({ value: ref.line, label: "verified", source: ref, basis: `review every item of this check-list in the manual (p.${ref.page}) before start-up` });
    }
  }
  cautions.forEach((c, i) => {
    if (c.label !== "verified") return;
    if (STARTUP_RE.test(c.value ?? "")) restoration.push({ ...c, basis: `${c.basis} — start-up`, copyOf: `safety.cautions[${i}]` });
    else if (AFTER_SERVICE_RE.test(c.value ?? "")) restoration.push({ ...c, basis: `${c.basis} — after service`, copyOf: `safety.cautions[${i}]` });
  });
  steps.forEach((st, i) =>
    (st.notes ?? []).forEach((n, j) => {
      if (n.text.label === "verified" && STARTUP_RE.test(n.text.value ?? "")) restoration.push({ ...n.text, basis: `${n.text.basis} — start-up`, copyOf: `steps[${i}].notes[${j}].text` });
    }),
  );
  for (const key of ["crankcase_capacity", "pressure", "flow", "rpm"]) {
    const basis = key === "crankcase_capacity" ? "data sheet: fill the crankcase to this capacity before start-up" : "data sheet rating — do not exceed during the run test";
    const spec = resolveSpec(applicableDataSheets, key, basis, identityKeys(identity));
    if (!spec) continue;
    restoration.push(spec.field.label === "verified" ? { ...spec.field, value: `${spec.label} ${spec.field.value}` } : spec.field);
  }
  restoration.push({ value: null, label: "unknown", source: null, basis: "functional-test acceptance limits are not specified in the attached documents" });

  // ---- unknowns (always-present entries) ----
  unknowns.push(
    identity.serialNumber
      ? { value: identity.serialNumber, label: "proposed", source: null, basis: "serial — from nameplate, unconfirmed" }
      : { value: null, label: "unknown", source: null, basis: "serial — not in the attached documents" },
    { value: null, label: "unknown", source: null, basis: "this pump's seal material is unknown — confirm against the nameplate suffix" },
    { value: null, label: "unknown", source: null, basis: "site isolation / lockout — the site owns isolation and lockout" },
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
    version: 2,
    packetId: input.packetId,
    generatedAt: input.now,
    notebookId: input.notebookId,
    disclaimer: DISCLAIMER,
    equipment: { manufacturer, model, serial, identityStatus: identity.status },
    identitySnapshot: { manufacturer: identity.manufacturer, model: identity.model, catalogNumber: identity.catalogNumber },
    workOrder,
    documents,
    scope,
    safety: { cautions, siteIsolation, hazardFlags },
    parts,
    tools,
    steps,
    figures,
    measurements,
    jha,
    qualifications,
    restoration,
    unknowns,
    blockers,
    leftOut,
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
