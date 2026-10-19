import { db, getProduct } from "@/server/context";
import { updateLimitsAction } from "@/app/actions/system";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";
import type { Limits } from "@/domain/policy";

export const metadata = { title: "Automations" };

export default async function AutomationsPage({ params }: PageProps<"/p/[product]/automations">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx) => ({
    conns: await tx.query<{ id: string; channel: string; account_label: string; mode: string; limits: Limits }>("select id, channel, account_label, mode, limits from channel_connections where product_id = $1 and status <> 'revoked'", [product.id]),
    actions: await tx.query<{ action: string; result: string; reason: string; created_at: string }>("select action, result, reason, created_at::text from outbound_actions where product_id = $1 order by created_at desc limit 30", [product.id]),
  }));
  return (
    <>
      <PageHeader title="Automations" description="No automation runs in this version. Every external action needs your approval of the exact version, and automatic mode cannot be switched on: it is refused by the database itself. The limits below apply to every action and are checked with a visible reason." />
      <Section title="Limits per channel" description="Daily limit, account-wide cap, minimum gap, author cooldown and active hours in the audience's time zone. An error, captcha or restriction pauses the channel immediately.">
        {d.conns.length ? (
          <div className="flex flex-col gap-3">
            {d.conns.map((c) => (
              <ActionForm key={c.id} action={updateLimitsAction.bind(null, slug, c.id)} submitLabel="Save limits" className="grid gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-4 lg:grid-cols-8 lg:items-end">
                <p className="font-medium sm:col-span-4 lg:col-span-8">{c.channel} {c.account_label}</p>
                <Field label="Mode" htmlFor={`m-${c.id}`}><Select id={`m-${c.id}`} name="mode" defaultValue={c.mode}><option value="requires_approval">Requires approval</option><option value="draft_only">Draft only</option><option disabled>Automatic (not in v0.1)</option></Select></Field>
                <Field label="Per day" htmlFor={`dl-${c.id}`}><Input id={`dl-${c.id}`} name="daily_limit" type="number" defaultValue={c.limits.daily_limit} /></Field>
                <Field label="Account cap" htmlFor={`ac-${c.id}`}><Input id={`ac-${c.id}`} name="account_daily_cap" type="number" defaultValue={c.limits.account_daily_cap} /></Field>
                <Field label="Gap, min" htmlFor={`g-${c.id}`}><Input id={`g-${c.id}`} name="min_gap_minutes" type="number" defaultValue={c.limits.min_gap_minutes} /></Field>
                <Field label="Author cooldown, days" htmlFor={`cd-${c.id}`}><Input id={`cd-${c.id}`} name="author_cooldown_days" type="number" defaultValue={c.limits.author_cooldown_days} /></Field>
                <Field label="From" htmlFor={`s-${c.id}`}><Input id={`s-${c.id}`} name="start" type="number" defaultValue={c.limits.active_hours.start} /></Field>
                <Field label="Until" htmlFor={`e-${c.id}`}><Input id={`e-${c.id}`} name="end" type="number" defaultValue={c.limits.active_hours.end} /></Field>
                <Field label="Time zone" htmlFor={`tz-${c.id}`}><Input id={`tz-${c.id}`} name="tz" defaultValue={c.limits.active_hours.tz} /></Field>
              </ActionForm>
            ))}
          </div>
        ) : <EmptyState title="No channels connected">Add channels in Connections to set their limits.</EmptyState>}
      </Section>
      <Section title="Recent external actions" description="Every export or send attempt, executed or skipped, with the reason.">
        {d.actions.length ? (
          <Table>
            <thead><tr><th>When</th><th>Action</th><th>Result</th><th>Reason</th></tr></thead>
            <tbody>{d.actions.map((a, i) => <tr key={i}><td className="num whitespace-nowrap">{formatDateTime(a.created_at)}</td><td>{a.action}</td><td><Status tone={a.result === "executed" ? "green" : a.result === "skipped" ? "amber" : "red"}>{a.result}</Status></td><td className="text-muted">{a.reason}</td></tr>)}</tbody>
          </Table>
        ) : <p className="text-[13px] text-muted">No actions yet.</p>}
      </Section>
    </>
  );
}
