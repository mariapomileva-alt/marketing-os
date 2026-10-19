/**
 * Action policy engine (independent implementation of the gate pattern described in
 * docs/reusable-patterns.md §D). Every evaluation returns allowed/denied with a visible reason and the
 * list of checks, which is stored on outbound_actions.
 */
export type Mode = "draft_only" | "requires_approval" | "automatic";

export interface Limits {
  daily_limit: number;
  account_daily_cap: number;
  min_gap_minutes: number;
  author_cooldown_days: number;
  active_hours: { start: number; end: number; tz: string };
}

export interface PolicyInput {
  action: "export" | "publish" | "reply" | "ad_change";
  now: Date;
  connection: null | {
    status: "connected" | "paused" | "revoked" | "error";
    mode: Mode;
    pausedUntil: Date | null;
    pausedReason: string | null;
    adapterKind: "official_api" | "export" | "browser_automation";
    limits: Limits;
  };
  approval: { state: string; payloadHash: string } | null;
  currentPayloadHash: string;
  executedToday: number;
  executedTodayAccount: number;
  lastExecutedAt: Date | null;
  authorLastContactedAt: Date | null;
  dedupeKeyUsed: boolean;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PolicyResult {
  allowed: boolean;
  reason: string;
  checks: Check[];
}

export function localHour(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
}

export function evaluatePolicy(p: PolicyInput): PolicyResult {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. Global red lines.
  add("human_approval", !!p.approval && p.approval.state === "approved", p.approval ? `approval is ${p.approval.state}` : "no approval");
  add(
    "approved_exact_payload",
    !!p.approval && p.approval.payloadHash === p.currentPayloadHash,
    p.approval && p.approval.payloadHash !== p.currentPayloadHash ? "content changed after approval" : "payload matches approval",
  );

  // Export is a download for the owner to post manually: no connection limits apply.
  if (p.action !== "export") {
    const c = p.connection;
    add("connection_present", !!c, c ? "connection found" : "no connection for this channel");
    if (c) {
      add("not_automatic", c.mode !== "automatic", c.mode === "automatic" ? "automatic mode is disabled in v0.1" : `mode ${c.mode}`);
      add("not_draft_only", c.mode !== "draft_only", c.mode === "draft_only" ? "connection is in draft-only mode" : "sending allowed after approval");
      add("no_browser_automation", c.adapterKind !== "browser_automation", c.adapterKind === "browser_automation" ? "browser automation adapters are disabled" : "official API");
      const paused = c.status === "paused" && (!c.pausedUntil || c.pausedUntil > p.now);
      add("connection_active", c.status === "connected" || (c.status === "paused" && !paused), paused ? `paused: ${c.pausedReason ?? "no reason"}` : `status ${c.status}`);
      const hour = localHour(p.now, c.limits.active_hours.tz);
      const inHours = hour >= c.limits.active_hours.start && hour < c.limits.active_hours.end;
      add("active_hours", inHours, `${hour}:00 in ${c.limits.active_hours.tz}, allowed ${c.limits.active_hours.start}:00–${c.limits.active_hours.end}:00`);
      add("daily_limit", p.executedToday < c.limits.daily_limit, `${p.executedToday} of ${c.limits.daily_limit} today`);
      if (c.limits.account_daily_cap > 0) add("account_cap", p.executedTodayAccount < c.limits.account_daily_cap, `${p.executedTodayAccount} of ${c.limits.account_daily_cap} on the account today`);
      if (p.lastExecutedAt) {
        const mins = (p.now.getTime() - p.lastExecutedAt.getTime()) / 60000;
        add("min_gap", mins >= c.limits.min_gap_minutes, `${Math.floor(mins)} min since last action, minimum ${c.limits.min_gap_minutes}`);
      }
      if (p.action === "reply" && p.authorLastContactedAt) {
        const days = (p.now.getTime() - p.authorLastContactedAt.getTime()) / 86_400_000;
        add("author_cooldown", days >= c.limits.author_cooldown_days, `${Math.floor(days)} days since last contact, minimum ${c.limits.author_cooldown_days}`);
      }
    }
  }
  add("dedupe", !p.dedupeKeyUsed, p.dedupeKeyUsed ? "already done for this target" : "first action for this target");

  const failed = checks.find((c) => !c.ok);
  return { allowed: !failed, reason: failed ? `${failed.name}: ${failed.detail}` : "all checks passed", checks };
}

/** Errors that must pause a connection immediately (circuit breaker). */
export function classifyAdapterError(message: string): "captcha" | "restriction" | "auth_lost" | "rate_limited" | "other" {
  const m = message.toLowerCase();
  if (/captcha|challenge/.test(m)) return "captcha";
  if (/rate.?limit|too many requests|429/.test(m)) return "rate_limited";
  if (/unauthori[sz]ed|token (expired|invalid)|401|login/.test(m)) return "auth_lost";
  if (/restrict|blocked|suspend|spam|forbidden|403/.test(m)) return "restriction";
  return "other";
}

export function pauseHoursFor(errorClass: ReturnType<typeof classifyAdapterError>): number {
  return errorClass === "rate_limited" ? 1 : errorClass === "other" ? 1 : 24;
}
