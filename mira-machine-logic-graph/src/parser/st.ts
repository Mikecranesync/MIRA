/**
 * Minimal Structured Text (ST / IEC 61131-3) parser scoped to what
 * Micro820/CCW emits. We extract two things:
 *
 *   1. Declared variables from VAR_GLOBAL/VAR_INPUT/VAR_OUTPUT/VAR blocks
 *      (CCW often omits VAR blocks from .stf because the declarations
 *      live in PrjLibrary.accdb / the CCW Controller Variables table).
 *   2. Referenced identifiers from program body — assignment targets
 *      and right-hand-side reads. This is what we use when the .stf
 *      has no VAR block: parse the body, then cross-reference with
 *      an external manifest for type/address.
 *
 * Not a real ST parser. Tokenizer + regex pass. Sufficient for tag
 * extraction; will be replaced when we need full semantic analysis.
 */

export type StScope =
  | "VAR_GLOBAL"
  | "VAR_INPUT"
  | "VAR_OUTPUT"
  | "VAR_IN_OUT"
  | "VAR_EXTERNAL"
  | "VAR";

export interface ParsedStVariable {
  name: string;
  dataType: string;
  scope: StScope;
  initialValue: string | null;
  comment: string | null;
}

export interface ParsedStFile {
  programName: string | null;
  variables: ParsedStVariable[];
  referencedIdentifiers: string[];
}

const VAR_BLOCK_RE =
  /\b(VAR_GLOBAL|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR)\b([\s\S]*?)\bEND_VAR\b/gi;

const PROGRAM_RE = /\bPROGRAM\s+([A-Za-z_][A-Za-z0-9_]*)/i;

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

const ST_KEYWORDS = new Set([
  "AND", "OR", "NOT", "XOR", "MOD",
  "IF", "THEN", "ELSE", "ELSIF", "END_IF",
  "CASE", "OF", "END_CASE",
  "FOR", "TO", "BY", "DO", "END_FOR",
  "WHILE", "END_WHILE",
  "REPEAT", "UNTIL", "END_REPEAT",
  "RETURN", "EXIT", "CONTINUE",
  "TRUE", "FALSE",
  "BOOL", "INT", "DINT", "UINT", "UDINT", "REAL", "STRING", "TIME", "BYTE", "WORD", "DWORD",
  "PROGRAM", "END_PROGRAM",
  "FUNCTION", "END_FUNCTION",
  "FUNCTION_BLOCK", "END_FUNCTION_BLOCK",
  "VAR", "VAR_GLOBAL", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_EXTERNAL", "END_VAR",
  "RETAIN", "CONSTANT",
]);

function stripComments(src: string): string {
  // Block comments (* ... *) — non-greedy, can span lines.
  let out = src.replace(/\(\*[\s\S]*?\*\)/g, " ");
  // Line comments // ...
  out = out.replace(/\/\/[^\n]*/g, " ");
  return out;
}

function parseVarBlock(scope: StScope, body: string): ParsedStVariable[] {
  const vars: ParsedStVariable[] = [];
  // Each declaration ends at a semicolon. Comments already stripped.
  const lines = body.split(";");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Pattern: name : TYPE [:= initial]
    const m = line.match(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_\[\]\.]*)(?:\s*:=\s*([^;]+?))?\s*$/,
    );
    if (!m) continue;
    vars.push({
      name: m[1],
      dataType: m[2],
      scope,
      initialValue: m[3] ? m[3].trim() : null,
      comment: null,
    });
  }
  return vars;
}

export function parseStructuredText(source: string): ParsedStFile {
  const stripped = stripComments(source);

  const programMatch = stripped.match(PROGRAM_RE);
  const programName = programMatch ? programMatch[1] : null;

  const variables: ParsedStVariable[] = [];
  let varBlocksText = "";
  let m: RegExpExecArray | null;
  // Reset lastIndex (regex has /g flag).
  VAR_BLOCK_RE.lastIndex = 0;
  while ((m = VAR_BLOCK_RE.exec(stripped)) !== null) {
    const scope = m[1].toUpperCase() as StScope;
    varBlocksText += m[0] + "\n";
    variables.push(...parseVarBlock(scope, m[2]));
  }

  // Body = everything that wasn't inside a VAR..END_VAR block.
  const body = stripped.replace(VAR_BLOCK_RE, " ");
  const idents = new Set<string>();
  const idMatches = body.match(IDENT_RE) || [];
  for (const id of idMatches) {
    if (ST_KEYWORDS.has(id.toUpperCase())) continue;
    if (/^\d/.test(id)) continue;
    idents.add(id);
  }

  return {
    programName,
    variables,
    referencedIdentifiers: [...idents].sort(),
  };
}
