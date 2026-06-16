/**
 * mira-machine-logic-graph Express API.
 *
 * Routes:
 *   GET /health
 *   GET /projects
 *   GET /projects/:id
 *   GET /projects/:id/ignition-tags   -- CRA-235
 */

import express from "express";
import { PROJECTS, findProject } from "./projects/registry.ts";
import { buildTagsForProject } from "./ignition/build-for-project.ts";
import { handleLiveTroubleshoot } from "./api/live-troubleshoot.ts";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "mira-machine-logic-graph", version: "0.1.0" });
  });

  app.get("/projects", (_req, res) => {
    res.json(PROJECTS.map((p) => ({ id: p.id, name: p.name })));
  });

  app.get("/projects/:id", (req, res) => {
    const p = findProject(req.params.id);
    if (!p) {
      res.status(404).json({ error: "project_not_found", id: req.params.id });
      return;
    }
    res.json({ id: p.id, name: p.name, ignition: p.ignition });
  });

  app.post("/projects/:id/live-troubleshoot", (req, res) => {
    void handleLiveTroubleshoot(req, res);
  });

  app.get("/projects/:id/ignition-tags", (req, res) => {
    const p = findProject(req.params.id);
    if (!p) {
      res.status(404).json({ error: "project_not_found", id: req.params.id });
      return;
    }
    try {
      const result = buildTagsForProject(p);
      res.json({
        projectId: p.id,
        generatedAt: new Date().toISOString(),
        stats: result.stats,
        export: result.export,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "build_failed", message });
    }
  });

  return app;
}

// Run directly: `bun run src/server.ts`
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8090);
  const app = createApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`mira-machine-logic-graph listening on :${port}`);
  });
}
