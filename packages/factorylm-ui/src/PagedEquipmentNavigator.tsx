import {
  askabilityOf,
  branchesReducer,
  EMPTY_BRANCH,
  itemKey,
  parentKey,
  refusalNeedsRefresh,
  repeatedLabelKeys,
  resolveFailureText,
  resolveRequestOf,
  targetKeyOf,
  type BrowserItem,
  type BrowserPage,
  type BrowserRef,
  type EquipmentSource,
  type QuestionTarget,
  type ResolveFailureReason,
  type SelectionPrecondition,
} from "@factorylm/interaction";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronIcon, FolderIcon, MachineIcon, SearchIcon } from "./icons";

/** A refused "Ask about": shown to the technician, never retried by the UI. */
export interface EquipmentAskNotice {
  readonly itemKey: string;
  /** The row as it was when refused; lets the navigator offer to load its current record. */
  readonly item: BrowserItem;
  readonly reason: ResolveFailureReason;
  readonly text: string;
}

/** A technician's request to reload a refused row's list; the navigator carries it out. */
export interface EquipmentRefreshRequest {
  readonly item: BrowserItem;
  /** Bumped per press, so pressing twice reloads twice. */
  readonly sequence: number;
}

export interface EquipmentAskController {
  /** Key of the row whose resolve is in flight, if any. */
  readonly pendingKey: string | null;
  /** Label of that row, so every Ask control can say what is being checked. */
  readonly pendingLabel: string | null;
  readonly notice: EquipmentAskNotice | null;
  /** One explicit resolve. On success the host's onAskAbout runs; on refusal a notice is set. */
  readonly ask: (item: BrowserItem) => void;
  readonly dismiss: () => void;
  /** Latest "Load current record" press, from the drawer or the composer notice. */
  readonly refreshRequest: EquipmentRefreshRequest | null;
  /** Reload the list a refused row came from. Never resolves; clears the notice. */
  readonly requestRefresh: (item: BrowserItem) => void;
  /**
   * The navigator's answer to a refresh: the current record, or null when it could
   * not be read back. Null shows a notice; the refused snapshot stays unaskable.
   */
  readonly settleRefresh: (item: BrowserItem, current: BrowserItem | null) => void;
}

/** A row as it was refused: same row and same revision means the same out-of-date record. */
function snapshotOf(item: BrowserItem): string {
  return `${itemKey(item)}@${item.revision ?? "-"}`;
}

export interface EquipmentAskOptions {
  /**
   * The conversation's current selection, read at the moment of the press. When
   * given, the server refuses with `selection_changed` if it moved elsewhere.
   */
  readonly selection?: () => SelectionPrecondition | null;
}

/**
 * The only path from a paged row to a question target. One request per press,
 * carrying the revision on screen (and the expected selection); a 409 or any
 * other refusal becomes a notice and the target is left exactly as it was.
 * Replacing the source cancels an in-flight resolve: its answer belongs to the old source.
 */
