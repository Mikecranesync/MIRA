/**
 * Candidate identity extraction — Manual-First PRD R1 (#4160 S5).
 *
 * Reads a candidate (manufacturer, part) from a LOOK observation, falling back
 * to the technician's typed text, WITHOUT consulting the corpus (the old
 * corpus-circular maker lookup is root cause RC1: a maker with no rows could
 * never be recognised, so its manual was never searched for).
 *
 * - Part: the serial-safe photo reader (`unambiguousPartNumber`, #4150) — one
 *   unambiguous part/catalog code; anything near a serial label is excluded,
 *   dates and voltage/range strings never qualify.
 * - Maker: the shared OEM maker table (`oemMakerTable`, the same entries that
 *   decide a maker's own documentation hosts). A maker name that is also an
 *   ordinary English word counts only in capitals, the way it is printed on a
 *   label; two different makers in one text are ambiguous and yield none.
 *
 * The result is a CANDIDATE — never identity. It may key a search; it is never
 * written to the notebook and never grounds an answer until the technician
 * confirms it (R2/R3).
 */
import { oemMakerTable } from "@/lib/manual-discovery";
import { catalogIdentifierView } from "./catalog-identifier";
import { modelNumbersIn } from "./manual-applicability";
import { modelIdentitiesInText } from "./model-token";
import { namesOnlyThisMachine, proposeIdentityFromText, type IdentityProposal } from "./identity-proposal";
import { reviewedManualFor } from "./reviewed-manual-library";
import {
  identifierKey,
  hasSeparateSerialField,
  labelledPartCodes,
  mentionsAssetLabel,
  mentionsSerialLabel,
  partLabelAfterPrivateLabel,
  partCodes,
  privateIdentifierKeys,
  privateSuffixTails,
  publicLabelText,
  serialCodes,
  unambiguousPartNumber,
  unwrapPartLabelMarkup,
} from "./photo-part-lookup";

export type CandidateIdentity = { manufacturer: string | null; part: string };

