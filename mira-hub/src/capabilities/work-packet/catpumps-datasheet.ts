/**
 * Work Packet (#4982) — CAT Pumps **data sheet** parser (parts list, kits, specs), pure (no I/O).
 *
 * Port of `tools/parts-breakdown/catpumps_breakdown.py`'s parts-list/kit-table extraction to this
 * capability's `DataSheet` shape (`./types.ts`), extended to cover BOTH CAT Pumps data-sheet
 * layouts actually shipped:
 *
 *   - **5CP-style** ("ITEM PART NUMBERS DESCRIPTION QTY", models listed one-per-line in the
 *     header, comma-terminated, then a bare "MATL" line) — the layout the Python module targets.
 *   - **3520-style** ("ITEM P/N MATL DESCRIPTION QTY", a single compact model token like
 *     "3520/C" meaning "3520" and "3520C") — the 35-frame sheets. Differences handled here that
 *     the Python module does not need to: a "†" production-parts-differ marker (5CP uses "="),
 *     model-restricted parts via a trailing "(Model 3520C)" parenthetical (5CP uses a trailing
 *     " – 5CP6120" dash list), and "*"/"u" footnote markers glued onto kit numbers
 *     ("76841*") rather than living on their own token.
 *
 * Nothing is invented. Every row carries the exact source page + line it was read from; a value
 * this module cannot resolve safely is reported in `problems`, never guessed. No model call.
 */

import type { DataSheet, DocText, DsKit, DsKitItem, DsKitNumbers, DsPart, DsSpec, SourceRef } from "./types";

// ─────────────────────────────────────────────── shared line model

interface Line {
  page: number;
  text: string;
}

function flattenLines(doc: DocText): Line[] {
  const out: Line[] = [];
  for (const p of [...doc.pages].sort((a, b) => a.page - b.page)) {
    for (const raw of p.text.split("\n")) {
      const text = raw.trim();
      if (text) out.push({ page: p.page, text });
    }
  }
  return out;
}

type MkSource = (page: number, line: string) => SourceRef;

// ─────────────────────────────────────────────── model tokens

/** "3520/C" -> ["3520", "3520C"]; "5CP6120" -> ["5CP6120"]; "3520/C/D" -> ["3520","3520C","3520D"]. */
function expandModelToken(raw: string): string[] {
  const tok = raw.trim().replace(/,+$/, "");
  if (!tok) return [];
  if (!tok.includes("/")) return [tok];
  const segments = tok
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return [];
  const base = segments[0];
  return [base, ...segments.slice(1).map((suffix) => base + suffix)];
}

function normalizeModelKey(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, "");
}

/**
 * Exact match only (after normalizing case/spaces/dashes) — never a prefix match, so
 * "3520" / "3520C" / "3521" are distinct, and "5CP6120CSSG1" matches only when the sheet
 * actually lists it. Tries `model` first, then `catalogNumber`.
 */
export function sheetModelFor(identity: { model?: string | null; catalogNumber?: string | null }, models: string[]): string | null {
  const byKey = new Map<string, string>();
  for (const m of models) byKey.set(normalizeModelKey(m), m);
  for (const candidate of [identity.model, identity.catalogNumber]) {
    if (!candidate) continue;
    const hit = byKey.get(normalizeModelKey(candidate));
    if (hit) return hit;
  }
  return null;
}

// ─────────────────────────────────────────────── parts list (PARTS / OPTIONAL / SERVICE)

