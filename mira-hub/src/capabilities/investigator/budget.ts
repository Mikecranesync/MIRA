/**
 * Paid-call spend ledger (contract: ../investigator/types.ts `SpendLedger`).
 *
 * `FileSpendLedger` is a jsonl, append-only ledger file shared across
 * processes (the offline harness and its sealed-run siblings may each start
 * their own process against the same `spend-ledger.jsonl` — PREREGISTRATION
 * §7). Every reserve/settle is one appended line; totals are always
 * recomputed from the file, never cached in memory, so one instance sees
 * another instance's spend immediately.
 *
 * Cross-process race: a bare "read, check, append" has a gap between the
 * read and the write where a second process can do the same read and both
 * pass. This ledger closes it by APPENDING FIRST, then re-reading the whole
 * file and checking the running total UP TO AND INCLUDING this
 * reservation's own line, in file order. Append order is the tie-break: the
 * reservation that lands earlier in the file wins; a later one that would
 * push the cumulative total over the cap gets an immediate `void` line
 * appended and `reserve()` returns null. This makes file order authoritative
 * regardless of how many processes raced to append.
 *
 * `worstCaseUsd` mirrors `openai-run-budget.ts`'s own chars/4 token proxy
 * (that file's own comment: an average, deliberately not the tighter
 * UTF-8-byte `boundInputTokens` bound it also exports) plus a flat +10%
 * margin, per this module's contract.
 */

import * as fs from "fs";
import * as path from "path";
import { DEFAULT_PRICE_PER_MTOK_IN, DEFAULT_PRICE_PER_MTOK_OUT } from "@/capabilities/openai-run-budget";
import type { SpendLedger } from "./types";

type ReserveRecord = { type: "reserve"; id: string; worstCaseUsd: number; label: string; ts: number };
type SettleRecord = {
  type: "settle";
  id: string;
  actualUsd: number;
  inputTokens: number;
  outputTokens: number;
  ts: number;
};
type VoidRecord = { type: "void"; id: string; ts: number };
type LedgerRecord = ReserveRecord | SettleRecord | VoidRecord;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${process.pid}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLedgerRecord(v: unknown): v is LedgerRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string") return false;
  if (r.type === "reserve") return typeof r.worstCaseUsd === "number" && Number.isFinite(r.worstCaseUsd);
  if (r.type === "settle") return typeof r.actualUsd === "number" && Number.isFinite(r.actualUsd);
  if (r.type === "void") return true;
  return false;
}

type ReadResult = { records: LedgerRecord[]; corrupt: boolean };

/** Read every line; a malformed line is skipped from `records` but flips
 *  `corrupt` — this is what makes "fail closed" real: `reserve()` below
 *  refuses outright on a corrupt file (it cannot trust a total it cannot
 *  fully account for), rather than silently under-counting spend by
 *  skipping the bad line and reporting a total as if it were complete. */
function readRecords(filePath: string): ReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { records: [], corrupt: false };
    throw err;
  }
  const out: LedgerRecord[] = [];
  let corrupt = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isLedgerRecord(parsed)) {
        out.push(parsed);
      } else {
        corrupt = true;
      }
    } catch {
      corrupt = true;
    }
  }
  return { records: out, corrupt };
}

/** spent (settled) + open (reserved, neither settled nor voided) over
 *  `records[0, endIndex)`. */
function totalUsdThrough(records: readonly LedgerRecord[], endIndex: number): number {
  const open = new Map<string, number>();
  let spent = 0;
  for (let i = 0; i < endIndex; i++) {
    const rec = records[i];
    if (rec.type === "reserve") {
      open.set(rec.id, rec.worstCaseUsd);
    } else if (rec.type === "settle") {
      open.delete(rec.id);
      spent += rec.actualUsd;
    } else {
      open.delete(rec.id);
    }
  }
  let openTotal = 0;
  for (const v of open.values()) openTotal += v;
  return spent + openTotal;
}

export class FileSpendLedger implements SpendLedger {
  private readonly filePath: string;
  private readonly cap: number;

