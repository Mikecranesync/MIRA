/**
 * #4133 — retail and warehouse codes on packaging labels. Asked "which part
 * number did the earlier photo show?" about a bearing box, the answer model gave
 * the Amazon FNSKU ("X0026E67QS") or a long carton code as the part number on
 * 12 of 15 attempts (gpt-oss-120b, the route's exact messages, three real LOOK
 * observations). With this note: 2/15, and 14/15 gave the code printed with the
 * product description (numbers on #4133).
 *
 * Deterministic and conditional, the same shape as #4131's data-identifier
 * note: added only when this turn's photo context contains an FNSKU-shaped
 * code; every other turn's prompt is byte-identical. No new call.
 */

export const RETAIL_CODE_NOTE =
  "RETAIL AND WAREHOUSE CODES on packaging labels are not part numbers: an Amazon FNSKU (\"X00\" followed by 7 letters or digits, printed under a barcode), an LPN, or a long hyphenated or numeric tracking code identifies the store listing or the carton, not the part. The manufacturer's part number is the code printed with the product description (for example \"<code> Tapered Roller Bearing\"). If that code looks misread or incomplete, give it as printed and say it should be checked against the part itself.";

/** An Amazon FNSKU as a vision model transcribes it: "X00" + 7 letters/digits,
 *  a whole token ("*X0026E67QS*" from a barcode counts). */
const FNSKU = /(?<![A-Za-z0-9])X00[A-Z0-9]{7}(?![A-Za-z0-9])/;

export function showsRetailCode(photoContext: string): boolean {
  return FNSKU.test(photoContext);
}

/** The system prompt, plus the note when the photo context shows a retail code. */
export function withRetailCodeNote(systemPrompt: string, photoContext: string): string {
  return showsRetailCode(photoContext) ? `${systemPrompt}\n\n${RETAIL_CODE_NOTE}` : systemPrompt;
}
