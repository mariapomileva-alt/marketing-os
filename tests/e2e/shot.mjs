// Dev helper (not a test): signs in and screenshots a list of paths. Usage: node tests/e2e/shot.mjs out-dir path1 path2 ...
import { chromium } from "@playwright/test";
const [, , out, ...paths] = process.argv;
const browser = await chromium.launch();
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  if (process.env.ONLY && process.env.ONLY !== name) continue;
  const page = await browser.newPage({ viewport });
  await page.goto("http://localhost:3100/login");
  const btn = page.getByRole("button", { name: "Continue as local owner" });
  if (await btn.count()) await btn.click();
  await page.waitForLoadState("networkidle");
  for (const p of paths) {
    await page.goto(`http://localhost:3100${p}`);
    await page.waitForLoadState("networkidle");
    const file = `${out}/${name}-${p.replace(/[^a-z0-9]+/gi, "_")}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file, page.url());
  }
  await page.close();
}
await browser.close();
