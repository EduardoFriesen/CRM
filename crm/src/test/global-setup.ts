import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

// Applies migrations as the owner role before any test runs.
export default async function setup(project: TestProject) {
  const url = project.config.env.CRM_TEST_OWNER_URL;
  if (!url) throw new Error("CRM_TEST_OWNER_URL is required");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql.end();
  }
}
