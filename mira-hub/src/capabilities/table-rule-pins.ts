/**
 * Pinned table rules (#5503 F14/F15).
 *
 * Whether a non-row line under a model header (a group heading, a merged cell) belongs to that
 * table is decided by the table's own drawn vertical rules. Reading a page's drawing at upload
 * could not be made safe, so no drawing is read. The rules of the few manual pages that need
 * them were captured once, checked against a rendered image of the page, and are stored in
 * `table-rule-pins.json` keyed by the file's SHA-256 and page number.
 *
 * A document whose bytes are not pinned gets no rule evidence. A pinned page gets its rules only
 * while the text geometry read from it still matches the fingerprint taken at capture, so a
 * change in text extraction cannot move a pinned rule onto a different line. No evidence means
 * the line ends the table and what follows is withheld from its models.
 */
import { createHash } from "node:crypto";
import pins from "./table-rule-pins.json";

export type VerticalRule = { x: number; y0: number; y1: number };
/** `reviewed`: digest of the page's model-scope rows as checked against the page image
 *  (`model-scope-gate.ts`); absent = the page's rows were not reviewed.
 *  `release`: the approval switch of a reviewed page. Only the exact value `"enabled"` releases the
 *  reviewed rows; `"disabled"` (or anything else, or nothing) withdraws them everywhere while the
 *  approved digest stays recorded for the drift checks. Turning an approval off is a one-word
 *  change, never a deletion.
 *  `models`: the catalog numbers of a reviewed page exactly as the page prints them. A row stored
 *  before approvals were bound to their pages carries no mark and no file hash; while the approval
 *  is off, such a row is treated as this page's when a passage of its own document page names one
 *  of them (`activeReleaseSql`). */
export type PagePin = { fingerprint: string; rules: readonly VerticalRule[]; reviewed?: string; release?: string; models?: readonly string[] };

const HEX64 = /^[0-9a-f]{64}$/;
const PAGE_KEY = /^[1-9]\d*$/;
/** A printed catalog number as it may reach SQL: letters, digits and hyphens only. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

/** The reviewed digest of a pin only while its approval switch is enabled. */
function releasedDigest(pin: PagePin): string | null {
  return pin.release === "enabled" && typeof pin.reviewed === "string" ? pin.reviewed : null;
}
/** The recorded digest of a pin, whatever its switch: null when the page has no valid approval. */
function recordedDigest(pin: PagePin): string | null {
  return typeof pin.reviewed === "string" && HEX64.test(pin.reviewed) ? pin.reviewed : null;
}
/** Page number (1-based, as a string key) to that page's pin. */
export type DocumentRulePins = Readonly<Record<string, PagePin>>;

const PINNED = pins.documents as unknown as Record<string, { source: string; pages: Record<string, PagePin> }>;

/** The pins of the document with exactly these bytes' SHA-256, or null when it is not pinned. */
export function rulePinsForSha(sha256: string): DocumentRulePins | null {
  return Object.hasOwn(PINNED, sha256) ? PINNED[sha256].pages : null;
}

/** True while the shipped pin of exactly this file (`sha256`) and page still records `digest` as
 *  that page's reviewed rows and its approval switch is enabled. A stored row released by the gate carries all three
 *  (`metadata.table_reviewed_sha`, its page, `metadata.table_reviewed`); retrieval honours the
 *  release only while this holds, so removing an approval from the pin file, for one file or for
 *  all, withdraws exactly the rows released under it, with no reprocess and no need for the
 *  original file. Anything missing or malformed is not a release. `lookup` exists for tests that
 *  stand stub bytes in for a pinned file; production always reads the shipped pins. */
export function isReleaseActive(sha256: unknown, pageNumber: unknown, digest: unknown,
  lookup: (sha256: string) => DocumentRulePins | null = rulePinsForSha): boolean {
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return false;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) return false;
  const page = typeof pageNumber === "string" && /^[1-9]\d*$/.test(pageNumber) ? Number(pageNumber) : pageNumber;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return false;
  const document = lookup(sha256);
  if (!document || !Object.hasOwn(document, String(page))) return false;
  return releasedDigest(document[String(page)]) === digest;
}

/** The shipped pins of every pinned file, keyed by SHA-256 (for `activeReleaseSql`). */
export function allRulePins(): Readonly<Record<string, DocumentRulePins>> {
  return Object.fromEntries(Object.entries(PINNED).map(([sha, document]) => [sha, document.pages]));
}

