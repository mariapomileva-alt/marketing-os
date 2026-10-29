import { db, getProduct } from "@/server/context";
import { getProfile, rulesPackApplied, listClaims, listGuardrails, listLinks, listLocales, listTerms } from "@/server/services/products";
import {
  addClaimAction, addLinkAction, applyRulesPackAction, addLocaleAction, addTermAction, approveClaimAction, archiveClaimAction, archiveProductAction, importWebsiteAction, saveBriefAction, toggleGuardrailAction, updateProfileAction,
} from "@/app/actions/products";
import { productBrief } from "@/server/services/marketing-brief";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Table } from "@/components/ui/layout";
import { DataFlag, Status } from "@/components/ui/status";
import { EpistemicTag } from "@/components/ui/epistemic";

export const metadata = { title: "Product profile" };
export const maxDuration = 120;

const listField = (v: string[]) => v.join("\n");

export default async function ProductsPage({ params }: PageProps<"/p/[product]/products">) {
  const { product: slug } = await params;
  const product = await getProduct(slug);
  const { profile, claims, guardrails, links, locales, terms, packApplied, brief, knowledgeCount } = await db(async (tx) => ({
    profile: await getProfile(tx, product.id),
    claims: await listClaims(tx, product.id),
    guardrails: await listGuardrails(tx, product.id),
    links: await listLinks(tx, product.id),
    locales: await listLocales(tx, product.id),
    terms: await listTerms(tx, product.id),
    packApplied: await rulesPackApplied(tx, product.id),
    brief: await productBrief(tx, product.id),
    knowledgeCount: (await tx.one<{ n: number }>("select count(*)::int n from knowledge_sources where product_id = $1", [product.id])).n,
  }));
  const vocabularies = ["format", "goal", "funnel_stage", "cta", "topic", "visual_device", "emotional_trigger"];
  const vocabLabel: Record<string, string> = { format: "Formats", goal: "Goals", funnel_stage: "Funnel stages", cta: "CTAs", topic: "Topics", visual_device: "Visual devices", emotional_trigger: "Emotional triggers" };

  return (
    <>
      <PageHeader
        title={`${profile.name} profile`}
        description="Everything the system may say about this product, how it should sound, and what it must never say. AI drafts use only the approved facts below."
        flags={profile.is_demo ? <DataFlag kind="demo" /> : null}
      />

      {profile.slug === "back-app" ? (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-4">
          <div className="max-w-[70ch]">
            <p className="text-[14px] font-medium">Back voice, phrases and rules (26 Oct 2026)</p>
            <p className="mt-1 text-[13px] text-muted">
              {packApplied
                ? "Applied. Every draft uses this tone, these facts and prohibited claims, the extra safety rules, and the full document from Knowledge. Applying again adds only what is missing."
                : "Adds the approved rules document to this product: tone and examples, product facts and claims we never make, safety rules (medication advice, invented proof, bot and sales phrases, AI-style turns), website and App Store links, and the document itself to Knowledge."}
            </p>
          </div>
          <ActionForm action={applyRulesPackAction.bind(null, slug)} submitLabel={packApplied ? "Apply again" : "Apply rules"} pendingLabel="Applying…" submitVariant={packApplied ? "ghost" : "primary"} className="flex items-center gap-3 [&_p]:max-w-[360px] [&_p]:text-[12px]">
            <span className="sr-only">Apply the rules document to this product</span>
          </ActionForm>
        </div>
      ) : null}

      <Section title="Marketing brief" description="What every generator uses for this product: the content desk, Threads posts, comments and replies, the morning brief, and the cards' look. Each product has its own.">
        <ActionForm action={saveBriefAction.bind(null, slug)} submitLabel="Save brief" className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 md:grid-cols-2">
          <Field label="Name in texts" htmlFor="b-name"><Input id="b-name" name="name" defaultValue={brief.name} /></Field>
          <Field label="What it is (one line)" htmlFor="b-what"><Input id="b-what" name="what" defaultValue={brief.what} /></Field>
          <Field label="Who reads us" htmlFor="b-aud" className="md:col-span-2"><Textarea id="b-aud" name="audience" rows={2} defaultValue={brief.audience} /></Field>
          <Field label="Our topic / niche" htmlFor="b-niche"><Input id="b-niche" name="niche" defaultValue={brief.niche} /></Field>
          <Field label="How we mention ourselves" htmlFor="b-mention"><Input id="b-mention" name="mention" defaultValue={brief.mention} /></Field>
          <Field label="When the product honestly helps" htmlFor="b-moment" className="md:col-span-2"><Input id="b-moment" name="product_moment" defaultValue={brief.product_moment} /></Field>
          <Field label="We never say" htmlFor="b-never" className="md:col-span-2"><Textarea id="b-never" name="never" rows={2} defaultValue={brief.never} /></Field>
          <Field label="The team never pretends" htmlFor="b-nc"><Input id="b-nc" name="never_claim" defaultValue={brief.never_claim} /></Field>
          <Field label="Topics where we stay out" htmlFor="b-skip"><Input id="b-skip" name="skip_topics" defaultValue={brief.skip_topics} /></Field>
          <Field label="Good comments in our tone" htmlFor="b-good" hint="One per line. Examples of tone, never copied." className="md:col-span-2"><Textarea id="b-good" name="voice_good" rows={3} defaultValue={brief.voice_good.join("\n")} /></Field>
          <Field label="What we never sound like" htmlFor="b-bad" className="md:col-span-2"><Input id="b-bad" name="voice_bad" defaultValue={brief.voice_bad} /></Field>
          <Field label="Words people search" htmlFor="b-search"><Input id="b-search" name="search_phrases" defaultValue={brief.search_phrases} /></Field>
          <Field label="Hashtags" htmlFor="b-tags"><Input id="b-tags" name="hashtags" defaultValue={brief.hashtags} /></Field>
          <Field label="Hashtag rule" htmlFor="b-tagrule"><Input id="b-tagrule" name="hashtag_rule" defaultValue={brief.hashtag_rule} /></Field>
          <Field label="Morning brief tone" htmlFor="b-tone"><Input id="b-tone" name="brief_tone" defaultValue={brief.brief_tone} /></Field>
          <Field label="Last carousel slide: title" htmlFor="b-ct"><Input id="b-ct" name="closing_title" defaultValue={brief.closing_title} /></Field>
          <Field label="Last carousel slide: text" htmlFor="b-cx"><Input id="b-cx" name="closing_text" defaultValue={brief.closing_text} /></Field>
          <Field label="Brand word on cards" htmlFor="b-cb"><Input id="b-cb" name="card_brand" defaultValue={brief.card_brand} /></Field>
          <Field label="Footer on cards" htmlFor="b-cf"><Input id="b-cf" name="card_footer" defaultValue={brief.card_footer} /></Field>
          <Field label="Note on the closing card" htmlFor="b-cn" hint="Empty for none." className="md:col-span-2"><Input id="b-cn" name="card_note" defaultValue={brief.card_note} /></Field>
          <fieldset className="flex flex-wrap items-end gap-3 md:col-span-2">
            <legend className="mb-1 text-[12px] text-muted">Card colours</legend>
            {(Object.entries(brief.colors) as Array<[string, string]>).map(([k, v]) => (
              <label key={k} className="flex items-center gap-1.5 text-[12px]"><span className="inline-block size-4 rounded-full border border-line" style={{ background: v }} />{k}<Input name={`color_${k}`} defaultValue={v} className="h-7 w-24" /></label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-[13.5px] md:col-span-2"><input type="checkbox" name="sensitive" defaultChecked={brief.sensitive} className="size-4" /> Health or safety topic: add emergency lines and hand risky conversations to a person</label>
        </ActionForm>
      </Section>

      <Section title="Read the website into Knowledge" description={`All public pages of the site (from its sitemap) become this product's knowledge: facts, wording and guides the generators use. ${knowledgeCount} source(s) in Knowledge now. Reading again adds only changed pages.`}>
        <ActionForm action={importWebsiteAction.bind(null, slug)} submitLabel="Read the website" pendingLabel="Reading the pages…" className="flex flex-wrap items-end gap-3 [&_p]:basis-full [&_p]:text-[12.5px]">
          <Field label="Website" htmlFor="site-url"><Input id="site-url" name="site_url" defaultValue={profile.website_url ?? ""} placeholder="https://momentro.me" className="w-80" /></Field>
        </ActionForm>
      </Section>

      <Section title="Basics and positioning">
        <ActionForm action={updateProfileAction.bind(null, slug)} submitLabel="Save profile" className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 md:grid-cols-2">
          <Field label="Name" htmlFor="name"><Input id="name" name="name" defaultValue={profile.name} required /></Field>
          <Field label="Category" htmlFor="category"><Input id="category" name="category" defaultValue={profile.category} /></Field>
          <Field label="Website" htmlFor="website_url"><Input id="website_url" name="website_url" type="url" defaultValue={profile.website_url ?? ""} /></Field>
          <Field label="Countries" htmlFor="countries" hint="Two-letter codes, one per line or separated by commas."><Textarea id="countries" name="countries" rows={2} defaultValue={listField(profile.countries)} /></Field>
          <Field label="Short description" htmlFor="short_description" className="md:col-span-2"><Textarea id="short_description" name="short_description" defaultValue={profile.short_description} /></Field>
          <Field label="Tone of voice" htmlFor="tone_of_voice" className="md:col-span-2"><Textarea id="tone_of_voice" name="tone_of_voice" defaultValue={profile.tone_of_voice} /></Field>
          <Field label="Pain points" htmlFor="pain_points" hint="One per line."><Textarea id="pain_points" name="pain_points" defaultValue={listField(profile.pain_points)} /></Field>
          <Field label="Triggers" htmlFor="triggers" hint="Events after which people start looking for help. One per line."><Textarea id="triggers" name="triggers" defaultValue={listField(profile.triggers)} /></Field>
          <Field label="Desired emotional states" htmlFor="desired_emotional_states"><Textarea id="desired_emotional_states" name="desired_emotional_states" defaultValue={listField(profile.desired_emotional_states)} /></Field>
          <Field label="Customer vocabulary" htmlFor="customer_vocabulary" hint="Words customers actually use."><Textarea id="customer_vocabulary" name="customer_vocabulary" defaultValue={listField(profile.customer_vocabulary)} /></Field>
          <Field label="Advantages" htmlFor="advantages"><Textarea id="advantages" name="advantages" defaultValue={listField(profile.advantages)} /></Field>
          <Field label="Prohibited topics" htmlFor="prohibited_topics"><Textarea id="prohibited_topics" name="prohibited_topics" defaultValue={listField(profile.prohibited_topics)} /></Field>
          <Field label="Legal and compliance restrictions" htmlFor="legal_restrictions" className="md:col-span-2"><Textarea id="legal_restrictions" name="legal_restrictions" defaultValue={profile.legal_restrictions} /></Field>
        </ActionForm>
      </Section>

      <Section title="Approved facts and prohibited claims" description="Approved facts are the only facts AI may state. Prohibited claims are checked in every compliance review.">
        {claims.filter((c) => !c.archived).length ? (
          <Table>
            <thead><tr><th>Type</th><th>Statement</th><th>Why</th><th>Status</th><th /></tr></thead>
            <tbody>
              {claims.filter((c) => !c.archived).map((c) => (
                <tr key={c.id}>
                  <td>{c.kind === "approved_fact" ? <EpistemicTag kind="fact" /> : <span className="text-red">Prohibited</span>}</td>
                  <td className="max-w-[460px]">{c.statement}</td>
                  <td className="text-muted">{c.rationale}</td>
                  <td>{c.approved_at ? <Status tone="green">Approved by you</Status> : <Status tone="amber">Proposed, needs your approval</Status>}</td>
                  <td className="whitespace-nowrap text-right">
                    {!c.approved_at ? (
                      <form action={approveClaimAction.bind(null, slug, c.id)} className="inline"><Button size="sm" variant="primary">Approve</Button></form>
                    ) : null}{" "}
                    <form action={archiveClaimAction.bind(null, slug, c.id)} className="inline"><Button size="sm" variant="ghost">Archive</Button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No facts yet">Add the facts AI may use about this product, and the claims it must never make.</EmptyState>
        )}
        <ActionForm action={addClaimAction.bind(null, slug)} submitLabel="Add" resetOnSuccess className="mt-3 grid gap-3 md:grid-cols-[180px_1fr_1fr_auto] md:items-end">
          <Field label="Type" htmlFor="claim-kind">
            <Select id="claim-kind" name="kind"><option value="approved_fact">Approved fact</option><option value="prohibited_claim">Prohibited claim</option></Select>
          </Field>
          <Field label="Statement" htmlFor="claim-statement"><Input id="claim-statement" name="statement" required /></Field>
          <Field label="Source or reason" htmlFor="claim-rationale"><Input id="claim-rationale" name="rationale" /></Field>
        </ActionForm>
      </Section>

      <Section title="Safety rules" description="Checked by code before any AI review. A blocking rule stops the item until the text changes; it cannot be approved around.">
        {guardrails.length ? (
          <Table>
            <thead><tr><th>Rule</th><th>What it does</th><th>Effect</th><th>State</th><th /></tr></thead>
            <tbody>
              {guardrails.map((g) => (
                <tr key={g.id}>
                  <td className="font-medium">{g.code}</td>
                  <td className="max-w-[520px] text-muted">{g.rationale || g.instruction}{g.rule_type === "tone" ? " (checked by the AI brand review)" : ""}</td>
                  <td>{g.severity === "block" ? <Status tone="red">Blocks</Status> : <Status tone="amber">Warns</Status>}</td>
                  <td>{g.active ? <Status tone="green">On</Status> : <Status>Off</Status>}</td>
                  <td className="text-right">
                    <form action={toggleGuardrailAction.bind(null, slug, g.id, !g.active)}><Button size="sm" variant="ghost">{g.active ? "Turn off" : "Turn on"}</Button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No product rules">Global rules still apply: no impersonating customers, no invented testimonials, channel length limits and link checks.</EmptyState>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Languages and countries">
          {locales.length ? (
            <ul className="mb-3 flex flex-wrap gap-2">
              {locales.map((l) => (
                <li key={l.id} className="rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1 text-[13px]">
                  {l.language}{l.country ? `-${l.country}` : ""}{l.is_primary ? " (primary)" : ""}
                </li>
              ))}
            </ul>
          ) : <p className="mb-3 text-[13px] text-muted">No languages yet. Content Studio needs at least one.</p>}
          <ActionForm action={addLocaleAction.bind(null, slug)} submitLabel="Add language" resetOnSuccess className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field label="Language code" htmlFor="language"><Input id="language" name="language" placeholder="en" required pattern="[a-zA-Z]{2,3}" /></Field>
            <Field label="Country" htmlFor="country"><Input id="country" name="country" placeholder="LV" pattern="[a-zA-Z]{2}" /></Field>
            <label className="mb-2 flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="is_primary" /> Primary</label>
          </ActionForm>
        </Section>

        <Section title="Links and CTAs" description="Only these hosts may appear in content; links get UTM tags from the builder.">
          {links.length ? (
            <ul className="mb-3 flex flex-col gap-1 text-[13px]">
              {links.map((l) => (
                <li key={l.id} className="truncate"><span className="text-muted">{l.kind}</span> {l.label}: <a className="text-green underline underline-offset-2" href={l.url} rel="noreferrer noopener" target="_blank">{l.url}</a></li>
              ))}
            </ul>
          ) : <p className="mb-3 text-[13px] text-muted">No links yet.</p>}
          <ActionForm action={addLinkAction.bind(null, slug)} submitLabel="Add link" resetOnSuccess className="grid gap-2 sm:grid-cols-2">
            <Field label="Kind" htmlFor="link-kind">
              <Select id="link-kind" name="kind">
                {["website", "landing", "app_store", "google_play", "social", "cta", "other"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
              </Select>
            </Field>
            <Field label="Label" htmlFor="link-label"><Input id="link-label" name="label" /></Field>
            <Field label="URL" htmlFor="link-url" className="sm:col-span-2"><Input id="link-url" name="url" type="url" required placeholder="https://" /></Field>
          </ActionForm>
        </Section>
      </div>

      <Section title="Vocabularies" description="Fixed lists keep analytics comparable: results group by these exact values.">
        <div className="grid gap-4 md:grid-cols-3">
          {vocabularies.map((v) => (
            <div key={v} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
              <h3 className="text-[14px]">{vocabLabel[v]}</h3>
              <p className="mt-1 text-[13px] text-muted">{terms.filter((t) => t.vocabulary === v).map((t) => t.label).join(", ") || "None yet"}</p>
            </div>
          ))}
        </div>
        <ActionForm action={addTermAction.bind(null, slug)} submitLabel="Add value" resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <Field label="List" htmlFor="vocabulary"><Select id="vocabulary" name="vocabulary">{vocabularies.map((v) => <option key={v} value={v}>{vocabLabel[v]}</option>)}</Select></Field>
          <Field label="Value" htmlFor="term-label"><Input id="term-label" name="label" required /></Field>
        </ActionForm>
      </Section>
          <Section title="Archive this project" description="It disappears from the switcher and from every daily job (desk, Threads, brief, posting). Its history stays. Only the owner can do this.">
        <form action={archiveProductAction.bind(null, slug)}><Button variant="danger" size="sm">Archive {profile.name}</Button></form>
      </Section>
    </>
  );
}
