import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_ASK_ROUTE_FRAGMENTS,
  SCAN_ASK_FALLBACK,
  SCAN_ASK_SELECTED_VIA,
  isForbiddenAskRoute,
  notebookChatHref,
  notebookOpenPath,
  openScannedAssetAskMira,
} from "../scan-ask-mira";

const ASSET = "asset-cv-101";
const NOTEBOOK = "nb-cv-101";

describe("scan-page Ask MIRA routing", () => {
  it("opens THE notebook for the scanned asset, then Hub equipment chat", () => {
    expect(notebookOpenPath(ASSET)).toBe(`/api/assets/${ASSET}/notebook/`);
    expect(notebookChatHref(NOTEBOOK)).toBe(`/equipment/${NOTEBOOK}`);
  });

  it("encodes ids so a crafted tag cannot break the path", () => {
    expect(notebookOpenPath("a/b?x=1")).toBe("/api/assets/a%2Fb%3Fx%3D1/notebook/");
    expect(notebookChatHref("n/../ask")).toBe("/equipment/n%2F..%2Fask");
  });

  it("never names the retired Ask doors", () => {
    for (const href of [notebookOpenPath(ASSET), notebookChatHref(NOTEBOOK)]) {
      expect(isForbiddenAskRoute(href)).toBe(false);
      for (const fragment of FORBIDDEN_ASK_ROUTE_FRAGMENTS) {
        expect(href.toLowerCase()).not.toContain(fragment);
      }
    }
  });

  it("flags telegram, hub/ask, Open WebUI, ask_api, and pipeline URLs", () => {
    expect(isForbiddenAskRoute("https://t.me/FactoryLMDiagnose_bot?start=asset_CV-101")).toBe(true);
    expect(isForbiddenAskRoute("/api/hub/ask/")).toBe(true);
    expect(isForbiddenAskRoute("https://chat.example/openwebui/c/new")).toBe(true);
    expect(isForbiddenAskRoute("http://mira-pipeline:9099/v1/chat/completions")).toBe(true);
    expect(isForbiddenAskRoute("/ask_api/chat")).toBe(true);
  });
});

describe("openScannedAssetAskMira", () => {
  it("POSTs selectedVia=qr and returns the equipment notebook href", async () => {
    const post = vi.fn(async () => ({
      ok: true,
      body: { notebook: { id: NOTEBOOK } },
    }));
    const out = await openScannedAssetAskMira(ASSET, { post, apiBase: "/hub" });
    expect(out).toEqual({ ok: true, href: `/hub/equipment/${NOTEBOOK}` });
    expect(post).toHaveBeenCalledWith(`/api/assets/${ASSET}/notebook/`, {
      selectedVia: SCAN_ASK_SELECTED_VIA,
    });
    expect(SCAN_ASK_SELECTED_VIA).toBe("qr");
  });

  it("prefers the server's explanation when the notebook cannot open", async () => {
    const out = await openScannedAssetAskMira(ASSET, {
      post: async () => ({
        ok: false,
        body: { error: "That asset hasn't been approved yet, so a notebook can't be opened for it." },
      }),
    });
    expect(out).toEqual({
      ok: false,
      message: "That asset hasn't been approved yet, so a notebook can't be opened for it.",
    });
  });

  it("falls back when the lookup fails or returns no notebook", async () => {
    await expect(
      openScannedAssetAskMira(ASSET, { post: async () => { throw new Error("offline"); } }),
    ).resolves.toEqual({ ok: false, message: SCAN_ASK_FALLBACK });
    await expect(
      openScannedAssetAskMira(ASSET, { post: async () => ({ ok: true, body: {} }) }),
    ).resolves.toEqual({ ok: false, message: SCAN_ASK_FALLBACK });
    await expect(
      openScannedAssetAskMira("  ", { post: async () => ({ ok: true, body: { notebook: { id: NOTEBOOK } } }) }),
    ).resolves.toEqual({ ok: false, message: SCAN_ASK_FALLBACK });
  });

  it("refuses a notebook href that slipped onto a forbidden door", async () => {
    const out = await openScannedAssetAskMira(ASSET, {
      post: async () => ({ ok: true, body: { notebook: { id: NOTEBOOK } } }),
      apiBase: "https://t.me/not-a-real-base",
    });
    expect(out).toEqual({ ok: false, message: SCAN_ASK_FALLBACK });
  });
});

/**
 * Source-level wiring check (same technique as confirmed-sources.test.ts).
 * The /m and /machine scan landings re-export one page; if Ask MIRA grows
 * another Telegram or /api/hub/ask href, this fails before a reviewer has
 * to notice.
 */
describe("mobile scan landing Ask MIRA wiring", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(resolve(here, "../../app/m/[assetTag]/page.tsx"), "utf8");
  const machine = readFileSync(resolve(here, "../../app/machine/[assetTag]/page.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the /machine scan landing is the same page, not a second Ask door", () => {
    expect(machine).toMatch(/export \{ default \} from "\.\.\/\.\.\/m\/\[assetTag\]\/page"/);
  });

  it("opens the scanned asset's Hub notebook instead of Telegram or /api/hub/ask", () => {
    expect(code).toContain("openScannedAssetAskMira");
    expect(code).not.toContain("t.me/");
    expect(code).not.toContain("/api/hub/ask");
    expect(code).not.toContain("ask_api");
    expect(code).not.toContain("openwebui");
    expect(code).not.toContain("mira-pipeline");
    expect(code).not.toMatch(/TELEGRAM_BOT|tgDeepLink|FactoryLMDiagnose_bot/);
  });
});

/**
 * mira-mobile Capacitor scan already opens THE notebook (plan I5) and asks
 * through askNotebook. Lock those files to the same sellable door so a later
 * "convenience" fallback cannot reintroduce pipeline / hub/ask / Open WebUI.
 */
describe("mira-mobile scan → notebook chat wiring", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const resources = strip(readFileSync(resolve(here, "../../../../mira-mobile/src/api/resources.ts"), "utf8"));
  const scanLanding = strip(readFileSync(resolve(here, "../../../../mira-mobile/src/lib/scan-landing.ts"), "utf8"));

  it("askNotebook posts only to /api/equipment-notebooks/:id/chat/", () => {
    expect(resources).toMatch(
      /`\/api\/equipment-notebooks\/\$\{encodeURIComponent\(notebookId\)\}\/chat\/`/,
    );
    for (const fragment of FORBIDDEN_ASK_ROUTE_FRAGMENTS) {
      expect(resources.toLowerCase()).not.toContain(fragment);
    }
  });

  it("a resolved scan opens that machine's notebook", () => {
    expect(scanLanding).toContain('kind: "notebook"');
    expect(scanLanding).toContain("openAssetNotebook");
    for (const fragment of FORBIDDEN_ASK_ROUTE_FRAGMENTS) {
      expect(scanLanding.toLowerCase()).not.toContain(fragment);
    }
  });
});