/** SQL condition (no parameters) on a `knowledge_entries` row: false for every row of an approved
 *  file's page whose approval is recorded but not enabled now, true otherwise. Every query that can
 *  put a node row into an answer, a prompt or a citation adds `AND <this>`, so switching an
 *  approval off removes that page from every route at once, whatever the question names, with no
 *  reprocess and no need for the original file; the stored rows are left as they are.
 *
 *  A row is recognised as the page's in one of three ways:
 *  1. a mark: the writer marks every row of a page with a recorded approval, in either switch
 *     state and whatever the page's extraction reads — a released row with the reviewed digest
 *     (`metadata.table_reviewed`), every other row with the recorded digest (`metadata.table_held`),
 *     each with its file's SHA-256. A marked row is served only while its exact file, page and
 *     digest approval is enabled;
 *  2. its file: every row this writer stores carries `metadata.file_sha256`;
 *  3. its page: a node row stored by an earlier build carries neither, so while an approval of
 *     page P is off, an unmarked node row of page P with no file hash is withheld when a passage of
 *     its own document page names one of that page's catalog numbers (`PagePin.models`). Rows of
 *     other documents and other pages are untouched.
 *  With every recorded approval enabled, only clause 1 is emitted. The values are pin-file hex,
 *  digits and catalog numbers, validated here before they reach SQL. `documents` exists for tests
 *  that stand stub bytes in for a pinned file. */
export function activeReleaseSql(alias = "",
  documents: Readonly<Record<string, DocumentRulePins>> = allRulePins()): string {
  if (alias !== "" && !/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`activeReleaseSql: bad alias ${alias}`);
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  const stamp = `${col("metadata")}->>'table_reviewed'`;
  const held = `${col("metadata")}->>'table_held'`;
  const page = `COALESCE(${col("page_start")}, ${col("source_page")})::text`;
  const active: string[] = [];
  const withdrawn: string[] = [];
  const withdrawnModels = new Map<number, Set<string>>();
  for (const sha of Object.keys(documents).sort()) {
    if (!HEX64.test(sha)) continue;
    const pages = documents[sha];
    for (const page of Object.keys(pages).sort()) {
      if (!PAGE_KEY.test(page)) continue;
      const recorded = recordedDigest(pages[page]);
      const digest = releasedDigest(pages[page]);
      if (digest !== null && HEX64.test(digest)) { active.push(`('${sha}', '${page}', '${digest}')`); continue; }
      if (recorded === null) continue;
      withdrawn.push(`('${sha}', '${page}')`);
      const models = withdrawnModels.get(Number(page)) ?? new Set<string>();
      for (const model of pages[page].models ?? []) if (typeof model === "string" && MODEL_NAME.test(model)) models.add(model);
      withdrawnModels.set(Number(page), models);
    }
  }
  const marked = active.length === 0
    ? `(${stamp} IS NULL AND ${held} IS NULL)`
    : `((${stamp} IS NULL OR (${col("metadata")}->>'table_reviewed_sha', ${page}, ${stamp}) IN (${active.join(", ")}))` +
      ` AND (${held} IS NULL OR (${col("metadata")}->>'table_held_sha', ${page}, ${held}) IN (${active.join(", ")})))`;
  if (withdrawn.length === 0) return marked;
  // Clauses 2 and 3 name the outer row explicitly: they sit beside a subquery over the same table.
  const o = alias || "knowledge_entries";
  const fileSha = `${o}.metadata->>'file_sha256'`;
  const pageNumber = `COALESCE(${o}.page_start, ${o}.source_page, 0)`;
  const byFile = `(${fileSha} IS NULL OR (${fileSha}, ${pageNumber}::text) NOT IN (${withdrawn.join(", ")}))`;
  const byPage = [...withdrawnModels.keys()].sort((a, b) => a - b).map((p) => {
    const models = [...withdrawnModels.get(p)!].sort();
    // A page approval with no catalog numbers recorded cannot be recognised by its text, so every
    // unmarked, unhashed node row of that page number is withheld while it is off (fail closed).
    const named = models.length === 0 ? "TRUE" : models.map((m) => `strpos(s.content, '${m}') > 0`).join(" OR ");
    return `(${o}.source_type IS DISTINCT FROM 'node_attachment' OR ${fileSha} IS NOT NULL` +
      ` OR ${o}.metadata->>'table_reviewed' IS NOT NULL OR ${o}.metadata->>'table_held' IS NOT NULL OR ${pageNumber} <> ${p}` +
      ` OR NOT EXISTS (SELECT 1 FROM knowledge_entries s WHERE s.tenant_id = ${o}.tenant_id AND s.doc_id = ${o}.doc_id` +
      ` AND s.source_type = 'node_attachment' AND COALESCE(s.page_start, s.source_page) = ${p} AND (${named})))`;
  });
  return `(${marked} AND ${byFile} AND ${byPage.join(" AND ")})`;
}

