import { MockProvider } from "@/domain/ai/mock";
import { AnthropicProvider } from "@/domain/ai/anthropic";
import type { LLMProvider } from "@/domain/ai/types";
import { withContext } from "@/server/db/client";
import { decryptSecret } from "@/server/security/crypto";

/**
 * Provider resolution. A workspace with a connected Anthropic key (Connections → AI providers) gets Claude;
 * everyone else gets the labelled mock. Keys are read with the service role (users cannot select secrets),
 * decrypted in memory and cached per secret id, never logged.
 */
let mock: MockProvider | null = null;
const cache = new Map<string, LLMProvider>();

export function mockProvider(): LLMProvider {
  mock ??= new MockProvider();
  return mock;
}

/** Kept for embeddings: they stay on the mock embedder until a real embedding model is chosen. */
export function aiProvider(): LLMProvider {
  return mockProvider();
}

export async function resolveProvider(workspaceId: string): Promise<LLMProvider> {
  const row = await withContext({ userId: null, role: "service" }, (tx) =>
    tx.maybeOne<{ secret_id: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number; default_model: string | null }>(
      `select s.id secret_id, s.ciphertext, s.iv, s.auth_tag, s.key_version, c.default_model
         from ai_provider_connections c join secrets s on s.id = c.secret_id
        where c.workspace_id = $1 and c.provider = 'anthropic' and c.status = 'connected' order by c.created_at desc limit 1`,
      [workspaceId],
    ),
  );
  if (!row) return mockProvider();
  const cached = cache.get(row.secret_id);
  if (cached) return cached;
  const key = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version });
  const provider = new AnthropicProvider(key, row.default_model || "claude-sonnet-5-5");
  cache.set(row.secret_id, provider);
  return provider;
}

/** Embeddings use the mock embedder ("mock-embed-256"), labelled as such. */
export async function embedTexts(texts: string[]) {
  const p = aiProvider();
  if (!p.embed) throw new Error("The active AI provider has no embedding model");
  return p.embed(texts);
}
