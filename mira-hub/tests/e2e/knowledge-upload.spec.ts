import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("local PDF upload reaches Knowledge tab as a parsed row", async ({ request }) => {
  const pdf = await readFile(path.join(__dirname, "fixtures/sample.pdf"));

  const uploadRes = await request.post("/hub/api/uploads/local", {
    multipart: {
      file: {
        name: "e2e-sample.pdf",
        mimeType: "application/pdf",
        buffer: pdf,
      },
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const row = await uploadRes.json();
  expect(row.provider).toBe("local");
  expect(row.filename).toBe("e2e-sample.pdf");

  let terminal: string | null = null;
  for (let i = 0; i < 30 && !terminal; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const listRes = await request.get("/hub/api/uploads");
    const rows = (await listRes.json()) as Array<{ id: string; status: string }>;
    const me = rows.find((r) => r.id === row.id);
    if (me && ["parsed", "failed", "cancelled"].includes(me.status)) {
      terminal = me.status;
    }
  }
  expect(terminal).toBe("parsed");
});

test("uploads/:id DELETE removes parsed row", async ({ request }) => {
  const pdf = await readFile(path.join(__dirname, "fixtures/sample.pdf"));
  const createRes = await request.post("/hub/api/uploads/local", {
    multipart: {
      file: { name: "e2e-delete-me.pdf", mimeType: "application/pdf", buffer: pdf },
    },
  });
  const { id } = await createRes.json();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const list = await request.get("/hub/api/uploads");
    const rows = (await list.json()) as Array<{ id: string; status: string }>;
    if (rows.find((r) => r.id === id)?.status === "parsed") break;
  }

  const del = await request.delete(`/hub/api/uploads/${id}`);
  expect(del.ok()).toBeTruthy();
  const list = await request.get("/hub/api/uploads");
  const rows = (await list.json()) as Array<{ id: string }>;
  expect(rows.find((r) => r.id === id)).toBeUndefined();
});
