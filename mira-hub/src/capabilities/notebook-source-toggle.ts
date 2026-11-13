/**
 * Which notebook sources are on, for a source list with on/off checkboxes
 * (#5456; Codex r1 + r2 on #5476, F2).
 *
 * One owner for three things that must never disagree: the checkbox, the
 * "will chat search this" label (a SERVER projection — `deriveSearchable` in
 * lib/document-readiness.ts), and the doc ids sent with a chat turn.
 *
 *  - The server's source list is the truth. A checkbox is that list's value,
 *    except while a toggle is in flight or was accepted but not yet re-read.
 *  - A write can commit and still lose its response, so a transport failure
 *    is "unknown", not "no": the row goes back to the last known server value
 *    and stays marked unsettled until a list read lands (`retryUnsettled`).
 *  - A list read that started before the latest write settled is discarded —
 *    it may predate that write.
 *  - One toggle per source at a time (`isBusy`), so two writes cannot race.
 *
 * Framework-free; the page supplies the two network calls and a re-render.
 */
export interface SourceRow {
  docId: string;
  enabledByDefault: boolean;
  matchState?: string | null;
}

export interface SourceToggleIO<S extends SourceRow> {
  /** Persist on/off for one source. Resolves `{ ok }` from the HTTP response. */
  patch: (docId: string, enabled: boolean) => Promise<{ ok: boolean }>;
  /** Read the source list from the server; undefined when the read failed. */
  list: () => Promise<S[] | undefined>;
  /** Something the page renders has changed. */
  onChange: () => void;
}

/** A rejected source is never on. Undefined when the source is not listed. */
export function persistedEnabled(sources: ReadonlyArray<SourceRow>, docId: string): boolean | undefined {
  const row = sources.find((s) => s.docId === docId);
  if (!row) return undefined;
  return row.enabledByDefault && row.matchState !== "rejected";
}

export function createSourceToggles<S extends SourceRow>(io: SourceToggleIO<S>) {
  let sources: S[] = [];
  /** Shown instead of the list's value: in flight, or accepted and not yet re-read. */
  const overrides = new Map<string, boolean>();
  const inFlight = new Set<string>();
  /** Write outcome unknown and no list read has landed since. */
  const unsettled = new Set<string>();
  let readsStarted = 0;
  let lastApplied = 0;
  /** Reads numbered at or below this began before the latest write settled. */
  let staleFloor = 0;

  const isEnabled = (docId: string): boolean => overrides.get(docId) ?? persistedEnabled(sources, docId) ?? false;

  function apply(next: S[]): void {
    sources = next;
    // The list now speaks for every source that has no write in the air.
    for (const docId of [...overrides.keys()]) if (!inFlight.has(docId)) overrides.delete(docId);
    for (const docId of [...unsettled]) if (!inFlight.has(docId)) unsettled.delete(docId);
    io.onChange();
  }

  /** Re-read the list. True when this read was applied. Never throws. */
  async function refresh(): Promise<boolean> {
    const mine = ++readsStarted;
    let next: S[] | undefined;
    try {
      next = await io.list();
    } catch {
      next = undefined;
    }
    // Last APPLIED, not last started: a good older read still counts when a
    // newer one failed — unless it predates the latest write.
    if (!next || mine <= lastApplied || mine <= staleFloor) return false;
    lastApplied = mine;
    apply(next);
    return true;
  }

  /**
   * Flip one source. Resolves true when the server is known to hold the new
   * state. A source with a toggle already in flight is left alone.
   */
  async function toggle(docId: string): Promise<boolean> {
    if (inFlight.has(docId)) return false;
    const next = !isEnabled(docId);
    overrides.set(docId, next);
    inFlight.add(docId);
    io.onChange();

    let outcome: "ok" | "refused" | "unknown";
    try {
      outcome = (await io.patch(docId, next)).ok ? "ok" : "refused";
    } catch {
      outcome = "unknown";
    }
    inFlight.delete(docId);
    staleFloor = readsStarted;
    if (outcome !== "ok") overrides.delete(docId); // back to the last known server value
    if (outcome === "unknown") unsettled.add(docId);
    io.onChange();

    const read = await refresh();
    return read ? persistedEnabled(sources, docId) === next : outcome === "ok";
  }

  return {
    /**
     * For a list the page reads itself (first load, the reload after an
     * upload): take a number BEFORE the request goes out, hand it back with
     * the rows, and the same ordering rules as `refresh` apply.
     */
    beginRead: (): number => ++readsStarted,
    /** Apply a list the page read. False when a newer read or write outdates it. */
    applySources(next: S[], readNo: number = ++readsStarted): boolean {
      if (readNo <= lastApplied || readNo <= staleFloor) return false;
      lastApplied = readNo;
      apply(next);
      return true;
    },
    refresh,
    toggle,
    isEnabled,
    isBusy: (docId: string): boolean => inFlight.has(docId),
    getSources: (): S[] => sources,
    /** The doc ids a chat turn searches: exactly what the checkboxes show. */
    enabledDocIds: (): string[] =>
      sources.filter((s) => s.matchState !== "rejected" && isEnabled(s.docId)).map((s) => s.docId),
    hasUnsettled: (): boolean => unsettled.size > 0,
    /** Call when the network may be back (online, tab shown again). */
    async retryUnsettled(): Promise<void> {
      if (unsettled.size > 0) await refresh();
    },
  };
}

export type SourceToggles<S extends SourceRow> = ReturnType<typeof createSourceToggles<S>>;
