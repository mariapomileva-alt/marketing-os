/**
 * Seeds data into the first workspace.
 *   npm run db:seed         → Back App with its rules (real configuration, not demo).
 *   npm run db:seed:demo    → a separate demo product with clearly flagged demo publications and metrics,
 *                             so the Analytics screen can be tried. Demo rows have is_demo = true and never
 *                             mix with real products.
 * Requires a signed-in owner to exist (sign in once first).
 */
import "./load-env";
import { closePools, withContext } from "../src/server/db/client";
import { createBackApp } from "../src/server/services/products";
import { seedDemo } from "../src/server/services/demo";

const demo = process.argv.includes("--demo");

async function owner() {
  return withContext({ userId: null, role: "service" }, (tx) =>
    tx.one<{ user_id: string; workspace_id: string }>("select user_id, workspace_id from workspace_members where role = 'owner' order by created_at limit 1"),
  );
}

const o = await owner().catch(() => null);
if (!o) {
  console.error("No owner yet. Start the app and sign in once, then run the seed again.");
  process.exit(1);
}
await withContext({ userId: o.user_id, role: "service", actorType: "system", reason: demo ? "demo seed" : "Back App seed" }, async (tx) => {
  if (demo) {
    const r = await seedDemo(tx, o.workspace_id);
    console.log(r.created ? `Demo product "Demo: Calm app" created with ${r.publications} demo publications.` : "Demo product already exists (demo-calm).");
  }
  else {
    const p = await createBackApp(tx, o.workspace_id);
    console.log(`Back App ready (/p/${p.slug}).`);
  }
});
await closePools();
