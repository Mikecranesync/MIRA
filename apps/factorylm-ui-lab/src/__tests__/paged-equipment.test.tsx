import { afterEach, describe, expect, it } from "bun:test";
import { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { itemKey, resolveRequestKey, type BrowserItem, type EquipmentSource, type QuestionTarget, type ResolveRequest, type SelectionPrecondition } from "@factorylm/interaction";
import { EquipmentAskNoticeBar, PagedEquipmentNavigator, useEquipmentAsk } from "@factorylm/ui";
import { BENCH_IDS, LARGE_PLANT, createFakeEquipmentSource } from "../fake-equipment-source";

const START: QuestionTarget = { machineId: BENCH_IDS.bench, machineLabel: "GS10 bench", componentId: BENCH_IDS.vfd1, componentLabel: "VFD1", location: "Garage › Bench line" };

interface View {
  readonly container: HTMLDivElement;
  readonly asked: QuestionTarget[];
  readonly resolves: string[];
  readonly requests: ResolveRequest[];
  readonly calls: string[];
  target(): QuestionTarget | null;
  row(key: string, scope?: string): HTMLButtonElement | null;
  button(name: string | RegExp): HTMLButtonElement | null;
  click(element: Element | null): Promise<void>;
  search(text: string, settle?: boolean): Promise<void>;
  swap(source: EquipmentSource): Promise<void>;
  flush(): Promise<void>;
  cleanup(): void;
}

interface RenderOptions {
  readonly calls?: string[];
  readonly selection?: () => SelectionPrecondition | null;
  readonly searchDelayMs?: number;
}

const views: View[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function render(initial: EquipmentSource = createFakeEquipmentSource(), options: RenderOptions = {}): Promise<View> {
  const container = document.createElement("div");
  document.body.append(container);
  const asked: QuestionTarget[] = [];
  const resolves: string[] = [];
  const requests: ResolveRequest[] = [];
  let current: QuestionTarget | null = START;
  let swapTo: ((source: EquipmentSource) => void) | null = null;
  function Host() {
    const [source, setSource] = useState<EquipmentSource>(initial);
    swapTo = setSource;
    // Count resolves at the source boundary: a silent retry would show up here.
    const counted = useMemo<EquipmentSource>(() => ({
      ...(source.resolvesNotebooks ? { resolvesNotebooks: true } : {}),
      children: (parent, opts) => source.children(parent, opts),
      search: (query, scope, opts) => source.search(query, scope, opts),
      resolve: (request, opts) => { resolves.push(resolveRequestKey(request)); requests.push(request); return source.resolve(request, opts); },
    }), [source]);
    const [target, setTarget] = useState<QuestionTarget | null>(START);
    const [browsing, setBrowsing] = useState<BrowserItem | null>(null);
    const asker = useEquipmentAsk(counted, (next) => { asked.push(next); current = next; setTarget(next); }, { selection: options.selection });
    current = target;
    return <>
      <PagedEquipmentNavigator source={counted} target={target} browsingKey={browsing ? itemKey(browsing) : null} onBrowse={setBrowsing} asker={asker} searchDelayMs={options.searchDelayMs ?? 0} />
      <div data-testid="composer"><EquipmentAskNoticeBar asker={asker} /></div>
    </>;
  }
  let root: Root | null = null;
  await act(async () => { root = createRoot(container); root.render(<Host />); });
  const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await flush();
  const view: View = {
    container, asked, resolves, requests, calls: options.calls ?? [],
    target: () => current,
    row: (key, scope = '[role="tree"]') => container.querySelector<HTMLButtonElement>(`${scope} [data-equipment-key="${key}"]`),
    button: (name) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? "")) ?? null,
    click: async (element) => { if (!element) throw new Error("element is required"); await act(async () => { (element as HTMLElement).click(); }); await flush(); },
    search: async (text, settle = true) => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Search equipment"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      if (settle) await flush();
    },
    swap: async (source) => { await act(async () => { swapTo?.(source); }); await flush(); },
    flush,
    cleanup: () => { act(() => root?.unmount()); container.remove(); },
  };
  views.push(view);
  return view;
}

