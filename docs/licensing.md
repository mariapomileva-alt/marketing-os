# Licensing and reuse findings

Stage A · 2026-10-19

> This is an engineering assessment to guide what we copy and what we only learn from. It is not legal advice. Where a decision carries legal risk, it is listed as an open question for the owner.

## Summary

| Source | Licence found | What we may do | What we must not do |
|---|---|---|---|
| com-factory | **None** | Study product and architectural ideas; implement independently | Copy, translate or adapt its code, prompts, regexes or UI text |
| AI Mindset course vault | **None stated**; course material distributed to participants | **Owner decision 2026-10-19:** import the whole vault into your private workspace as the methodology knowledge base, with attribution and participant names pseudonymised | Commit raw course files to Git; publish course text externally; show participants' real names; present course examples as facts about our products |
| AJTBD prompt, call schema, codebook template | **None stated**; methodology attributed to Ivan Zamesin (Next Move Theory) | Adapt the structure into product entities, as you asked; keep attribution of the methodology | Hardcode the example company, products or forbidden phrases; reproduce canon texts we do not have |
| Default stack (Next.js, Tailwind, shadcn/ui, Zod, PostgreSQL, pgvector, Supabase client libs, job runner, Sentry/PostHog SDKs) | Permissive open-source licences expected | Use as dependencies | Ship without a licence inventory; Stage B adds an automated licence check |
| Platform APIs (Meta: Instagram, Threads; others later) | Platform terms | Use official APIs within granted permissions and rate limits | Browser automation presented as safe; scraping that bypasses API permissions |

## 1. com-factory

**Evidence checked (commit `fc55f71`):**

- no `LICENSE`, `LICENSE.md`, `COPYING` or similar file in the repository root or subfolders;
- `package.json` has no `license` field and declares `"private": true`;
- `README.md` and `INSTALL.md` contain no licence or permission statement.

**Conclusion.** Code published without a licence is, by default, protected by the author's copyright: the public can view it on GitHub, but receives no permission to copy, modify or redistribute it. Therefore:

- **No code, prompts, regular expressions, SQL or UI text from com-factory will be copied or translated** into Marketing OS.
- Product ideas and architectural patterns (modes, gates with reasons, limits, cooldowns, dedupe, circuit breaker, validators) are not protected as such and will be **re-implemented independently** from our own specification in `reusable-patterns.md`.
- To keep the implementation clean, Stage B code for the policy engine and validators will be written from that specification, not with the com-factory source open side by side.
- If you later want to reuse actual code, ask the author (GitHub `MikitaDrazdou`) to add a licence or grant written permission. Recommended only if a specific module would save significant time; currently none does.

**Third-party dependencies of com-factory** (Aside Browser, Jev on OpenRouter) have their own terms and are not used by Marketing OS.

## 2. AI Mindset Marketing Sprint vault

**Evidence checked:** README, programme, all summary cards and written materials; text search across all 73 files for licence, copyright and redistribution terms. None found. The README states the vault is assembled from the course platform (`learn.aimindset.org/marketing`).

**Owner decision (2026-10-19):** the course materials are the methodological foundation of Marketing OS and are imported into the knowledge base.

**How we do this safely:**

- **Private use only.** The materials live in your private workspace database and private Storage bucket. They are **not committed to Git** (the raw files stay outside the repository; `.gitignore` blocks the import folder) and are never published externally.
- **Attribution.** Every source keeps its course, session, speaker, date and file name in provenance, and every answer that uses it cites it.
- **Third-party personal data.** Transcripts and Zoom chats contain names and messages of other participants. On import, participant names and handles are replaced with stable pseudonyms (`Participant-07`); lecturers and guest speakers stay named as authors. Chat messages are kept as low-confidence context.
- **Methodology, not evidence.** Course sources are `scope = workspace`, `source_type = methodology`. They can support rules, playbooks and recommendations, but can never be cited as a fact or quote about Back App, MyTeam Space or Momentrami customers.
- **No verbatim copying into outputs.** Generated content for your channels uses methods from the course, not its sentences. Short quotes appear only inside the internal knowledge view with a citation.
- **Third-party company data.** The 13 "AI Visibility Report" PDFs describe other companies; they are imported as methodology examples (report structure), clearly labelled, when PDF parsing arrives (v0.2).
- **Contradictions with our rules.** Where the course recommends tactics forbidden for a product (for example, discount + deadline + FOMO for Back App), the product guardrails win; the playbook marks the rule as "not applicable to this product".

## 3. AJTBD prompt, call-record schema, codebook template

**Evidence checked:** file headers. The pipeline names its methodology (Advanced JTBD / Next Move Theory by Ivan Zamesin) and references canon files that are not provided. No licence or author statement for the three files themselves.

**Conclusion.**

- You asked to adapt these materials; we will implement **our own data model** inspired by their structure (entities, fields, rules), which is an independent implementation of a method.
- Methodology terms (Core Job, Big Job, consideration activators, RAT cards, etc.) will be used with attribution in docs and in the UI help text ("based on Advanced JTBD by Ivan Zamesin").
- The schema JSON and codebook Markdown will not be shipped verbatim. Field names are re-specified in English in our migrations.
- All example content is excluded: the example company, courses, country, funnel steps, prices and phrase lists.
- **Owner confirmed (2026-10-19):** these files are course materials and form part of the methodology base. They are imported as workspace-level methodology sources; the example company content stays in the source text but is never used as data about our products.

## 4. Planned stack dependencies

Expected licences (to be **verified automatically** in Stage B with a licence inventory script; build fails on unknown or copyleft licences unless approved):

| Component | Expected licence |
|---|---|
| Next.js, React, Tailwind CSS, shadcn/ui, Zod | MIT |
| PostgreSQL | PostgreSQL Licence |
| pgvector | PostgreSQL Licence |
| Supabase client libraries | MIT (hosted Supabase is a commercial service with its own terms and DPA) |
| Drizzle ORM (if chosen, D-3) | Apache-2.0 |
| Inngest SDK / Trigger.dev (D-2) | Apache-2.0 for SDKs; check self-hosting terms if self-hosted |
| Sentry / PostHog SDKs | MIT for client SDKs; hosted services have their own terms |

Fonts: only fonts with an open licence (SIL OFL) or a purchased licence will be bundled.

## 5. Platform terms

- **Threads:** an official API exists with publishing, reply management, deletion and a publishing-limit endpoint; documented limits include 250 API-published posts and 1,000 replies per profile per rolling 24 hours ([Meta Threads API overview](https://developers.facebook.com/docs/threads/overview)). Publishing through it requires a Meta app with the relevant permissions.
- **Instagram:** content publishing via API is available for professional accounts and covers images, videos, Reels, carousels and stories; media must be hosted at a public URL; the publishing limit is exposed by an endpoint ([Meta content publishing docs](https://developers.facebook.com/docs/instagram-platform/content-publishing)). The MVP does not publish to Instagram; it exports.
- **Browser automation** of logged-in sessions and scraping that bypasses refused API access (as described in com-factory and in the course scraper prompt) can breach platform terms and risk account restrictions. Marketing OS will not ship such an adapter enabled; if ever built, it is a separate adapter, off by default, with a written risk disclosure shown before enabling.

## 6. Data protection note (affects licensing of customer content)

Back App customer interviews will contain information about panic, anxiety and fear, which is likely health-related personal data under GDPR (special category). This affects where data is hosted, which AI providers may process it, consent records and retention. See `open-decisions-and-risks.md` (R-1, D-15).
