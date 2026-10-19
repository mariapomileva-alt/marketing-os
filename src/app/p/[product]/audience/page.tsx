import Link from "next/link";
import { db, getProduct } from "@/server/context";
import { codebookState, listBarriers, listFears, listJobs, listQuotes, listSegments, segmentHistory } from "@/server/services/ajtbd";
import { activateCodebookAction, addAudienceAction, addBarrierAction, addFearAction, addJobAction, addQuoteAction, addSegmentAction, newDraftCodebookAction } from "@/app/actions/ajtbd";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { Status } from "@/components/ui/status";
import { EpistemicTag } from "@/components/ui/epistemic";
import { Tabs, tabParam } from "@/components/ui/tabs";
import { formatDateTime, formatLocator } from "@/lib/format";

export const metadata = { title: "Audience & AJTBD" };

const TAB_IDS = ["segments", "jobs", "fears", "quotes", "codebook"] as const;
const FEAR_CLASSES = ["chain_break", "under_delivery", "tax_job", "personal_risk", "irreversible_loss"];
const BARRIER_CLASSES = ["missing_prerequisite", "unsupported_context", "broken_link", "handoff_failure", "cycle_rework", "irreversible_loss"];
const human = (s: string | null) => (s ? s.replaceAll("_", " ") : "—");

