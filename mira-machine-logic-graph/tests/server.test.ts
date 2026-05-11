import { describe, expect, test } from "bun:test";
import { createApp } from "../src/server.ts";

async function pickPort(): Promise<number> {
  return 8090 + Math.floor(Math.random() * 100);
}

describe("server", () => {
  test("GET /projects returns the registered projects", async () => {
    const app = createApp();
    const port = await pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/projects`);
      expect(r.status).toBe(200);
      const body = (await r.json()) as Array<{ id: string }>;
      expect(body.some((p) => p.id === "micro820-conveyor")).toBe(true);
    } finally {
      server.close();
    }
  });

  test("GET /projects/:id/ignition-tags returns a Provider export", async () => {
    const app = createApp();
    const port = await pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/projects/micro820-conveyor/ignition-tags`);
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        export: { tagType: string; tags: Array<{ name: string; tags: unknown[] }> };
        stats: { tagsEmitted: number };
      };
      expect(body.export.tagType).toBe("Provider");
      expect(body.export.tags[0].name).toBe("Conveyor");
      expect(body.stats.tagsEmitted).toBeGreaterThan(10);
    } finally {
      server.close();
    }
  });

  test("GET /projects/:id/ignition-tags returns 404 for unknown project", async () => {
    const app = createApp();
    const port = await pickPort();
    const server = app.listen(port);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/projects/nope/ignition-tags`);
      expect(r.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