const key = (kind: BrowserItem["kind"], id: string) => itemKey({ kind, id });

async function openBench(view: View) {
  await view.click(view.row(key("namespace", BENCH_IDS.garage)));
  await view.click(view.row(key("namespace", BENCH_IDS.benchLine)));
  await view.click(view.row(key("notebook", BENCH_IDS.bench)));
}

describe("paged equipment navigator", () => {
  it("loads only the root page first, then one parent's children per expand", async () => {
    const calls: string[] = [];
    const view = await render(createFakeEquipmentSource({ onCall: (line) => calls.push(line) }), { calls });
    expect(calls).toEqual(["browse:children root"]);
    expect(view.container.querySelectorAll('[role="tree"] [data-equipment-key]').length).toBe(3);
    await openBench(view);
    expect(calls).toEqual([
      "browse:children root",
      `browse:children namespace:${BENCH_IDS.garage}`,
      `browse:children namespace:${BENCH_IDS.benchLine}`,
      `browse:children notebook:${BENCH_IDS.bench}`,
    ]);
    expect(view.row(key("notebook_component", BENCH_IDS.vfd1))?.dataset.target).toBe("true");
  });

  it("browsing never moves the target; one explicit resolve does", async () => {
    const view = await render();
    await openBench(view);
    await view.click(view.row(key("notebook_component", BENCH_IDS.mlc)));
    expect(view.target()).toEqual(START);
    expect(view.resolves).toEqual([]);
    await view.click(view.button("Ask about MLC"));
    expect(view.resolves).toEqual([key("notebook_component", BENCH_IDS.mlc)]);
    expect(view.asked).toHaveLength(1);
    expect(view.target()).toMatchObject({ machineId: BENCH_IDS.bench, componentId: BENCH_IDS.mlc, componentLabel: "MLC" });
  });

  it("Ask about sends the notebook, component and the revision on screen; a correction since is a 409, shown once, target holds", async () => {
    const source = createFakeEquipmentSource();
    const view = await render(source);
    await openBench(view);
    // The fixture corrects K2 right after the bench list loads: the row shows revision 1, the record is now 2.
    expect(source.revisionOf(BENCH_IDS.stale)).toBe(2);
    await view.click(view.row(key("notebook_component", BENCH_IDS.stale)));
    await view.click(view.button("Ask about Contactor K2"));
    await sleep(50);
    await view.flush();
    expect(view.requests).toEqual([{ kind: "notebook_component", notebookId: BENCH_IDS.bench, componentId: BENCH_IDS.stale, expectedRevision: 1 }]);
    expect(view.asked).toEqual([]);
    expect(view.target()).toEqual(START);
    const alert = view.container.querySelector('[data-testid="composer"] [role="alert"]');
    expect(alert?.getAttribute("data-reason")).toBe("stale_revision");
    expect(alert?.textContent).toContain("did not change");
    expect(alert?.textContent?.toLowerCase()).not.toContain("try again");
  });

  it("control: an unchanged component with the same revision resolves on the first press", async () => {
    const view = await render();
    await openBench(view);
    await view.click(view.row(key("notebook_component", BENCH_IDS.mlc)));
    await view.click(view.button("Ask about MLC"));
    expect(view.requests).toEqual([{ kind: "notebook_component", notebookId: BENCH_IDS.bench, componentId: BENCH_IDS.mlc, expectedRevision: 1 }]);
    expect(view.target()).toMatchObject({ componentId: BENCH_IDS.mlc });
  });

  it("after a stale refusal, Load current record reloads the list without resolving; the next press uses the new revision", async () => {
    const calls: string[] = [];
    const view = await render(createFakeEquipmentSource({ onCall: (line) => calls.push(line) }), { calls });
    await openBench(view);
    await view.click(view.row(key("notebook_component", BENCH_IDS.stale)));
    await view.click(view.button("Ask about Contactor K2"));
    const benchLoads = () => calls.filter((line) => line === `browse:children notebook:${BENCH_IDS.bench}`).length;
    expect(benchLoads()).toBe(1);
    await view.click(view.button("Load current record"));
    expect(benchLoads()).toBe(2);
    // Refreshing is not asking: no resolve, no target change, notice gone.
    expect(view.resolves).toHaveLength(1);
    expect(view.target()).toEqual(START);
    expect(view.container.querySelector('[data-testid="composer"] [role="alert"]')).toBeNull();
    await view.click(view.button("Ask about Contactor K2"));
    expect(view.requests.at(-1)).toMatchObject({ componentId: BENCH_IDS.stale, expectedRevision: 2 });
    expect(view.target()).toMatchObject({ componentId: BENCH_IDS.stale });
  });

  it("a selection that changed elsewhere is a 409 from the host's precondition, and the target holds", async () => {
    const source = createFakeEquipmentSource();
    source.setSelection("thread-1", { componentId: BENCH_IDS.vfd1, revision: 1, version: 4 });
    const view = await render(source, { selection: () => ({ threadKey: "thread-1", version: 3 }) });
    await openBench(view);
    await view.click(view.row(key("notebook_component", BENCH_IDS.mlc)));
    await view.click(view.button("Ask about MLC"));
    expect(view.requests).toEqual([{ kind: "notebook_component", notebookId: BENCH_IDS.bench, componentId: BENCH_IDS.mlc, expectedRevision: 1, selection: { threadKey: "thread-1", version: 3 } }]);
    expect(view.container.querySelector('[data-testid="composer"] [role="alert"]')?.getAttribute("data-reason")).toBe("selection_changed");
    expect(view.asked).toEqual([]);
    expect(view.target()).toEqual(START);
  });

  it("control: a matching selection precondition (no selection yet) resolves", async () => {
    const view = await render(createFakeEquipmentSource(), { selection: () => ({ threadKey: "thread-1", version: null }) });
    await openBench(view);
    await view.click(view.row(key("notebook_component", BENCH_IDS.mlc)));
    await view.click(view.button("Ask about MLC"));
    expect(view.requests[0]).toMatchObject({ selection: { threadKey: "thread-1", version: null } });
    expect(view.target()).toMatchObject({ componentId: BENCH_IDS.mlc });
  });

  it("a whole notebook is browse-only unless the source resolves notebooks", async () => {
    const plain = await render();
    await plain.click(plain.row(key("namespace", BENCH_IDS.garage)));
    await plain.click(plain.row(key("namespace", BENCH_IDS.benchLine)));
    await plain.click(plain.row(key("notebook", BENCH_IDS.bench)));
    expect(plain.button("Ask about GS10 bench")).toBeNull();
    plain.cleanup();
    views.splice(views.indexOf(plain), 1);

    const capable = await render(createFakeEquipmentSource({ resolvesNotebooks: true }));
    await capable.click(capable.row(key("namespace", BENCH_IDS.garage)));
    await capable.click(capable.row(key("namespace", BENCH_IDS.benchLine)));
    await capable.click(capable.row(key("notebook", BENCH_IDS.bench)));
    await capable.click(capable.button("Ask about GS10 bench"));
    expect(capable.requests).toEqual([{ kind: "notebook", notebookId: BENCH_IDS.bench }]);
    expect(capable.target()).toMatchObject({ machineId: BENCH_IDS.bench, componentId: null });
  });

  it("changing the query drops the old results at once: nothing from the previous query stays clickable", async () => {
    const view = await render(createFakeEquipmentSource({ pageSize: 2, latencyMs: 30 }), { searchDelayMs: 40 });
    const results = '[aria-label="Equipment search results"]';
    const rowsShown = () => [...view.container.querySelectorAll<HTMLElement>(`${results} [data-equipment-key]`)].map((el) => el.dataset.equipmentKey);
    await view.search("vfd1");
    await sleep(120);
    await view.flush();
    expect(rowsShown()).toHaveLength(2);
    expect(view.button(/^Show more/)).not.toBeNull();
    await view.search("mlc", false);
    // Before the debounce even fires: no VFD1 row, no Show more for the old cursor.
    expect(rowsShown()).toEqual([]);
    expect(view.button(/^Show more/)).toBeNull();
    await sleep(120);
    await view.flush();
    expect(rowsShown()).toEqual([key("notebook_component", BENCH_IDS.mlc)]);
  });

  it("a search answer that lands after the query changed is dropped", async () => {
    const view = await render(createFakeEquipmentSource({ latencyMs: 60 }), { searchDelayMs: 0 });
    const results = '[aria-label="Equipment search results"]';
    await view.search("vfd1"); // request in flight (60 ms)
    await view.search("mlc", false);
    await sleep(150);
    await view.flush();
    const shown = [...view.container.querySelectorAll<HTMLElement>(`${results} [data-equipment-key]`)].map((el) => el.dataset.equipmentKey);
    expect(shown).toEqual([key("notebook_component", BENCH_IDS.mlc)]);
  });

  it("replacing the source drops its branches and cancels its resolve", async () => {
    const a = createFakeEquipmentSource({ latencyMs: 40 });
    const view = await render(a);
    await sleep(60); await view.flush();
    await view.click(view.row(key("namespace", BENCH_IDS.garage)));
    await sleep(60); await view.flush();
    await view.click(view.row(key("namespace", BENCH_IDS.benchLine)));
    await sleep(60); await view.flush();
    await view.click(view.row(key("notebook", BENCH_IDS.bench)));
    await sleep(60); await view.flush();
    await view.click(view.row(key("notebook_component", BENCH_IDS.mlc)));
    await view.click(view.button("Ask about MLC")); // resolve in flight on A (40 ms)

    // B: same root key "Garage", different children.
    const onlyInB: BrowserItem = { kind: "namespace", id: "ns-only-in-b", label: "Only in B", parent: { kind: "namespace", id: BENCH_IDS.garage }, childCount: 0 };
    const b: EquipmentSource = {
      children: async (parent) => parent
        ? { items: parent.id === BENCH_IDS.garage ? [onlyInB] : [], total: parent.id === BENCH_IDS.garage ? 1 : 0, hasMore: false, nextCursor: null }
        : { items: [{ kind: "namespace", id: BENCH_IDS.garage, label: "Garage", parent: null, childCount: 1 }], total: 1, hasMore: false, nextCursor: null },
      search: async () => ({ items: [], total: 0, hasMore: false, nextCursor: null }),
      resolve: async () => ({ ok: false, reason: "not_found" }),
    };
    await view.swap(b);
    await sleep(80); await view.flush();
    // A's resolve finished after the swap: it must not move the target.
    expect(view.asked).toEqual([]);
    expect(view.target()).toEqual(START);
    expect(view.row(key("namespace", BENCH_IDS.benchLine))).toBeNull();
    expect(view.row(key("notebook_component", BENCH_IDS.mlc))).toBeNull();
    await view.click(view.row(key("namespace", BENCH_IDS.garage)));
    expect(view.row(key("namespace", "ns-only-in-b"))).not.toBeNull();
    expect(view.row(key("namespace", BENCH_IDS.benchLine))).toBeNull();
  });

  it("an unlinked installed instance and a retired component are visible but not askable", async () => {
    const view = await render();
    await openBench(view);
    const retired = view.row(key("notebook_component", BENCH_IDS.retired))!;
    expect(retired.textContent).toContain("Retired");
    await view.click(retired);
    expect(view.button(/Ask about Contactor K0/)).toBeNull();

    await view.click(view.row(key("namespace", BENCH_IDS.line2)));
    await view.click(view.row(key("asset", BENCH_IDS.conveyor2Asset)));
    const unlinked = view.row(key("installed_instance", BENCH_IDS.vfd1Installed))!;
    expect(unlinked.textContent).toContain("Not linked to a notebook");
    await view.click(unlinked);
    expect(view.button(/^Ask about VFD1$/)).toBeNull();
    expect(view.resolves).toEqual([]);
    expect(view.target()).toEqual(START);

    const spare = view.row(key("installed_instance", BENCH_IDS.spare))!;
    expect(spare.textContent).toContain("Not linked to a notebook");
  });

  it("duplicate tags are separate rows that show where they are; asking resolves the exact id", async () => {
    const view = await render();
    await view.search("vfd1");
    const results = '[aria-label="Equipment search results"]';
    const hits = [...view.container.querySelectorAll<HTMLElement>(`${results} [data-equipment-key]`)].map((el) => el.dataset.equipmentKey);
    expect(hits).toEqual([
      key("notebook_component", BENCH_IDS.vfd1),
      key("notebook_component", BENCH_IDS.vfd1Line2),
      key("installed_instance", BENCH_IDS.vfd1Installed),
    ]);
    for (const el of view.container.querySelectorAll(`${results} .fl-equip__place`)) expect(el.textContent).not.toBe("");
    await view.click(view.row(key("notebook_component", BENCH_IDS.vfd1Line2), results));
    await view.click(view.button("Ask about VFD1"));
    expect(view.resolves).toEqual([key("notebook_component", BENCH_IDS.vfd1Line2)]);
    expect(view.target()).toMatchObject({ machineId: BENCH_IDS.conveyor2, componentId: BENCH_IDS.vfd1Line2 });
  });

  it("search runs on the server, pages by cursor, and never holds more than it was shown", async () => {
    const source = createFakeEquipmentSource({ pageSize: 25 });
    const view = await render(source);
    await view.search("GS10 drive");
    const results = '[aria-label="Equipment search results"]';
    const count = () => view.container.querySelectorAll(`${results} [data-equipment-key]`).length;
    expect(count()).toBe(25);
    const more = view.button(/^Show more/)!;
    const totalHits = LARGE_PLANT.areas * LARGE_PLANT.linesPerArea * LARGE_PLANT.machinesPerLine + 2; // + both bench-garage GS10 drives
    expect(more.textContent).toBe(`Show more (${totalHits - 25} more)`);
    await view.click(more);
    expect(count()).toBe(50);
    expect(source.maxPageSeen()).toBe(25);
    await view.search("");
    expect(view.container.querySelector(results)).toBeNull();
  });

  it("a failed children load shows an error row, and only the technician's press reloads it", async () => {
    const calls: string[] = [];
    const view = await render(createFakeEquipmentSource({ onCall: (line) => calls.push(line) }), { calls });
    await view.click(view.row(key("namespace", BENCH_IDS.garage)));
    await view.click(view.row(key("namespace", BENCH_IDS.flaky)));
    expect(view.container.textContent).toContain("Could not load the contents of Flaky storeroom.");
    const flakyCalls = () => calls.filter((line) => line === `browse:children namespace:${BENCH_IDS.flaky}`).length;
    await new Promise((r) => setTimeout(r, 50));
    await view.flush();
    // Exactly the one request the technician's expand made: nothing re-requested it behind their back.
    expect(flakyCalls()).toBe(1);
    await view.click(view.button("Try loading again"));
    expect(flakyCalls()).toBe(2);
    expect(view.row(key("notebook", "nb-storeroom-shelf"))).not.toBeNull();
  });
});

describe("fake equipment source (the server stand-in)", () => {
  it("holds a 20,000-component plant and serves it in bounded pages", async () => {
    const source = createFakeEquipmentSource({ pageSize: 100 });
    const first = await source.search("component", null);
    expect(first.total).toBe(LARGE_PLANT.areas * LARGE_PLANT.linesPerArea * LARGE_PLANT.machinesPerLine * (LARGE_PLANT.componentsPerMachine - 1));
    expect(first.items).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const all = await source.search("M", { kind: "namespace", id: BENCH_IDS.plant });
    expect(all.total).toBeGreaterThanOrEqual(20_000);
    expect(source.maxPageSeen()).toBe(100);
  });

  it("rejects a cursor from another scope", async () => {
    const source = createFakeEquipmentSource({ pageSize: 5 });
    const page = await source.search("gs10", null);
    expect(page.nextCursor).not.toBeNull();
    await expect(source.children(null, { cursor: page.nextCursor })).rejects.toThrow("invalid_cursor");
  });
});