// Item number (optional — a missing item cell continues the previous row's item); an optional
// production-parts-differ marker ("=" on 5CP sheets, "†" on 35-frame sheets); the part number
// (digits, occasionally with a trailing letter suffix on a continuation row, e.g. "49464C");
// the material code (letters, or a dash when blank); an optional RoHS "R" marker; the
// description; and the quantity (a single integer, or a dash-joined per-model run like "8–4").
// Numbered groups (not named): 1=item 2=part 3=matl 4=desc 5=qty. Named capture groups require
// an ES2018+ compile target; this repo targets ES2017 (tsconfig.json), so plain groups + index
// access are used throughout this file instead.
const PART_ROW =
  /^(?:(\d{1,3})\s+)?(?:[=†]\s*)?(\d{4,6}[A-Z]{0,2})\s+([A-Z]{1,5}|[—-])\s*(?:R\b)?\s*(.+?)\s+(\d+(?:[–—-]\d+)*)$/;

// Numbered groups: 1=part 2=desc 3=qty.
const SIMPLE_ROW = /^(\d{4,6})\s+(.+?)\s+(\d+)$/;

function parseQty(raw: string, models: string[]): { qtyByModel: Record<string, number> | null; qtyStatus: DsPart["qtyStatus"] } {
  const parts = raw.split(/[–—-]/);
  const values = parts.map((v) => Number.parseInt(v, 10));
  if (values.some((v) => Number.isNaN(v))) return { qtyByModel: null, qtyStatus: "ambiguous" };
  if (values.length === 1) {
    return { qtyByModel: Object.fromEntries(models.map((m) => [m, values[0]])), qtyStatus: "single" };
  }
  if (values.length === models.length && models.length > 0) {
    return { qtyByModel: Object.fromEntries(models.map((m, i) => [m, values[i]])), qtyStatus: "per_model" };
  }
  return { qtyByModel: null, qtyStatus: "ambiguous" };
}

/**
 * F6 port (#4993, mirrored from the Python fix): a row whose description ends in a model
 * restriction — " – 5CP6120" (5CP-style dash list) or "(Model 3520C)" (3520-style parenthetical)
 * — applies ONLY to the named model(s), not every model on the sheet, whether the row's quantity
 * was one shared value or one value per model. A restriction is honored only when every named
 * token is an EXACT, already-known sheet model — never guessed from free text.
 */
function extractAppliesTo(rawDesc: string, models: string[]): { desc: string; appliesTo: string[] } {
  const dash = /^(.*?)\s+[–—-]\s*([A-Za-z0-9 ,]+)$/.exec(rawDesc);
  if (dash) {
    const candidates = dash[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (candidates.length > 0 && candidates.every((c) => models.includes(c))) {
      return { desc: dash[1].trim(), appliesTo: candidates };
    }
  }
  const paren = /^(.*)\(Model\s+([^)]+)\)\s*$/i.exec(rawDesc);
  if (paren) {
    const expanded = expandModelToken(paren[2].trim()).filter((t) => models.includes(t));
    if (expanded.length > 0) {
      return { desc: rawDesc, appliesTo: expanded };
    }
  }
  return { desc: rawDesc, appliesTo: [...models] };
}

function parsePartsList(lines: Line[], mkSource: MkSource): { models: string[]; parts: DsPart[] } {
  const headerIdx = lines.findIndex((l) => l.text.startsWith("ITEM PART NUMBERS") || l.text.startsWith("ITEM P/N"));
  if (headerIdx === -1) return { models: [], parts: [] };
  const headerPage = lines[headerIdx].page;

  const models: string[] = [];
  let i = headerIdx + 1;
  while (i < lines.length && lines[i].page === headerPage && !PART_ROW.test(lines[i].text)) {
    const text = lines[i].text;
    if (text !== "MATL") {
      for (const tok of text.split(/[\s,]+/).filter(Boolean)) {
        for (const m of expandModelToken(tok)) {
          if (!models.includes(m)) models.push(m);
        }
      }
    }
    i++;
  }

  const parts: DsPart[] = [];
  let lastItem: number | null = null;
  for (; i < lines.length && lines[i].page === headerPage; i++) {
    const { text } = lines[i];
    const m = PART_ROW.exec(text);
    if (!m) continue;
    const [, itemRaw, partRaw, matlRaw, descRaw, qtyRaw] = m;
    const item: number | null = itemRaw ? Number.parseInt(itemRaw, 10) : lastItem;
    lastItem = item;
    const matl = matlRaw === "—" || matlRaw === "-" ? null : matlRaw;
    const { desc, appliesTo } = extractAppliesTo(descRaw.trim(), models);
    const { qtyByModel, qtyStatus } = parseQty(qtyRaw, models);
    const filteredQtyByModel = qtyByModel ? Object.fromEntries(Object.entries(qtyByModel).filter(([k]) => appliesTo.includes(k))) : null;
    parts.push({
      item,
      partNumber: partRaw,
      material: matl,
      description: desc,
      qtyRaw,
      qtyByModel: filteredQtyByModel,
      qtyStatus,
      appliesTo,
      section: "parts",
      source: mkSource(lines[i].page, text),
    });
  }
  return { models, parts };
}

