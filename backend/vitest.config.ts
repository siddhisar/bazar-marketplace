import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The DB-backed suites share one fixture user; running them one at a
    // time (rather than vitest's default parallel workers) keeps two suites
    // from wiping the fixture out from under each other mid-run.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
