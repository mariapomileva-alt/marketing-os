import { expect, test, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * End-to-end vertical slice on a fresh product (mock AI):
 * product → language + link → source upload → verbatim quote → segment → Job → idea → hooks → content →
 * reviews → UTM link → approval queue → approve → calendar → export → mark published.
 */
const run = Date.now().toString(36);
const slug = `e2e-${run}`;

async function signIn(page: Page) {
  await page.goto("/login");
  const btn = page.getByRole("button", { name: "Continue as local owner" });
  if (await btn.count()) await btn.click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe.configure({ mode: "serial" });

test("full content workflow with approval and export", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The full flow runs once, on desktop.");
  test.setTimeout(240_000);
  await signIn(page);

  // Product
  await page.goto("/start");
  await page.getByLabel("Name").fill(`E2E ${run}`);
  await page.getByLabel("Short address").fill(slug);
  await page.getByLabel("Website").fill("https://e2e.example");
  await page.getByRole("button", { name: "Create product" }).click();
  await page.waitForURL(`**/p/${slug}/products`);
  await page.getByLabel("Language code").fill("en");
  await page.getByRole("button", { name: "Add language" }).click();
  await expect(page.getByText("Language added.")).toBeVisible();

  // Evidence + verbatim quote
  const dir = path.join(info.outputDir, "files");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "interview.md");
  writeFileSync(file, "# Interview 1\n\nI get scared on the metro because my heart races and I think everyone is looking.\n");
  await page.goto(`/p/${slug}/knowledge`);
  await page.getByLabel("File", { exact: true }).setInputFiles(file);
  await page.getByLabel("Source type").selectOption("note");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(/Imported 1 passages/)).toBeVisible();

  await page.goto(`/p/${slug}/audience?tab=quotes`);
  await page.getByLabel("Exact words").fill("my heart races and I think everyone is looking");
  await page.getByRole("button", { name: "Save quote" }).click();
  await expect(page.getByText("Quote saved with its source.")).toBeVisible();
  await page.getByLabel("Exact words").fill("my heart was racing");
  await page.getByRole("button", { name: "Save quote" }).click();
  await expect(page.getByText(/were not found in that source/)).toBeVisible();

  // Segment and Job
  await page.goto(`/p/${slug}/audience?tab=segments`);
  await page.getByLabel("Code").fill("EE-S1");
  await page.getByLabel("Core Job").fill("want to get through a panic wave on the metro");
  await page.getByLabel("Success criteria, most important first").fill("discreet | privacy | nobody notices\nfast | time | under a minute");
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(page.getByText(/Segment added to the draft codebook/)).toBeVisible();

  await page.goto(`/p/${slug}/audience?tab=jobs`);
  await page.getByLabel("Job", { exact: true }).fill("want to calm my breathing without anyone noticing");
  await page.getByLabel("Segment").selectOption({ index: 1 });
  await page.getByLabel("Supporting quote").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save Job" }).click();
  await expect(page.getByText("Job saved.")).toBeVisible();

  // Idea → hooks → content
  await page.goto(`/p/${slug}/ideas`);
  await page.getByLabel("Title").fill("First minute on the metro");
  await page.getByLabel("Segment").selectOption({ index: 1 });
  await page.getByLabel("Job").selectOption({ index: 1 });
  await page.getByLabel("Customer quote").selectOption({ index: 1 });
  await page.getByLabel(/interview\.md/).check();
  await page.getByRole("button", { name: "Create idea" }).click();
  await page.waitForURL(/\/ideas\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Generate hooks" }).click();
  await expect(page.getByText(/3 hook variants proposed by the mock provider/)).toBeVisible();
  await expect(page.getByText("Variant 3", { exact: true })).toBeVisible();
  await page.getByLabel("Channel").selectOption("threads");
  await page.getByLabel("Format").selectOption("short_post");
  await page.getByRole("button", { name: "Generate content" }).click();
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  // Reviews ran: mock AI reviews never pass silently; safety rules ran in code.
  await expect(page.getByText("Safety rules (code)")).toBeVisible();
  await expect(page.getByText(/No compliance review was performed/)).toBeVisible();
  await expect(page.getByText("Needs your review").first()).toBeVisible();

  // Manual edit creates v2 and keeps history
  await page.getByLabel("Body").fill("Your body is loud right now. That is not the same as danger. One slow breath out, longer than the breath in.");
  await page.getByLabel("What did you change and why").fill("Plainer body text");
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/Saved as a new version/)).toBeVisible();
  await expect(page.getByText(/v2 by/)).toBeVisible();
  await page.getByRole("button", { name: "Run reviews again" }).click();
  await expect(page.getByText("Needs your review").first()).toBeVisible();

  // UTM link, then queue
  await page.getByRole("button", { name: "Create UTM link" }).click();
  await expect(page.getByText(/utm_source=threads&utm_medium=social/).first()).toBeVisible();
  await page.getByRole("button", { name: "Send to Approval Queue" }).click();
  await expect(page.getByText(/Waiting in the/)).toBeVisible();

  // Approve the exact payload
  await page.goto(`/p/${slug}/approvals`);
  await expect(page.getByText("Exactly what will be posted:")).toBeVisible();
  await expect(page.getByText(/One slow breath out/).first()).toBeVisible();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByRole("heading", { name: "Nothing waiting" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "approved" })).toBeVisible();

  // Calendar, export, publish
  await page.goto(`/p/${slug}/studio?status=approved`);
  await page.getByRole("link", { name: /First minute on the metro/ }).first().click();
  await page.getByLabel("Date and time").fill("2026-10-22T10:30");
  await page.getByRole("button", { name: "Place on calendar" }).click();
  await expect(page.getByText("Scheduled").first()).toBeVisible();
  const exportHref = await page.getByRole("link", { name: /Download export/ }).getAttribute("href");
  const res = await page.request.get(exportHref!);
  expect(res.status()).toBe(200);
  const md = await res.text();
  expect(md).toContain("## Text to post");
  expect(md).toContain("utm_content=ci_");
  await page.getByLabel("Link to the post").fill("https://www.threads.net/@example/post/abc123");
  await page.getByRole("button", { name: "Mark as published" }).click();
  await expect(page.getByText(/^Published \d/)).toBeVisible();

  await page.goto(`/p/${slug}/calendar?month=2026-10`);
  await expect(page.getByRole("link", { name: /First minute on the metro/ }).first()).toBeVisible();
});