export function useEquipmentAsk(
  source: EquipmentSource,
  onAskAbout: (target: QuestionTarget, item: BrowserItem) => void,
  options: EquipmentAskOptions = {},
): EquipmentAskController {
  const [pending, setPending] = useState<BrowserItem | null>(null);
  const [notice, setNotice] = useState<EquipmentAskNotice | null>(null);
  const [refreshRequest, setRefreshRequest] = useState<EquipmentRefreshRequest | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  /** Snapshots a refusal said were out of date, by row key. Asking with one again sends nothing. */
  const refused = useRef(new Map<string, { readonly snapshot: string; readonly reason: ResolveFailureReason }>());
  const onAskRef = useRef(onAskAbout);
  onAskRef.current = onAskAbout;
  const selectionRef = useRef(options.selection);
  selectionRef.current = options.selection;
  useEffect(() => () => {
    inFlight.current?.abort();
    inFlight.current = null;
    refused.current.clear();
    setPending(null);
    setNotice(null);
    setRefreshRequest(null);
  }, [source]);

  const ask = useCallback((item: BrowserItem) => {
    if (inFlight.current) return; // one resolve at a time; a second press does not queue a retry
    const key = itemKey(item);
    const known = refused.current.get(key);
    if (known && known.snapshot === snapshotOf(item)) {
      // The same out-of-date record: say so again instead of sending it. Loading the current record clears this.
      setNotice({ itemKey: key, item, reason: known.reason, text: resolveFailureText(known.reason, item.label) });
      return;
    }
    const notebooks = source.resolvesNotebooks === true;
    const askability = askabilityOf(item, { notebooks });
    const request = resolveRequestOf(item, selectionRef.current?.() ?? null, { notebooks });
    if (!request) {
      if (askability === "browse_only") return; // nothing to refuse: the row was never askable
      const reason = askability === "retired" ? "retired" : "no_link";
      setNotice({ itemKey: key, item, reason, text: resolveFailureText(reason, item.label) });
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    setPending(item);
    setNotice(null);
    source.resolve(request, { signal: controller.signal })
      .catch(() => ({ ok: false as const, reason: "error" as const }))
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) onAskRef.current(result.target, item);
        else {
          if (refusalNeedsRefresh(result.reason)) refused.current.set(key, { snapshot: snapshotOf(item), reason: result.reason });
          setNotice({ itemKey: key, item, reason: result.reason, text: resolveFailureText(result.reason, item.label) });
        }
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
        if (!controller.signal.aborted) setPending(null);
      });
  }, [source]);

  const requestRefresh = useCallback((item: BrowserItem) => {
    setNotice(null);
    setRefreshRequest((last) => ({ item, sequence: (last?.sequence ?? 0) + 1 }));
  }, []);

  const settleRefresh = useCallback((item: BrowserItem, current: BrowserItem | null) => {
    const key = itemKey(item);
    const known = refused.current.get(key);
    if (current && snapshotOf(current) !== known?.snapshot) {
      refused.current.delete(key);
      return;
    }
    const text = current
      ? `The list still shows the record of ${item.label} that was refused. The question target did not change.`
      : `Could not load the current record of ${item.label}. The question target did not change. Find ${item.label} in the list again before asking.`;
    setNotice({ itemKey: key, item, reason: known?.reason ?? "stale_revision", text });
  }, []);

  return {
    pendingKey: pending ? itemKey(pending) : null,
    pendingLabel: pending?.label ?? null,
    notice,
    ask,
    dismiss: () => setNotice(null),
    refreshRequest,
    requestRefresh,
    settleRefresh,
  };
}

export interface PagedEquipmentNavigatorProps {
  readonly source: EquipmentSource;
  /** What the next question is about. Owned by the host; browsing never changes it. */
  readonly target: QuestionTarget | null;
  /** Key (kind:id) of the row being browsed; host-owned so the composer bar can name it. */
  readonly browsingKey: string | null;
  readonly onBrowse: (item: BrowserItem) => void;
  /** From `useEquipmentAsk`: the single resolve path, shared with the composer bar. */
  readonly asker: EquipmentAskController;
  /** Wait after typing before searching the server. */
  readonly searchDelayMs?: number;
}

/** The list (and page) a browsed row was pressed in. */
type RowOrigin =
  | { readonly list: "children"; readonly parent: BrowserRef | null; readonly cursor: string | null }
  | { readonly list: "search"; readonly query: string; readonly cursor: string | null };

function LevelIcon({ item }: { readonly item: BrowserItem }) {
  return item.kind === "namespace" ? <FolderIcon /> : <MachineIcon />;
}

const NOTE: Partial<Record<ReturnType<typeof askabilityOf>, string>> = {
  no_link: "Not linked to a notebook",
  retired: "Retired",
};

/**
 * Equipment-first navigation over a paged source. Children load when a row is
 * opened, "Show more" follows the server cursor, and search runs on the server.
 * The client holds only the pages it has been shown, never a plant-wide tree.
 */
