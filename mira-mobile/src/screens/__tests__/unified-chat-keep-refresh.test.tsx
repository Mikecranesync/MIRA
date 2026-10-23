// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { HostHooks } from "@factorylm/ui";
const mocks = vi.hoisted(() => ({ request: vi.fn(), binary: vi.fn(), detail: vi.fn(), hooks: null as HostHooks | null }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p }, CapacitorHttp: { request: vi.fn() }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} } }));
vi.mock("../../api/client", async (original) => ({ ...await original<typeof import("../../api/client")>(), request: mocks.request, requestBinary: mocks.binary }));
vi.mock("../../api/resources", async (original) => ({ ...await original<typeof import("../../api/resources")>(), getNotebookDetail: mocks.detail }));
vi.mock("../../api/manual-search-status", () => ({ fetchManualSearchStatus: async () => null }));
vi.mock("@factorylm/ui", async (original) => ({ ...await original<typeof import("@factorylm/ui")>(), FactoryLMShell: ({ hooks }: { hooks: HostHooks }) => { mocks.hooks = hooks; return null; } }));
import { UnifiedChat } from "../UnifiedChat";
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
function mount() {
  render(<UnifiedChat turns={[]} liveTurns={[]} pending={null} busy={false} canStop canRetry chatError={null}
    handlers={{ onSend: () => {}, onStop: () => {}, onRetry: () => {}, onCitation: () => {} }}
    meta={{ notebookId: "nb-1", threadId: "notebook-nb-1:thread-legacy", title: "Machine", identityConfirmed: true }} />);
}
describe("real mobile Keep callback", () => {
  it("reports a committed save with failed refresh, then recovers without another POST", async () => {
    mocks.request.mockResolvedValue({ ok: true });
    mocks.detail.mockRejectedValue(new Error("offline"));
    mount();
    let result: unknown;
    await act(async () => { result = await mocks.hooks!.onKeepPhoto!("photo-1"); });
    expect(result).toBe("refresh_pending");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.hooks!.isPhotoKept!("photo-1")).toBe(true);
    mocks.detail.mockResolvedValue({ notebook: {}, sources: [{ docId: "doc-1", originFileId: "photo-1", enabledByDefault: true, matchState: "user_confirmed" }], turns: [], threads: [], photos: [] });
    await act(async () => { expect(await mocks.hooks!.onRefreshPhotoScope!()).toBe(true); });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("rejects a failed POST rather than claiming partial success", async () => {
    mocks.request.mockRejectedValue(new Error("save failed"));
    mocks.detail.mockResolvedValue({ notebook: {}, sources: [], turns: [], threads: [], photos: [] });
    mount();
    await act(async () => { await expect(mocks.hooks!.onKeepPhoto!("photo-1")).rejects.toThrow("save failed"); });
    expect(mocks.hooks!.isPhotoKept!("photo-1")).toBe(false);
  });
  it("uses the existing authenticated FilePreview for the photo under review", async () => {
    vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:original-photo"; } static revokeObjectURL() {} });
    mocks.binary.mockResolvedValue({status:200,bytes:new Uint8Array([1,2,3]),contentType:"image/png"});
    mount();
    expect(mocks.hooks?.renderPhoto).toBeTypeOf("function");
    const view = render(<>{mocks.hooks!.renderPhoto!("photo-under-review")}</>);
    await waitFor(() => expect(view.getByRole("img", {name:"Original photo"}).getAttribute("src")).toBe("blob:original-photo"));
    expect(mocks.binary).toHaveBeenCalledWith("/api/namespace/files/photo-under-review/");
  });

});
