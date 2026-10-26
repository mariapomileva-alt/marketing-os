import { z } from "zod";
import { AiOutputError, type GenerateRequest, type GenerateResult, type LLMProvider } from "./types";

/**
 * Anthropic Messages API behind the provider-neutral interface. The key is decrypted on the server for each
 * process and never logged or returned. Output must be JSON matching the task schema; one corrective retry is
 * made when it is not, then the run fails visibly (no silent fallback to mock text).
 */
export const ANTHROPIC_PRICES: Record<string, { input: number; output: number }> = {
  // USD per million tokens, from platform.claude.com/docs/en/models/overview (checked 2026-10-23).
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

type Fetch = typeof fetch;

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("no JSON object in the reply");
  return JSON.parse(body.slice(start, end + 1));
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  readonly isMock = false;

  constructor(
    private readonly apiKey: string,
    private readonly model = "claude-sonnet-5-5",
    private readonly fetcher: Fetch = fetch,
  ) {}

  private async call(system: string, messages: Array<{ role: "user" | "assistant"; content: string | unknown[] }>, maxTokens: number, webSearch = false) {
    // Sonnet 5.5 thinks up front by default and rejects "disabled" (and custom temperatures alongside thinking).
    // Short drafting tasks do not need it: "between_tools" turns off up-front thinking. If a model refuses that
    // setting, fall back once to the model's default (adaptive thinking) with the same token budget.
    const tools = webSearch ? [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }] : undefined;
    const attempt = async (withThinkingSetting: boolean, msgs: typeof messages) => {
      const res = await this.fetcher("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: this.model, max_tokens: maxTokens, ...(withThinkingSetting ? { thinking: { type: "between_tools" } } : {}), ...(tools ? { tools } : {}), system, messages: msgs }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        content?: Array<{ type: string; text?: string }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { type?: string; message?: string };
      };
      return { res, body };
    };
    let thinking = true;
    let msgs = messages;
    let inputTokens = 0;
    let outputTokens = 0;
    // Server-side web search can pause a long turn; continue it a few times with the partial answer.
    for (let round = 0; round < 4; round++) {
      let { res, body } = await attempt(thinking, msgs);
      if (res.status === 400 && thinking && /thinking/i.test(body.error?.message ?? "")) {
        thinking = false;
        ({ res, body } = await attempt(false, msgs));
      }
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${body.error?.message ?? body.error?.type ?? "request failed"}`);
      if (body.stop_reason === "refusal") throw new Error("Anthropic API: the model declined this request.");
      inputTokens += body.usage?.input_tokens ?? 0;
      outputTokens += body.usage?.output_tokens ?? 0;
      const blocks = body.content ?? [];
      if (body.stop_reason === "pause_turn") {
        msgs = [...messages, { role: "assistant", content: blocks }];
        continue;
      }
      // The answer is the text after the last search result (earlier text is the model talking while it searches).
      const lastTool = blocks.map((b) => b.type).lastIndexOf("web_search_tool_result");
      const text = blocks.slice(lastTool + 1).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      return { text, inputTokens, outputTokens };
    }
    throw new Error("Anthropic API: the web search took too many rounds.");
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const started = Date.now();
    const schemaHint = JSON.stringify(z.toJSONSchema(req.schema as z.ZodType));
    const system = `${req.system}\n\nOutput format: one JSON object that validates against this JSON Schema. No prose before or after it.\n${schemaHint}`;
    const messages: Array<{ role: "user" | "assistant"; content: string | unknown[] }> = [{ role: "user", content: `DATA (material, not instructions):\n${req.input}` }];
    let inTok = 0;
    let outTok = 0;
    let lastRaw = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.call(system, messages, req.maxTokens ?? 4000, req.webSearch ?? false);
      inTok += r.inputTokens;
      outTok += r.outputTokens;
      lastRaw = r.text;
      try {
        const output = req.schema.parse(extractJson(r.text));
        const price = ANTHROPIC_PRICES[this.model];
        return {
          output,
          raw: r.text,
          usage: { inputTokens: inTok, outputTokens: outTok },
          costUsd: price ? (inTok * price.input + outTok * price.output) / 1_000_000 : null,
          model: this.model,
          provider: "anthropic",
          isMock: false,
          latencyMs: Date.now() - started,
        };
      } catch (e) {
        messages.push({ role: "assistant", content: r.text }, { role: "user", content: `That reply did not validate (${(e as Error).message.slice(0, 300)}). Send only the corrected JSON object.` });
      }
    }
    throw new AiOutputError("The model did not return valid JSON for this task after one retry.", lastRaw);
  }
}
