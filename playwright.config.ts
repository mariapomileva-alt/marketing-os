import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./tests/e2e-global-setup";

const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e-global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Dev server: AUTH_MODE=dev (local owner sign-in) is refused in production builds by design.
    // It gets its own database; stop any other `next dev` in this folder first (Next allows one per project).
    command: `npx next dev -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 180000,
    env: { DATABASE_URL: e2eDatabaseUrl(), AUTH_MODE: "dev" },
  },
});
