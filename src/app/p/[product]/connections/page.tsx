import { db, getProduct } from "@/server/context";
import { CHANNEL_REGISTRY } from "@/server/services/connections";
import { connectAiAction, connectChannelAction, revokeAiAction, revokeChannelAction, rotateAiAction } from "@/app/actions/system";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader, Section, Table } from "@/components/ui/layout";
import { DataFlag, Status } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage({ params }: PageProps<"/p/[product]/connections">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const d = await db(async (tx, ctx) => ({
    ai: await tx.query<{ id: string; provider: string; label: string; status: string; last_four: string | null; created_at: string; rotated_at: string | null; revoked_at: string | null; runs: number }>(
      `select c.id, c.provider, c.label, c.status, s.last_four, c.created_at::text, c.rotated_at::text, c.revoked_at::text,
              (select count(*)::int from agent_runs r where r.workspace_id = c.workspace_id and r.provider = c.provider) runs
         from ai_provider_connections c left join secrets s on s.id = c.secret_id where c.workspace_id = $1 order by c.created_at desc`,
      [ctx.workspaceId],
    ),
    channels: await tx.query<{ id: string; channel: string; account_label: string; mode: string; status: string; paused_reason: string | null; last_error: string | null; created_at: string; revoked_at: string | null; pubs: number }>(
      `select c.id, c.channel, c.account_label, c.mode, c.status, c.paused_reason, c.last_error, c.created_at::text, c.revoked_at::text,
              (select count(*)::int from publications p where p.connection_id = c.id) pubs
         from channel_connections c where c.product_id = $1 order by c.created_at desc`,
      [product.id],
    ),
  }));
  const tone = (s: string) => (s === "connected" ? "green" : s === "revoked" ? "neutral" : "red") as "green" | "neutral" | "red";
  return (
    <>
      <PageHeader title="Connections" description="Keys and tokens are stored encrypted on the server, never in the browser or logs. Disconnecting deletes the secret; everything published and measured through it stays in history." />

      <Section title="AI providers (all products)" description="This build generates with the mock provider. A connected key is stored safely now and used once real generation is switched on in Stage C. Note: ChatGPT and Claude subscriptions do not include API access; API keys come from platform.openai.com or console.anthropic.com.">
        <Table>
          <thead><tr><th>Provider</th><th>Key</th><th>Status</th><th>Connected</th><th>Runs recorded</th><th /></tr></thead>
          <tbody>
            <tr><td>Mock provider <DataFlag kind="mock" /></td><td>—</td><td><Status tone="green">Active</Status></td><td>Built in</td><td>—</td><td /></tr>
            {d.ai.map((c) => (
              <tr key={c.id}>
                <td>{c.provider === "anthropic" ? "Anthropic" : "OpenAI"}{c.label && c.label !== c.provider ? <span className="text-muted"> {c.label}</span> : null}</td>
                <td className="num">{c.last_four ? `…${c.last_four}` : "deleted"}</td>
                <td><Status tone={tone(c.status)}>{c.status === "connected" ? "Stored, not used yet" : c.status}</Status></td>
                <td className="num whitespace-nowrap">{formatDateTime(c.created_at)}{c.rotated_at ? <div className="text-[12px] text-muted">rotated {formatDateTime(c.rotated_at)}</div> : null}{c.revoked_at ? <div className="text-[12px] text-muted">disconnected {formatDateTime(c.revoked_at)}</div> : null}</td>
                <td className="num">{c.runs}</td>
                <td className="min-w-[220px]">
                  {c.status !== "revoked" ? (
                    <div className="flex flex-col gap-2">
                      <ActionForm action={rotateAiAction.bind(null, slug, c.id)} submitLabel="Rotate key" submitVariant="secondary" resetOnSuccess className="flex items-end gap-2">
                        <Input name="api_key" type="password" autoComplete="off" placeholder="New key" aria-label="New API key" className="h-7" />
                      </ActionForm>
                      <form action={revokeAiAction.bind(null, slug, c.id)}><Button size="sm" variant="danger">Disconnect</Button></form>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <ActionForm action={connectAiAction.bind(null, slug)} submitLabel="Store key" resetOnSuccess className="mt-3 grid gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-[160px_1fr_200px_auto] sm:items-end">
          <Field label="Provider" htmlFor="ai-provider"><Select id="ai-provider" name="provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></Select></Field>
          <Field label="API key" htmlFor="ai-key"><Input id="ai-key" name="api_key" type="password" autoComplete="off" required /></Field>
          <Field label="Label" htmlFor="ai-label"><Input id="ai-label" name="label" /></Field>
        </ActionForm>
      </Section>

      <Section title={`Channels for ${product.name}`}>
        <Table>
          <thead><tr><th>Channel</th><th>What works in this build</th><th>Connection</th><th /></tr></thead>
          <tbody>{CHANNEL_REGISTRY.map((c) => {
            const conns = d.channels.filter((x) => x.channel === c.id);
            const active = conns.find((x) => x.status !== "revoked");
            return (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="max-w-[360px] text-muted">{c.status === "planned" ? <DataFlag kind="planned" /> : c.capabilities}{c.note ? <div className="text-[12px]">{c.note}</div> : null}</td>
                <td>
                  {active ? <><Status tone={tone(active.status)}>{active.account_label || "Connected"}</Status><div className="text-[12px] text-muted">{active.mode === "draft_only" ? "Draft only" : "Requires approval"}, {active.pubs} publications{active.paused_reason ? `, paused: ${active.paused_reason}` : ""}</div></> : <span className="text-muted">{c.status === "planned" ? "Not available yet" : "Not connected"}</span>}
                  {conns.filter((x) => x.status === "revoked").map((x) => <div key={x.id} className="text-[12px] text-faint">Disconnected {formatDateTime(x.revoked_at)}, {x.pubs} publications kept</div>)}
                </td>
                <td>{active ? <form action={revokeChannelAction.bind(null, slug, active.id)}><Button size="sm" variant="danger">Disconnect</Button></form> : null}</td>
              </tr>
            );
          })}</tbody>
        </Table>
        <ActionForm action={connectChannelAction.bind(null, slug)} submitLabel="Add channel" resetOnSuccess className="mt-3 grid gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-[180px_1fr_200px_auto] sm:items-end">
          <Field label="Channel" htmlFor="ch"><Select id="ch" name="channel">{CHANNEL_REGISTRY.filter((c) => c.status === "available").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Account" htmlFor="ch-acc" hint="e.g. @backapp. Used in the approval preview."><Input id="ch-acc" name="account_label" required /></Field>
          <Field label="Mode" htmlFor="ch-mode"><Select id="ch-mode" name="mode"><option value="requires_approval">Requires approval</option><option value="draft_only">Draft only</option></Select></Field>
        </ActionForm>
      </Section>
    </>
  );
}
