import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/cli.ts", "src/http/**", "**/*.d.ts"],
      reporter: ["text", "json-summary", "html"],
    },
    testTimeout: 15_000,
    // E2E tests touch the file system; bumped hook timeout for cold-start reads.
    hookTimeout: 30_000,
  },
});
