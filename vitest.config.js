import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ESM support
    globals: false,
    environment: "node",

    // Test file patterns
    include: ["tests/**/*.test.js"],

    // Reporters
    reporter: "verbose",

    // Separate timeouts for unit vs integration
    // Individual tests override with { timeout: N } as needed
    testTimeout: 10000,
  },
});
