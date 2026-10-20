import "./load-env";
import { migrate } from "../src/server/db/migrator";
import { databaseUrl } from "../src/server/env";

const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : databaseUrl();
if (!url) {
  if (process.env.VERCEL) {
    // Hosted build before the database is connected: build anyway, so the sign-in page can say what is missing.
    console.warn("[migrate] No database configured (DATABASE_URL / POSTGRES_URL). Skipping migrations.");
    process.exit(0);
  }
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  process.exit(1);
}
console.log(`[migrate] Applying migrations to ${new URL(url).host}`);
const { applied, skipped } = await migrate(url);
console.log(`Migrations applied: ${applied.length ? applied.join(", ") : "none"} (already applied: ${skipped.length})`);