function parseSimpleSection(lines: Line[], heading: string, section: "optional" | "service", models: string[], mkSource: MkSource): DsPart[] {
  const idx = lines.findIndex((l) => l.text.startsWith(heading));
  if (idx === -1) return [];
  const page = lines[idx].page;
  const out: DsPart[] = [];
  let pending: Line[] = [];

  const finalizePending = (lastLine: Line) => {
    if (pending.length === 0) return;
    const joined = pending.map((l) => l.text).join(" ");
    const pm = /^(\d{4,6})\s+(.+)$/.exec(joined);
    if (pm) {
      const qty = Number.parseInt(lastLine.text, 10);
      out.push({
        item: null,
        partNumber: pm[1],
        material: null,
        description: pm[2].trim(),
        qtyRaw: lastLine.text,
        qtyByModel: Number.isNaN(qty) ? null : Object.fromEntries(models.map((m) => [m, qty])),
        qtyStatus: "single",
        appliesTo: [...models],
        section,
        source: mkSource(pending[0].page, pending[0].text),
      });
    }
    pending = [];
  };

  for (let i = idx + 1; i < lines.length && lines[i].page === page; i++) {
    const line = lines[i];
    const text = line.text;
    if (text.startsWith("PART DESCRIPTION")) continue;
    if (/^[A-Z][A-Z ]{6,}$/.test(text) && !text.startsWith("PART")) break; // next heading on the same page
    const sm = SIMPLE_ROW.exec(text);
    if (sm) {
      const [, smPart, smDesc, smQty] = sm;
      const qty = Number.parseInt(smQty, 10);
      out.push({
        item: null,
        partNumber: smPart,
        material: null,
        description: smDesc.trim(),
        qtyRaw: smQty,
        qtyByModel: Object.fromEntries(models.map((m) => [m, qty])),
        qtyStatus: "single",
        appliesTo: [...models],
        section,
        source: mkSource(line.page, text),
      });
      pending = [];
      continue;
    }
    if (/^\d{4,6}\s/.test(text)) {
      pending = [line];
      continue;
    }
    if (pending.length > 0 && /^\d+$/.test(text)) {
      finalizePending(line);
      continue;
    }
    if (pending.length > 0) pending.push(line);
  }
  return out;
}

// ─────────────────────────────────────────────── kits (SEAL KITS / VALVE KITS)

const KIT_HEADER = /^(SEAL|VALVE) KITS\s+(?:One|Two|Three|Four|Five|\w+)\s*\((\d+)\)/;
const MATERIAL_TOKEN = /[A-Z]+ \((?:STD|\.\d{4})\)/g;

/** A footnote line ("* Review material codes…", "u Silicone oil/grease required…"). */
function isFootnoteLine(text: string): boolean {
  return /^\*/.test(text) || /^u\s/i.test(text) || /^◆/.test(text);
}

/** "76841*" -> "76841" (a kit-number value with a footnote marker glued on); "*" alone, or a
 *  lone "u", is a pure footnote marker and carries no value. */
