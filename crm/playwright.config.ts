import { defineConfig, devices } from "@playwright/test";
import { testAppUrl, testOwnerUrl } from "./test-env";

process.env.CRM_TEST_OWNER_URL = testOwnerUrl;
const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    // Test-only: fake LLM (ignored in production) and a throwaway master key.
    env: { DATABASE_URL: testAppUrl, CRM_FAKE_MODEL: "1", CRM_ENCRYPTION_KEY: "0f".repeat(32) },
  },
});