export default async function AudiencePage({ params, searchParams }: PageProps<"/p/[product]/audience">) {
  const { product: slug } = await params;
  const tab = tabParam(await searchParams, TAB_IDS, "segments");
  const product = await getProduct(slug);
  const d = await db(async (tx) => ({
    audiences: await tx.query<{ id: string; name: string; description: string }>("select id, name, description from audiences where product_id = $1 order by name", [product.id]),
    segments: await listSegments(tx, product.id),
    jobs: await listJobs(tx, product.id),
    fears: await listFears(tx, product.id),
    barriers: await listBarriers(tx, product.id),
    quotes: await listQuotes(tx, product.id),
    codebooks: await codebookState(tx, product.id),
    history: tab === "codebook" ? await segmentHistory(tx, product.id) : [],
    sources: await tx.query<{ id: string; title: string }>("select id, title from knowledge_sources where product_id = $1 and scope = 'product' and status = 'ready' order by imported_at desc", [product.id]),
  }));
  const base = `/p/${slug}/audience`;
  const segOptions = (
    <>
      <option value="">No segment</option>
      {d.segments.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
    </>
  );
  const quoteOptions = (
    <>
      <option value="">No quote (hypothesis)</option>
      {d.quotes.map((q) => <option key={q.id} value={q.id}>“{q.text_verbatim.slice(0, 80)}”</option>)}
    </>
  );

  return (
    <>
      <PageHeader
        title="Audience & AJTBD"
        description="Segments are defined by a Core Job and the order of its success criteria, not by demographics. Fears and barriers are kept apart; quotes are verbatim and linked to their source."
      />
      <Tabs base={base} current={tab} tabs={[
        { id: "segments", label: "Segments", count: d.segments.length },
        { id: "jobs", label: "Jobs", count: d.jobs.length },
        { id: "fears", label: "Fears and barriers", count: d.fears.length + d.barriers.length },
        { id: "quotes", label: "Quotes", count: d.quotes.length },
        { id: "codebook", label: "Codebook" },
      ]} />

      {tab === "segments" ? (
        <>
          <Section>
            {d.segments.length ? (
              <Table>
                <thead><tr><th>Code</th><th>Segment</th><th>Core Job</th><th>Criteria in priority order</th><th>Confidence</th><th className="text-right">Jobs</th><th className="text-right">Fears</th><th className="text-right">Barriers</th></tr></thead>
                <tbody>
                  {d.segments.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.code}</td>
                      <td>{s.name}{s.audience ? <div className="text-[12px] text-muted">{s.audience}</div> : null}</td>
                      <td className="max-w-[260px]">{s.core_job ?? "—"}</td>
                      <td className="max-w-[320px]">
                        <ol className="list-decimal pl-4 text-muted">
                          {(s.criteria_order ?? []).map((c, i) => <li key={i}><span className="text-ink">{c.criterion}</span>{c.threshold ? ` → ${c.threshold}` : <span className="text-amber"> (no threshold yet)</span>}</li>)}
                        </ol>
                      </td>
                      <td><Status tone={s.confidence_status === "solid" ? "green" : s.confidence_status === "emerging" ? "slate" : "amber"}>{human(s.confidence_status)}</Status></td>
                      <td className="num text-right">{s.jobs}</td><td className="num text-right">{s.fears}</td><td className="num text-right">{s.barriers}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No segments yet">Start with one segment you have evidence for. Its definition goes into a draft codebook that you approve.</EmptyState>
            )}
          </Section>
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Section title="Add a segment">
              <ActionForm action={addSegmentAction.bind(null, slug)} submitLabel="Add segment" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:grid-cols-2">
                <Field label="Code" htmlFor="seg-code" hint="Stable id, never reused, e.g. BA-S1."><Input id="seg-code" name="code" required placeholder="BA-S1" /></Field>
                <Field label="Audience" htmlFor="seg-aud"><Select id="seg-aud" name="audience_id"><option value="">None</option>{d.audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
                <Field label="Core Job" htmlFor="seg-job" className="sm:col-span-2" hint="“want to + verb (+ object)”."><Input id="seg-job" name="core_job" required placeholder="want to get through a panic wave on public transport" /></Field>
                <Field label="Name" htmlFor="seg-name" className="sm:col-span-2" hint="Defaults to the Core Job."><Input id="seg-name" name="name" /></Field>
                <Field label="Success criteria, most important first" htmlFor="seg-crit" className="sm:col-span-2" hint="One per line: criterion | direction | threshold. Leave the threshold empty if you do not know it yet.">
                  <Textarea id="seg-crit" name="criteria" required rows={4} placeholder={"discreet to use | privacy | nobody around notices\nworks without thinking | effort | one tap"} />
                </Field>
                <Field label="What makes it different from other segments" htmlFor="seg-dist" className="sm:col-span-2"><Input id="seg-dist" name="distinguishing" /></Field>
              </ActionForm>
            </Section>
            <Section title="Audiences">
              <ul className="mb-3 text-[13px]">{d.audiences.map((a) => <li key={a.id} className="border-b border-line py-1.5">{a.name}<span className="text-muted"> {a.description}</span></li>)}</ul>
              <ActionForm action={addAudienceAction.bind(null, slug)} submitLabel="Add audience" resetOnSuccess>
                <Field label="Name" htmlFor="aud-name"><Input id="aud-name" name="name" required /></Field>
                <Field label="Description" htmlFor="aud-desc"><Input id="aud-desc" name="description" /></Field>
              </ActionForm>
            </Section>
          </div>
        </>
      ) : null}

      {tab === "jobs" ? (
        <>
          <Section>
            {d.jobs.length ? (
              <Table>
                <thead><tr><th>Level</th><th>Job</th><th>Segment</th><th>Evidence</th><th className="text-right">Criteria</th></tr></thead>
                <tbody>
                  {d.jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="whitespace-nowrap">{human(j.level)}{j.job_type !== "regular" ? <div className="text-[12px] text-muted">{human(j.job_type)}</div> : null}</td>
                      <td className="max-w-[440px]">{j.statement}{j.parent ? <div className="text-[12px] text-muted">for: {j.parent}</div> : null}</td>
                      <td>{j.segment_code ?? "—"}</td>
                      <td>{j.evidence_level === "quote" && j.quote ? <span className="flex items-start gap-1.5"><EpistemicTag kind="quote" /><span className="text-[12.5px] text-muted">“{j.quote}”</span></span> : <EpistemicTag kind="hypothesis" />}</td>
                      <td className="num text-right">{j.criteria}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState title="No Jobs yet">A Job is the progress a person is trying to make, written as “want to + verb”.</EmptyState>}
          </Section>
          <Section title="Add a Job">
            <ActionForm action={addJobAction.bind(null, slug)} submitLabel="Save Job" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:grid-cols-3">
              <Field label="Job" htmlFor="job-st" className="md:col-span-3"><Input id="job-st" name="statement" required placeholder="want to stop the spiral before it takes over" /></Field>
              <Field label="Level" htmlFor="job-level"><Select id="job-level" name="level" defaultValue="core">{["super_big", "big", "core", "small", "micro"].map((l) => <option key={l} value={l}>{human(l)}</option>)}</Select></Field>
              <Field label="Type" htmlFor="job-type"><Select id="job-type" name="job_type">{["regular", "orientation", "emotional", "tax", "fake", "viral"].map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>
              <Field label="Segment" htmlFor="job-seg"><Select id="job-seg" name="segment_id">{segOptions}</Select></Field>
              <Field label="Bigger Job it serves" htmlFor="job-parent"><Select id="job-parent" name="parent_job_id"><option value="">None</option>{d.jobs.map((j) => <option key={j.id} value={j.id}>{j.statement.slice(0, 70)}</option>)}</Select></Field>
              <Field label="Supporting quote" htmlFor="job-quote" hint="Without a quote the Job is stored as a hypothesis."><Select id="job-quote" name="quote_id">{quoteOptions}</Select></Field>
              <Field label="Criteria source" htmlFor="job-csrc"><Select id="job-csrc" name="criteria_source"><option value="self">Said by the customer</option><option value="echoed">Repeated after the interviewer</option><option value="prompted_by_interviewer">Only the interviewer said it</option></Select></Field>
              <Field label="Context" htmlFor="job-ctx" className="md:col-span-3"><Input id="job-ctx" name="context" placeholder="Who, in what situation, so these criteria follow" /></Field>
              <Field label="Success criteria, most important first" htmlFor="job-crit" className="md:col-span-3" hint="criterion | direction | threshold"><Textarea id="job-crit" name="criteria" rows={3} /></Field>
            </ActionForm>
          </Section>
        </>
      ) : null}

      {tab === "fears" ? (
        <div className="grid gap-8 xl:grid-cols-2">
          <Section title="Fears" description="Predictions that the goal won't be reached. Proof can address them.">
            {d.fears.length ? (
              <Table>
                <thead><tr><th>Fear</th><th>Class</th><th>Addressable with proof</th><th>Segment</th></tr></thead>
                <tbody>{d.fears.map((f) => (
                  <tr key={f.id}><td className="max-w-[280px]">{f.fear}{f.quote ? <div className="text-[12px] text-muted">“{f.quote}”</div> : null}</td><td className="text-muted">{human(f.class)}</td>
                    <td>{f.reducible_by_communication === null ? "—" : f.reducible_by_communication ? "Yes" : <span className="text-amber">No, check if it is a barrier</span>}</td><td>{f.segment_code ?? "—"}</td></tr>
                ))}</tbody>
              </Table>
            ) : <EmptyState title="No fears recorded" />}
            <ActionForm action={addFearAction.bind(null, slug)} submitLabel="Add fear" resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Fear" htmlFor="fear" className="sm:col-span-2"><Input id="fear" name="fear" required /></Field>
              <Field label="About which way" htmlFor="fear-way"><Input id="fear-way" name="about_way" placeholder="using an app during an attack" /></Field>
              <Field label="Class" htmlFor="fear-class"><Select id="fear-class" name="class"><option value="">Unclassified</option>{FEAR_CLASSES.map((c) => <option key={c} value={c}>{human(c)}</option>)}</Select></Field>
              <Field label="Can proof address it?" htmlFor="fear-red"><Select id="fear-red" name="reducible"><option value="">Not sure</option><option value="yes">Yes</option><option value="no">No</option></Select></Field>
              <Field label="Segment" htmlFor="fear-seg"><Select id="fear-seg" name="segment_id">{segOptions}</Select></Field>
              <Field label="Proof we have or need" htmlFor="fear-proof" className="sm:col-span-2"><Input id="fear-proof" name="proof_available" /></Field>
              <Field label="Quote" htmlFor="fear-q" className="sm:col-span-2"><Select id="fear-q" name="quote_id">{quoteOptions}</Select></Field>
            </ActionForm>
          </Section>
          <Section title="Barriers" description="Facts that make the path impossible. Only changing reality removes them; messaging does not.">
            {d.barriers.length ? (
              <Table>
                <thead><tr><th>Barrier</th><th>Class</th><th>Where in the chain</th><th>Who can change it</th></tr></thead>
                <tbody>{d.barriers.map((b) => (
                  <tr key={b.id}><td className="max-w-[280px]">{b.barrier}{b.quote ? <div className="text-[12px] text-muted">“{b.quote}”</div> : null}</td><td className="text-muted">{human(b.class)}</td><td>{b.chain_node || "—"}</td><td>{human(b.owner)}</td></tr>
                ))}</tbody>
              </Table>
            ) : <EmptyState title="No barriers recorded" />}
            <ActionForm action={addBarrierAction.bind(null, slug)} submitLabel="Add barrier" resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Barrier" htmlFor="barrier" className="sm:col-span-2"><Input id="barrier" name="barrier" required /></Field>
              <Field label="Class" htmlFor="bar-class"><Select id="bar-class" name="class"><option value="">Unclassified</option>{BARRIER_CLASSES.map((c) => <option key={c} value={c}>{human(c)}</option>)}</Select></Field>
              <Field label="Where in the chain" htmlFor="bar-node"><Input id="bar-node" name="chain_node" /></Field>
              <Field label="Who can change it" htmlFor="bar-owner"><Select id="bar-owner" name="owner"><option value="">Unknown</option>{["us", "client", "third_party", "platform", "regulator"].map((o) => <option key={o} value={o}>{human(o)}</option>)}</Select></Field>
              <Field label="How to remove it" htmlFor="bar-mech"><Select id="bar-mech" name="removal_mechanic"><option value="">Not decided</option>{["repair", "kill", "take_off", "route_to_partner", "change_entry", "make_reversible"].map((o) => <option key={o} value={o}>{human(o)}</option>)}</Select></Field>
              <Field label="Segment" htmlFor="bar-seg"><Select id="bar-seg" name="segment_id">{segOptions}</Select></Field>
              <Field label="Quote" htmlFor="bar-q"><Select id="bar-q" name="quote_id">{quoteOptions}</Select></Field>
            </ActionForm>
          </Section>
        </div>
      ) : null}

      {tab === "quotes" ? (
        <>
          <Section>
            {d.quotes.length ? (
              <ul className="flex flex-col gap-2">
                {d.quotes.map((q) => (
                  <li key={q.id} className="flex gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-3">
                    <EpistemicTag kind="quote" />
                    <div className="min-w-0">
                      <p className="prose-measure text-[14px]">“{q.text_verbatim}”</p>
                      {q.source_id ? <Link href={`/p/${slug}/knowledge/${q.source_id}#${q.chunk_id}`} className="text-[12.5px] text-green underline-offset-2 hover:underline">{q.source_title} {formatLocator(q.locator)}</Link> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No quotes yet">Quotes are copied word for word from a {product.name} source in Knowledge. The system checks they match the source exactly.</EmptyState>}
          </Section>
          <Section title="Add a verbatim quote">
            {d.sources.length ? (
              <ActionForm action={addQuoteAction.bind(null, slug)} submitLabel="Save quote" resetOnSuccess className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
                <Field label="Source" htmlFor="q-src"><Select id="q-src" name="source_id" required>{d.sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select></Field>
                <Field label="Exact words" htmlFor="q-text" hint="Copy from the source without changes."><Textarea id="q-text" name="text" required /></Field>
                <Field label="Speaker" htmlFor="q-sp"><Select id="q-sp" name="speaker"><option value="customer">Customer</option><option value="interviewer">Interviewer</option><option value="other">Other</option></Select></Field>
              </ActionForm>
            ) : <EmptyState title={`Upload a ${product.name} source first`} action={<Link href={`/p/${slug}/knowledge`} className="text-green underline">Open Knowledge</Link>} />}
          </Section>
        </>
      ) : null}

      {tab === "codebook" ? (
        <>
          <Section title="Versions" description="A codebook version is frozen once approved. Changes go into a new draft with a migration map; segment codes never change.">
            {d.codebooks.length ? (
              <Table>
                <thead><tr><th>Version</th><th>Status</th><th className="text-right">Segments</th><th>Approved</th><th /></tr></thead>
                <tbody>{d.codebooks.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">v{c.version}</td>
                    <td><Status tone={c.status === "active" ? "green" : c.status === "draft" ? "amber" : "neutral"}>{c.status}</Status></td>
                    <td className="num text-right">{c.segments}</td>
                    <td>{c.approved_at ? formatDateTime(c.approved_at) : "—"}</td>
                    <td className="text-right">{c.status === "draft" ? <form action={activateCodebookAction.bind(null, slug, c.id)}><Button size="sm" variant="primary" disabled={!c.segments}>Approve and activate</Button></form> : null}</td>
                  </tr>
                ))}</tbody>
              </Table>
            ) : <EmptyState title="No codebook yet">It is created with your first segment.</EmptyState>}
            {d.codebooks[0]?.status === "active" ? <form action={newDraftCodebookAction.bind(null, slug)} className="mt-3"><Button>Start a new draft version</Button></form> : null}
          </Section>
          <Section title="Segment change history">
            {d.history.length ? (
              <Table>
                <thead><tr><th>When</th><th>Who</th><th>Change</th><th>Item</th></tr></thead>
                <tbody>{d.history.map((h, i) => <tr key={i}><td className="whitespace-nowrap">{formatDateTime(h.occurred_at)}</td><td>{h.actor_type}</td><td>{h.action} {human(h.entity_type)}</td><td className="text-muted">{h.summary}</td></tr>)}</tbody>
              </Table>
            ) : <p className="text-[13px] text-muted">No changes yet.</p>}
          </Section>
        </>
      ) : null}
    </>
  );
}
