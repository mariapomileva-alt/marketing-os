import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Tabs, tabParam } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Activity Log" };
const ACTOR: Record<string, string> = { user: "You", ai: "AI (requested by you)", system: "System", integration: "Integration" };

function summarise(entity: string, after: Record<string, unknown> | null, before: Record<string, unknown> | null): string {
  const r = after ?? before ?? {};
  const pick = ["title", "name", "statement", "code", "text_verbatim", "subject_summary", "core_job", "status", "decision", "fear", "barrier", "metric", "full_url"];
  for (const k of pick) if (typeof r[k] === "string" && r[k]) return String(r[k]).slice(0, 140);
  if (before && after && typeof before.status === "string" && before.status !== after.status) return `${before.status} → ${after.status}`;
  return entity.replaceAll("_", " ");
}

export default async function ActivityPage({ params, searchParams }: PageProps<"/p/[product]/activity">) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const tab = tabParam(sp, ["log", "ai"], "log");
  const actor = typeof sp.actor === "string" ? sp.actor : "";
  const entity = typeof sp.entity === "string" ? sp.entity : "";
  const product = await getProduct(slug);
  const d = await db(async (tx, ctx) => ({
    rows: tab === "log" ? await tx.query<{ id: string; occurred_at: string; actor_type: string; action: string; entity_type: string; entity_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null; email: string | null }>(
      `select l.id::text, l.occurred_at::text, l.actor_type, l.action, l.entity_type, l.entity_id, l.before, l.after, l.reason, u.email
         from audit_logs l left join users u on u.id = l.actor_id
        where l.workspace_id = $1 and (l.product_id = $2 or l.product_id is null) and ($3 = '' or l.actor_type = $3) and ($4 = '' or l.entity_type = $4)
        order by l.occurred_at desc, l.id desc limit 300`,
      [ctx.workspaceId, product.id, actor, entity],
    ) : [],
    entities: await tx.query<{ entity_type: string }>("select distinct entity_type from audit_logs where workspace_id = $1 and (product_id = $2 or product_id is null) order by 1", [ctx.workspaceId, product.id]),
    runs: tab === "ai" ? await tx.query<{ id: string; created_at: string; step: string; role: string; provider: string; model: string; is_mock: boolean; input_tokens: number; output_tokens: number; cost_usd: string | null; duration_ms: number; error: string | null; sources: number; prompt: string | null }>(
      `select r.id, r.created_at::text, r.step, r.role, r.provider, r.model, r.is_mock, r.input_tokens, r.output_tokens, r.cost_usd::text, r.duration_ms, r.error,
              jsonb_array_length(r.source_ids) sources, t.key || ' v' || v.version prompt
         from agent_runs r left join prompt_template_versions v on v.id = r.prompt_template_version_id left join prompt_templates t on t.id = v.template_id
        where r.product_id = $1 order by r.created_at desc limit 200`,
      [product.id],
    ) : [],
  }));
  return (
    <>
      <PageHeader title="Activity Log" description="Every change by you, the AI, the system and integrations, with before and after values. The log cannot be edited or deleted." />
      <Tabs base={`/p/${slug}/activity`} current={tab} tabs={[{ id: "log", label: "All activity" }, { id: "ai", label: "AI runs" }]} />
      {tab === "log" ? (
        <>
          <form className="mb-4 flex flex-wrap items-end gap-2" action={`/p/${slug}/activity`}>
            <label className="text-[13px]">Who <Select name="actor" defaultValue={actor} className="ml-1 inline-block w-48"><option value="">Everyone</option>{Object.entries(ACTOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
            <label className="text-[13px]">What <Select name="entity" defaultValue={entity} className="ml-1 inline-block w-52"><option value="">Everything</option>{d.entities.map((e) => <option key={e.entity_type} value={e.entity_type}>{e.entity_type.replaceAll("_", " ")}</option>)}</Select></label>
            <Button type="submit">Filter</Button>
          </form>
          <Section>
            {d.rows.length ? (
              <Table>
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th><th>Reason</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num whitespace-nowrap">{formatDateTime(r.occurred_at)}</td>
                    <td className="whitespace-nowrap">{ACTOR[r.actor_type] ?? r.actor_type}{r.email ? <div className="text-[12px] text-muted">{r.email}</div> : null}</td>
                    <td>{r.action.replaceAll("_", " ")}</td><td>{r.entity_type.replaceAll("_", " ")}</td>
                    <td className="max-w-[380px] text-muted">{summarise(r.entity_type, r.after, r.before)}</td>
                    <td className="max-w-[220px] text-muted">{r.reason ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </Table>
            ) : <EmptyState title="No activity matches" />}
          </Section>
        </>
      ) : (
        <Section description="Each model call with its input, sources, prompt version, model, tokens, cost and duration.">
          {d.runs.length ? (
            <Table>
              <thead><tr><th>When</th><th>Step</th><th>Model</th><th>Prompt</th><th className="text-right">Sources</th><th className="text-right">Tokens in / out</th><th className="text-right">Cost, USD</th><th className="text-right">Time</th><th>Result</th></tr></thead>
              <tbody>{d.runs.map((r) => (
                <tr key={r.id}>
                  <td className="num whitespace-nowrap">{formatDateTime(r.created_at)}</td><td>{r.step.replaceAll("_", " ")}<div className="text-[12px] text-muted">{r.role.replaceAll("_", " ")}</div></td>
                  <td>{r.provider}/{r.model}{r.is_mock ? <span className="ml-1 text-[12px] text-slate">mock</span> : null}</td><td className="text-muted">{r.prompt ?? "—"}</td>
                  <td className="num text-right">{r.sources}</td><td className="num text-right">{r.input_tokens} / {r.output_tokens}</td><td className="num text-right">{r.cost_usd ?? "—"}</td><td className="num text-right">{r.duration_ms} ms</td>
                  <td>{r.error ? <span className="text-red">{r.error}</span> : "ok"}</td>
                </tr>
              ))}</tbody>
            </Table>
          ) : <EmptyState title="No AI runs yet" />}
          <p className="mt-2 text-[12px] text-muted">Linked work: <Link href={`/p/${slug}/studio`} className="text-green underline">Content Studio</Link>.</p>
        </Section>
      )}
    </>
  );
}
