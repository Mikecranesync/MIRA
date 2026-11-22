/**
 * The web PlatformAdapter's contract, branch by branch (#3806 step 1).
 *
 * The cases that matter most are the ones where the adapter must say "no":
 * a web scan that cannot happen, and a share that did not complete. Both have
 * a plausible-looking wrong answer available, and returning it would hand the
 * shell state no human confirmed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserAdapterDeps, createWebAdapter, type WebAdapterDeps } from "./web-adapter";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

function deps(over: Partial<WebAdapterDeps> = {}): WebAdapterDeps {
  let n = 0;
  return {
    pickFile: async () => null,
    history: { length: 1, back: () => {} },
    origin: "https://app.factorylm.com",
    newId: () => `att_${++n}`,
    ...over,
  };
}

describe("attachments", () => {
  // #4019: the adapter used to return only the descriptor and drop the File, so
  // the host had nothing to upload. It holds the bytes until the host takes them.
  it("holds the picked bytes by attachment id until the host forgets them", async () => {
    const f = file("g120.pdf", "application/pdf");
    const a = createWebAdapter(deps({ pickFile: async () => f }));
    const picked = await a.attachFile();
    expect(a.heldFile(picked!.id)).toBe(f);
    a.forget(picked!.id);
    expect(a.heldFile(picked!.id)).toBeUndefined();
  });

  // Codex #4024 round 2 F3: removing a chip gives the adapter no event, so the
  // held bytes are bounded — the oldest is released once more than 8 are held.
  it("holds at most the 8 most recent files", async () => {
    let n = 0;
    const a = createWebAdapter(deps({ pickFile: async () => file(`f${++n}.pdf`, "application/pdf") }));
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.push((await a.attachFile())!.id);
    expect(a.heldFile(ids[0])).toBeUndefined();
    expect(a.heldFile(ids[1])).toBeDefined();
    expect(a.heldFile(ids[8])).toBeDefined();
  });

  it("a dismissed chooser holds nothing", async () => {
    const a = createWebAdapter(deps({ pickFile: async () => null }));
    expect(await a.attachPhoto()).toBeNull();
    expect(a.heldFile("att_1")).toBeUndefined();
  });

  it("maps a chosen PDF to a pdf attachment", async () => {
    const a = createWebAdapter(deps({ pickFile: async () => file("g120.pdf", "application/pdf") }));
    expect(await a.attachFile()).toEqual({
      id: "att_1", name: "g120.pdf", mediaType: "application/pdf", kind: "pdf", status: "ready",
    });
  });

  it("maps a chosen image to a photo attachment", async () => {
    const a = createWebAdapter(deps({ pickFile: async () => file("nameplate.jpg", "image/jpeg") }));
    expect((await a.attachPhoto())?.kind).toBe("photo");
  });

  it("classifies a .pdf whose type the browser left blank", async () => {
    // Browsers hand back an empty `type` for unregistered extensions; the name
    // is then the only signal, and getting this wrong uploads a PDF as binary.
    const a = createWebAdapter(deps({ pickFile: async () => file("manual.PDF", "") }));
    const att = await a.attachFile();
    expect(att?.kind).toBe("pdf");
    expect(att?.mediaType).toBe("application/octet-stream");
  });

  it("returns null when the chooser is dismissed", async () => {
    const a = createWebAdapter(deps({ pickFile: async () => null }));
    expect(await a.attachFile()).toBeNull();
    expect(await a.attachPhoto()).toBeNull();
    expect(await a.attachCamera()).toBeNull();
  });

  it("asks for the rear camera on attachCamera and not on attachPhoto", async () => {
    const pickFile: WebAdapterDeps["pickFile"] & ReturnType<typeof vi.fn> =
      vi.fn(async (_accept: string, _capture?: "environment" | "user") => file("p.jpg", "image/jpeg"));
    const a = createWebAdapter(deps({ pickFile }));
    await a.attachCamera();
    await a.attachPhoto();
    expect(pickFile.mock.calls[0]?.[1]).toBe("environment");
    expect(pickFile.mock.calls[1]?.[1]).toBeUndefined();
  });

  it("marks a selected file ready, never uploaded", async () => {
    // "ready" means selected. If the adapter claimed a completed upload the host
    // would skip its own queue/failure handling.
    const a = createWebAdapter(deps({ pickFile: async () => file("a.txt", "text/plain") }));
    expect((await a.attachFile())?.status).toBe("ready");
  });
});

describe("scanMachine — unsupported on web, and not faked", () => {
  it("returns null rather than inventing a machine id", async () => {
    // A plausible id here would give the shell an asset context no human
    // confirmed — what the UNS confirmation gate exists to prevent.
    expect(await createWebAdapter(deps()).scanMachine()).toBeNull();
  });
});

describe("shareArtifact", () => {
  it("shares via Web Share and reports shared", async () => {
    const share = vi.fn(async (_data: { title?: string; text?: string; url?: string }) => {});
    expect(await createWebAdapter(deps({ share })).shareArtifact("art_7")).toBe("shared");
    expect(share.mock.calls[0]?.[0].url).toBe("https://app.factorylm.com/artifacts/art_7");
  });

  it("percent-encodes the artifact id", async () => {
    const share = vi.fn(async (_data: { title?: string; text?: string; url?: string }) => {});
    await createWebAdapter(deps({ share })).shareArtifact("a b/c");
    expect(share.mock.calls[0]?.[0].url).toBe("https://app.factorylm.com/artifacts/a%20b%2Fc");
  });

  it("reports cancelled when the browser has no Web Share", async () => {
    expect(await createWebAdapter(deps({ share: undefined })).shareArtifact("art_7")).toBe("cancelled");
  });

  it("reports cancelled when the share sheet rejects", async () => {
    // A dismissal and a failure are indistinguishable here; "not shared" is the
    // only answer that is true in both cases.
    const share = vi.fn(async () => { throw new Error("AbortError"); });
    expect(await createWebAdapter(deps({ share })).shareArtifact("art_7")).toBe("cancelled");
  });
});

describe("onBack", () => {
  it("handles back when there is history to pop", () => {
    const back = vi.fn();
    expect(createWebAdapter(deps({ history: { length: 3, back } })).onBack()).toBe("handled");
    expect(back).toHaveBeenCalledOnce();
  });

  it("passes on a fresh tab instead of swallowing the gesture", () => {
    // history.length === 1 means back() does nothing. Claiming "handled" would
    // strand the user on the current layer with a dead Back.
    const back = vi.fn();
    expect(createWebAdapter(deps({ history: { length: 1, back } })).onBack()).toBe("pass");
    expect(back).not.toHaveBeenCalled();
  });
});

describe("photo previews and paste/drop intake (upload parity, 2026-10-05)", () => {
  function urls() {
    let n = 0;
    const revoked: string[] = [];
    return {
      revoked,
      createObjectURL: (_: File) => `blob:test/${++n}`,
      revokeObjectURL: (u: string) => { revoked.push(u); },
    };
  }

  it("gives a picked photo a local preview, and a PDF none", async () => {
    const u = urls();
    let next: File = file("plate.jpg", "image/jpeg");
    const a = createWebAdapter(deps({ ...u, pickFile: async () => next }));
    expect((await a.attachPhoto())?.previewUrl).toBe("blob:test/1");
    next = file("g120.pdf", "application/pdf");
    expect((await a.attachFile())?.previewUrl).toBeUndefined();
  });

  it("releases the preview on remove and on release after send, keeps it through forget, and on eviction", async () => {
    const u = urls();
    const a = createWebAdapter(deps({ ...u, pickFile: async () => file("p.jpg", "image/jpeg") }));
    const removed = (await a.attachPhoto())!;
    a.release!(removed.id);
    expect(u.revoked).toEqual([removed.previewUrl]);
    expect(a.heldFile(removed.id)).toBeUndefined();

    // Sent: the host forgets the bytes, but the outgoing message still shows
    // the picture — the preview survives until the host releases it.
    const sent = (await a.attachPhoto())!;
    a.forget(sent.id);
    expect(a.heldFile(sent.id)).toBeUndefined();
    expect(u.revoked).not.toContain(sent.previewUrl);
    a.release!(sent.id);
    expect(u.revoked).toContain(sent.previewUrl);

    const first = (await a.attachPhoto())!;
    for (let i = 0; i < 8; i++) await a.attachPhoto();
    expect(u.revoked).toContain(first.previewUrl); // oldest evicted past MAX_HELD
  });

  it("adopts pasted/dropped files through the same accept rule as the File picker", () => {
    const u = urls();
    const a = createWebAdapter(deps(u));
    const taken = a.adoptFiles!([
      file("plate.jpg", "image/jpeg"),
      file("manual.pdf", "application/pdf"),
      file("readings.csv", ""),
      file("setup.exe", "application/x-msdownload"),
    ]);
    expect(taken.map((t) => [t.name, t.kind])).toEqual([["plate.jpg", "photo"], ["manual.pdf", "pdf"], ["readings.csv", "file"]]);
    expect(taken[0].previewUrl).toBe("blob:test/1");
    for (const t of taken) expect(a.heldFile(t.id)).toBeDefined();
  });

  it("a dropped PDF with no MIME type is taken, as the picker takes it (#4288 Codex r1 F2)", () => {
    const a = createWebAdapter(deps(urls()));
    const [pdf] = a.adoptFiles!([file("manual.PDF", "")]);
    expect(pdf).toMatchObject({ name: "manual.PDF", kind: "pdf", mediaType: "application/octet-stream" });
    expect(a.heldFile(pdf.id)).toBeDefined();
  });
});

// #5788: on Android Chrome, Attach then File dropped the chosen file. The event
// order below was recorded on the Samsung SM-X510 (Chrome 157) on 2026-11-22.
// A camera-permission prompt (the accept list includes image/*) hands the page
// focus for about 37 ms before the chooser opens. The old fallback armed on that
// focus, settled the pick with null 500 ms later while the chooser was still
// open, and the file the technician then picked arrived on a detached input.
describe("browser file picker settles only on a real outcome (#5788)", () => {
  class FakeInput extends EventTarget {
    type = "";
    accept = "";
    style: Record<string, string> = {};
    files: File[] | null = [];
    clicked = 0;
    constructor(private readonly attached: Set<FakeInput>) { super(); }
    setAttribute() {}
    click() { this.clicked++; }
    remove() { this.attached.delete(this); }
  }

  let attached: Set<FakeInput>;
  let win: EventTarget;
  let inputs: FakeInput[];

  beforeEach(() => {
    vi.useFakeTimers();
    attached = new Set();
    inputs = [];
    win = Object.assign(new EventTarget(), {
      location: { origin: "https://app.factorylm.com" },
      history: { length: 1, back() {} },
    });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      createElement: () => { const el = new FakeInput(attached); inputs.push(el); return el; },
      body: {
        appendChild: (el: FakeInput) => { attached.add(el); },
        contains: (el: FakeInput) => attached.has(el),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function pick() {
    let outcome: { file: File | null } | undefined;
    void browserAdapterDeps().pickFile("application/pdf,.pdf,image/*,.csv,.txt,.md").then((file) => { outcome = { file }; });
    const input = inputs[inputs.length - 1]!;
    return { input, settled: () => outcome };
  }
  const fire = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type));
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("keeps the pick open through the focus a permission prompt hands back, and takes the file picked after it", async () => {
    const { input, settled } = pick();
    expect(input.clicked).toBe(1);
    fire(win, "blur");                       // camera-permission prompt opens
    await vi.advanceTimersByTimeAsync(14_000);
    fire(win, "focus");                      // prompt answered: focus comes back briefly
    await vi.advanceTimersByTimeAsync(37);
    fire(win, "blur");                       // the "Choose an action" chooser opens
    await vi.advanceTimersByTimeAsync(20_000); // technician picks Files, then the PDF
    expect(settled()).toBeUndefined();
    expect(attached.has(input)).toBe(true);

    const pdf = file("manual.pdf", "application/pdf");
    fire(win, "focus");
    await vi.advanceTimersByTimeAsync(130);
    input.files = [pdf];
    fire(input, "change");
    await flush();
    expect(settled()).toEqual({ file: pdf });
    expect(attached.has(input)).toBe(false);
  });

  it("settles with null when the chooser is dismissed and the browser says so", async () => {
    const { input, settled } = pick();
    fire(win, "blur");
    await vi.advanceTimersByTimeAsync(3_600);
    fire(input, "cancel");
    await flush();
    expect(settled()).toEqual({ file: null });
    expect(attached.has(input)).toBe(false);
  });

  it("still settles when a browser never sends cancel, once the page has kept focus, so the composer is not left busy", async () => {
    const { input, settled } = pick();
    fire(win, "blur");
    await vi.advanceTimersByTimeAsync(3_600);
    fire(win, "focus");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toEqual({ file: null });
    expect(attached.has(input)).toBe(false);
  });

  it("the focus fallback takes a file that is already on the input when change never fired", async () => {
    const { input, settled } = pick();
    fire(win, "blur");
    const pdf = file("manual.pdf", "application/pdf");
    input.files = [pdf];
    fire(win, "focus");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toEqual({ file: pdf });
  });

  it("a late focus after the pick settled does nothing", async () => {
    const { input, settled } = pick();
    const pdf = file("manual.pdf", "application/pdf");
    input.files = [pdf];
    fire(input, "change");
    await flush();
    expect(settled()).toEqual({ file: pdf });
    fire(win, "focus");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled()).toEqual({ file: pdf });
  });
});
