import "./load-env";
import { migrate } from "../src/server/db/migrator";

const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  process.exit(1);
}
const { applied, skipped } = await migrate(url);
console.log(`Migrations applied: ${applied.length ? applied.join(", ") : "none"} (already applied: ${skipped.length})`);
