/**
 * Lightweight CSV serialiser — no external dependencies.
 * Follows RFC 4180 quoting: fields containing commas, double-quotes,
 * or newlines are wrapped in double-quotes; embedded double-quotes are
 * doubled. Cells are first neutralised against spreadsheet formula
 * injection (see `neutralizeFormula`).
 */

// A cell whose first character is one of these is auto-evaluated as a formula
// by Excel / Google Sheets / LibreOffice when the exported file is opened —
// the CSV / formula-injection attack (DDE, HYPERLINK exfiltration, etc.).
// TAB (\t) and CR (\r) are included because some spreadsheets strip a leading
// whitespace control char and then see the formula char behind it.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Neutralise spreadsheet formula injection by prefixing a dangerous cell with a
 * single quote, so the spreadsheet renders it as literal text instead of
 * evaluating it. Legitimate signed numbers (e.g. "-5", "+12", "-3.14") are left
 * intact — a finite number is a value, never a formula payload.
 * OWASP: https://owasp.org/www-community/attacks/CSV_Injection
 */
export function neutralizeFormula(s: string): string {
  if (s === "" || !FORMULA_LEAD.test(s)) return s;
  // Preserve genuine signed numbers — only "-"/"+" leads can be a real number,
  // and only when the whole cell parses as one. "=", "@", TAB, CR never can.
  if ((s[0] === "-" || s[0] === "+") && Number.isFinite(Number(s))) return s;
  return `'${s}`;
}

/**
 * Escape a single cell value for CSV output.
 */
export function csvEscape(value: unknown): string {
  const raw = value == null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  const s = neutralizeFormula(raw);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialise an array of flat objects to a CSV string.
 * The column order follows the keys of the first row.
 * Returns an empty string for an empty array.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

/**
 * Build a Response with the correct CSV headers.
 */
export function csvResponse(content: string, filename: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