export function PagedEquipmentNavigator({ source, target, browsingKey, onBrowse, asker, searchDelayMs = 250 }: PagedEquipmentNavigatorProps) {
  const [branches, dispatch] = useReducer(branchesReducer, new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searchFor, setSearchFor] = useState("");
  const requests = useRef(0);
  const aborts = useRef(new Map<string, AbortController>());
  const currentKey = targetKeyOf(target);
  const notebooks = source.resolvesNotebooks === true;
  const browsingRef = useRef(browsingKey);
  browsingRef.current = browsingKey;
  const onBrowseRef = useRef(onBrowse);
  onBrowseRef.current = onBrowse;

  /** Per list, the cursor that fetched each loaded row's page, so that one page can be read again. */
  const pageCursors = useRef(new Map<string, Map<string, string | null>>());
  /** Where each browsed row was found: the list the technician pressed it in, not wherever else it is cached. */
  const origins = useRef(new Map<string, RowOrigin>());
  const refreshAbort = useRef<AbortController | null>(null);
  const askerRef = useRef(asker);
  askerRef.current = asker;

  /** Loads one page into `key`. */
  const load = useCallback((key: string, run: (signal: AbortSignal, cursor: string | null) => Promise<BrowserPage>, cursor: string | null) => {
    aborts.current.get(key)?.abort();
    const controller = new AbortController();
    aborts.current.set(key, controller);
    const request = ++requests.current;
    const append = cursor !== null;
    dispatch({ type: "start", key, request, append });
    run(controller.signal, cursor).then(
      (page) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "page", key, request, page, append });
        const cursors = append ? pageCursors.current.get(key) ?? new Map<string, string | null>() : new Map<string, string | null>();
        for (const item of page.items) if (!cursors.has(itemKey(item))) cursors.set(itemKey(item), cursor);
        pageCursors.current.set(key, cursors);
      },
      () => { if (!controller.signal.aborted) dispatch({ type: "fail", key, request }); },
    );
  }, []);

  const loadChildren = useCallback((parent: BrowserRef | null, cursor: string | null = null) => {
    const ref = parent ? { kind: parent.kind, id: parent.id } : null;
    load(parentKey(ref), (signal, after) => source.children(ref, { cursor: after, signal }), cursor);
  }, [load, source]);

  // A new source is a new inventory: nothing loaded, opened or searched under the old one survives.
  useEffect(() => {
    dispatch({ type: "clear" });
    setExpanded(new Set());
    pageCursors.current.clear();
    origins.current.clear();
    loadChildren(null);
    const pending = aborts.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      refreshAbort.current?.abort();
      refreshAbort.current = null;
    };
  }, [loadChildren]);

  // Debounced server search. The moment the query changes, the old results and
  // their request are gone, so nothing from the previous query stays clickable.
  const needle = query.trim();
  useEffect(() => {
    aborts.current.get("search")?.abort();
    dispatch({ type: "reset", key: "search" });
    setSearchFor("");
    if (!needle) return;
    const timer = setTimeout(() => setSearchFor(needle), searchDelayMs);
    return () => clearTimeout(timer);
  }, [needle, searchDelayMs, source]);
  const searchFresh = searchFor !== "" && searchFor === needle;
  const loadSearch = useCallback((cursor: string | null) => {
    if (!searchFor) return;
    load("search", (signal, after) => source.search(searchFor, null, { cursor: after, signal }), cursor);
  }, [searchFor, load, source]);
  useEffect(() => { loadSearch(null); }, [loadSearch]);

  const browseFrom = (item: BrowserItem, origin: RowOrigin) => {
    origins.current.set(itemKey(item), origin);
    onBrowse(item);
  };
  const treeOrigin = (item: BrowserItem): RowOrigin => {
    const holding = parentKey(item.parent);
    return { list: "children", parent: item.parent, cursor: pageCursors.current.get(holding)?.get(itemKey(item)) ?? null };
  };

  /**
   * After a refusal that says the row is out of date: on the technician's press,
   * read again the one page of the one list they found the row in (it survives a
   * cleared search and later pages), then swap the record into every loaded copy.
   * Never resolves; the target stays where it is until they ask again.
   */
  const refreshFor = (item: BrowserItem) => {
    const key = itemKey(item);
    const origin = origins.current.get(key) ?? treeOrigin(item);
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    const read = origin.list === "search"
      ? source.search(origin.query, null, { cursor: origin.cursor, signal: controller.signal })
      : source.children(origin.parent ? { kind: origin.parent.kind, id: origin.parent.id } : null, { cursor: origin.cursor, signal: controller.signal });
    read.then(
      (page) => {
        if (controller.signal.aborted) return;
        const current = page.items.find((row) => itemKey(row) === key) ?? null;
        if (current) {
          dispatch({ type: "patch", item: current });
          if (browsingRef.current === key) onBrowseRef.current(current);
        }
        askerRef.current.settleRefresh(item, current);
      },
      () => { if (!controller.signal.aborted) askerRef.current.settleRefresh(item, null); },
    ).finally(() => { if (refreshAbort.current === controller) refreshAbort.current = null; });
  };
  const refreshRef = useRef(refreshFor);
  refreshRef.current = refreshFor;
  const refreshSequence = asker.refreshRequest?.sequence;
  useEffect(() => {
    if (asker.refreshRequest) refreshRef.current(asker.refreshRequest.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per press (sequence), from either notice
  }, [refreshSequence]);

  const loaded = useMemo(() => [...branches.values()].flatMap((branch) => branch.items), [branches]);
  const repeated = useMemo(() => repeatedLabelKeys(loaded), [loaded]);

  const toggle = (item: BrowserItem) => {
    const key = itemKey(item);
    const opening = !expanded.has(key);
    setExpanded((open) => {
      const next = new Set(open);
      if (opening) next.add(key); else next.delete(key);
      return next;
    });
    const branch = branches.get(key);
    if (opening && (!branch || branch.status === "idle" || branch.status === "error")) loadChildren(item);
  };

  const askButton = (item: BrowserItem) => {
    const key = itemKey(item);
    if (key !== browsingKey || askabilityOf(item, { notebooks }) !== "askable" || key === currentKey) return null;
    const pending = asker.pendingKey === key;
    return <button
      type="button"
      className="fl-equip__ask"
      disabled={asker.pendingKey !== null}
      aria-busy={pending ? "true" : undefined}
      onClick={() => asker.ask(item)}
    >{pending ? `Checking ${item.label}…` : `Ask about ${item.label}`}</button>;
  };

  const rowMeta = (item: BrowserItem, showPlace: boolean) => {
    const note = NOTE[askabilityOf(item, { notebooks })];
    return <>
      <span className="fl-equip__text">
        <span className="fl-equip__label">{item.label}</span>
        {item.tag && item.tag !== item.label ? <span className="fl-equip__detail fl-equip__tag">{item.tag}</span> : null}
        {item.detail ? <span className="fl-equip__detail">{item.detail}</span> : null}
        {note ? <span className="fl-equip__detail fl-equip__note" data-note={askabilityOf(item, { notebooks })}>{note}</span> : null}
        {showPlace && item.place ? <span className="fl-equip__place" title={item.place}>{item.place}</span> : null}
      </span>
      {itemKey(item) === currentKey ? <span className="fl-equip__target-mark">Target</span> : null}
    </>;
  };

  const branchFooter = (key: string, onMore: () => void, label: string) => {
    const branch = branches.get(key) ?? EMPTY_BRANCH;
    if (branch.status === "loading") return <li role="none" className="fl-equip__state" aria-live="polite">Loading…</li>;
    if (branch.status === "error") {
      return <li role="none" className="fl-equip__state" data-state="error">
        <span role="alert">Could not load {label}.</span>
        <button type="button" className="fl-equip__more" onClick={onMore}>Try loading again</button>
      </li>;
    }
    if (branch.hasMore) {
      const remaining = Math.max(branch.total - branch.items.length, 0);
      return <li role="none" className="fl-equip__state">
        <button type="button" className="fl-equip__more" onClick={onMore}>Show more{remaining ? ` (${remaining} more)` : ""}</button>
      </li>;
    }
    return null;
  };

  const rows = (parent: BrowserItem | null) => {
    const key = parentKey(parent);
    const branch = branches.get(key) ?? EMPTY_BRANCH;
    // After a failed first page the cursor is still null (reload); after a failed "Show more" it is the page that failed.
    const retry = () => loadChildren(parent ? { kind: parent.kind, id: parent.id } : null, branch.nextCursor);
    return <>
      {branch.items.map((item) => {
        const k = itemKey(item);
        const hasChildren = item.childCount > 0;
        const open = expanded.has(k);
        return <li key={k} role="none">
          <div className="fl-equip__line">
            <button
              type="button"
              role="treeitem"
              className="fl-tree__row fl-equip__row"
              data-kind={item.kind}
              data-equipment-key={k}
              data-browsing={k === browsingKey ? "true" : undefined}
              data-target={k === currentKey ? "true" : undefined}
              aria-expanded={hasChildren ? open : undefined}
              aria-selected={k === browsingKey}
              onClick={() => { browseFrom(item, treeOrigin(item)); if (hasChildren) toggle(item); }}
            >
              <span className="fl-tree__disclosure" aria-hidden="true">
                {hasChildren ? <ChevronIcon className="fl-tree__chevron"/> : null}
              </span>
              <span className="fl-tree__icon" aria-hidden="true"><LevelIcon item={item} /></span>
              {rowMeta(item, repeated.has(k))}
            </button>
            {askButton(item)}
          </div>
          {hasChildren && open
            ? <ul className="fl-tree__children" role="group">{rows(item)}</ul>
            : null}
        </li>;
      })}
      {branchFooter(key, retry, parent ? `the contents of ${parent.label}` : "equipment")}
    </>;
  };

  const search = searchFresh ? branches.get("search") ?? EMPTY_BRANCH : { ...EMPTY_BRANCH, status: "loading" as const };
  const searching = needle !== "";
  const notice = asker.notice;

  return <div className="fl-equip" data-mode="paged">
    <label className="fl-shell__search">
      <SearchIcon className="fl-shell__nav-icon" />
      <input
        type="search"
        aria-label="Search equipment"
        placeholder="Search tag, name or model"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
    </label>

    {notice
      ? <div className="fl-equip__notice" data-reason={notice.reason}>
        <p>{notice.text}</p>
        {refusalNeedsRefresh(notice.reason)
          ? <button type="button" className="fl-equip__more" onClick={() => asker.requestRefresh(notice.item)}>Load current record</button>
          : null}
        <button type="button" className="fl-equip__more" onClick={asker.dismiss}>Dismiss</button>
      </div>
      : null}

    {searching
      ? <section className="fl-shell__nav-section" aria-labelledby="fl-equip-results">
        <h2 id="fl-equip-results" className="fl-shell__section-title">Results</h2>
        {search.status === "ready" && search.items.length === 0
          ? <p className="fl-shell__empty">No matches.</p>
          : <ul className="fl-tree fl-tree--flat" aria-label="Equipment search results">
            {search.items.map((item) => {
              const k = itemKey(item);
              return <li key={`search-${k}`}>
                <div className="fl-equip__line">
                  <button
                    type="button"
                    className="fl-tree__row fl-equip__row"
                    data-kind={item.kind}
                    data-equipment-key={k}
                    data-browsing={k === browsingKey ? "true" : undefined}
                    data-target={k === currentKey ? "true" : undefined}
                    onClick={() => browseFrom(item, { list: "search", query: searchFor, cursor: pageCursors.current.get("search")?.get(k) ?? null })}
                  >
                    <span className="fl-tree__icon" aria-hidden="true"><LevelIcon item={item} /></span>
                    {/* Off-tree rows always show their place: there is no tree around them to say it. */}
                    {rowMeta(item, true)}
                  </button>
                  {askButton(item)}
                </div>
              </li>;
            })}
            {searchFresh ? branchFooter("search", () => loadSearch(search.nextCursor), "search results") : <li role="none" className="fl-equip__state" aria-live="polite">Searching…</li>}
          </ul>}
      </section>
      : <section className="fl-shell__nav-section" aria-labelledby="fl-equip-tree">
        <h2 id="fl-equip-tree" className="fl-shell__section-title">Equipment</h2>
        <ul className="fl-tree" role="tree" aria-label="Equipment">{rows(null)}</ul>
      </section>}
  </div>;
}

