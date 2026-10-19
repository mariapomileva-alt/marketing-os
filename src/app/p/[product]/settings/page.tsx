import { db } from "@/server/context";
import { updateSettingsAction } from "@/app/actions/system";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { KeyValue, PageHeader, Section } from "@/components/ui/layout";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/p/[product]/settings">) {
  const { product: slug } = await params;
  const d = await db(async (tx, ctx) => ({
    s: await tx.maybeOne<{ min_publications_per_group: number; min_impressions_per_group: number; min_n_share_cell: number; ai_run_budget_usd: string; ai_daily_budget_usd: string }>(
      "select min_publications_per_group, min_impressions_per_group, min_n_share_cell, ai_run_budget_usd::text, ai_daily_budget_usd::text from workspace_settings where workspace_id = $1",
      [ctx.workspaceId],
    ),
    ws: await tx.one<{ name: string }>("select name from workspaces where id = $1", [ctx.workspaceId]),
    user: ctx.user,
  }));
  const s = d.s ?? { min_publications_per_group: 5, min_impressions_per_group: 1000, min_n_share_cell: 20, ai_run_budget_usd: "0.50", ai_daily_budget_usd: "5.00" };
  return (
    <>
      <PageHeader title="Settings" description="Workspace-wide settings. They apply to every product." />
      <Section title="Account">
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <KeyValue items={[["Workspace", d.ws.name], ["Signed in as", d.user.email], ["Sign-in method", d.user.mode === "dev" ? "Development sign-in (local only)" : "Email link (Supabase)"], ["Two-factor", "Set up with Supabase Auth when deployed (Stage C)"]]} />
        </div>
      </Section>
      <ActionForm action={updateSettingsAction.bind(null, slug)} submitLabel="Save settings" className="flex flex-col gap-6">
        <Section title="When is there enough data?" description="Below these thresholds Analytics shows “Not enough data” and never names a leader.">
          <div className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-3">
            <Field label="Posts per group" htmlFor="mp"><Input id="mp" name="min_publications_per_group" type="number" min={1} defaultValue={s.min_publications_per_group} /></Field>
            <Field label="Exposure per group" htmlFor="mi"><Input id="mi" name="min_impressions_per_group" type="number" min={1} defaultValue={s.min_impressions_per_group} /></Field>
            <Field label="Cases per segment share" htmlFor="ms" hint="AJTBD aggregates (default 20)."><Input id="ms" name="min_n_share_cell" type="number" min={1} defaultValue={s.min_n_share_cell} /></Field>
          </div>
        </Section>
        <Section title="AI budget" description="Runs stop when the daily budget is reached. The mock provider costs nothing.">
          <div className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-2">
            <Field label="Per run, USD" htmlFor="rb"><Input id="rb" name="ai_run_budget_usd" type="number" step="0.01" min={0.01} defaultValue={s.ai_run_budget_usd} /></Field>
            <Field label="Per day, USD" htmlFor="db"><Input id="db" name="ai_daily_budget_usd" type="number" step="0.01" min={0.01} defaultValue={s.ai_daily_budget_usd} /></Field>
          </div>
        </Section>
      </ActionForm>
    </>
  );
}
