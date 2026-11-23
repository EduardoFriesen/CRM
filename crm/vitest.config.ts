import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests hit the dev Postgres (docker-compose.dev.yml, 127.0.0.1:55432)
// using the passwords from the stack's .env unless CRM_TEST_* are already set.
if (!process.env.CRM_TEST_OWNER_URL && existsSync("../.env")) process.loadEnvFile("../.env");
const host = "127.0.0.1:55432";
const ownerUrl = process.env.CRM_TEST_OWNER_URL ?? `postgresql://crm:${process.env.CRM_DB_PASSWORD}@${host}/crm`;
const appUrl = process.env.CRM_TEST_APP_URL ?? `postgresql://crm_app:${process.env.CRM_APP_DB_PASSWORD}@${host}/crm`;

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    fileParallelism: false,
    env: { CRM_TEST_OWNER_URL: ownerUrl, DATABASE_URL: appUrl },
  },
});