/** Maker names that are also everyday words: only an ALL-CAPS label print counts. */
const DICTIONARY_MAKERS = new Set(["sick", "banner", "parker", "eaton", "emerson", "phoenix"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How far (in words, same sentence) a TYPED dictionary-word maker may sit
 *  before the part code it names ("Banner Q4X sensor, part Q4XTBLAF300-Q8"). */
const TYPED_MAKER_MAX_GAP_WORDS = 4;

/** Words allowed between a typed dictionary-word maker and its part code. */
const TYPED_MAKER_GAP_WORDS = new Set([
  "part", "pn", "p/n", "model", "series", "cat", "catalog", "no", "number", "type", "a", "an", "the",
  "sensor", "sensors", "photo", "eye", "photoeye", "photocell", "prox", "proximity", "switch", "valve",
  "valves", "cylinder", "regulator", "manifold", "fitting", "relay", "drive", "vfd", "inverter", "motor",
  "gearmotor", "gearbox", "encoder", "controller", "plc", "module", "hmi", "panel", "pump", "actuator",
  "light", "curtain", "breaker", "contactor", "starter", "supply", "transmitter", "gauge", "filter",
  "safety", "pneumatic", "hydraulic",
]);

/** #4160 gate NO-GO: in a technician's TYPED text a dictionary-word maker
 *  ("Banner", "Sick") counts when it is capitalised and the part code follows
 *  in the same sentence within a few words — the way people write a model,
 *  not the way a label prints one. Lowercase never counts ("a banner"). */
function typedMakerNamesPart(text: string, matched: string, matchIndex: number, part: string): boolean {
  if (!/^[A-Z]/.test(matched)) return false;
  const after = text.slice(matchIndex + matched.length);
  const at = after.toUpperCase().indexOf(part.toUpperCase());
  if (at < 0) return false;
  const gap = after.slice(0, at);
  if (/[.!?\n]/.test(gap)) return false;
  const words = gap.split(/[\s,;:()]+/).filter(Boolean);
  if (words.length > TYPED_MAKER_MAX_GAP_WORDS) return false;
  // Codex #4184 F1: only a maker-to-part phrase may sit between them — an
  // equipment word ("valve", "sensor", "part") or a code-like token with a
  // digit (the family, "Q4X"). Anything else ("Sick of this …", "Banner is
  // wrong on …") means the word is being used as an ordinary word.
  return words.every((w) => /\d/.test(w) || TYPED_MAKER_GAP_WORDS.has(w.toLowerCase().replace(/[.#]$/, "")));
}

/** Every maker group (the OEM table's first domain) named in `text`, mapped to the
 *  longest matched name. Aliases of one maker share a group. `typedPart`: the
 *  text is the technician's typed message and this is the part it names, which
 *  enables the typed-text rule for dictionary-word makers above. */
function makerGroups(text: string, typedPart?: string, loose = false): Map<string, string> {
  const hits = new Map<string, string>(); // group (first domain) -> longest matched name
  for (const { name, domains } of oemMakerTable()) {
    const body = escape(name).replace(/\\-| /g, "[\\s-]+");
    const re = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi");
    const dictionary = DICTIONARY_MAKERS.has(name);
    const named = [...text.matchAll(re)].some(
      (m) =>
        !dictionary ||
        m[0] === m[0].toUpperCase() ||
        // `loose` (ambiguity check only): any capitalised mention counts.
        (loose && /^[A-Z]/.test(m[0])) ||
        (typedPart !== undefined && typedMakerNamesPart(text, m[0], m.index ?? 0, typedPart)),
    );
    if (!named) continue;
    const group = domains[0] ?? name;
    const prior = hits.get(group);
    if (!prior || name.length > prior.length) hits.set(group, name);
  }
  return hits;
}

/** The maker named in `text`, upper-cased as printed on a label, or null when
 *  none or more than one distinct maker is named. */
export function makerFromText(text: string, typedPart?: string): string | null {
  const hits = makerGroups(text, typedPart);
  if (hits.size !== 1) return null;
  // Codex #4184 F3: in TYPED text, any OTHER maker the technician capitalised
  // ("Sick or Banner Q4X…") makes the choice ambiguous — never pick one.
  if (typedPart !== undefined) {
    const [chosen] = hits.keys();
    if ([...makerGroups(text, undefined, true).keys()].some((g) => g !== chosen)) return null;
  }
  return [...hits.values()][0].toUpperCase();
}

/** #6127, #6131 r1 F2: every maker group (the OEM table's first domain) `text` names, mapped to a
 *  name matched for it, by the reading `makerFromText` uses, with a dictionary-word maker also
 *  counted when it is typed right before one of `parts` (the typed-text rule above). Aliases of
 *  one maker are one group. */
export function makerGroupsNamedIn(text: string, parts: readonly string[] = []): Map<string, string> {
  const groups = makerGroups(text);
  for (const part of parts) for (const [group, name] of makerGroups(text, part)) if (!groups.has(group)) groups.set(group, name);
  return groups;
}

export function extractCandidateIdentity(observation: string, typed = ""): CandidateIdentity | null {
  const fromPhoto = unambiguousPartNumber(observation);
  const part = fromPhoto ?? (typed ? unambiguousPartNumber(typed) : null);
  if (!part) return null;
  // The typed text gets the typed-maker rule (#4160 gate); a label keeps the
  // capitals-only rule for dictionary-word makers.
  const own = fromPhoto ? makerFromText(observation) : makerFromText(typed, part);
  const other = fromPhoto ? makerFromText(typed, part) : makerFromText(observation);
  const manufacturer = own && other && own !== other ? null : (own ?? other);
  return { manufacturer, part };
}

/**
 * Does the technician's own typed text ask for the manual/documentation
 * itself, rather than a troubleshooting question about the part (#4160 S6,
 * PRD R2)? One half of the trigger for a candidate-basis background manual
 * search — the other half is the identity having come from a label read (a
 * photo observation), checked separately by the caller. Deterministic and
 * narrow by design (zero-token-architecture): this gates a background side
 * effect, not an answer, so a miss just means the search waits for the next
 * turn or an explicit ask — never a wrong answer.
 */
const MANUAL_PUBLICATION = String.raw`(?:manuals?|documentation|docs?|pdfs?|datasheet|data\s+sheet|spec\s+sheet|user\s+guide|user(?:['’]s)?\s+manual|service\s+manual|install(?:ation)?\s+guide)`;
const MANUAL_INTENT_RE = new RegExp(String.raw`\b(?:${MANUAL_PUBLICATION}|instructions?)\b`, "i");
const MANUAL_REQUEST_START = String.raw`^(?:(?:can|could|would)[ \t]+you[ \t]+|please[ \t]+)*`;
const MANUAL_REQUEST_VERB = String.raw`(?:find|get|open|show|send|look up|give|(?:i[ \t]+)?(?:need|want)|do you have|where (?:can|do) i (?:find|get))[ \t]+(?:me[ \t]+)?`;
const MANUAL_REQUEST_END = String.raw`(?:,?[ \t]+please)?[.!?]*$`;
const MANUAL_REQUEST_RE = new RegExp(
  String.raw`${MANUAL_REQUEST_START}(?:${MANUAL_REQUEST_VERB})?(?:(?:the|a|an)[ \t]+)?(?:official[ \t]+)?${MANUAL_PUBLICATION}(?:[ \t]+(?:for|of|on)[ \t]+([^\r\n]+?))?${MANUAL_REQUEST_END}`,
  "i",
);
const NAMED_MANUAL_REQUEST_RE = new RegExp(
  String.raw`${MANUAL_REQUEST_START}${MANUAL_REQUEST_VERB}([^\r\n]+?)[ \t]+${MANUAL_PUBLICATION}${MANUAL_REQUEST_END}`,
  "i",
);
const MANUAL_DEVICE = String.raw`(?:drive|vfd|plc|hmi|motor|inverter|controller|panel|valve|relay|sensor|module|pump|machine|equipment|device|unit|part|nameplate|photo|picture)`;
const MANUAL_MAKER = oemMakerTable().map(({ name }) => escape(name).replace(/\\-| /g, "[ \\t-]+")).join("|");
const MANUAL_MODEL_CODE = String.raw`(?=[a-z0-9./+-]{0,31}\d)[a-z0-9][a-z0-9./+-]{0,31}`;
const MANUAL_IDENTIFIER_LABEL = String.raw`(?:model|part|catalog|order)`;
const MANUAL_IDENTIFIER_FIELD = String.raw`(?:${MANUAL_IDENTIFIER_LABEL}(?:[ \t]+(?:number|no\.?|code))?(?:[ \t]*[:#][ \t]*|[ \t]+))?`;
const MANUAL_IDENTIFIER_NO = new RegExp(
  String.raw`^((?:(?:${MANUAL_MAKER})[ \t]+)?${MANUAL_IDENTIFIER_LABEL}[ \t]+no)\.(?=[ \t:#])`,
  "i",
);
const MANUAL_REFERENCE_RE = new RegExp(
  String.raw`^(?:this|that|it|(?:(?:pictured|attached)[ \t]+)?${MANUAL_DEVICE}(?:[ \t]+(?:in|from)[ \t]+(?:this|the|my|your)[ \t]+(?:photo|picture))?|${MANUAL_MAKER})$`,
  "i",
);
const MANUAL_MODEL_REFERENCE_RE = new RegExp(
  // A compact code or a printed split code such as SLC 5/03, with at most one adjacent catalog code.
  String.raw`^(?:(?:${MANUAL_MAKER})[ \t]+)?${MANUAL_IDENTIFIER_FIELD}(?:${MANUAL_MODEL_CODE}|([a-z]{2,8})[ \t]+[0-9][0-9./+-]{0,11})(?:[ \t]+(${MANUAL_MODEL_CODE}))?(?:[ \t]+${MANUAL_DEVICE})?$`,
  "i",
);
const DIRECT_MANUAL_IDENTITY_RE = new RegExp(
  String.raw`^(?:${MANUAL_MAKER})[ \t]+${MANUAL_IDENTIFIER_FIELD}(${MANUAL_MODEL_CODE})(?:[ \t]+${MANUAL_DEVICE})?$`,
  "i",
);
const REVIEWED_MANUAL_REFERENCE_RE = new RegExp(
  String.raw`^(${MANUAL_MAKER})[ \t]+([a-z0-9][a-z0-9./+\- \t]*?)[ \t]+(${MANUAL_MODEL_CODE})$`,
  "i",
);

export function wantsManualDocumentation(message: string): boolean {
  return MANUAL_INTENT_RE.test(message);
}

function manualRequestSubject(message: string): string | undefined {
  const text = message.trim();
  const request = MANUAL_REQUEST_RE.exec(text);
  return (request ? (request[1] ?? "") : NAMED_MANUAL_REQUEST_RE.exec(text)?.[1])
    ?.replace(/^(?:(?:the|a|an|my|this|that)[ \t]+)?(?:official[ \t]+)?/i, "");
}

function reviewedManualIdentityFromSubject(subject: string): IdentityProposal | null {
  const match = REVIEWED_MANUAL_REFERENCE_RE.exec(catalogIdentifierView(subject).text);
  if (!match) return null;
  const [, manufacturer, product, order] = match;
  const catalogNumber = order.toUpperCase();
  const reviewed = reviewedManualFor({ manufacturer, model: product.trim().replace(/[ \t]+/g, " "), catalogNumber });
  return reviewed && { manufacturer: reviewed.manufacturer.toUpperCase(), model: catalogNumber };
}

/** A request for the document itself, as opposed to a question about its contents. */
export function asksToFindManual(message: string): boolean {
  const subject = manualRequestSubject(message);
  if (subject === undefined || /[.!?][ \t]+\S/.test(subject.replace(MANUAL_IDENTIFIER_NO, "$1"))) return false;
  // A remaining clause could ask about the manual. Accept only a whole equipment reference.
  if (!subject || MANUAL_REFERENCE_RE.test(subject) || reviewedManualIdentityFromSubject(subject)) return true;
  const model = MANUAL_MODEL_REFERENCE_RE.exec(subject);
  if (!model || (model[1] && model[1] !== model[1].toUpperCase())) return false;
  const catalog = model[2];
  // A second token needs catalog-number evidence. A number followed by a unit can look like a model.
  return !catalog || (/[a-z]\d/i.test(catalog) && partCodes(catalog).includes(catalog));
}

// Spaced or segmented standards on equipment labels can resemble a model.
// Keep the following text visible to the competing-model check.
const NAMEPLATE_STANDARD = /\b(?:IEC|EN|ISO|UL|CSA|NEMA|ANSI|BS|VDE|JIS|DIN)[ \t-]*[A-Z]?\d+(?:[.-]\d+)*[A-Z]?(?:[ \t]+No\.?[ \t]+\d+)?\b/gi;
const NUMBER_LED_MARKING = /\b\d(?=[A-Z0-9-]*[A-Z])[A-Z0-9]*(?:-[A-Z0-9]+)*\b/gi;

function photoTextForModelComparison(photo: string): string {
  // Keep a placeholder when a serial itself looks like a rating so the
  // comparison reader does not take the next line as the serial.
  return catalogIdentifierView(photo).text
    .replace(NAMEPLATE_STANDARD, "_")
    .replace(NUMBER_LED_MARKING, (marking) => modelNumbersIn(marking).length ? marking : "_");
}

/**
 * Select the exact identity for a manual request from either input. A single
 * explicitly labelled photo model can be offered for confirmation even if the
 * loose prose scan sees other tokens on the plate. That exception never grants
 * permission to start an automatic external search.
 */
export function exactManualIdentity(photo: string, typed: string): IdentityProposal | null {
  // LOOK can wrap individual printed fields in Markdown. Keep the field and
  // private-data rules applied to the unwrapped reading. Egress still checks
  // the original observation independently before starting a search.
  const displayed = catalogIdentifierView(unwrapPartLabelMarkup(photo)).text;
  if ((mentionsSerialLabel(photo) && !mentionsSerialLabel(displayed)) ||
      (mentionsAssetLabel(photo) && !mentionsAssetLabel(displayed))) return null;
  photo = displayed;
  if (!photo && !mentionsSerialLabel(typed) && !mentionsAssetLabel(typed)) {
    const subject = manualRequestSubject(typed);
    const reviewed = subject && reviewedManualIdentityFromSubject(subject);
    if (reviewed && !modelIsPrivate(typed, reviewed.model)) return reviewed;
    const direct = subject && DIRECT_MANUAL_IDENTITY_RE.exec(catalogIdentifierView(subject).text);
    if (direct) {
      const model = direct[1].toUpperCase();
      const manufacturer = makerFromText(typed, model);
      if (manufacturer && (modelNumbersIn(model).length || modelIdentitiesInText(model).size) && !modelIsPrivate(typed, model)) {
        return { manufacturer, model };
      }
    }
  }
  const candidate = extractCandidateIdentity(photo, typed);
  // Many makers use compact model names that the part-number scanner does not
  // recognize. A reviewed record can support displaying a confirmation card.
  if (!candidate) {
    if (mentionsAssetLabel(photo) || partLabelAfterPrivateLabel(photo) ||
        mentionsSerialLabel(typed) || mentionsAssetLabel(typed)) return null;
    const publicPhoto = publicLabelText(photo);
    const text = photo ? `${photoTextForModelComparison(publicPhoto)}\n${typed}` : typed;
    const maker = makerFromText(text);
    const proposal = maker && proposeIdentityFromText(text, [maker]);
    if (!proposal || !reviewedManualFor(proposal)) return null;
    if (photo) {
      if (makerFromText(publicPhoto) !== maker) return null;
      // Only the public prefix can propose a compact model. Scan the full
      // photo to veto competing model-shaped markings. The shared comparison
      // reader excludes the actual serial value.
      if (!namesOnlyThisMachine(photoTextForModelComparison(photo), proposal.model)) return null;
    }
    return modelIsPrivate(photo, proposal.model) && !hasSeparateSerialField(photo, proposal.model) ? null : proposal;
  }
  if (!candidate?.manufacturer) return null;
  if (isSafeCandidateSearchIdentity(photo, typed, candidate.part, candidate.manufacturer)) {
    return { manufacturer: candidate.manufacturer, model: candidate.part };
  }

  const { part, manufacturer } = candidate;
  const key = part.toUpperCase();
  const labelled = labelledPartCodes(photo);
  const reviewed = reviewedManualFor({ manufacturer, model: part });
  if (
    !photo ||
    makerFromText(photo) !== manufacturer ||
    (!reviewed && mentionsSerialLabel(photo)) ||
    unambiguousPartNumber(photo)?.toUpperCase() !== key ||
    labelled.length !== 1 ||
    labelled[0] !== key ||
    mentionsAssetLabel(photo) || partLabelAfterPrivateLabel(photo) ||
    modelIsPrivate(photo, part) ||
    !isSafeCandidateSearchIdentity("", `${manufacturer} MODEL: ${part}\n${typed}`, part, manufacturer)
  ) return null;

  // A reviewed family marking can describe this same labelled order number.
  // Compare exact identities too: another order number in the same series is
  // still a competing model even if the single-token resolver folds both.
  if (reviewed?.families?.length) {
    const exactIdentities = modelIdentitiesInText(part);
    for (const identity of modelIdentitiesInText(photo)) {
      if (!exactIdentities.has(identity) && !reviewed.families.includes(identity)) return null;
    }
  } else if (!namesOnlyThisMachine(photoTextForModelComparison(photo), part)) {
    return null;
  }

  return { manufacturer, model: part };
}

function modelIsPrivate(text: string, model: string): boolean {
  const key = identifierKey(model);
  return [...privateIdentifierKeys(text), ...privateSuffixTails(text)].some((value) => value.includes(key));
}

/**
 * May `part` leave MIRA as an automatic, pre-confirmation manual-search identity,
 * given the photo observation and the technician's typed text (#4172)? The ONE
 * gate every candidate-basis proposal and acquisition passes. Strict by owner
 * decision after six review rounds — all must hold, else no automatic search
 * (a confirmed identity still searches through the existing confirmed path):
 *  - the serial-safe part codes across BOTH texts are exactly `part` — so the
 *    identity came from the serial-safe reader (which never yields a code
 *    under a serial or asset-tag label, ADR-0036), and two codes are
 *    ambiguity, never absence. A serial label on the plate is the normal
 *    case, not a refusal (owner decision 2026-11-07): every real nameplate
 *    carries one, and the labelled model beside it is still the part — but a
 *    code EITHER text marks as a serial is refused outright, even typed back
 *    unlabelled in the other (`serialCodes`, Codex post-cap F6);
 *  - the photo and typed text TOGETHER name no other machine
 *    (proposeIdentityFromText's multi-machine rejection);
 *  - neither text names a maker other than `manufacturer` (aliases of one maker
 *    share an OEM-table group); a proposed maker the table cannot place is
 *    never checked against a maker the text does name — fail closed.
 */
export function isSafeCandidateSearchIdentity(photoText: string, typed: string, part: string, manufacturer: string): boolean {
  const key = part.trim().toUpperCase();
  if (!key) return false;
  const texts = [photoText, typed].filter(Boolean);
  // A code either text marks as a serial never leaves, even when the OTHER
  // text carries it unlabelled — the technician typing the photo's serial back
  // does not launder it (#4172 Codex post-cap F6, ADR-0036).
  if (texts.some((t) => serialCodes(t).includes(key))) return false;
  // #5268 Codex F1: nor may a serial or asset-tag value from either text come
  // back under another label ("MODEL: 12345678") or with its punctuation or
  // spaces changed (AB-1234567 → AB1234567, "TP 1200" → TP1200).
  const keyNorm = identifierKey(key);
  // r5: nor any FRAGMENT of one ("Asset tag: PN12345678" → 12345678).
  if (texts.some((t) => [...privateIdentifierKeys(t)].some((k) => k.includes(keyNorm)))) return false;
  // r11/r12: nor a value a bare suffix label marks, of any spacing, wrapping
  // or qualifier ("TP 1200\n(asset tag)", "T P 12 00 (customer S/N)").
  if (texts.some((t) => privateSuffixTails(t).some((tail) => tail.includes(keyNorm)))) return false;
  // #5268 Codex r4 — the structural wall. Once EITHER text carries a serial or
  // asset label, eligibility comes only from the PHOTO's own part label
  // (P/N, MODEL, …). Typed text then grants nothing, so no spelling, spacing
  // or relabelling of a private value typed back can make it searchable. A
  // turn with no private label anywhere is unaffected.
  // #5268 Codex r13 — owner decision 2026-11-07: a plate or message that shows
  // a serial or asset-tag label never starts the automatic search. Twelve
  // rounds each found a new way to word a private value beside the model;
  // the technician confirms the identity instead.
  if (texts.some((t) => mentionsSerialLabel(t) || mentionsAssetLabel(t))) return false;
  if (texts.some(partLabelAfterPrivateLabel)) return false;
  // #5268 Codex r9: the technician's own words naming a serial or asset tag
  // ("TP 1200 (asset tag)") turn the automatic search off — typed text can
  // mark a value private but never vouch for one.
  if (mentionsSerialLabel(typed) || mentionsAssetLabel(typed)) return false;
  const codes = new Set(texts.flatMap((t) => partCodes(t).map((c) => c.toUpperCase())));
  if (codes.size !== 1 || !codes.has(key)) return false;
  const proposed = new Set(makerGroups(manufacturer).keys());
  // Codex #4184 F3: the typed text is read loosely (any capitalised maker
  // word), so coordinated alternatives ("Sick or Banner") are a contradiction.
  const named = [
    ...(photoText ? [...makerGroups(photoText).keys()] : []),
    ...(typed ? [...makerGroups(typed, undefined, true).keys()] : []),
  ];
  if (named.some((g) => !proposed.has(g))) return false;
  return namesOnlyThisMachine(texts.join("\n"), part);
}
