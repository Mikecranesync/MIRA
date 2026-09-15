/**
 * The web PlatformAdapter's contract, branch by branch (#3806 step 1).
 *
 * The cases that matter most are the ones where the adapter must say "no":
 * a web scan that cannot happen, and a share that did not complete. Both have
 * a plausible-looking wrong answer available, and returning it would hand the
 * shell state no human confirmed.
 */
import { describe, expect, it, vi } from "vitest";

import { createWebAdapter, type WebAdapterDeps } from "./web-adapter";

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
    const pickFile = vi.fn(async () => file("p.jpg", "image/jpeg"));
    const a = createWebAdapter(deps({ pickFile }));
    await a.attachCamera();
    await a.attachPhoto();
    expect(pickFile.mock.calls[0][1]).toBe("environment");
    expect(pickFile.mock.calls[1][1]).toBeUndefined();
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
    const share = vi.fn(async () => {});
    expect(await createWebAdapter(deps({ share })).shareArtifact("art_7")).toBe("shared");
    expect(share.mock.calls[0][0].url).toBe("https://app.factorylm.com/artifacts/art_7");
  });

  it("percent-encodes the artifact id", async () => {
    const share = vi.fn(async () => {});
    await createWebAdapter(deps({ share })).shareArtifact("a b/c");
    expect(share.mock.calls[0][0].url).toBe("https://app.factorylm.com/artifacts/a%20b%2Fc");
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