function normalizeKitValueToken(raw: string): string | null {
  const stripped = raw.replace(/^\*+/, "").replace(/\*+$/, "");
  if (stripped === "") return null;
  if (/^u$/i.test(stripped)) return null;
  if (/^\d{4,6}$/.test(stripped)) return stripped;
  if (stripped === "—" || stripped === "-") return null;
  return null;
}

function parseKitNumbersLine(toks: string[], materials: string[], knownModels: string[]): { models: string[]; values: (string | null)[] | null } | null {
  const modelsFound: string[] = [];
  const values: (string | null)[] = [];
  let sawAnyValueToken = false;
  for (const raw of toks) {
    const bare = raw.replace(/,$/, "");
    if (knownModels.includes(bare)) {
      modelsFound.push(bare);
      continue;
    }
    const stripped = raw.replace(/^\*+/, "").replace(/\*+$/, "");
    if (stripped === "" || /^u$/i.test(stripped)) continue; // pure footnote-marker token
    sawAnyValueToken = true;
    const v = normalizeKitValueToken(raw);
    values.push(v);
  }
  if (modelsFound.length === 0 && !sawAnyValueToken) return null;
  return { models: modelsFound, values: values.length === materials.length && materials.length > 0 ? values : null };
}

function parseKitItemRow(toks: string[], materials: string[]): Omit<DsKitItem, "source"> | null {
  const n = materials.length;
  if (n === 0 || toks.length < n + 2) return null;
  const last = toks[toks.length - 1];
  if (!/^\d+$/.test(last)) return null;

  const isPartTok = (t: string) => /^\d{4,6}$/.test(t) || t === "—" || t === "-";
  const isItemTok = (t: string) => /^\d{1,3}$/.test(t) || t === "—" || t === "-";

  const lead: string[] = [];
  for (const t of toks) {
    if (isPartTok(t) || isItemTok(t)) lead.push(t);
    else break;
  }

  let itemTok: string;
  let parts: string[];
  if (lead.length === n + 1 && isItemTok(lead[0])) {
    itemTok = lead[0];
    parts = lead.slice(1);
  } else if (lead.length === n) {
    itemTok = "—";
    parts = lead;
  } else {
    return null;
  }
  if (!parts.every(isPartTok)) return null;

  const desc = toks.slice(lead.length, toks.length - 1).join(" ").trim();
  if (!desc) return null;

  const item = itemTok === "—" || itemTok === "-" ? null : Number.parseInt(itemTok, 10);
  const partsByMaterial: Record<string, string | null> = {};
  materials.forEach((m, idx) => {
    const p = parts[idx];
    partsByMaterial[m] = p === "—" || p === "-" ? null : p;
  });
  return { item, description: desc, qtyRaw: last, partsByMaterial };
}

