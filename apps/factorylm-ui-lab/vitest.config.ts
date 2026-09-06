import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      allow: ["../.."],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "../../packages/**/src/__tests__/**/*.test.{ts,tsx}",
      "src/__tests__/**/*.test.{ts,tsx}",
    ],
  },
});
