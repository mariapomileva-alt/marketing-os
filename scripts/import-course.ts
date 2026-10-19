/**
 * Imports the course vault (zip) and AJTBD files into a workspace as methodology.
 * Usage: npm run knowledge:import-course -- <vault.zip> [extra files...] [--workspace <id>]
 * Raw files are read from disk only; they are not copied into the repository.
 */
import "./load-env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closePools, withContext } from "../src/server/db/client";
import { importCourse, readCourseFiles } from "../src/server/services/knowledge";

const args = process.argv.slice(2);
const wsFlag = args.indexOf("--workspace");
const workspaceArg = wsFlag >= 0 ? args.splice(wsFlag, 2)[1] : undefined;
if (!args.length) {
  console.error("Usage: npm run knowledge:import-course -- <vault.zip> [extra files...] [--workspace <id>]");
  process.exit(1);
}
const zipPath = args.find((a) => a.toLowerCase().endsWith(".zip"));
const extras = args.filter((a) => a !== zipPath);

const files = readCourseFiles({
  zip: zipPath ? new Uint8Array(await readFile(zipPath)) : undefined,
  files: await Promise.all(extras.map(async (f) => ({ name: path.basename(f), bytes: new Uint8Array(await readFile(f)) }))),
});

const result = await withContext({ userId: null, role: "service", actorType: "system", reason: "course methodology import" }, async (tx) => {
  const ws = workspaceArg ?? (await tx.one<{ id: string }>("select id from workspaces order by created_at limit 1")).id;
  return importCourse(tx, ws, files);
});
console.log(`Imported ${result.imported} sources (${result.duplicates} already present), ${result.participantsPseudonymised} participants pseudonymised, ${result.playbookRules} playbook rules proposed.`);
for (const s of result.skipped) console.log(`Skipped ${s.path}: ${s.reason}`);
await closePools();