function parseKits(lines: Line[], models: string[], mkSource: MkSource, problems: string[]): DsKit[] {
  const kits: DsKit[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const headLine = lines[idx];
    const head = KIT_HEADER.exec(headLine.text);
    if (!head) continue;

    const kind = head[1].toLowerCase() as "seal" | "valve";
    const perPumpNum = Number.parseInt(head[2], 10);
    const perPumpSource = mkSource(headLine.page, headLine.text);

    let materials: string[] = [];
    // Models named since the last value row; a value row closes them into one entry (Codex #5062
    // F11) so each model keeps its own kit number when the sheet lists one row per model.
    let modelsAcc: string[] = [];
    const kitNumbers: DsKitNumbers[] = [];
    let ambiguous = false;
    const items: DsKitItem[] = [];

    for (let j = idx + 1; j < lines.length; j++) {
      const { page, text } = lines[j];
      if (KIT_HEADER.test(text) || text.startsWith("PN ")) break;
      if (text.startsWith("PUMP MODELS")) {
        materials = text.match(MATERIAL_TOKEN) ?? [];
        continue;
      }
      if (text.startsWith("ITEM (Included")) continue;
      if (isFootnoteLine(text)) continue;

      const toks = text.split(/\s+/).filter(Boolean);

      const itemRow = parseKitItemRow(toks, materials);
      if (itemRow) {
        items.push({ ...itemRow, source: mkSource(page, text) });
        continue;
      }

      if (materials.length > 0 && items.length === 0) {
        const parsed = parseKitNumbersLine(toks, materials, models);
        if (parsed) {
          for (const m of parsed.models) if (!modelsAcc.includes(m)) modelsAcc.push(m);
          if (parsed.values) {
            // A value row with no model of its own reads as "fits every model" downstream — only
            // safe when it is the table's one row.
            if (modelsAcc.length === 0 && kitNumbers.length > 0) ambiguous = true;
            kitNumbers.push({
              models: modelsAcc,
              byMaterial: Object.fromEntries(materials.map((m, i) => [m, parsed.values![i]])),
              source: mkSource(page, text),
            });
            modelsAcc = [];
          }
        }
      }
    }

    if (!ambiguous && kitNumbers.length > 1 && kitNumbers.some((kn) => kn.models.length === 0)) ambiguous = true;
    if (ambiguous) {
      problems.push(`${kind} kit table (page ${headLine.page}): a kit-number row names no pump model while other rows do — kit numbers left out rather than guessed`);
    }

    kits.push({
      kind,
      perPump: Number.isNaN(perPumpNum) ? null : perPumpNum,
      perPumpSource,
      materials,
      kitNumbers: ambiguous ? [] : kitNumbers,
      items,
    });
  }
  return kits;
}

// ─────────────────────────────────────────────── specs (page 1 SPECIFICATIONS block)

const SPEC_PATTERNS: Array<{ key: string; label: string; regex: RegExp }> = [
  { key: "flow", label: "Flow", regex: /^Flow\s+(.+)$/ },
  { key: "pressure", label: "Pressure Range", regex: /^(?:Pump\s+)?Pressure Range\s+(.+)$/ },
  { key: "rpm", label: "Pump RPM", regex: /^Pump RPM\*?\s+(.+)$/ },
  { key: "bore", label: "Bore", regex: /^Bore\s+(.+)$/ },
  { key: "stroke", label: "Stroke", regex: /^Stroke\s+(.+)$/ },
  { key: "weight", label: "Weight", regex: /^Weight\s+(.+)$/ },
  { key: "crankcase_capacity", label: "Crankcase Capacity", regex: /^Crankcase Capacity\s+(.+)$/ },
];

// A line that only names models ("5CP6120, 5CP6120CS", "5CP6120CSSG1", "8521") heads a spec block.
// Every spec line after it belongs to those models until the next heading, a "COMMON" heading, or a
// page break — a row this module does not read (e.g. "Engine RPM") does not end the block (Codex
// #5062 F19). A token is a model when it is on the sheet's own model list (digits-only and compact
// "3520/C" forms included) or has the letters-in-the-middle shape ("5CP6120"). A digits-only token
// that is not on the list cannot be told apart from a stray number, so its block's values are
// marked unresolved, never applied to every model. Once a sheet has any block of values, a value outside
// every block and outside the common section is unresolved as well.
const MODEL_TOKEN_RE = /^[0-9]{1,2}[A-Z]{1,4}[0-9][0-9A-Z]*$/;
const BARE_MODEL_RE = /^[0-9]{4,5}[A-Z]{0,4}$/;
const COMMON_RE = /^COMMON\b/;

