import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testAppUrl, testOwnerUrl, testRedisUrl } from "./test-env";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    fileParallelism: false,
    env: {
      CRM_TEST_OWNER_URL: testOwnerUrl,
      DATABASE_URL: testAppUrl,
      REDIS_URL: testRedisUrl,
      // Test-only master key; never used outside the test runner.
      CRM_ENCRYPTION_KEY: "0f".repeat(32),
    },
  },
});
