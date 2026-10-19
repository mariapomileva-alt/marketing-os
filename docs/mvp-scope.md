# MVP scope (v0.1) — strict boundaries

Stage A · 2026-10-19 · status: proposal

The MVP is complete when all 15 points of the Definition of Done in the brief pass on a deployed build, with Back App fully configured and two more products created. Anything not listed under "In scope" is out of scope, even if the schema already has room for it.

## In scope

| Area | Included in v0.1 | Explicitly not in v0.1 |
|---|---|---|
| Accounts | One owner, one workspace; magic link + TOTP | Team members, roles, invitations |
| Products | CRUD, full profile (§6 of the brief), guardrails, claims, links, UTM templates, taxonomy terms; Back App seeded with its rules | Product templates marketplace |
| Knowledge | Upload Markdown, TXT, JSON, CSV; provenance on every source; chunking; full-text + vector search; manual quote extraction | PDF, DOCX, URL fetch, images/OCR, audio transcription (v0.2) |
| Audience & AJTBD | Manual CRUD: audiences, segments, jobs (levels), success criteria (ordered), fears, barriers, triggers, quotes, interviews, leads; codebook v1 create/activate; segment change history; import of already-structured JSON records (schema v1, adapted) | LLM call unpacking, AI re-clustering, period reports, winback (v0.3) |
| Competitors & signals | Manual competitor list; manual signal entry with all structure fields; comparison table for ≥ 20 creatives with filters and sort | Scraping, automatic extraction, Ads Library harvest (never via web-UI scraping) |
| Hooks & ideas | Ideas linked to segment/job/sources; hook and angle variants (AI) with rationale | Hook library analytics beyond MVP analytics |
| Content Studio | Inputs from the brief; generates: hook, angle, Instagram caption, short post, Threads post, carousel (slide texts), Reels script (timecode · script · visual), helpful comment draft; each variant with the 7 explanations; manual editing with version history | Long post, X thread, storyboard frames, static-image concept, email, article (v0.2); image/video generation (later) |
| Reviews | Deterministic guardrail engine (blocking) + AI brand review + AI compliance review (advisory, structured findings) | Second-model reviewer (v0.2) |
| AI providers | Mock provider (default in Stage B); one real provider wired in Stage C (D-5); cost and token logging; per-run budget cap | Model routing UI, fine-tuning |
| Approval Queue | Unified queue; approval bound to version hash; approve / reject / request changes; reasons visible | Bulk approve, delegated approvers |
| Calendar | Month/week views; schedule approved items; drag to reschedule; shows published items | Auto-publishing at scheduled time |
| Channels | **Instagram:** export package (caption, slide texts, script, UTM link) · **Threads:** draft + export/copy, mark as posted with URL · **Website:** landing URLs + article export · Planned stubs for YouTube, TikTok, X, LinkedIn, Snapchat, Pinterest, Blog/SEO, Email | Any API publishing (Threads API is D-7), comment discovery, auto-replies, browser automation |
| Connections | Integration status page; LLM provider key connection (encrypted, revocable, rotatable); disconnect without losing history | OAuth to social platforms (v0.2 with D-7) |
| UTM | Builder with templates; unique link per publication; copy; history | Link shortener, click tracking redirect (v0.2) |
| Metrics | Manual entry and CSV import with column mapping; import batches; undo batch | API metrics pulls |
| Conversions | CSV import of registrations / trials / payments / refunds keyed by UTM or link id; unmatched rows reported | Store/MMP integrations |
| Analytics | Dashboard from §12 of the brief; group by product, channel, segment, hook, angle, format, CTA; Wilson intervals; `Not enough data`; CPL/CAC only when spend exists; demo dataset labelled | Cohorts, LTV curves, multi-touch attribution |
| Experiments | Auto-created per item; pre-registration; review screen; human conclusion; recommendation cards citing data | Automated rule updates (fast loop) |
| Conversations | Manual logging of comments/replies on our posts; reply drafts go through approval and are posted manually | Inbound fetching via API |
| Automations | Page shows policy settings (modes, limits, active hours) and that `automatic` is disabled | Any running automation |
| Activity Log | Full audit of user, AI, system and integration actions; filters | Export to SIEM |
| Settings | Workspace, profile, MFA, AI budget caps, thresholds for "Not enough data" | Billing |
| Quality | Type check, lint, unit + integration + e2e tests; desktop and mobile layouts; error and empty states | Load testing |

## Hard red lines in v0.1

