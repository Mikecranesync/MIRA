/**
 * Thin, display-only reader for vendored Drive Commander packs.
 *
 * The pack of record lives in mira-bots/shared/drive_packs/packs/<id>/pack.json
 * (Python package data, validated by that service's loader/grader). This module
 * does NOT re-implement that validation — it reads the vendored copy
 * (src/data/drive-packs/<id>.json, produced by scripts/vendor-drive-packs.mjs)
 * and exposes only the fields the public pages render.
 *
 * Provenance is `manual_cited` (PowerFlex 525 = a beta-grade, manual-cited pack —
 * no bench live_decode). Every rendered claim must carry a citation from the pack
 * (see drive-commander-renderer.ts); this module surfaces those citations.
 */

// Bun/TS native JSON import. AB-1: PowerFlex 525 only.
import powerflex525 from "../data/drive-packs/powerflex_525.json";

export interface Citation {
  doc: string;
  page: string;
  excerpt?: string;
}

export interface ValueMeaning {
  value: string;
  meaning: string;
}

export interface ParameterCard {
  parameter_id: string;
  name: string;
  purpose?: string;
  default?: string | null;
  range?: string | null;
  unit?: string | null;
  related_faults: string[];
  related_parameters: string[];
  value_meanings: ValueMeaning[];
  source_citation?: Citation;
}

export interface DriveFamily {
  manufacturer: string;
  series: string;
  aliases: string[];
}

export interface DrivePackDisplay {
  modelSlug: string; // URL slug, e.g. "powerflex-525"
  packId: string; // pack id, e.g. "powerflex_525"
  family: DriveFamily;
  faultCodes: Record<string, string>; // { "7": "Motor Overload" }
  parameters: ParameterCard[];
  manualDoc: string; // canonical source document (from the citations)
  provenanceLabel: string; // "manual-cited" — honest provenance shown on every page
}

export interface FaultView {
  key: string; // bare pack key, e.g. "7"
  display: string; // "F007"
  name: string; // "Motor Overload"
  hasDetail: boolean; // any cited related parameters?
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Fault key ("7") -> the "F007" form used in parameters[].related_faults. */
function faultTag(key: string): string {
  const n = parseInt(key, 10);
  return Number.isNaN(n) ? `F${key}` : `F${pad3(n)}`;
}

function buildPack(raw: any, modelSlug: string): DrivePackDisplay {
  const parameters: ParameterCard[] = (raw.parameters ?? []).map((p: any) => ({
    parameter_id: p.parameter_id,
    name: p.name,
    purpose: p.purpose ?? "",
    default: p.default ?? null,
    range: p.range ?? null,
    unit: p.unit ?? null,
    related_faults: p.related_faults ?? [],
    related_parameters: p.related_parameters ?? [],
    value_meanings: p.value_meanings ?? [],
    source_citation: p.source_citation
      ? { doc: p.source_citation.doc, page: String(p.source_citation.page), excerpt: p.source_citation.excerpt }
      : undefined,
  }));
  // The canonical source doc is the same manual for every cited item; pick the first.
  const manualDoc =
    parameters.find((p) => p.source_citation?.doc)?.source_citation?.doc ??
    `${raw.family?.manufacturer ?? ""} ${raw.family?.series ?? ""} User Manual`.trim();

  const items: Record<string, string> = raw.provenance?.items ?? {};
  const allManualCited =
    Object.values(items).length > 0 && Object.values(items).every((v) => v === "manual_cited");

  return {
    modelSlug,
    packId: raw.pack_id,
    family: {
      manufacturer: raw.family?.manufacturer ?? "",
      series: raw.family?.series ?? "",
      aliases: raw.family?.aliases ?? [],
    },
    faultCodes: raw.live_decode?.fault_codes ?? {},
    parameters,
    manualDoc,
    provenanceLabel: allManualCited ? "manual-cited" : "mixed provenance",
  };
}

// URL model-slug -> vendored pack. Add entries as packs are promoted + vendored.
const PACKS: Record<string, DrivePackDisplay> = {
  "powerflex-525": buildPack(powerflex525 as any, "powerflex-525"),
};

export const PACK_MODELS = Object.keys(PACKS);

export function getPack(modelSlug: string): DrivePackDisplay | null {
  return PACKS[modelSlug] ?? null;
}

/** Normalise a user/URL fault code ("F007", "f7", "007", "7") to the bare pack key. */
export function getFault(pack: DrivePackDisplay, code: string): FaultView | null {
  if (!code) return null;
  const stripped = code.replace(/^[Ff]/, "").replace(/^0+(?=\d)/, "");
  const key = pack.faultCodes[stripped] !== undefined ? stripped : undefined;
  if (key === undefined) return null;
  return {
    key,
    display: faultTag(key),
    name: pack.faultCodes[key],
    hasDetail: getParametersForFault(pack, key).length > 0,
  };
}

/** Parameters whose cited card links to this fault (fault "7" -> related_faults "F007"). */
export function getParametersForFault(pack: DrivePackDisplay, key: string): ParameterCard[] {
  const tag = faultTag(key);
  return pack.parameters.filter((p) => p.related_faults.includes(tag));
}

/** All faults, numeric-sorted, flagged whether they have cited parameter detail. */
export function listFaults(pack: DrivePackDisplay): FaultView[] {
  return Object.keys(pack.faultCodes)
    .filter((k) => k !== "0") // "No Fault" is not a troubleshooting page
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((key) => ({
      key,
      display: faultTag(key),
      name: pack.faultCodes[key],
      hasDetail: getParametersForFault(pack, key).length > 0,
    }));
}

/** Case-insensitive parameter lookup by id (P033 / p033 / C125). */
export function getParameter(pack: DrivePackDisplay, pid: string): ParameterCard | null {
  if (!pid) return null;
  const want = pid.trim().toLowerCase();
  return pack.parameters.find((p) => p.parameter_id.toLowerCase() === want) ?? null;
}

/** All parameters, id-sorted. */
export function listParameters(pack: DrivePackDisplay): ParameterCard[] {
  return [...pack.parameters].sort((a, b) => a.parameter_id.localeCompare(b.parameter_id));
}

/** The faults a parameter links to (related_faults "F007" -> FaultView), for cross-links. */
export function getFaultsForParameter(pack: DrivePackDisplay, param: ParameterCard): FaultView[] {
  return param.related_faults
    .map((tag) => {
      const key = tag.replace(/^[Ff]/, "").replace(/^0+(?=\d)/, "");
      const name = pack.faultCodes[key];
      return name ? { key, display: faultTag(key), name, hasDetail: true } : null;
    })
    .filter((f): f is FaultView => f !== null);
}

/** Every Drive Commander page path (landing + faults + parameters) for the sitemap. */
export function driveCommanderSitemapLocs(): string[] {
  const locs: string[] = [];
  for (const slug of PACK_MODELS) {
    const pack = PACKS[slug];
    locs.push(`/drive-commander/${slug}`);
    for (const f of listFaults(pack)) locs.push(`/drive-commander/${slug}/faults/${f.display}`);
    for (const p of pack.parameters) locs.push(`/drive-commander/${slug}/parameters/${p.parameter_id}`);
  }
  return locs;
}
