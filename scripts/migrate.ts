import "./load-env";
import { migrate } from "../src/server/db/migrator";
import { databaseUrl } from "../src/server/env";

const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : databaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  process.exit(1);
}
const { applied, skipped } = await migrate(url);
console.log(`Migrations applied: ${applied.length ? applied.join(", ") : "none"} (already applied: ${skipped.length})`);
