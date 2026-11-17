import { afterEach, describe, expect, it } from "bun:test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { itemKey, type BrowserItem, type EquipmentSource, type QuestionTarget } from "@factorylm/interaction";
import { EquipmentAskNoticeBar, PagedEquipmentNavigator, useEquipmentAsk } from "@factorylm/ui";
import { BENCH_IDS, LARGE_PLANT, createFakeEquipmentSource } from "../fake-equipment-source";

const START: QuestionTarget = { machineId: BENCH_IDS.bench, machineLabel: "GS10 bench", componentId: BENCH_IDS.vfd1, componentLabel: "VFD1", location: "Garage › Bench line" };

interface View {
  readonly container: HTMLDivElement;
  readonly asked: QuestionTarget[];
  readonly resolves: string[];
  readonly calls: string[];
  target(): QuestionTarget | null;
  row(key: string, scope?: string): HTMLButtonElement | null;
  button(name: string | RegExp): HTMLButtonElement | null;
  click(element: Element | null): Promise<void>;
  search(text: string): Promise<void>;
  flush(): Promise<void>;
  cleanup(): void;
}

const views: View[] = [];
afterEach(() => { views.splice(0).forEach((view) => view.cleanup()); });

async function render(source: EquipmentSource & { readonly maxPageSeen?: () => number } = createFakeEquipmentSource(), calls: string[] = []): Promise<View> {
  const container = document.createElement("div");
  document.body.append(container);
  const asked: QuestionTarget[] = [];
  const resolves: string[] = [];
  let current: QuestionTarget | null = START;
  // Count resolves at the source boundary: a silent retry would show up here.
  const counted: EquipmentSource = {
    children: (parent, options) => source.children(parent, options),
    search: (query, scope, options) => source.search(query, scope, options),
    resolve: (target, options) => { resolves.push(itemKey(target)); return source.resolve(target, options); },
  };
  function Host() {
    const [target, setTarget] = useState<QuestionTarget | null>(START);
    const [browsing, setBrowsing] = useState<BrowserItem | null>(null);
    const asker = useEquipmentAsk(counted, (next) => { asked.push(next); current = next; setTarget(next); });
    current = target;
    return <>
      <PagedEquipmentNavigator source={counted} target={target} browsingKey={browsing ? itemKey(browsing) : null} onBrowse={setBrowsing} asker={asker} searchDelayMs={0} />
      <div data-testid="composer"><EquipmentAskNoticeBar asker={asker} /></div>
    </>;
  }
  let root: Root | null = null;
  await act(async () => { root = createRoot(container); root.render(<Host />); });
  const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await flush();
  const view: View = {
    container, asked, resolves, calls,
    target: () => current,
    row: (key, scope = '[role="tree"]') => container.querySelector<HTMLButtonElement>(`${scope} [data-equipment-key="${key}"]`),
    button: (name) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? "")) ?? null,
    click: async (element) => { if (!element) throw new Error("element is required"); await act(async () => { (element as HTMLElement).click(); }); await flush(); },
    search: async (text) => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Search equipment"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await flush();
    },
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
    const view = await render(createFakeEquipmentSource({ onCall: (line) => calls.push(line) }), calls);
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

  for (const [name, id, reason] of [
    ["stale revision (409)", BENCH_IDS.stale, "stale_revision"],
    ["selection changed elsewhere (409)", BENCH_IDS.moved, "selection_changed"],
  ] as const) {
    it(`a ${name} is shown, resolved once, never retried, and the target holds`, async () => {
      const view = await render();
      await openBench(view);
      const row = view.row(key("notebook_component", id))!;
      await view.click(row);
      await view.click(view.button(/^Ask about /));
      await new Promise((r) => setTimeout(r, 50));
      await view.flush();
      expect(view.resolves).toEqual([key("notebook_component", id)]);
      expect(view.asked).toEqual([]);
      expect(view.target()).toEqual(START);
      const alert = view.container.querySelector('[data-testid="composer"] [role="alert"]');
      expect(alert?.getAttribute("data-reason")).toBe(reason);
      expect(alert?.textContent).toContain("did not change");
      expect(alert?.textContent?.toLowerCase()).not.toContain("try again");
    });
  }

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
    const view = await render(createFakeEquipmentSource({ onCall: (line) => calls.push(line) }), calls);
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
