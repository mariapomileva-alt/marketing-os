import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for API keys and tokens at rest. Keys come from the server environment
 * (ENCRYPTION_KEY_V<n>, base64, 32 bytes); ENCRYPTION_ACTIVE_KEY_VERSION selects the key for new
 * secrets. Old versions stay readable for rotation. Plaintext never leaves the server.
 */
type Env = Record<string, string | undefined>;

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/**
 * Key version 1 may be derived when ENCRYPTION_KEY_V1 is not set but the hosted Supabase project's server secret is
 * (synced by the Supabase ↔ Vercel integration). The derived key is as secret as its source and never stored.
 * Rotating that Supabase secret changes the key: AI keys must then be entered again (see ADR-17).
 * An explicit ENCRYPTION_KEY_V1 always wins.
 */
export function encryptionKey(version: number, env: Env = process.env): Buffer {
  const raw = env[`ENCRYPTION_KEY_V${version}`];
  if (!raw) {
    const source = version === 1 ? env.SUPABASE_JWT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY : undefined;
    if (source) return Buffer.from(hkdfSync("sha256", source, "marketing-os", "encryption-key-v1", 32));
    throw new Error(`Encryption key version ${version} is not configured`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`Encryption key version ${version} must be 32 bytes (base64)`);
  return key;
}

export function activeKeyVersion(env: Env = process.env): number {
  const v = Number(env.ENCRYPTION_ACTIVE_KEY_VERSION ?? "1");
  if (!Number.isInteger(v) || v < 1) throw new Error("ENCRYPTION_ACTIVE_KEY_VERSION must be a positive integer");
  return v;
}

export function encryptSecret(plaintext: string, env: Env = process.env, aad = "marketing-os"): EncryptedSecret {
  const keyVersion = activeKeyVersion(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyVersion, env), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion };
}

export function decryptSecret(secret: EncryptedSecret, env: Env = process.env, aad = "marketing-os"): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret.keyVersion, env), secret.iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(secret.authTag);
  return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]).toString("utf8");
}

export function lastFour(value: string): string {
  return value.length <= 4 ? "****" : value.slice(-4);
}
