/**
 * Strict validator for typed hazard-critical numbers (§4.1 `numbers[]`). An unknown key, an
 * unknown quantity, a unit that is not the quantity's canonical unit, or a non-finite value is a
 * schema failure, which the verifier turns into `block:schema` (SYS-2 fail closed).
 *
 * Pure + dependency-free (no zod — same convention as lib/contextualization/intake-contract.ts).
 */
import { QUANTITIES, QUANTITY_UNIT, UNITS, type Condition, type Quantity, type TypedNumber, type Unit } from "./types";

const NUMBER_KEYS = new Set(["quantity", "value", "unit", "sourceChunkId", "condition"]);
const CONDITION_KEYS = new Set(["op", "value", "unit"]);
const CONDITION_OPS = ["le", "ge", "eq"] as const;
const CONDITION_UNITS = ["hp", "kW"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function onlyKeys(o: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(o).every((k) => allowed.has(k));
}

function includes<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseCondition(raw: unknown): Condition | null {
  if (!isPlainObject(raw) || !onlyKeys(raw, CONDITION_KEYS)) return null;
  if (!includes(CONDITION_OPS, raw.op) || !includes(CONDITION_UNITS, raw.unit)) return null;
  if (!finite(raw.value) || raw.value <= 0) return null;
  return { op: raw.op, value: raw.value, unit: raw.unit };
}

/** Parse one untrusted number; null on any schema failure. */
export function parseTypedNumber(raw: unknown): TypedNumber | null {
  if (!isPlainObject(raw) || !onlyKeys(raw, NUMBER_KEYS)) return null;
  const { quantity, value, unit, sourceChunkId } = raw;
  if (!includes<Quantity>(QUANTITIES, quantity) || !includes<Unit>(UNITS, unit)) return null;
  if (QUANTITY_UNIT[quantity] !== unit) return null;
  if (!finite(value) || value < 0) return null;
  if (sourceChunkId !== null && (typeof sourceChunkId !== "string" || sourceChunkId.length === 0)) return null;
  const out: TypedNumber = { quantity, value, unit, sourceChunkId };
  if (raw.condition !== undefined) {
    const condition = parseCondition(raw.condition);
    if (condition === null) return null;
    out.condition = condition;
  }
  return out;
}
