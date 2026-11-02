// #5069: phone web Back closes the open layer instead of leaving /v3. Drives the controller
// against a fake history that models one browser tab's entry stack.
import { describe, expect, it } from "vitest";
import { createLayerBack } from "./layer-back-history";

function fakeTab(url = "https://app.test/v3?thread=a", state: unknown = { host: 1 }) {
  const entries: { state: unknown; url: string }[] = [{ state, url }];
  let index = 0;
  const listeners: (() => void)[] = [];
  let backs = 0;
  const history = {
    get state() { return entries[index].state; },
    pushState(state: unknown, title?: string) { void title; entries.splice(index + 1); entries.push({ state, url: entries[index].url }); index += 1; },
    replaceState(state: unknown, _t: string, next?: string | URL | null) { entries[index] = { state, url: next ? String(next) : entries[index].url }; },
    back() { backs += 1; },
  };
  return {
    history,
    entries,
    get index() { return index; },
    get backs() { return backs; },
    url: () => entries[index].url,
    /** The browser finishing a back navigation (user Back, or a queued history.back()). */
    pop() { index -= 1; listeners.forEach((l) => l()); },
    onPopState(l: () => void) { listeners.push(l); return () => listeners.splice(listeners.indexOf(l), 1); },
  };
}

function setup(tab = fakeTab()) {
  let raised = 0;
  const ctl = createLayerBack({ history: tab.history, currentUrl: tab.url, onPopState: (l) => tab.onPopState(l), raiseBack: () => { raised += 1; } });
  return { tab, ctl, raised: () => raised };
}

describe("#5069 Back closes the open layer", () => {
  it("opening a layer pushes one placeholder entry that keeps the host's state", () => {
    const { tab, ctl } = setup();
    ctl.sync(true);
    ctl.sync(true);
    expect(tab.entries).toHaveLength(2);
    expect(tab.entries[1].state).toEqual({ host: 1, flLayerBack: true });
  });

  it("user Back while a layer is open raises the shell's Back event instead of leaving", () => {
    const { tab, ctl, raised } = setup();
    ctl.sync(true);
    tab.pop();
    expect(raised()).toBe(1);
    ctl.sync(false); // the shell closed the layer
    expect(tab.backs).toBe(0); // the placeholder is already gone; nothing more to pop
  });

  it("a layer closed in the UI consumes its placeholder and keeps the address the host wrote", () => {
    const { tab, ctl, raised } = setup();
    ctl.sync(true);
    tab.history.replaceState(tab.history.state, "", "https://app.test/v3?thread=b"); // writeSearch on pick
    ctl.sync(false);
    expect(tab.backs).toBe(1);
    tab.pop();
    expect(raised()).toBe(0);
    expect(tab.index).toBe(0);
    expect(tab.url()).toBe("https://app.test/v3?thread=b");
  });

  it("Back that closes a sheet over the drawer re-arms for the drawer", () => {
    const { tab, ctl, raised } = setup();
    ctl.sync(true); // drawer
    tab.pop(); // Back closes the sheet on top
    expect(raised()).toBe(1);
    ctl.sync(true); // drawer is now the top layer
    expect(tab.entries).toHaveLength(2);
    tab.pop();
    expect(raised()).toBe(2);
  });

  it("a reload on the placeholder (pull-to-refresh, drawer open) does not stack a second one", () => {
    const { tab, ctl, raised } = setup(fakeTab(undefined, { host: 1, flLayerBack: true }));
    ctl.sync(true); // the phone profile reopens the drawer at mount
    expect(tab.entries).toHaveLength(1);
    tab.pop();
    expect(raised()).toBe(1);
  });

  it("a reload on the placeholder with nothing open consumes it", () => {
    const { tab, ctl } = setup(fakeTab(undefined, { host: 1, flLayerBack: true }));
    ctl.sync(false);
    expect(tab.backs).toBe(1);
  });

  it("control: Back with no layer open is ordinary navigation", () => {
    const { tab, ctl, raised } = setup();
    ctl.sync(false);
    tab.history.pushState({ host: 2 }, ""); // some other navigation inside /v3
    tab.pop();
    expect(raised()).toBe(0);
    expect(tab.entries[0].state).toEqual({ host: 1 }); // nothing rewritten
    expect(tab.backs).toBe(0);
  });
});
