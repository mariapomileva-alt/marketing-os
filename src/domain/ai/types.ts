import type { z } from "zod";

/** Provider-neutral interface. Business logic asks for a task with a schema, never for a vendor SDK. */
export interface GenerateRequest<T> {
  task: AiTask;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  /** Structured context the mock provider uses to build deterministic output. Real providers ignore it. */
  context?: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult<T> {
  output: T;
  raw: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number | null;
  model: string;
  provider: string;
  isMock: boolean;
  latencyMs: number;
}

export interface LLMProvider {
  id: "mock" | "anthropic" | "openai";
  isMock: boolean;
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
  embed?(texts: string[]): Promise<{ vectors: number[][]; model: string; dims: number }>;
}

export type AiTask = "hooks" | "content" | "brand_review" | "compliance_review" | "experiment_review" | "community_comment" | "community_reply" | "calm_video";

export class AiOutputError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
  }
}

export class BudgetExceededError extends Error {}
