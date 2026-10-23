import { describe, expect, it } from "vitest";
import { AnthropicProvider, extractJson } from "@/domain/ai/anthropic";
import { communityReplySchema } from "@/domain/ai/schemas";

const reply = (text: string, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 100 } } : { error: { message: text } }), { status });

describe("Anthropic provider", () => {
  it("parses JSON (also inside code fences) and prices the call", async () => {
    const calls: RequestInit[] = [];
    const fake = (async (_url: unknown, init?: RequestInit) => {
      calls.push(init!);
      return reply('```json\n{"understanding":"asks the name","may_mention_product":true,"handoff_to_human":false,"text":"It\'s called Back — I\'m on the team."}\n```');
    }) as typeof fetch;
    const p = new AnthropicProvider("sk-ant-test", "claude-sonnet-5-5", fake);
    const r = await p.generate({ task: "community_reply", system: "s", input: "{}", schema: communityReplySchema });
    expect(r.output.text).toMatch(/Back/);
    expect(r.isMock).toBe(false);
    expect(r.costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / 1_000_000);
    const headers = calls[0].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("retries once with the validation error, then fails visibly", async () => {
    let n = 0;
    const fake = (async () => { n++; return reply("not json"); }) as typeof fetch;
    const p = new AnthropicProvider("sk-ant-test", "claude-sonnet-5-5", fake);
    await expect(p.generate({ task: "community_reply", system: "s", input: "{}", schema: communityReplySchema })).rejects.toThrow(/valid JSON/);
    expect(n).toBe(2);
  });

  it("surfaces API errors without the key", async () => {
    const fake = (async () => reply("Your credit balance is too low", 400)) as typeof fetch;
    const p = new AnthropicProvider("sk-ant-secret", "claude-sonnet-5-5", fake);
    const err = await p.generate({ task: "community_reply", system: "s", input: "{}", schema: communityReplySchema }).catch((e: Error) => e);
    expect(String(err)).toMatch(/credit balance/);
    expect(String(err)).not.toMatch(/sk-ant-secret/);
  });

  it("extracts the first JSON object from surrounding text", () => {
    expect(extractJson('Sure! {"a":1} done')).toEqual({ a: 1 });
  });
});

describe("request shape", () => {
  it("turns off up-front thinking and sends no temperature (Sonnet 5.5 rejects it with thinking)", async () => {
    let body: Record<string, unknown> = {};
    const fake = (async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ content: [{ type: "thinking" }, { type: "text", text: '{"understanding":"x","may_mention_product":false,"handoff_to_human":false,"text":"y"}' }], usage: {} }), { status: 200 });
    }) as typeof fetch;
    const r = await new AnthropicProvider("sk-ant-x", "claude-sonnet-5-5", fake).generate({ task: "community_reply", system: "s", input: "{}", schema: communityReplySchema });
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body).not.toHaveProperty("temperature");
    expect(r.output.text).toBe("y");
  });
});

it("falls back to the model's default thinking when the setting is refused", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fake = (async (_u: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init!.body));
    bodies.push(b);
    if (b.thinking) return new Response(JSON.stringify({ error: { message: "thinking type between_tools is not supported" } }), { status: 400 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: '{"understanding":"x","may_mention_product":false,"handoff_to_human":false,"text":"ok"}' }], usage: {} }), { status: 200 });
  }) as typeof fetch;
  const r = await new AnthropicProvider("sk-ant-x", "claude-sonnet-5-5", fake).generate({ task: "community_reply", system: "s", input: "{}", schema: communityReplySchema });
  expect(r.output.text).toBe("ok");
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).not.toHaveProperty("thinking");
});
