import {
  itemKey,
  parentKey,
  resolveRequestKey,
  type BrowserItem,
  type BrowserPage,
  type BrowserRef,
  type EquipmentSource,
  type EquipmentSourceOptions,
  type ResolveRequest,
  type ResolveResult,
} from "@factorylm/interaction";

/**
 * A disconnected stand-in for the Hub equipment-browser API (#5602 README):
 * direct children, server-side substring search and exact resolve, each paged
 * with an opaque cursor. It plays the server, so it may hold the whole fixture;
 * the navigator only ever sees the pages it asks for.
 *
 * Fixture plant (sample data, not live equipment):
 * - Garage › Bench line › GS10 bench: the drive (VFD1) and MLC (Q1 relay) bench,
 *   plus deliberate negatives: a retired component, and Contactor K2, which is
 *   corrected (revision 1 → 2) right after the bench list first loads, so an
 *   "Ask about" from that list carries a stale revision and gets a 409.
 *
 * Resolve applies the equipment-browser checks to the request it is given, against
 * mutable current state: notebook membership, retirement, `expectedRevision`, and
 * the thread selection precondition (version, cleared, same component, same
 * revision). Nothing is refused by id. Whole notebooks resolve only when
 * `resolvesNotebooks` is set; the Hub API does not resolve them (400).
 * - Garage › Line 2: a second "VFD1" (duplicate tag) and an installed VFD1 with no
 *   notebook link.
 * - Garage › Flaky storeroom: its first children request fails, to show the error row.
 * - Lake Wales plant: 10 areas × 10 lines × 10 machines × 20 components = 20,000 components.
 * - One installed spare at the root with no placement.
 */

export const LARGE_PLANT = { areas: 10, linesPerArea: 10, machinesPerLine: 10, componentsPerMachine: 20 } as const;

export const BENCH_IDS = {
  garage: "ns-garage",
  benchLine: "ns-bench-line",
  bench: "nb-gs10-bench",
  vfd1: "nc-vfd1-bench",
  mlc: "nc-q1-mlc-bench",
  plc: "nc-plc1-bench",
  retired: "nc-k0-retired",
  stale: "nc-k2-corrected",
  moved: "nc-f3-selection",
  line2: "ns-line2",
  conveyor2Asset: "as-conveyor2",
  conveyor2: "nb-conveyor2",
  vfd1Line2: "nc-vfd1-line2",
  vfd1Installed: "ii-vfd1-line2",
  spare: "ii-spare-vfd",
  flaky: "ns-flaky",
  plant: "ns-lake-wales",
} as const;

type Row = Omit<BrowserItem, "childCount" | "place">;

function ref(kind: BrowserItem["kind"], id: string): BrowserRef {
  return { kind, id };
}

function buildRows(): Row[] {
  const b = BENCH_IDS;
  const rows: Row[] = [
    { kind: "namespace", id: b.garage, label: "Garage", parent: null },
    { kind: "namespace", id: b.benchLine, label: "Bench line", parent: ref("namespace", b.garage) },
    { kind: "notebook", id: b.bench, label: "GS10 bench", detail: "Drive and relay bench", parent: ref("namespace", b.benchLine) },
    { kind: "notebook_component", id: b.vfd1, label: "VFD1", detail: "AutomationDirect GS10 drive GS11N-20P2", parent: ref("notebook", b.bench), retiredAt: null },
    { kind: "notebook_component", id: b.mlc, label: "MLC", tag: "Q1", detail: "Schneider TeSys CA3KN22BD control relay", parent: ref("notebook", b.bench), retiredAt: null },
    { kind: "notebook_component", id: b.plc, label: "PLC1", detail: "Allen-Bradley Micro820", parent: ref("notebook", b.bench), retiredAt: null },
    { kind: "notebook_component", id: b.retired, label: "Contactor K0", detail: "Removed from the bench", parent: ref("notebook", b.bench), retiredAt: "2026-11-01T00:00:00Z" },
    { kind: "notebook_component", id: b.stale, label: "Contactor K2", detail: "Corrected right after the bench list loads", parent: ref("notebook", b.bench), retiredAt: null },
    { kind: "notebook_component", id: b.moved, label: "Fuse F3", detail: "Control fuse", parent: ref("notebook", b.bench), retiredAt: null },
    { kind: "namespace", id: b.line2, label: "Line 2", parent: ref("namespace", b.garage) },
    { kind: "asset", id: b.conveyor2Asset, label: "Conveyor 2", detail: "CMMS asset", parent: ref("namespace", b.line2) },
    { kind: "notebook", id: b.conveyor2, label: "Conveyor 2 notebook", parent: ref("asset", b.conveyor2Asset) },
    { kind: "notebook_component", id: b.vfd1Line2, label: "VFD1", detail: "AutomationDirect GS10 drive GS13N-20P2", parent: ref("notebook", b.conveyor2), retiredAt: null },
    { kind: "installed_instance", id: b.vfd1Installed, label: "VFD1", detail: "Installed GS10, no notebook link", parent: ref("asset", b.conveyor2Asset), resolution: { status: "unmapped", reason: "no_link" } },
    { kind: "namespace", id: b.flaky, label: "Flaky storeroom", parent: ref("namespace", b.garage) },
    { kind: "notebook", id: "nb-storeroom-shelf", label: "Storeroom shelf", parent: ref("namespace", b.flaky) },
    { kind: "installed_instance", id: b.spare, label: "Spare VFD", detail: "Unplaced installed drive", parent: null, resolution: { status: "unmapped", reason: "no_link" } },
    { kind: "namespace", id: b.plant, label: "Lake Wales plant", parent: null },
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let a = 1; a <= LARGE_PLANT.areas; a++) {
    const area = `ns-area-${pad(a)}`;
    rows.push({ kind: "namespace", id: area, label: `Area ${a}`, parent: ref("namespace", b.plant) });
    for (let l = 1; l <= LARGE_PLANT.linesPerArea; l++) {
      const line = `${area}-line-${pad(l)}`;
      rows.push({ kind: "namespace", id: line, label: `Line ${a}.${l}`, parent: ref("namespace", area) });
      for (let m = 1; m <= LARGE_PLANT.machinesPerLine; m++) {
        const machine = `nb-${a}-${l}-${m}`;
        rows.push({ kind: "notebook", id: machine, label: `Machine ${a}.${l}.${m}`, parent: ref("namespace", line) });
        for (let c = 1; c <= LARGE_PLANT.componentsPerMachine; c++) {
          rows.push({ kind: "notebook_component", id: `nc-${a}-${l}-${m}-${pad(c)}`, label: `M${a}.${l}.${m}-C${pad(c)}`, detail: c === 1 ? "GS10 drive" : "Component", parent: ref("notebook", machine), retiredAt: null });
        }
      }
    }
  }
  return rows;
}

