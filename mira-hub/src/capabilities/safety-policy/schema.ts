/**
 * Zod schema for typed hazard-critical numbers (§4.1 `numbers[]`). Strict objects: an unknown key,
 * an unknown quantity, a unit that is not the quantity's canonical unit, or a non-finite value is a
 * schema failure, which the verifier turns into `block:schema` (SYS-2 fail closed).
 */
import { z } from "zod";
import { QUANTITIES, QUANTITY_UNIT, UNITS, type TypedNumber } from "./types";

export const ConditionSchema = z.strictObject({
  op: z.enum(["le", "ge", "eq"]),
  value: z.number().finite().positive(),
  unit: z.enum(["hp", "kW"]),
});

export const TypedNumberSchema = z
  .strictObject({
    quantity: z.enum(QUANTITIES),
    value: z.number().finite().nonnegative(),
    unit: z.enum(UNITS),
    sourceChunkId: z.string().min(1).nullable(),
    condition: ConditionSchema.optional(),
  })
  .refine((n) => QUANTITY_UNIT[n.quantity] === n.unit, { message: "unit does not match quantity" });

export const NumbersPlanSchema = z.strictObject({
  numbers: z.array(TypedNumberSchema).max(64),
});

/** Parse one untrusted number; null on any schema failure. */
export function parseTypedNumber(raw: unknown): TypedNumber | null {
  const r = TypedNumberSchema.safeParse(raw);
  return r.success ? (r.data as TypedNumber) : null;
}
