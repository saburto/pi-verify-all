import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@earendil-works/pi-coding-agent":
        "./src/__tests__/mocks/pi-agent.ts",
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: true,
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    singleFork: false,
  },
});