/** The ask notice beside the composer, where the question target is read. */
export function EquipmentAskNoticeBar({ asker }: { readonly asker: EquipmentAskController }) {
  const notice = asker.notice;
  if (!notice) return null;
  return <div className="fl-equip__notice" role="alert" data-reason={notice.reason}>
    <p>{notice.text}</p>
    {refusalNeedsRefresh(notice.reason)
      ? <button type="button" className="fl-equip__more" onClick={() => asker.requestRefresh(notice.item)}>Load current record</button>
      : null}
    <button type="button" className="fl-equip__more" onClick={asker.dismiss}>Dismiss</button>
  </div>;
}

/** Display-only target for the composer bar while browsing; asking still goes through `asker.ask`. */
export function provisionalTarget(item: BrowserItem | null, source?: Pick<EquipmentSource, "resolvesNotebooks">): QuestionTarget | null {
  if (!item || askabilityOf(item, { notebooks: source?.resolvesNotebooks === true }) !== "askable") return null;
  if (item.kind === "notebook") return { machineId: item.id, machineLabel: item.label, componentId: null, componentLabel: null, location: item.place ?? "" };
  const machineLabel = item.place?.split(" › ").at(-1) ?? "";
  return { machineId: item.parent?.id ?? "", machineLabel, componentId: item.id, componentLabel: item.label, location: item.place ?? "" };
}