function headingModels(text: string, roster: Map<string, string>): { models: string[]; known: boolean } | null {
  const toks = text.split(",").map((t) => t.trim());
  const models: string[] = [];
  let known = true;
  for (const tok of toks) {
    if (!/^[0-9A-Z]+(?:\/[0-9A-Z]+)*$/.test(tok)) return null;
    for (const m of expandModelToken(tok)) {
      const hit = roster.get(normalizeModelKey(m));
      if (hit || MODEL_TOKEN_RE.test(m)) models.push(hit ?? m);
      else if (BARE_MODEL_RE.test(m)) {
        models.push(m);
        known = false;
      } else return null;
    }
  }
  return { models, known };
}

type SpecScope = { kind: "sheet" } | { kind: "common" } | { kind: "models"; models: string[] } | { kind: "unresolved" };

const normSpec = (v: string): string => v.replace(/\s+/g, " ").trim().toLowerCase();

function parseSpecs(lines: Line[], models: string[], mkSource: MkSource): DsSpec[] {
  const roster = new Map(models.map((m) => [normalizeModelKey(m), m]));
  const out: Array<{ spec: DsSpec; scope: SpecScope }> = [];
  const seen = new Set<string>();
  let scope: SpecScope = { kind: "sheet" };
  let scopePage = -1;
  for (const { page, text } of lines) {
    if (page !== scopePage) {
      scope = { kind: "sheet" };
      scopePage = page;
    }
    if (COMMON_RE.test(text)) {
      scope = { kind: "common" };
      continue;
    }
    const heading = headingModels(text, roster);
    if (heading) {
      scope = heading.known ? { kind: "models", models: heading.models } : { kind: "unresolved" };
      continue;
    }
    for (const def of SPEC_PATTERNS) {
      const m = def.regex.exec(text);
      if (!m) continue;
      const value = m[1].trim();
      const id = `${def.key}|${normSpec(value)}|${scope.kind}|${scope.kind === "models" ? scope.models.join(",") : ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const spec: DsSpec = { key: def.key, label: def.label, value, source: mkSource(page, text) };
      if (scope.kind === "models") spec.models = scope.models;
      if (scope.kind === "unresolved") spec.scopeUnresolved = true;
      out.push({ spec, scope });
    }
  }
  // Only a heading that actually heads ratings counts — the parts-list and kit-table model lines on
  // later pages have the same shape.
  const sawBlock = out.some((o) => o.scope.kind === "models" || o.scope.kind === "unresolved");
  if (sawBlock) for (const o of out) if (o.scope.kind === "sheet") o.spec.scopeUnresolved = true;
  return out.map((o) => o.spec);
}

// ─────────────────────────────────────────────── entry point

export function parseCatPumpsDataSheet(doc: DocText): DataSheet | null {
  const lines = flattenLines(doc);
  const joined = lines.map((l) => l.text).join("\n");
  if (!/\bDATA SHEET\b/.test(joined) || !/CAT PUMPS/.test(joined)) return null;

  const mkSource: MkSource = (page, line) => ({ docId: doc.docId, fileId: doc.fileId, filename: doc.filename, page, line });

  const { models, parts: mainParts } = parsePartsList(lines, mkSource);
  const optional = parseSimpleSection(lines, "OPTIONAL PARTS AND ACCESSORIES", "optional", models, mkSource);
  const service = parseSimpleSection(lines, "SERVICE PARTS", "service", models, mkSource);
  const problems: string[] = [];
  const kits = parseKits(lines, models, mkSource, problems);
  const specs = parseSpecs(lines, models, mkSource);

  if (models.length === 0) problems.push("no parts-list header found (ITEM PART NUMBERS / ITEM P/N) — models unknown");
  if (kits.length === 0) problems.push("no seal/valve kit tables found");
  for (const p of mainParts) {
    if (p.qtyStatus === "ambiguous") {
      problems.push(`item ${p.item ?? "?"} part ${p.partNumber}: qty '${p.qtyRaw}' could not be resolved per model`);
    }
  }

  return {
    kind: "catpumps_datasheet",
    models,
    parts: [...mainParts, ...optional, ...service],
    kits,
    specs,
    problems,
  };
}