/** Every recorded page approval (file SHA-256, page, digest, catalog numbers), whatever its switch,
 *  for the fence and inventory statements of the rollback runbook. */
export function recordedApprovals(documents: Readonly<Record<string, DocumentRulePins>> = allRulePins()):
  Array<{ sha256: string; page: number; digest: string; models: string[]; enabled: boolean }> {
  const out: Array<{ sha256: string; page: number; digest: string; models: string[]; enabled: boolean }> = [];
  for (const sha of Object.keys(documents).sort()) {
    if (!HEX64.test(sha)) continue;
    for (const page of Object.keys(documents[sha]).sort()) {
      const pin = documents[sha][page];
      const digest = recordedDigest(pin);
      if (digest === null || !PAGE_KEY.test(page)) continue;
      out.push({ sha256: sha, page: Number(page), digest, models: [...(pin.models ?? [])], enabled: releasedDigest(pin) === digest });
    }
  }
  return out;
}

/** Identity of a page's positioned text: every item's text and position, in reading order. */
export function layoutFingerprint(items: ReadonlyArray<{ str: string; x: number; y: number }>): string {
  const hash = createHash("sha256");
  for (const item of items) hash.update(`${item.str}\u0000${item.x.toFixed(2)}\u0000${item.y.toFixed(2)}\u0001`);
  return hash.digest("hex");
}

/** The pinned rules of one page, only when its text geometry is the geometry that was pinned. */
export function pinnedRules(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): readonly VerticalRule[] | null {
  return matchingPin(document, pageNumber, items)?.rules ?? null;
}

/** The pin of one page, only when its text geometry is the geometry that was pinned. */
function matchingPin(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): PagePin | null {
  const key = String(pageNumber);
  if (!document || !Object.hasOwn(document, key)) return null;
  const pin = document[key];
  return pin.fingerprint === layoutFingerprint(items) ? pin : null;
}

/** The reviewed-rows digest of one page of a pinned document: null unless the document is
 *  pinned, the page is pinned, its text geometry matches, its rows were reviewed and that
 *  approval is enabled. */
export function reviewedRowsDigest(document: DocumentRulePins | null, pageNumber: number,
  items: ReadonlyArray<{ str: string; x: number; y: number }>): string | null {
  const pin = matchingPin(document, pageNumber, items);
  return pin ? releasedDigest(pin) : null;
}

/** The recorded approval digest of one page of a file, in either switch state and WHATEVER the page
 *  reads now: no geometry check, so a page whose extraction drifted, whose table was not recognised
 *  or whose layout could not be read is still bound to its approval. The writer marks every row of
 *  such a page that the gate does not release with it (`metadata.table_held`), so the page's text
 *  answers only while that approval is enabled (`activeReleaseSql`). Null when the page has no
 *  recorded approval. */
export function boundDigest(document: DocumentRulePins | null, pageNumber: number): string | null {
  const key = String(pageNumber);
  if (!document || !Object.hasOwn(document, key)) return null;
  return recordedDigest(document[key]);
}

/** A rule runs through a text line only when it passes below the baseline and up through the
 * body of the letters; one that merely reaches the baseline stops at the line. */
const BELOW_BASELINE_PT = 1;
const ABOVE_BASELINE_PT = 4;

/** Indices of the rules whose extent runs through the text line at baseline `y`. */
export function rulesCrossing(rules: readonly VerticalRule[], y: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < rules.length; i++) if (rules[i].y0 <= y - BELOW_BASELINE_PT && y + ABOVE_BASELINE_PT <= rules[i].y1) ids.push(i);
  return ids;
}
