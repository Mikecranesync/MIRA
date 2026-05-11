/**
 * CSV asset register importer.
 *
 * Parses a CSV with columns: tag, name, manufacturer, model, serial_number, location
 * and bulk-creates assets in the tenant's Atlas store via the admin API.
 *
 * Built for the May 21 expo demo so prospects asking "can I bulk-import my
 * equipment list from a spreadsheet?" get a yes. Same shape MaintainX, UpKeep,
 * Limble, and Fiix all ship. (See docs/competitive/ingest-layer-comparison.md.)
 */

import { createAsset } from "./atlas.js";

interface AssetCSVRow {
  tag: string;
  name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  location: string;
}

interface ImportResult {
  imported: number;
  failed: number;
  errors: string[];
}

const MAX_ROWS = 500;

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

function parseCSV(text: string): AssetCSVRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0].toLowerCase();
  const headers = splitCSVLine(headerLine).map((h) => h.trim());

  const colMap: Record<string, number> = {};
  const expected = ["tag", "name", "manufacturer", "model", "serial_number", "location"];
  for (const col of expected) {
    const idx = headers.findIndex((h) => h === col);
    if (idx !== -1) colMap[col] = idx;
  }

  if (!("name" in colMap)) return [];

  const rows: AssetCSVRow[] = [];
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 1) continue;

    rows.push({
      tag: cols[colMap.tag ?? -1]?.trim() || "",
      name: cols[colMap.name ?? -1]?.trim() || "",
      manufacturer: cols[colMap.manufacturer ?? -1]?.trim() || "",
      model: cols[colMap.model ?? -1]?.trim() || "",
      serial_number: cols[colMap.serial_number ?? -1]?.trim() || "",
      location: cols[colMap.location ?? -1]?.trim() || "",
    });
  }

  return rows;
}

function buildDescription(row: AssetCSVRow): string {
  const parts: string[] = [];
  if (row.tag) parts.push(`Tag: ${row.tag}`);
  if (row.manufacturer) parts.push(`Manufacturer: ${row.manufacturer}`);
  if (row.serial_number) parts.push(`Serial: ${row.serial_number}`);
  return parts.join(" | ");
}

export async function importAssetCSV(
  csvText: string,
  atlasToken?: string,
): Promise<ImportResult> {
  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return {
      imported: 0,
      failed: 0,
      errors: ["No valid rows. Header must include 'name' (and optionally tag, manufacturer, model, serial_number, location)."],
    };
  }

  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (!row.name) {
      errors.push(`Row ${i + 2}: missing name`);
      failed++;
      continue;
    }

    try {
      await createAsset(
        {
          name: row.name,
          description: buildDescription(row),
          model: row.model || "",
          area: row.location || "",
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
