// Applies ./drizzle migrations as the crm owner role. Runs in the crm-migrate service.
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is required");

if (!existsSync("./drizzle/meta/_journal.json")) {
  console.log("no migrations to apply");
  process.exit(0);
}

const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} finally {
  await sql.end();
}
