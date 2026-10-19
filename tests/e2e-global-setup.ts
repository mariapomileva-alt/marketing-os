import { existsSync } from "node:fs";
import { Client } from "pg";
import { migrate } from "../src/server/db/migrator";

/**
 * Playwright runs against its own database (E2E_DATABASE_URL, default: TEST_DATABASE_URL with an _e2e_test name),
 * recreated on every run, so end-to-end products never pile up in the development database.
 */
export function e2eDatabaseUrl() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set");
  const u = new URL(base);
  u.pathname = "/marketing_os_e2e_test";
  return u.toString();
}

export default async function setup() {
  const url = e2eDatabaseUrl();
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  if (!/_test$/.test(dbName)) throw new Error(`Refusing to reset a database that does not end with _test: ${dbName}`);
  u.pathname = "/postgres";
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  await c.query(`drop database if exists ${dbName} with (force)`);
  await c.query(`create database ${dbName}`);
  await c.end();
  await migrate(url);
}
