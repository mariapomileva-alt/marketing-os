import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies db/migrations/*.sql in name order, each in its own transaction.
 * A migration that was already applied with a different checksum aborts the run:
 * applied migrations are never edited, a new file is added instead.
 */
export async function migrate(connectionString: string, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const client = new Client({ connectionString });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query(`create table if not exists public.schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Map<string, string>(
      (await client.query<{ version: string; checksum: string }>("select version, checksum from public.schema_migrations")).rows.map(
        (r) => [r.version, r.checksum],
      ),
    );
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was changed after it was applied. Add a new migration instead.`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public.schema_migrations (version, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
        result.applied.push(file);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return result;
}
