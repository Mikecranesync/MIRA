/**
 * CSV historical work order importer.
 *
 * Parses a CSV file with columns: date, title, description, priority, asset, category
 * and bulk-creates work orders in the tenant's Atlas store via the admin API.
 */

import { createWorkOrder } from "./atlas.js";

interface CSVRow {
  date: string;
  title: string;
  description: string;
  priority: string;
  asset: string;
  category: string;
}

interface ImportResult {
  imported: number;
  failed: number;
  errors: string[];
}

const VALID_PRIORITIES = new Set(["NONE", "LOW", "MEDIUM", "HIGH"]);
const VALID_CATEGORIES = new Set([
  "CORRECTIVE", "PREVENTIVE", "CONDITION_BASED", "EMERGENCY",
]);
const MAX_ROWS = 500;

function parseCSV(text: string): CSVRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0].toLowerCase();
  const headers = splitCSVLine(headerLine);

  const colMap: Record<string, number> = {};
  const expected = ["date", "title", "description", "priority", "asset", "category"];
  for (const col of expected) {
    const idx = headers.findIndex((h) => h.trim() === col);
    if (idx !== -1) colMap[col] = idx;
  }

  if (!("title" in colMap) || !("description" in colMap)) {
    return [];
  }

  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 2) continue;

    rows.push({
      date: cols[colMap.date ?? -1]?.trim() || "",
      title: cols[colMap.title ?? -1]?.trim() || "",
      description: cols[colMap.description ?? -1]?.trim() || "",
      priority: (cols[colMap.priority ?? -1]?.trim() || "MEDIUM").toUpperCase(),
      asset: cols[colMap.asset ?? -1]?.trim() || "",
      category: (cols[colMap.category ?? -1]?.trim() || "CORRECTIVE").toUpperCase(),
    });
  }

  return rows;
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function importCSV(
  csvText: string,
  atlasToken?: string,
): Promise<ImportResult> {
  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return { imported: 0, failed: 0, errors: ["No valid rows found. Ensure CSV has 'title' and 'description' columns."] };
  }

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (!row.title) {
      errors.push(`Row ${i + 2}: missing title`);
      failed++;
      continue;
    }

    const priority = VALID_PRIORITIES.has(row.priority)
      ? (row.priority as "NONE" | "LOW" | "MEDIUM" | "HIGH")
      : "MEDIUM";
    const category = VALID_CATEGORIES.has(row.category)
      ? row.category
      : "CORRECTIVE";

    const desc = row.date
      ? `[${row.date}] ${row.description}`
      : row.description;

    try {
      await createWorkOrder(
        {
          title: row.title,
          description: desc || row.title,
          priority,
          category,
          status: "COMPLETE",
        },
        atlasToken,
      );
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${i + 2}: ${msg.slice(0, 100)}`);
      failed++;
    }

    if ((i + 1) % 10 === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return { imported, failed, errors: errors.slice(0, 20) };
}
