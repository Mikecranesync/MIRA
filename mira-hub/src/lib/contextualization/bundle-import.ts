/**
 * Parse a Factory Context Bundle (bundle@1) file map into rows for the Hub contextualization tables.
 *
 * Pure + unit-testable (no DB, no zip). The route unzips the upload and calls parseBundle, then
 * inserts a project + ctx_sources + ctx_extractions inside withTenantContext. Imported extractions
 * keep their offline accept/reject status so a human can re-review or run the existing Promote flow.
 */

export interface ImportSource {
  fileName: string;
  sourceType: string;
  status: string;
}

export interface ImportExtraction {
  tagName: string;
  roles: string[];
  unsPathProposed: string | null;
  i3xElementId: string | null;
  evidenceJson: Record<string, unknown>;
  confidence: number | null;
  status: "pending" | "accepted" | "rejected";
  sourceFile: string | null;
}

export interface ParsedBundle {
  projectName: string;
  description: string | null;
  sources: ImportSource[];
  extractions: ImportExtraction[];
}

const VALID_STATUS = new Set(["pending", "accepted", "rejected"]);
const VALID_SOURCE_TYPE = new Set(["l5x", "st", "plcopen", "csv", "manual", "other"]);

function parseJson(files: Record<string, string>, name: string): Record<string, unknown> {
  const raw = files[name];
  if (raw == null) throw new Error(`bundle missing ${name}`);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`bundle ${name} is not valid JSON`);
  }
}

/** Validate + normalize a bundle's manifest.json + review.json into insertable rows. */
export function parseBundle(files: Record<string, string>): ParsedBundle {
  const manifest = parseJson(files, "manifest.json");
  const schema = String(manifest.schema ?? "");
  if (!schema.startsWith("mira-contextualizer/bundle@")) {
    throw new Error("not a Factory Context Bundle (bad manifest schema)");
  }
  const project = (manifest.project ?? {}) as Record<string, unknown>;
  const projectName = (typeof project.name === "string" && project.name.trim()) || "Imported project";
  const description = typeof project.description === "string" ? project.description : null;

  const rawSources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const sources: ImportSource[] = rawSources.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const fileName = String(o.file ?? "").trim() || "unknown";
    const t = String(o.type ?? "other");
    return {
      fileName,
      sourceType: VALID_SOURCE_TYPE.has(t) ? t : "other",
      status: String(o.status ?? "done"),
    };
  });

  const review = parseJson(files, "review.json");
  const decisions = Array.isArray(review.decisions) ? review.decisions : [];
  const extractions: ImportExtraction[] = decisions.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const status = String(o.status ?? "pending");
    const conf = o.confidence;
    return {
      tagName: String(o.tag ?? "").trim(),
      roles: Array.isArray(o.roles) ? o.roles.map(String) : [],
      unsPathProposed: typeof o.unsPath === "string" ? o.unsPath : null,
      i3xElementId: typeof o.unsPath === "string" ? o.unsPath : null,
      evidenceJson: (o.evidence ?? {}) as Record<string, unknown>,
      confidence: typeof conf === "number" ? conf : null,
      status: (VALID_STATUS.has(status) ? status : "pending") as ImportExtraction["status"],
      sourceFile: typeof o.source === "string" ? o.source : null,
    };
  }).filter((e) => e.tagName);

  return { projectName, description, sources, extractions };
}
