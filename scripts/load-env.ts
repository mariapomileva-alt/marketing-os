// Loads .env.local then .env for scripts run outside Next.js (Node >= 22 has process.loadEnvFile).
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
