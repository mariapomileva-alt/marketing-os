import { existsSync } from "node:fs";
import { Client } from "pg";
import { migrate } from "../src/server/db/migrator";

/** Recreates the test database and applies all migrations once per test run. */
export default async function setup() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  if (!/_test$/.test(dbName)) throw new Error(`Refusing to reset a database that does not end with _test: ${dbName}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`drop database if exists ${dbName} with (force)`);
  await c.query(`create database ${dbName}`);
  await c.end();
  await migrate(url);
  process.env.DATABASE_URL = url;
}
