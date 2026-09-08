import { resolve } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { findReactDuplication } from "./single-react";

// Fail on the precondition, not on its symptom. Without this, a run that skipped
// `bootstrap:ui` reports five "Invalid hook call" failures inside the shell
// suites — an error five frames from its cause, which two sessions independently
// mistook for a flaky suite (#3692).
const duplication = findReactDuplication(
  resolve(import.meta.dir, ".."),
  resolve(import.meta.dir, "../../../packages/factorylm-ui"),
);
if (duplication) throw new Error(duplication);

GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