  constructor(filePath: string, capUsd: number) {
    this.filePath = filePath;
    this.cap = capUsd;
    const dir = path.dirname(filePath);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "");
    // Re-read on construction per contract (also a fail-fast read of any
    // existing file this instance is about to share).
    readRecords(this.filePath);
  }

  capUsd(): number {
    return this.cap;
  }

  spentUsd(): number {
    let spent = 0;
    for (const rec of readRecords(this.filePath).records) if (rec.type === "settle") spent += rec.actualUsd;
    return spent;
  }

  reserve(worstCaseUsd: number, label: string): string | null {
    // A non-finite or negative worst case can never be admitted — letting it
    // through would make every later `total > cap` comparison involving it
    // either throw away the cap (NaN) or under-charge it (negative).
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd < 0) return null;

    // Re-read totals before reserving (contract requirement). This is a
    // cheap, non-authoritative pre-check: an obviously-over-cap request
    // never even appends a line. A CORRUPT file fails closed here too — a
    // line we cannot parse is spend we cannot account for, so the total is
    // unknown, not "whatever the good lines sum to".
    const before = readRecords(this.filePath);
    if (before.corrupt) return null;
    if (totalUsdThrough(before.records, before.records.length) + worstCaseUsd > this.cap) return null;

    const id = nextId();
    const record: ReserveRecord = { type: "reserve", id, worstCaseUsd, label, ts: Date.now() };
    fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n");

    // The AUTHORITATIVE check: re-read after appending and look at this
    // reservation's own position in file order. Two concurrent instances
    // can both pass the pre-check above and both append — this is what
    // makes the cap real across processes: whichever line landed earlier
    // wins, and anything that would overshoot the cap once its own line is
    // counted gets voided immediately. A file that became corrupt between
    // the two reads (another writer's bad line landed in between) also
    // voids this reservation — same fail-closed reasoning as above.
    const after = readRecords(this.filePath);
    const idx = after.records.findIndex((r) => r.type === "reserve" && r.id === id);
    const cumulative =
      after.corrupt || idx === -1 ? Infinity : totalUsdThrough(after.records, idx + 1);
    if (cumulative > this.cap) {
      const voidRec: VoidRecord = { type: "void", id, ts: Date.now() };
      fs.appendFileSync(this.filePath, JSON.stringify(voidRec) + "\n");
      return null;
    }
    return id;
  }

  settle(reservationId: string, actualUsd: number, usage: { inputTokens: number; outputTokens: number }): void {
    const { records } = readRecords(this.filePath);
    const alreadyClosed = records.some((r) => (r.type === "settle" || r.type === "void") && r.id === reservationId);
    if (alreadyClosed) return; // idempotent: settle() on an already-settled/voided id is a no-op.

    const reserveRec = records.find((r): r is ReserveRecord => r.type === "reserve" && r.id === reservationId);
    const fallbackUsd = reserveRec?.worstCaseUsd ?? 0;
    const usd = Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : fallbackUsd;
    const inputTokens = Number.isFinite(usage?.inputTokens) && usage.inputTokens >= 0 ? usage.inputTokens : 0;
    const outputTokens = Number.isFinite(usage?.outputTokens) && usage.outputTokens >= 0 ? usage.outputTokens : 0;

    const record: SettleRecord = { type: "settle", id: reservationId, actualUsd: usd, inputTokens, outputTokens, ts: Date.now() };
    fs.appendFileSync(this.filePath, JSON.stringify(record) + "\n");
  }
}

const CHARS_PER_TOKEN = 4;
const MARGIN = 1.1;

/** Worst-case USD for one call: `promptChars/4` input tokens plus
 *  `maxOutputTokens` output tokens, at the Hub's own OpenAI list prices,
 *  with a flat +10% margin. */
export function worstCaseUsd(promptChars: number, maxOutputTokens: number): number {
  const inputTokens = Math.max(0, promptChars) / CHARS_PER_TOKEN;
  const outputTokens = Math.max(0, maxOutputTokens);
  const raw = (inputTokens / 1e6) * DEFAULT_PRICE_PER_MTOK_IN + (outputTokens / 1e6) * DEFAULT_PRICE_PER_MTOK_OUT;
  return raw * MARGIN;
}
