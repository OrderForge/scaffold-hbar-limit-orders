import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only: every one runs offline against the captured fixtures in test/fixtures,
    // so CI never depends on SaucerSwap being up.
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "~~": path.resolve(__dirname, "./"),
    },
  },
});
