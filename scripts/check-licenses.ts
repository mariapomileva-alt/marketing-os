/**
 * Lists the licences of installed production dependencies and fails on licences that would
 * restrict how Marketing OS can be used or distributed (copyleft or unknown). Reads node_modules only;
 * it never downloads or runs anything.
 *   npm run licenses
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ALLOWED = /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|OFL-1\.1|CC0-1\.0|Unlicense|Python-2\.0|CC-BY-4\.0|MPL-2\.0)$/;
const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function licenceOf(dir: string): string {
  const p = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const l = p.license ?? p.licenses;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x.type)).join(" OR ");
  if (l && typeof l === "object") return l.type ?? "UNKNOWN";
  return "UNKNOWN";
}

function accepted(expr: string) {
  const clean = expr.replace(/[()]/g, "");
  if (clean.includes(" OR ")) return clean.split(" OR ").some((x) => ALLOWED.test(x.trim()));
  return clean.split(" AND ").every((x) => ALLOWED.test(x.trim()));
}

const seen = new Map<string, string>();
const queue: string[] = Object.keys(pkg.dependencies ?? {});
while (queue.length) {
  const name = queue.shift()!;
  if (seen.has(name)) continue;
  const dir = path.join(root, "node_modules", name);
  if (!existsSync(path.join(dir, "package.json"))) continue;
  seen.set(name, licenceOf(dir));
  const deps = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).dependencies ?? {};
  queue.push(...Object.keys(deps));
}

const bad = [...seen].filter(([, l]) => !accepted(l));
const counts = new Map<string, number>();
for (const [, l] of seen) counts.set(l, (counts.get(l) ?? 0) + 1);
console.log(`${seen.size} production packages:`);
for (const [l, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${l}: ${n}`);
if (bad.length) {
  console.error("\nNeeds a look before release:");
  for (const [n, l] of bad) console.error(`  ${n}: ${l}`);
  process.exit(1);
}
console.log("\nNo copyleft or unknown licences in production dependencies.");
