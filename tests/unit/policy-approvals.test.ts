import { describe, expect, it } from "vitest";
import { approvalHash, canonicalJson } from "@/domain/approvals";
import { classifyAdapterError, evaluatePolicy, type PolicyInput } from "@/domain/policy";

const base: PolicyInput = {
  action: "publish",
  now: new Date("2026-10-20T09:00:00Z"), // 12:00 in Riga
  connection: {
    status: "connected",
    mode: "requires_approval",
    pausedUntil: null,
    pausedReason: null,
    adapterKind: "official_api",
    limits: { daily_limit: 3, account_daily_cap: 0, min_gap_minutes: 60, author_cooldown_days: 30, active_hours: { start: 9, end: 21, tz: "Europe/Riga" } },
  },
  approval: { state: "approved", payloadHash: "h" },
  currentPayloadHash: "h",
  executedToday: 0,
  executedTodayAccount: 0,
  lastExecutedAt: null,
  authorLastContactedAt: null,
  dedupeKeyUsed: false,
};

describe("action policy", () => {
  it("allows an approved action within limits", () => {
    expect(evaluatePolicy(base)).toMatchObject({ allowed: true, reason: "all checks passed" });
  });
  it.each([
    [{ approval: null }, /human_approval/],
    [{ currentPayloadHash: "changed" }, /content changed after approval/],
    [{ connection: { ...base.connection!, mode: "automatic" as const } }, /automatic mode is disabled/],
    [{ connection: { ...base.connection!, mode: "draft_only" as const } }, /draft-only/],
    [{ connection: { ...base.connection!, adapterKind: "browser_automation" as const } }, /browser automation/],
    [{ connection: { ...base.connection!, status: "paused" as const, pausedUntil: new Date("2026-10-21T00:00:00Z"), pausedReason: "captcha" } }, /paused: captcha/],
    [{ now: new Date("2026-10-20T20:00:00Z") }, /active_hours/],
    [{ executedToday: 3 }, /3 of 3 today/],
    [{ lastExecutedAt: new Date("2026-10-20T08:30:00Z") }, /min_gap/],
    [{ dedupeKeyUsed: true }, /already done/],
    [{ action: "reply" as const, authorLastContactedAt: new Date("2026-10-10T09:00:00Z") }, /author_cooldown/],
  ])("denies with a visible reason (%#)", (patch, reason) => {
    const r = evaluatePolicy({ ...base, ...patch } as PolicyInput);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(reason);
  });
  it("export needs approval but no connection", () => {
    expect(evaluatePolicy({ ...base, action: "export", connection: null }).allowed).toBe(true);
    expect(evaluatePolicy({ ...base, action: "export", connection: null, approval: null }).allowed).toBe(false);
  });
  it("classifies adapter errors for the circuit breaker", () => {
    expect(classifyAdapterError("Please complete the CAPTCHA")).toBe("captcha");
    expect(classifyAdapterError("HTTP 429 Too Many Requests")).toBe("rate_limited");
    expect(classifyAdapterError("token expired")).toBe("auth_lost");
    expect(classifyAdapterError("Action blocked: spam")).toBe("restriction");
  });
});

describe("approval hash", () => {
  it("is independent of key order and changes with any field", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const p = { contentVersionId: "v", versionHash: "x", channel: "threads", format: "short_post", destination: { account: "@a", method: "export" as const }, text: "t", utmUrl: null, media: [] };
    expect(approvalHash(p)).toBe(approvalHash({ ...p }));
    expect(approvalHash(p)).not.toBe(approvalHash({ ...p, text: "t." }));
    expect(approvalHash(p)).not.toBe(approvalHash({ ...p, destination: { account: "@b", method: "export" } }));
  });
});
