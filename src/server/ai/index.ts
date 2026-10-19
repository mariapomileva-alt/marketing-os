import { MockProvider } from "@/domain/ai/mock";
import type { LLMProvider } from "@/domain/ai/types";

/**
 * Provider resolution. v0.1 (Stage B) ships the mock provider only; real providers (Anthropic, OpenAI)
 * are added in Stage C behind the same interface once an API key is connected in Connections.
 */
let mock: MockProvider | null = null;
export function aiProvider(): LLMProvider {
  mock ??= new MockProvider();
  return mock;
}

/** Embeddings use the same provider; the mock embedder is labelled in the model name ("mock-embed-256"). */
export async function embedTexts(texts: string[]) {
  const p = aiProvider();
  if (!p.embed) throw new Error("The active AI provider has no embedding model");
  return p.embed(texts);
}
