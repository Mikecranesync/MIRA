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

export interface EquipmentAskController {
  /** The source this controller resolves against (a navigator must use the same one). */
  readonly source: EquipmentSource;
  /** Key of the row whose resolve is in flight, if any. */
  readonly pendingKey: string | null;
  readonly notice: EquipmentAskNotice | null;
  /** One explicit resolve. On success the host's onAskAbout runs; on refusal a notice is set. */
  readonly ask: (item: BrowserItem) => void;
  readonly dismiss: () => void;
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
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<EquipmentAskNotice | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const onAskRef = useRef(onAskAbout);
  onAskRef.current = onAskAbout;
  const selectionRef = useRef(options.selection);
  selectionRef.current = options.selection;
  useEffect(() => () => {
    inFlight.current?.abort();
    inFlight.current = null;
    setPendingKey(null);
    setNotice(null);
  }, [source]);

  const ask = useCallback((item: BrowserItem) => {
    if (inFlight.current) return; // one resolve at a time; a second press does not queue a retry
    const key = itemKey(item);
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
    setPendingKey(key);
    setNotice(null);
    source.resolve(request, { signal: controller.signal })
      .catch(() => ({ ok: false as const, reason: "error" as const }))
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) onAskRef.current(result.target, item);
        else setNotice({ itemKey: key, item, reason: result.reason, text: resolveFailureText(result.reason, item.label) });
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
        if (!controller.signal.aborted) setPendingKey(null);
      });
  }, [source]);

  return { source, pendingKey, notice, ask, dismiss: () => setNotice(null) };
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

  /** Loads one page into `key`. `fresh` re-points the browsed row at its newly loaded record. */
  const load = useCallback((key: string, run: (signal: AbortSignal, cursor: string | null) => Promise<BrowserPage>, cursor: string | null, fresh = false) => {
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
        const browsed = fresh ? page.items.find((item) => itemKey(item) === browsingRef.current) : undefined;
        if (browsed) onBrowseRef.current(browsed);
      },
      () => { if (!controller.signal.aborted) dispatch({ type: "fail", key, request }); },
    );
  }, []);

  const loadChildren = useCallback((parent: BrowserRef | null, cursor: string | null = null, fresh = false) => {
    const ref = parent ? { kind: parent.kind, id: parent.id } : null;
    load(parentKey(ref), (signal, after) => source.children(ref, { cursor: after, signal }), cursor, fresh);
  }, [load, source]);

  // A new source is a new inventory: nothing loaded, opened or searched under the old one survives.
  useEffect(() => {
    dispatch({ type: "clear" });
    setExpanded(new Set());
    loadChildren(null);
    const pending = aborts.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
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
  const loadSearch = useCallback((cursor: string | null, fresh = false) => {
    if (!searchFor) return;
    load("search", (signal, after) => source.search(searchFor, null, { cursor: after, signal }), cursor, fresh);
  }, [searchFor, load, source]);
  useEffect(() => { loadSearch(null); }, [loadSearch]);

  /**
   * After a refusal that says the row is out of date: reload the list it came from
   * (tree branch and/or search) on the technician's press. Never resolves; the
   * target stays where it is until they ask again.
   */
  const refreshFor = (item: BrowserItem) => {
    const key = itemKey(item);
    const holding = parentKey(item.parent);
    if (branches.get(holding)?.items.some((row) => itemKey(row) === key)) loadChildren(item.parent, null, true);
    if (branches.get("search")?.items.some((row) => itemKey(row) === key)) loadSearch(null, true);
  };

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
              onClick={() => { onBrowse(item); if (hasChildren) toggle(item); }}
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
          ? <button type="button" className="fl-equip__more" onClick={() => { refreshFor(notice.item); asker.dismiss(); }}>Load current record</button>
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
                    onClick={() => onBrowse(item)}
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
  if (!asker.notice) return null;
  return <div className="fl-equip__notice" role="alert" data-reason={asker.notice.reason}>
    <p>{asker.notice.text}</p>
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

