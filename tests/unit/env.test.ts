import { describe, expect, it } from "vitest";
import { databaseUrl, storageDriver, supabaseAnonKey, supabaseUrl } from "@/server/env";
import { decryptSecret, encryptionKey, encryptSecret } from "@/server/security/crypto";
import { pgConfig } from "@/server/db/config";

describe("hosted configuration", () => {
  const integration = {
    POSTGRES_URL: "postgres://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x",
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUPABASE_JWT_SECRET: "jwt-secret",
  };

  it("reads the names synced by the Supabase–Vercel integration, own names first", () => {
    expect(databaseUrl(integration)).toBe(integration.POSTGRES_URL);
    expect(databaseUrl({ ...integration, DATABASE_URL: "postgres://own" })).toBe("postgres://own");
    expect(supabaseUrl(integration)).toBe("https://abc.supabase.co");
    expect(supabaseAnonKey(integration)).toBe("anon");
    expect(storageDriver(integration)).toBe("supabase");
    expect(storageDriver({})).toBe("local");
  });

  it("drops integration-only URL parameters and turns on TLS", () => {
    const c = pgConfig(integration.POSTGRES_URL);
    expect(c.connectionString).not.toMatch(/supa=|sslmode=/);
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("derives a stable key from the Supabase secret only when no explicit key exists", () => {
    const k = encryptionKey(1, integration);
    expect(k).toHaveLength(32);
    expect(encryptionKey(1, integration).equals(k)).toBe(true);
    const enc = encryptSecret("sk-test", integration);
    expect(decryptSecret(enc, integration)).toBe("sk-test");
    const explicit = Buffer.alloc(32, 7).toString("base64");
    expect(encryptionKey(1, { ...integration, ENCRYPTION_KEY_V1: explicit }).equals(Buffer.alloc(32, 7))).toBe(true);
    expect(() => encryptionKey(1, {})).toThrow(/not configured/);
    expect(() => encryptionKey(2, integration)).toThrow(/not configured/);
  });
});
