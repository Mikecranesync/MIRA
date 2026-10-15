/**
 * Stranger Walk replay config (#4460): the fidelity harness's local `next dev`
 * (throwaway AUTH_SECRET, basePath /hub, every /api request served or aborted),
 * running replay.spec.ts instead. $0 — nothing leaves the machine.
 */
import { defineConfig } from "@playwright/test";
import fidelity from "../fidelity/playwright.fidelity.config";

export default defineConfig({
  ...fidelity,
  testDir: ".",
  testMatch: ["replay.spec.ts"],
  timeout: 60 * 60_000,
});
