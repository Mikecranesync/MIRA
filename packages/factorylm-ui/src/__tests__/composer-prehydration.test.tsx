/**
 * #4695: on a server-rendered page the message field is visible, and typeable,
 * before the app has started. A technician on a slow link starts typing; React
 * keeps that text through hydration, but the shell state does not know it, so
 * the next render of the controlled field wrote the empty draft back and the
 * first words vanished ("How do I clear…" was sent as "do I clear…"; live
 * staging probe, typing before hydration kept only "o I clear a fault…").
 *
 * These tests render the shell to HTML, type into that HTML, hydrate it, then
 * force an unrelated re-render, which is exactly the sequence the live page goes through.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { act, type Dispatch, type MutableRefObject } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { ShellAction } from "@factorylm/interaction";
import { Harness, fakeAdapter } from "./harness";

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const adapter = fakeAdapter();
const field = () => container!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]')!;
const stateDraft = () => container!.querySelector('output[aria-label="Active context"]')!.getAttribute("data-draft");

/** Server HTML in the page; `typed` entered into it before the app starts; then hydrate. */
function hydrateAfterTyping(typed: string): MutableRefObject<Dispatch<ShellAction> | null> {
  const dispatchRef: MutableRefObject<Dispatch<ShellAction> | null> = { current: null };
  const element = <Harness surface="hub" fixture="general-ask" adapter={adapter} dispatchRef={dispatchRef} />;
  container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(element);
  field().value = typed;
  act(() => { root = hydrateRoot(container!, element); });
  return dispatchRef;
}

describe("Composer before hydration (#4695)", () => {
  it("keeps text typed into the server-rendered field before the app started", () => {
    hydrateAfterTyping("How d");
    expect(stateDraft()).toBe("How d");
    expect(field().value).toBe("How d");
  });

  it("survives the next unrelated render, which used to write the empty draft back", () => {
    const dispatch = hydrateAfterTyping("How d");
    act(() => dispatch.current!({ type: "set-navigation-visible", visible: true }));
    expect(field().value).toBe("How d");
    expect(stateDraft()).toBe("How d");
  });

  it("control: a client-only mount starts empty and adopts nothing", () => {
    container = document.createElement("div");
    document.body.append(container);
    act(() => {
      root = createRoot(container!);
      root.render(<Harness surface="hub" fixture="general-ask" adapter={adapter} />);
    });
    expect(field().value).toBe("");
    expect(stateDraft()).toBe("");
  });
});
