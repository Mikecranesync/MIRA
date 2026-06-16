/**
 * Photo upload probe — verifies the picker accepts images, local JPEG
 * round-trips through /ingest/photo, and Google Drive photo pick works
 * end-to-end. Assumes the hub is live at app.factorylm.com.
 */
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";

test.setTimeout(180_000);

test("photo upload — local JPEG round-trip to /ingest/photo", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "mike@factorylm.com");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button:has-text("Sign In")');
  await page.waitForURL(/\/hub\/feed/, { timeout: 15_000 });

  // Generate a tiny valid JPEG in-memory (1×1 white pixel). Pillow/Sharp
  // can decode this; no external fixture needed.
  const onePixelJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
    "base64",
  );

  const filename = `probe-local-photo-${Date.now()}.jpg`;
  const uploadRes = await page.request.post(`${HUB}/api/uploads/local`, {
    multipart: {
      file: {
        name: filename,
        mimeType: "image/jpeg",
        buffer: onePixelJpeg,
      },
    },
  });
  expect(uploadRes.ok(), `upload failed: ${uploadRes.status()}`).toBeTruthy();
  const created = (await uploadRes.json()) as { id: string; kind?: string; status: string };
  expect(created.kind).toBe("photo");

  // Poll until terminal
  let terminal: string | null = null;
  let detail: string | null = null;
  for (let i = 0; i < 40 && !terminal; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const list = await page.request.get(`${HUB}/api/uploads`);
    const rows = (await list.json()) as Array<{
      id: string;
      status: string;
      statusDetail: string | null;
    }>;
    const me = rows.find((r) => r.id === created.id);
    if (me && ["parsed", "failed", "cancelled"].includes(me.status)) {
      terminal = me.status;
      detail = me.statusDetail ?? null;
    }
  }

  console.log(`Local JPEG probe: id=${created.id}, terminal=${terminal}, detail=${detail}`);
  expect(terminal).toBe("parsed");

  await ctx.close();
});

test("photo upload — Google Drive JPEG round-trip to /ingest/photo", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "mike@factorylm.com");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button:has-text("Sign In")');
  await page.waitForURL(/\/hub\/feed/, { timeout: 15_000 });

  // 1. Drive access token
  const tokenRes = await page.request.get(`${HUB}/api/picker/google/token`);
  if (!tokenRes.ok()) {
    console.log("Google Drive not connected — skipping cloud photo probe");
    await ctx.close();
    return;
  }
  const { accessToken } = (await tokenRes.json()) as { accessToken: string };

  // 2. Find any image in Drive
  const listRes = await page.request.get(
    "https://www.googleapis.com/drive/v3/files?" +
      new URLSearchParams({
        q: "(mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp') and trashed=false",
        pageSize: "5",
        fields: "files(id,name,size,mimeType,modifiedTime)",
        orderBy: "modifiedTime desc",
      }).toString(),
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const list = (await listRes.json()) as {
    files?: Array<{
      id: string;
      name: string;
      size: string;
      mimeType: string;
      modifiedTime: string;
    }>;
  };

  if (!list.files || list.files.length === 0) {
    console.log("No image in Drive — skipping cloud photo probe");
    await ctx.close();
    return;
  }

  const candidate =
    list.files
      .filter((f) => Number(f.size) < 10 * 1024 * 1024)
      .sort((a, b) => Number(a.size) - Number(b.size))[0] ?? list.files[0];

  console.log(`Picking Drive image: ${candidate.name} (${candidate.size} bytes, ${candidate.mimeType})`);

  const postRes = await page.request.post(`${HUB}/api/uploads`, {
    data: {
      provider: "google",
      externalFileId: candidate.id,
      filename: candidate.name,
      mimeType: candidate.mimeType,
      sizeBytes: Number(candidate.size),
      externalCreatedAt: candidate.modifiedTime,
    },
    headers: { "Content-Type": "application/json" },
  });
  expect(postRes.ok()).toBeTruthy();
  const created = (await postRes.json()) as { id: string; kind?: string };
  expect(created.kind).toBe("photo");

  let terminal: string | null = null;
  let detail: string | null = null;
  for (let i = 0; i < 60 && !terminal; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const rows = (await (await page.request.get(`${HUB}/api/uploads`)).json()) as Array<{
      id: string;
      status: string;
      statusDetail: string | null;
    }>;
    const me = rows.find((r) => r.id === created.id);
    if (me && ["parsed", "failed", "cancelled"].includes(me.status)) {
      terminal = me.status;
      detail = me.statusDetail ?? null;
    }
  }

  console.log(`Drive photo probe: id=${created.id}, terminal=${terminal}, detail=${detail}`);
  expect(terminal).toBe("parsed");

  await ctx.close();
});
