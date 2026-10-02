import { afterEach, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PublicDemo } from "../PublicDemo";

const originalFetch = globalThis.fetch;
const originalMatchMedia = window.matchMedia;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
  globalThis.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
});

async function mount() {
  const pending: { resolve: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    if (String(input).includes("/chat")) {
      return new Promise<Response>((resolve) => pending.push({ resolve, signal: init?.signal }));
    }
    // An unavailable simulator still exposes Reset; this isolates host state
    // from polling, which has its own successful-reset integration coverage.
    return Promise.resolve(new Response("unavailable", { status: 503 }));
  }) as typeof fetch;
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<PublicDemo config={{ simlabUrl: "http://sim.test", hubUrl: "http://hub.test", notebookId: "nb" }} />);
  });
  return pending;
}
async function reset() {
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click(); });
}
async function send(text: string) {
  await act(async () => {
    const box = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('form[aria-label="Composer"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
const answer = (text: string) => new Response([
  `data: ${JSON.stringify({ kind: "content", content: text })}`,
  'data: {"kind":"status","status":"answered"}',
  'data: [DONE]',
].join("\n\n"));

it("reset preserves the closed mobile navigation", async () => {
  await mount();
  expect(container.querySelector(".fl-shell")!.getAttribute("data-navigation-visible")).toBe("false");
  await reset();
  expect(container.querySelector(".fl-shell")!.getAttribute("data-navigation-visible")).toBe("false");
});

it("reset invalidates the pending answer and late completion cannot overwrite a newer question", async () => {
  const pending = await mount();
  await send("Old jam question");
  expect(pending).toHaveLength(1);
  await reset();
  expect(pending[0]!.signal?.aborted).toBe(true);
  expect(container.textContent).not.toContain("Old jam question");
  await send("New healthy question");
  expect(pending).toHaveLength(2);
  await act(async () => {
    const box = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Queued next question");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { pending[0]!.resolve(answer("Obsolete jam answer")); });
  expect(container.textContent).not.toContain("Obsolete jam answer");
  expect(container.textContent).toContain("New healthy question");
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.disabled).toBe(true);
  await act(async () => { pending[1]!.resolve(answer("Current healthy answer")); });
  expect(container.textContent).toContain("Current healthy answer");
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.disabled).toBe(false);
  expect(container.textContent).not.toContain("Old jam question");
});

it("a transport that ignores abort cannot restore the pre-reset thread", async () => {
  const pending = await mount();
  await send("Old jam question");
  await reset();
  await act(async () => { pending[0]!.resolve(answer("Obsolete jam answer")); });
  expect(container.textContent).not.toContain("Old jam question");
  expect(container.textContent).not.toContain("Obsolete jam answer");
});
