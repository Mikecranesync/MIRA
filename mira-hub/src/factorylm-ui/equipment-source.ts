/**
 * The Hub's EquipmentSource: the shared paged navigator over `/api/equipment-browser/*`
 * (capabilities/equipment-browser/README.md). Read-only: it lists, searches and
 * resolves; it never selects. Selecting stays with BenchComponents (one writer).
 *
 * The API resolves components only, so `resolvesNotebooks` is left unset and
 * notebooks are browse-only. While the MIRA_EQUIPMENT_NAV flag is off the routes
 * answer 404 and the host shows nothing (`equipmentNavAvailable`).
 */
import type {
  BrowserItem,
  BrowserItemKind,
  BrowserPage,
  BrowserRef,
  EquipmentSource,
  EquipmentSourceOptions,
  ResolveRequest,
  ResolveResult,
} from "@factorylm/interaction";
import { API_BASE } from "@/lib/config";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** One row as the equipment-browser API returns it (only the fields the navigator reads). */
export type ApiItem = {
  kind: BrowserItemKind;
  id: string;
  name: string;
  parent: { kind: BrowserItemKind | "root"; id: string | null };
  childrenCount: number;
  manufacturer?: string | null;
  model?: string | null;
  component?: {
    retiredAt: string | null;
    kind: string | null;
    current: { revision: number; localTag: string | null; rawLabel: string | null; manufacturer: string | null; family: string | null; catalogNumber: string | null } | null;
  };
  notebook?: { displayName: string; model: string | null; locationLabel: string | null };
  resolution?: { status: "unmapped"; reason: "no_link" };
};

type ApiPage = { items: ApiItem[]; counts: { total: number }; hasMore: boolean; nextCursor: string | null };

type ApiResolved =
  | {
    status: "resolved";
    notebook: { id: string; displayName: string; locationLabel: string | null };
    component: { id: string; kind: string | null; current: { localTag: string | null; rawLabel: string | null } | null };
  }
  | { status: "unmapped"; reason: "no_link" };

const join = (...parts: (string | null | undefined)[]) => parts.filter((p) => p && p.trim()).join(" ") || undefined;

/** Map one API row to the navigator's row. Revision: `component.current.revision ?? 0` (README). */
export function browserItemOf(row: ApiItem): BrowserItem {
  const parent: BrowserRef | null = row.parent.kind === "root" || !row.parent.id ? null : { kind: row.parent.kind, id: row.parent.id };
  const base = { kind: row.kind, id: row.id, label: row.name, parent, childCount: row.childrenCount };
  if (row.kind === "notebook_component" && row.component) {
    const current = row.component.current;
    return {
      ...base,
      tag: current?.localTag ?? undefined,
      detail: join(current?.manufacturer, current?.catalogNumber ?? current?.family),
      retiredAt: row.component.retiredAt,
      revision: current?.revision ?? 0,
    };
  }
  if (row.kind === "notebook" && row.notebook) return { ...base, detail: row.notebook.model ?? undefined };
  if (row.kind === "installed_instance") {
    return { ...base, detail: join(row.manufacturer, row.model), resolution: { status: "unmapped", reason: "no_link" } };
  }
  return { ...base, detail: join(row.manufacturer, row.model) };
}

async function errorCode(res: Response): Promise<string> {
  try {
    return String(((await res.json()) as { error?: unknown }).error ?? `http_${res.status}`);
  } catch {
    return `http_${res.status}`;
  }
}

/** Plain-language component name, the same order the list uses (local tag, then label, then kind). */
function componentLabel(c: { kind: string | null; current: { localTag: string | null; rawLabel: string | null } | null }): string {
  return c.current?.localTag || c.current?.rawLabel || c.kind || "Component";
}

/** 409/404 codes from the resolve route, in the navigator's words. */
export function resolveFailureOf(status: number, code: string): Extract<ResolveResult, { ok: false }>["reason"] {
  if (status === 409 && (code === "stale_revision" || code === "selection_changed")) return code;
  if (status === 409 && code === "component_retired") return "retired";
  if (status === 404 && code === "not_found") return "not_found";
  return "error";
}

export function resolveQuery(request: Extract<ResolveRequest, { kind: "notebook_component" }>): URLSearchParams {
  const q = new URLSearchParams({ targetKind: "notebook_component", notebookId: request.notebookId, componentId: request.componentId });
  if (request.expectedRevision !== undefined) q.set("expectedRevision", String(request.expectedRevision));
  // The server takes the version and the thread together, or neither.
  if (request.selection) {
    q.set("selectionVersion", request.selection.version === null ? "none" : String(request.selection.version));
    q.set("threadKey", request.selection.threadKey);
  }
  return q;
}

export function createHubEquipmentSource(fetchImpl: Fetch = (url, init) => fetch(url, init), base = `${API_BASE}/api/equipment-browser/`): EquipmentSource {
  const read = async (path: string, q: URLSearchParams, options?: EquipmentSourceOptions): Promise<BrowserPage> => {
    if (options?.cursor) q.set("cursor", options.cursor);
    const res = await fetchImpl(`${base}${path}?${q}`, { signal: options?.signal, cache: "no-store" });
    if (!res.ok) throw new Error(await errorCode(res));
    const page = (await res.json()) as ApiPage;
    return { items: page.items.map(browserItemOf), total: page.counts.total, hasMore: page.hasMore, nextCursor: page.nextCursor };
  };
  return {
    children: (parent, options) => read("children/",
      parent ? new URLSearchParams({ parentKind: parent.kind, parentId: parent.id }) : new URLSearchParams({ parentKind: "root" }), options),
    search: (query, scope, options) => read("search/",
      scope ? new URLSearchParams({ scopeKind: scope.kind, scopeId: scope.id, q: query }) : new URLSearchParams({ scopeKind: "root", q: query }), options),
    resolve: async (request, options) => {
      if (request.kind !== "notebook_component") return { ok: false, reason: "error" };
      const res = await fetchImpl(`${base}resolve/?${resolveQuery(request)}`, { signal: options?.signal, cache: "no-store" });
      if (!res.ok) return { ok: false, reason: resolveFailureOf(res.status, await errorCode(res)) };
      const body = (await res.json()) as ApiResolved;
      if (body.status !== "resolved") return { ok: false, reason: "no_link" };
      return {
        ok: true,
        target: {
          machineId: body.notebook.id,
          machineLabel: body.notebook.displayName,
          componentId: body.component.id,
          componentLabel: componentLabel(body.component),
          location: body.notebook.locationLabel ?? "",
        },
      };
    },
  };
}

/**
 * Whether to show the navigator: one smallest read must succeed. The flag-off 404, a
 * signed-out 401 or a failed read all hide it; nothing else in the Hub depends on it.
 */
export async function equipmentNavAvailable(fetchImpl: Fetch = (url, init) => fetch(url, init), base = `${API_BASE}/api/equipment-browser/`): Promise<boolean> {
  try {
    return (await fetchImpl(`${base}children/?parentKind=root&limit=1`, { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}
