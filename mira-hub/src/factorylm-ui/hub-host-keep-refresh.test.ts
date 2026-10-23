/** Execute real host callbacks with controlled dependencies; shared mounted
 * card tests separately prove the visible recovery controls. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("hub-host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string, fetch: unknown, loadDetail: unknown) {
  let initializer = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) initializer = node.initializer!.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  expect(initializer).not.toBe("");
  const compiled = ts.transpileModule(`const callback = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function("fetch", "loadDetail", "selectionRef", "API_BASE", "useCallback", `${compiled}\nreturn callback;`)(
    fetch, loadDetail, { current: { notebookId: "machine-1", threadId: "thread-1" } }, "", (fn: unknown) => fn,
  );
}
describe("Hub photo save and source refresh outcomes", () => {
  it.each([false, "throw"])("reports saved but stale scope for %s refresh", async (outcome) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const refresh = outcome === "throw" ? vi.fn().mockRejectedValue(new Error("offline")) : vi.fn().mockResolvedValue(false);
    expect(await callback("onKeepPhoto", fetch, refresh)("photo-1")).toBe("refresh_pending");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ notebookId: "machine-1", threadId: "thread-1" });
  });
  it("refresh retry never posts the photo again", async () => {
    const fetch = vi.fn();
    const refresh = vi.fn().mockResolvedValue(true);
    expect(await callback("onRefreshPhotoScope", fetch, refresh)()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("a failed write rejects without refreshing", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const refresh = vi.fn();
    await expect(callback("onKeepPhoto", fetch, refresh)("photo-1")).rejects.toThrow("keep_photo_503");
    expect(refresh).not.toHaveBeenCalled();
  });
});