export interface FakeEquipmentSourceOptions {
  readonly pageSize?: number;
  readonly latencyMs?: number;
  /** Resolve whole notebooks too (not something the Hub equipment-browser API does). */
  readonly resolvesNotebooks?: boolean;
  /** Called once per request, e.g. for the lab's adapter log. */
  readonly onCall?: (line: string) => void;
}

/** A stored thread selection, as `notebook_thread_selections` holds it. */
export interface FakeSelection {
  readonly componentId: string;
  readonly revision: number;
  readonly version: number;
  readonly cleared?: boolean;
}

export interface FakeEquipmentSource extends EquipmentSource {
  /** Largest page the source has returned so far. */
  readonly maxPageSeen: () => number;
  /** Current revision of a component (what a correction bumps). */
  readonly revisionOf: (componentId: string) => number;
  /** A correction: the component's current revision goes up by one. */
  readonly correct: (componentId: string) => void;
  /** Another tab/device changed this thread's selection in this notebook (Hub keys selections by both). */
  readonly setSelection: (notebookId: string, threadKey: string, selection: FakeSelection | null) => void;
}

const KIND_ORDER = ["namespace", "asset", "notebook", "notebook_component", "installed_instance"];

function compare(left: Row, right: Row): number {
  return KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function encodeCursor(offset: number, scope: string): string {
  return btoa(JSON.stringify({ offset, scope }));
}

function decodeCursor(cursor: string | null | undefined, scope: string): number {
  if (!cursor) return 0;
  const parsed = JSON.parse(atob(cursor)) as { offset: number; scope: string };
  if (parsed.scope !== scope) throw new Error("invalid_cursor");
  return parsed.offset;
}

export function createFakeEquipmentSource(options: FakeEquipmentSourceOptions = {}): FakeEquipmentSource {
  const pageSize = options.pageSize ?? 25;
  const latency = options.latencyMs ?? 0;
  let rows: Row[] | null = null;
  let byParent: Map<string, Row[]> | null = null;
  let byKey: Map<string, Row> | null = null;
  let flakyFailed = false;
  let benchListed = false;
  let maxPage = 0;
  const revisions = new Map<string, number>();
  const selections = new Map<string, FakeSelection>();
  const selectionKey = (notebookId: string, threadKey: string) => JSON.stringify([notebookId, threadKey]);
  const revisionOf = (id: string) => revisions.get(id) ?? 1;

  const ensure = () => {
    if (rows && byParent && byKey) return { rows, byParent, byKey };
    rows = buildRows().sort(compare);
    byParent = new Map();
    byKey = new Map();
    for (const row of rows) {
      byKey.set(itemKey(row), row);
      const key = parentKey(row.parent);
      byParent.set(key, [...(byParent.get(key) ?? []), row]);
    }
    return { rows, byParent, byKey };
  };

  const placeOf = (row: Row): string => {
    const { byKey } = ensure();
    const names: string[] = [];
    let parent = row.parent;
    while (parent) {
      const up = byKey.get(itemKey(parent));
      if (!up) break;
      names.unshift(up.label);
      parent = up.parent;
    }
    return names.join(" › ");
  };

  const toItem = (row: Row): BrowserItem => ({
    ...row,
    ...(row.kind === "notebook_component" ? { revision: revisionOf(row.id) } : {}),
    place: placeOf(row),
    childCount: ensure().byParent.get(itemKey(row))?.length ?? 0,
  });

  const wait = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    if (!latency) return resolve();
    const timer = setTimeout(resolve, latency);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
  });

  const page = (list: readonly Row[], scope: string, cursor: string | null | undefined): BrowserPage => {
    const offset = decodeCursor(cursor, scope);
    const slice = list.slice(offset, offset + pageSize);
    maxPage = Math.max(maxPage, slice.length);
    const end = offset + slice.length;
    const hasMore = end < list.length;
    return { items: slice.map(toItem), total: list.length, hasMore, nextCursor: hasMore ? encodeCursor(end, scope) : null };
  };

  const descendants = (scope: BrowserRef | null): Row[] => {
    const { rows, byParent } = ensure();
    if (!scope) return rows;
    const out: Row[] = [];
    const walk = (key: string) => {
      for (const child of byParent.get(key) ?? []) { out.push(child); walk(itemKey(child)); }
    };
    walk(itemKey(scope));
    return out.sort(compare);
  };

  const resolveNow = (request: ResolveRequest): ResolveResult => {
    const { byKey } = ensure();
    if (request.kind === "notebook") {
      if (!options.resolvesNotebooks) return { ok: false, reason: "error" }; // the Hub API answers 400
      const notebook = byKey.get(itemKey({ kind: "notebook", id: request.notebookId }));
      if (!notebook) return { ok: false, reason: "not_found" };
      return { ok: true, target: { machineId: notebook.id, machineLabel: notebook.label, componentId: null, componentLabel: null, location: placeOf(notebook) } };
    }
    const row = byKey.get(itemKey({ kind: "notebook_component", id: request.componentId }));
    const notebook = byKey.get(itemKey({ kind: "notebook", id: request.notebookId }));
    if (!row || !notebook || row.parent?.kind !== "notebook" || row.parent.id !== request.notebookId) return { ok: false, reason: "not_found" };
    if (row.retiredAt) return { ok: false, reason: "retired" };
    const current = revisionOf(row.id);
    if (request.expectedRevision !== undefined && request.expectedRevision !== current) return { ok: false, reason: "stale_revision" };
    if (request.selection) {
      const stored = selections.get(selectionKey(request.notebookId, request.selection.threadKey));
      if ((stored ? stored.version : null) !== request.selection.version
        || (stored && (stored.cleared || stored.componentId !== row.id || stored.revision !== current))) {
        return { ok: false, reason: "selection_changed" };
      }
    }
    return { ok: true, target: { machineId: notebook.id, machineLabel: notebook.label, componentId: row.id, componentLabel: row.label, location: placeOf(notebook) } };
  };

  return {
    ...(options.resolvesNotebooks ? { resolvesNotebooks: true } : {}),
    maxPageSeen: () => maxPage,
    revisionOf,
    correct: (id) => { revisions.set(id, revisionOf(id) + 1); },
    setSelection: (notebookId, threadKey, selection) => {
      const key = selectionKey(notebookId, threadKey);
      if (selection) selections.set(key, selection); else selections.delete(key);
    },
    async children(parent: BrowserRef | null, opts: EquipmentSourceOptions = {}) {
      const key = parentKey(parent);
      options.onCall?.(`browse:children ${key}${opts.cursor ? " +more" : ""}`);
      await wait(opts.signal);
      if (parent?.id === BENCH_IDS.flaky && !flakyFailed) {
        flakyFailed = true;
        throw new Error("fixture: storeroom children fail once");
      }
      const result = page(ensure().byParent.get(key) ?? [], `children:${key}`, opts.cursor);
      // Fixture story: someone corrects K2 just after the technician first sees the bench.
      if (parent?.id === BENCH_IDS.bench && !benchListed) { benchListed = true; revisions.set(BENCH_IDS.stale, revisionOf(BENCH_IDS.stale) + 1); }
      return result;
    },
    async search(query: string, scope: BrowserRef | null, opts: EquipmentSourceOptions = {}) {
      const needle = normalize(query);
      options.onCall?.(`browse:search "${needle}"${opts.cursor ? " +more" : ""}`);
      await wait(opts.signal);
      const hits = descendants(scope).filter((row) => [row.label, row.tag, row.detail].some((v) => v !== undefined && normalize(v).includes(needle)));
      return page(hits, `search:${parentKey(scope)}:${needle}`, opts.cursor);
    },
    async resolve(request: ResolveRequest, opts = {}): Promise<ResolveResult> {
      const revision = request.kind === "notebook_component" && request.expectedRevision !== undefined ? ` rev=${request.expectedRevision}` : "";
      options.onCall?.(`browse:resolve ${resolveRequestKey(request)}${revision}`);
      await wait(opts.signal);
      return resolveNow(request);
    },
  };
}
