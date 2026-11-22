import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Opt-in real database suite; its own guard requires a named disposable
// loopback database and separate non-DDL runtime/admin connections.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/capabilities/__tests__/free-technician-signup.integration.test.ts"],
    exclude: [],
  },
});