- No action leaves the system without a human approving the exact version.
- `automatic` mode cannot be enabled (refused in code, not only hidden in UI).
- No fake accounts, no AI speaking as a customer, no invented personal experience.
- No mass commenting, no scraping, no browser automation.
- No percentages written by AI; all numbers computed.
- No hypothesis displayed as a fact; quotes only verbatim with source.
- Back App: no cure promises, no diagnosis, no false urgency or fear manipulation, no positioning as a replacement for a doctor, therapist or emergency service; content addressing acute crisis must carry the approved safety line (wording to be approved by the owner, D-13).

## Definition of Done mapping

| DoD | How it is demonstrated |
|---|---|
| 1 Add three products | Products CRUD; e2e test creates Back App, MyTeam Space, Momentrami |
| 2 Switch without mixing data | Product in URL; composite FKs + RLS; integration test tries cross-product reads and writes and must fail |
| 3 Upload a document | Markdown/TXT/JSON/CSV upload with provenance form |
| 4 Source behind every AI conclusion | Assertions and variant rationales list evidence; UI hover/expand; test: AI output without evidence is stored as hypothesis |
| 5 Create a segment and a Job | AJTBD screens |
| 6 Multiple hook and content variants | Content Studio (mock in B, real provider in C) |
| 7 Edit manually | Version history with diff and author |
| 8 Approve or reject | Approval Queue |
| 9 Place on calendar | Calendar with approved items only |
| 10 Export for Instagram or Threads | Export package download + copy-to-clipboard |
| 11 Unique UTM link | UTM builder; uniqueness constraint |
| 12 Upload metrics | Manual + CSV import |
| 13 Compare by hook, angle, channel | Analytics group-by tables with thresholds |
| 14 History of all AI and user actions | Activity Log + agent run viewer |
| 15 Disconnect without damage | Revoke LLM key connection (and any channel connection); history intact; test asserts rows remain |

## Implementation order

Each step ends with: type check, lint, tests green, CHANGELOG entry, short report (done · files · tested · limitations · next).

### Stage B — foundation (mock AI, demo data labelled)

| Step | Deliverable | Exit check |
|---|---|---|
| B1 | Repo, Next.js + TS strict, Tailwind, shadcn/ui, ESLint, Vitest, Playwright, `.env.example`, CI script, licence inventory | `typecheck`, `lint`, `test` pass on empty app |
| B2 | Local Supabase; migrations for tenancy, products, audit; RLS; append-only triggers | Isolation + audit immutability tests |
| B3 | Auth (magic link + TOTP), owner bootstrap | Unauthenticated access blocked |
| B4 | App shell: 19-section navigation, product selector in header, empty states, design tokens, responsive | Visual check desktop + 375 px |
| B5 | Product CRUD with full profile, guardrails, claims, links, taxonomy | e2e: create 3 products |
| B6 | Knowledge library: upload MD/TXT/JSON/CSV, provenance, chunking, FTS; embedding job (mock embeddings in B) | Search returns source + locator |
| B7 | Audience & AJTBD manual CRUD, codebook v1, segment history | Segment change audited |
| B8 | Signals & competitors manual table (≥ 20 rows usable) | Sort/filter test |
| B9 | Content Studio with **Mock LLM provider** (deterministic, labelled "MOCK"), ideas → hooks → variants → versions | Every variant has rationale + evidence links |
| B10 | Guardrail engine + review steps (mock AI review, real deterministic rules) | Golden-set tests for Back App red lines |
| B11 | Approval Queue with hash binding; Calendar | Edit-after-approval invalidates approval |
| B12 | UTM builder; export packages (Instagram, Threads) | Unique links; export contents test |
| B13 | Metrics manual + CSV import; Analytics dashboard on **demo data** (flagged); stats module | Wilson + "Not enough data" unit tests |
| B14 | Activity Log, agent run viewer, Connections page (LLM key connect/disconnect/rotate) | DoD #15 test |

### Stage C — first live workflow (Back App)

| Step | Deliverable |
|---|---|
| C1 | EU-hosted Supabase project; real LLM provider connected (D-5); budget caps set |
| C2 | Back App profile completed with your approved facts, prohibited claims, tone, crisis line |
| C3 | Import selected materials with full provenance (your own notes; no course transcripts) |
| C4 | One segment + one Job entered from your evidence (labelled by evidence level) |
| C5 | One idea → three hooks → Instagram caption, Threads post, Reels script |
| C6 | Brand + compliance review; fix blocking findings |
| C7 | Approval → export → you post manually → mark published with URL |
| C8 | UTM link → test metrics import → experiment result in Analytics (flagged as test data until real data arrives) |

## Out of scope for v0.1 (summary)

Automated publishing on any platform, comment discovery and auto-replies, browser automation, scraping, image/video generation, paid-ads management and auto-rules, multi-user collaboration, PDF/DOCX/URL ingestion, AI call unpacking and re-clustering, multi-touch attribution, LTV modelling, GEO tracking, PostHog.
