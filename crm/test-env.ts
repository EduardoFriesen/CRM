import { existsSync } from "node:fs";

// Tests hit the dev Postgres (docker-compose.dev.yml, 127.0.0.1:55432) using the
// stack's .env passwords unless CRM_TEST_* are already set.
if (!process.env.CRM_TEST_OWNER_URL && existsSync("../.env")) process.loadEnvFile("../.env");
const host = "127.0.0.1:55432";

export const testOwnerUrl =
  process.env.CRM_TEST_OWNER_URL ?? `postgresql://crm:${process.env.CRM_DB_PASSWORD}@${host}/crm`;
export const testAppUrl =
  process.env.CRM_TEST_APP_URL ?? `postgresql://crm_app:${process.env.CRM_APP_DB_PASSWORD}@${host}/crm`;
