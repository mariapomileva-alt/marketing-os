import { createHmac } from "node:crypto";
import { encryptionKey } from "./crypto";

/**
 * Bearer token for the posting-queue endpoint, derived from the server encryption key, so no extra setting is
 * needed. The build stores it in Supabase Vault for the database scheduler; it is never logged or sent to a browser.
 */
export function queueToken(env: Record<string, string | undefined> = process.env): string {
  return createHmac("sha256", encryptionKey(1, env)).update("youtube-post-queue").digest("base64url");
}
