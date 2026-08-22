/**
 * Delete-confirmation contract + client flow semantics.
 * Hub tests run in node with no jsdom: assert on renderToStaticMarkup output.
 * Run: npx vitest run src/components/equipment/NotebookDeleteDialog.test.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NotebookDeleteDialog } from "./NotebookDeleteDialog";
import {
  createSubmitGuard,
  deleteFailureMessage,
  removeNotebookFromList,
} from "@/lib/notebook-delete";

const render = (over: Partial<Parameters<typeof NotebookDeleteDialog>[0]> = {}) =>
  renderToStaticMarkup(
    <NotebookDeleteDialog
      notebookName="PIXEL PROOF 2026-08-21 Danfoss FC 202"
      deleting={false}
      error={null}
      onCancel={() => {}}
      onConfirm={() => {}}
      {...over}
    />,
  );

describe("NotebookDeleteDialog — confirmation contract", () => {
  it("NAMES the notebook being deleted", () => {
    // Without the name a user cannot tell which notebook they are destroying.
    expect(render()).toContain("PIXEL PROOF 2026-08-21 Danfoss FC 202");
  });

  it("warns that deletion is permanent and irreversible", () => {
    const html = render();
    expect(html).toContain("permanently deleted");
    expect(html).toContain("cannot be undone");
  });

  it("states that uploaded documents are preserved", () => {
    // Deleting a notebook must not read as "this deletes my manuals too".
    expect(render()).toContain("Uploaded documents are kept");
  });

  it("is an alertdialog with an accessible name and description", () => {
    const html = render();
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="delete-nb-title"');
    expect(html).toContain('aria-describedby="delete-nb-desc"');
  });

  it("offers a non-destructive way out", () => {
    expect(render()).toContain("Cancel");
  });

  it("escapes a hostile notebook name instead of injecting markup", () => {
    const html = render({ notebookName: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("NotebookDeleteDialog — in-flight state", () => {
  it("disables both buttons and marks busy while deleting", () => {
    const html = render({ deleting: true });
    expect(html).toContain("aria-busy=\"true\"");
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Deleting…");
  });

  it("shows a failure message in an alert region", () => {
    const html = render({ error: "This notebook is still referenced by another record." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("still referenced by another record");
  });
});

describe("deleteFailureMessage", () => {
  it("maps each status onto an actionable message", () => {
    expect(deleteFailureMessage(404)).toMatch(/no longer exists/i);
    expect(deleteFailureMessage(401)).toMatch(/signed in|isn't yours/i);
    expect(deleteFailureMessage(403)).toMatch(/signed in|isn't yours/i);
    expect(deleteFailureMessage(409)).toMatch(/still referenced/i);
    expect(deleteFailureMessage(500)).toMatch(/try again/i);
    expect(deleteFailureMessage(0)).toMatch(/try again/i);
  });

  it("never surfaces a raw status code to the technician", () => {
    for (const s of [400, 404, 409, 418, 500, 503]) {
      expect(deleteFailureMessage(s)).not.toMatch(/\d{3}/);
    }
  });
});

describe("removeNotebookFromList", () => {
  it("removes the deleted notebook immediately", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(removeNotebookFromList(list, "b")).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("returns a NEW array so React actually re-renders", () => {
    const list = [{ id: "a" }];
    const out = removeNotebookFromList(list, "a");
    expect(out).not.toBe(list);
    expect(list).toHaveLength(1); // input untouched
  });

  it("leaves the list alone when the id is not present", () => {
    const list = [{ id: "a" }];
    expect(removeNotebookFromList(list, "zzz")).toEqual(list);
  });
});

describe("createSubmitGuard — double-submission", () => {
  it("runs the first call and ignores a concurrent second", async () => {
    const guard = createSubmitGuard();
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "done";
    });
    const [a, b] = await Promise.all([guard.run(fn), guard.run(fn)]);
    expect(fn).toHaveBeenCalledTimes(1); // the double-tap is swallowed
    expect(a).toBe("done");
    expect(b).toBeUndefined();
  });

  it("releases after completion so a genuine retry still works", async () => {
    const guard = createSubmitGuard();
    const fn = vi.fn(async () => "ok");
    await guard.run(fn);
    await guard.run(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("releases after a failure — a failed delete must be retryable", async () => {
    const guard = createSubmitGuard();
    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(guard.run(boom)).rejects.toThrow("network");
    expect(guard.busy).toBe(false);
    await expect(guard.run(boom)).rejects.toThrow("network");
    expect(boom).toHaveBeenCalledTimes(2);
  });
});
