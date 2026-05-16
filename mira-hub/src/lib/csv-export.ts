/**
 * Lightweight CSV serialiser — no external dependencies.
 * Follows RFC 4180 quoting: fields containing commas, double-quotes,
 * or newlines are wrapped in double-quotes; embedded double-quotes are
 * doubled.
 */

/**
 * Escape a single cell value for CSV output.
 */
export function csvEscape(value: unknown): string {
  const s = value == null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
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
