/**
 * Checks marketing copy against the global and Back App safety rules, the same code the Content Studio runs.
 *   npx tsx scripts/check-copy.ts <file.json>
 * The file maps a name to { channel, format, text } (channel/format pick the length limits, e.g. instagram + carousel).
 */
import { readFileSync } from "node:fs";
import { checkText, outcomeOf } from "../src/domain/guardrails";
import { BACK_APP_GUARDRAILS } from "../src/domain/seed/back-app";

const posts = JSON.parse(readFileSync(process.argv[2], "utf8")) as Record<string, { channel: string; format: string; text: string }>;
let blocked = 0;
for (const [name, post] of Object.entries(posts)) {
  const findings = checkText(post, BACK_APP_GUARDRAILS);
  const outcome = outcomeOf(findings);
  if (outcome === "block") blocked++;
  console.log(`${name}: ${outcome}${findings.length ? " — " + findings.map((f) => `${f.code}${"match" in f ? ` "${(f as { match?: string }).match}"` : ""}`).join("; ") : ""}`);
}
process.exit(blocked ? 1 : 0);
