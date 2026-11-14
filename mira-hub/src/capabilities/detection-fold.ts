/**
 * Detection-only Unicode fold, shareable (#5485, #3980).
 *
 * #3980 names `foldForDetection` as the one canonical entry point for folding
 * text before a deterministic rule reads it. Today that function is private to
 * `answer-validation.ts`, and open PRs #4929 and #4931 both edit that file, so
 * it cannot be exported from there without colliding with them. This module is
 * a byte-for-byte copy of that block, exported so other deterministic readers
 * (the "back to mine" reader in `conversation-subject.ts`; catalog-number
 * readers, #5484) use the same fold instead of writing a third one.
 *
 * Drift is a test failure, not a code-review hope:
 * `__tests__/detection-fold.test.ts` reads both files and fails if the character
 * sets or the fold body ever differ. Merge-back (#3980): once #4929/#4931 have
 * landed, `answer-validation.ts` imports from here and its private copy goes.
 *
 * Detection only: the folded string is never shown, stored, or sent to a model.
 */

/**
 * Hyphen-equivalent codepoints folded to ASCII `-`. NOT en/em dash.
 *
 * Membership is decided by Unicode decomposition, not by how a glyph looks:
 *   U+2010 HYPHEN, U+2012 FIGURE DASH, U+2212 MINUS SIGN  — hyphen/minus forms
 *   U+2011 NON-BREAKING HYPHEN  — <noBreak> U+2010        (the observed bypass)
 *   U+FE63 SMALL HYPHEN-MINUS   — <small>   U+002D
 *   U+FF0D FULLWIDTH HYPHEN-MINUS — <wide>  U+002D
 *
 * U+FE58 SMALL EM DASH is deliberately ABSENT. It was in this set until an
 * independent review checked its decomposition: `<small> U+2014`. It is an EM
 * DASH form, and folding it would have quietly contradicted the en/em-dash
 * exclusion three lines below — the precise class of interaction this file
 * exists to prevent. Judge a codepoint by `unicodedata.decomposition()`, never
 * by the shape of the glyph.
 */
export const HYPHEN_EQUIV_CHARS = "\\u2010\\u2011\\u2012\\u2212\\uFE63\\uFF0D";
const HYPHEN_EQUIV = new RegExp(`[${HYPHEN_EQUIV_CHARS}]`, "g");
export const APOSTROPHE_EQUIV_CHARS = "\\u2018\\u2019\\u02BC";
const APOSTROPHE_EQUIV = new RegExp(`[${APOSTROPHE_EQUIV_CHARS}]`, "g");

/**
 * Every Unicode SPACE SEPARATOR (category `Zs`) folded to ASCII " ".
 *
 * Chosen by Unicode category rather than by listing the ones we happened to
 * see: U+00A0, U+1680, the U+2000–U+200A block, U+202F, U+205F, U+3000. The
 * earlier hand-picked set (U+00A0, U+2007, U+202F) missed the entire
 * U+2000–U+200A block, and an exploratory fuzz over model-realistic variants
 * is what surfaced it.
 */
export const UNICODE_SPACE_CHARS = "\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000";
const UNICODE_SPACE = new RegExp(`[${UNICODE_SPACE_CHARS}]`, "g");

/**
 * ALL invisible FORMAT characters (Unicode general category `Cf`) — removed
 * outright, because they are not part of the logical text at all.
 *
 * This is a CATEGORY, deliberately, and it is the second time that lesson has
 * had to be learned in this file. The first version listed six codepoints that
 * had actually been observed. An independent review then demonstrated a live
 * bypass of A1, A2 and A4 through eleven more — U+200E/U+200F and the
 * U+202A–U+202E and U+2066–U+2069 bidi controls — which are ordinary output
 * for a mixed-script model, and gpt-oss-120b, the model that caused #3973, is
 * one. A hand-picked list of invisible characters is the same mistake as a
 * hand-picked list of hyphens; only the category closes the class.
 *
 * U+00AD SOFT HYPHEN is in here by virtue of being `Cf`, and that is correct:
 * a soft hyphen is a LINE-BREAK HINT, not a hyphen. Folding it to "-" would
 * corrupt every word it appears inside ("ener\u00ADgized" -> "ener-gized"),
 * whereas removing it restores the word the model meant. The hazard grammars
 * already tolerate an absent hyphen ("re[-\s]?energi"), so stripping catches
 * "re\u00ADenergize" without inventing a hyphen anywhere.
 *
 * Safe to apply wholesale because this copy is never rendered: ZWJ emoji
 * sequences, Arabic number signs and language tags all lose nothing that a
 * SAFETY regex should have been matching on.
 */
const ZERO_WIDTH = /\p{Cf}/gu;

/**
 * Fold a string into the ASCII shape every rule in this file is written
 * against. **Detection only** — the returned string is never displayed,
 * persisted, or sent to a model. See `validateAnswer` in answer-validation.ts for why en/em dash are
 * excluded.
 */
export function foldForDetection(s: string): string {
  return s
    .replace(/[*`]/g, "")
    .replace(HYPHEN_EQUIV, "-")
    .replace(APOSTROPHE_EQUIV, "'")
    .replace(UNICODE_SPACE, " ")
    .replace(ZERO_WIDTH, "");
}
