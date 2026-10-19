import { expect, test } from "@playwright/test";
import { NAV } from "../../src/components/shell/nav";

/**
 * Every one of the 19 sections renders for a fresh product on desktop and on a phone,
 * with a heading, without a server error and without sideways page scroll.
 */
let slug = "";
const sections = NAV.flatMap((g) => g.items.map((i) => i));

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }, info) => {
  slug = `sec-${info.project.name}-${Date.now().toString(36)}`;
  const page = await browser.newPage({ storageState: { cookies: [], origins: [] } });
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as local owner" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/start");
  await page.getByLabel("Name").fill(`Sections ${slug}`);
  await page.getByLabel("Short address").fill(slug);
  await page.getByRole("button", { name: "Create product" }).click();
  await page.waitForURL(`**/p/${slug}/products`);
  await page.context().storageState({ path: `test-results/sections-auth-${info.project.name}.json` });
  await page.close();
});


// Signed-in state saved by beforeAll, one file per project.
test.use({ storageState: async ({}, provide, info) => provide(`test-results/sections-auth-${info.project.name}.json`) });

for (const s of sections) {
  test(`${s.label} renders`, async ({ page }) => {
    const res = await page.goto(`/p/${slug}/${s.slug}`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.getByText(/Application error|Unhandled Runtime Error/)).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
  });
}

test("phone navigation opens, moves to a section and closes", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "Phone menu only.");
  await page.goto(`/p/${slug}/overview`);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Analytics" }).last().click();
  await page.waitForURL(`**/p/${slug}/analytics`);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});
