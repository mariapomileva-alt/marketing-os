# Source audit

Stage A · 2026-10-19 · status: for owner review

This document records what was found in each source, what is useful for Marketing OS, and what must not be adopted. All sources were treated as research material. **Nothing from any source was executed**: no scripts, installers, prompts or automations were run. Files were read only.

| # | Source | How it was accessed | Size |
|---|---|---|---|
| 1 | `github.com/MikitaDrazdou/com-factory` | Shallow read-only clone, commit `fc55f71` ("Comments Factory", package version 0.5.0) | 24 TypeScript files, ~3,000 lines |
| 2 | `AI-Mindset-MARKETING-Vault.zip` | Copied from Downloads, extracted into an isolated scratch folder | 73 files: 60 Markdown, 13 PDF, no executables |
| 3 | `AJTBD prompt.md` | Read | 212 lines, v2.0 dated 2026-10-09 |
| 4 | `03-schema-call-record.json` | Read | JSON schema v1 |
| 5 | `04-codebook-template.md` | Read | Codebook template, versioning rules, aggregator spec |

---

## 1. com-factory (Comments Factory)

### What it is

A single-owner, local-only admin panel and scheduler that finds fresh posts on X and Threads, decides whether a reply is worth writing, drafts a reply in the founder's voice, validates it, and posts it from the owner's own account within limits. One account can serve several products.

### Stack and structure

- Node ≥ 23.6, TypeScript executed directly (no build step), Hono web server, built-in `node:sqlite`. Only two runtime dependencies (`hono`, `@hono/node-server`).
- Runs on the owner's Mac as a `launchd` service; panel bound to `127.0.0.1:4777`.
- External services: OpenRouter for "Jev" (a decision/scoring model, `typesafe/jev-1.13`); Aside Browser (third-party desktop browser) as the "hands" for X and Threads; the text model connected inside Aside (default Claude) for drafting.

```
src/cli.ts              commands: serve, doctor, x:*, threads:*
src/server/*            panel pages, settings UI, views
src/runner/x.ts         X: discover → score → draft → post → stats
src/runner/threads.ts   Threads: import memory → inbound → discover → score → draft → post → stats → insights
src/runner/scheduler.ts one-minute ticker, schedule slots, posting approved drafts, doctor
src/runner/doctor.ts    environment and login health checks
src/lib/limits.ts       daily limits, active hours, min gap, author cooldown, per-post dedupe, pauses
src/lib/draft.ts        drafting + validators (length, links, UTM, prices, hashtags, sales hooks)
src/lib/jev.ts          scoring questions and thresholds
src/lib/products.ts     product cards, prompt context, UTM application
src/lib/settings.ts     per-platform config defaults and modes
src/lib/*-browser.ts    JavaScript injected into logged-in browser sessions
src/prompts/*           system prompts for X, Threads, voice commands
```

### Data model (SQLite)

`settings` (key/value JSON), `products`, `runs` (each scheduler run with stats and log), `candidates` (found posts with score JSON, decision and reason; unique per platform + post id), `drafts` (text, model, status, error), `comments` (what was actually posted, with metrics JSON and `source` = runner or imported), `inbound` (replies to our comments, classified A/B/C/D), `blocks` (per-platform pause with reason and expiry), `stop_authors`. Migrations are additive `ALTER TABLE` calls at startup.

### Strongest product patterns observed

1. **Three autonomy modes per platform**: draft only / requires approval / automatic.
2. **A single "gate" function** that answers "may we act right now?" and always returns a human-readable reason: platform disabled, paused until X with reason, outside active hours, daily limit reached, account-wide cap reached, minimum gap not elapsed.
3. **Deduplication and anti-repetition**: one reply per post across all tools on the account, author cooldown (30 days), stop-list of authors, avoids re-using recent opening words.
4. **Self-limiting promotion**: product mentions and links capped as a share of the last N own comments, so the account does not drift into sounding salesy.
5. **Immediate circuit breaker**: any error, captcha, login loss or platform push-back pauses the platform (24 h by default) and shows the reason on the overview.
6. **Visible skip reasons**: every candidate stores why it was skipped (`relevance 0.53 < 0.6`, `kind=ad`, `risk 0.66`).
7. **Cheap classifier before expensive writer**: a scoring model with fixed questions and numeric thresholds filters ~95% of posts; the writing model only runs for the few that pass.
8. **Deterministic validators after generation, with one repair pass**: no hashtags, no second link, links only to known hosts and only with UTM, no prices where forbidden, no "DM me / tell me your dates" sales endings, at most one emoji. Missing UTM is inserted by code, not left to the model.
9. **Honest voice rules in prompts**: speak as the founder, never pretend to be a customer, never invent personal experience, use only facts listed in the product card.
10. **Product card as the single source of allowed facts**, rendered into every prompt ("facts you may use, never invent others", "never: …").
11. **Natural-language settings commands** turned into a structured patch that is shown to the owner and applied only after confirmation.
12. **`doctor`** health checks feeding an onboarding checklist in the panel.
13. **Import of another tool's history** so two tools on one account never hit the same author or post.

### Things not to adopt

| Observation | Why not |
|---|---|
| Posts through logged-in browser sessions via Aside (DOM clicks for Threads, session API for X) | Unofficial automation. The project's own README says automation formally violates X and Meta rules. Marketing OS uses official APIs first; browser automation only as a separately labelled, disabled-by-default adapter. |
| Code comment: "Threads has no API" | Outdated. Meta publishes an official Threads API with publishing, reply-management permissions and a publishing-limit endpoint (verified 2026-10-19, see licensing/sources). |
| Default mode for X is `auto` | Contradicts our MVP rule: every external action requires manual approval. |
| `install.sh` pipes a remote script into `bash` (`curl … | bash`) and registers a KeepAlive launchd service | Not run. Would need explicit approval; not needed for Marketing OS. |
| SQLite, local Mac, no auth | Fine for a one-machine tool; Marketing OS needs auth, multi-product isolation, encrypted secrets and a hosted database. |
| Settings as JSON blobs in one key/value table | Hard to audit and migrate; Marketing OS uses typed, versioned tables. |
| Jev scoring through OpenRouter | Interesting pattern (calibrated scores), but a specific third-party model; we keep the pattern behind an interface, not the vendor. |
| Domain-specific defaults (eSIM queries, pt/es markets, price regexes) | Product-specific; irrelevant to our products. |

**Licence:** none found (no LICENSE file, no `license` field, `"private": true`). See `licensing.md`. No code is copied.

---

## 2. AI Mindset Marketing Sprint vault (course archive)

### What it is

Export (2026-10-15) of a three-week course, 21 Sep – 12 Oct 2026: 19 sessions in 7 sections. Each session has a summary card, often a full transcript and a Zoom chat export; some have speaker materials. Filenames were zip-encoded (`#U043f…`) and were decoded to Cyrillic for reading only.

| Section | Contents |
|---|---|
| 01 preparation | Two pre-work cards (LinkedIn as a B2B system; AI marketing at Moonly) |
| 02 intro call | Cohort introduction (card, transcript, chat) |
| 03 week 1 · product × marketing | Moonly "context is the moat" lecture; Roma Kumar's performance pipeline; Sergey Bulaev's agentic LinkedIn. **Materials:** Product Data Flywheel framework (AIM-PDF-01 v0.4), B2C onboarding / hooks / Data Flywheel guide (AIM-B2C-ONB-01 v0.6), Meta Ads auto-rules guide, a storyboard skill, a prompt to build a Meta Ads Library scraper skill |
| 04 week 2 · content machines and attribution | Creator farm on AI actors; daily GTM strategy engine; content machine; the AI Mindset "marketing harness"; LinkedIn track; Seva Ustinov on attribution and Data Flywheel |
| 05 week 3 · GTM and scale | Outcome-based pricing interview; GEO / AI-visibility guest with 13 PDF "AI Visibility Reports" about third-party companies; LinkedIn and personal brand |
| 06 office hours | Three sessions |
| 07 demo day | Ten participant "marketing machines" |

Transcripts (~2.7 MB) were not read in full; summary cards and all written materials were. Transcripts and chats contain names and messages of other course participants.

### Most relevant content for Marketing OS

| Source | What it contributes |
|---|---|
| **Product Data Flywheel (AIM-PDF-01)** | The definition we adopt: if past outcomes do not change the next decision, it is not a flywheel. Five required parts (rules and examples; autonomy levels and red lines; memory of every case; quality checks; an owner). Fast loop vs slow loop. Metrics defined *before* the change: primary result, early indicator, counter-metric, decision quality, data quality. What to record per case: what was known before the decision, rule version, what was actually shown, reaction, outcome and when, consent and retention. Explicit warnings: attribution ≠ causation; the "clicked → show more of the same" trap; never back-fill features the system did not know at decision time. |
| **B2C onboarding / hooks / Data Flywheel (AIM-B2C-ONB-01)** | Four layers of user context: stated / observed / inferred (hypothesis with confidence) / confirmed by outcome. "Never store an AI inference as an established fact; keep source, date, confidence and a way to correct it." Table of psychological mechanics with the line where each turns into manipulation (fake scarcity, fake countdowns, fake social proof) — directly usable as Back App compliance rules. Message match from creative to first screen. Counter-metrics for every stage (refunds, early cancellations, complaints). |
| **Roma Kumar, week 1 practice** | "Creo Lab": tag every creative by persona, hook, body, angle, actor and concept so winning combinations can be found; the bottleneck is understanding what worked, not production. Customer interviews before performance; verbatim customer quotes feed scripts. Competitor creative decomposition (persona, hook, body, angle, format). |
| **Week 2 content machine** | Weekly debugging of "reference vs our version" with a human doing the final diagnosis; trend-watching sorted by views relative to the account's median. |
| **Seva Ustinov, attribution** | Choose one attribution object (order, first lead, contact) and one primary model for the team (last non-direct / last non-brand click). At small scale, asking customers where they came from is enough. Evaluate automated rules by money saved, money lost and opportunity cost. |
| **AI Mindset harness** | Context as plain, portable Markdown (product, audience, voice, glossary) that survives model or vendor changes; naming conventions; **evals** as tests of quality; **gates** — things an agent may never do (for example, post to a channel itself). |
| **GTM engine (open session)** | Deterministic work (storage, selection, diffs) in SQL and scripts; LLM only where reasoning is needed; Postgres before vector or graph databases. A separate evaluator model scores outputs and a human sees what was included, excluded and how it was scored; >70% rejection in the first weeks is normal while the voice is tuned. |
| **Demo day** | A signal should carry source, platform, freshness, response size, an explanation of why it worked and an adaptation idea. Full auto-publishing is one mode, not the goal; the irreversible action stays with the owner. A single UTM generator plus documented routes makes partner attribution explainable. |
| **Ads Library scraper prompt** (`prompt_recreate_skill.md`) | Useful **analysis fields** for signals: hook in first 3 s, hook type, offer, promise, proof, emotional lever, audience signals, CTA, on-screen text, structure segments with "why it works". Useful **honesty rules**: spend and reach are never available for commercial ads, so days active is only a proxy; any truncated collection must be labelled; a technique seen in a competitor is a hypothesis, not a recommendation. |
| **Storyboard skill** (`skill.md`) | The output shape (timecode · script fragment · visual) is reusable for Reels scripts. |
| Meta Ads auto-rules guide | Kill / test / scale rules for paid campaigns. Out of MVP scope (no ad-account management); roadmap only. |
| GEO reports and lecture | Measuring AI-assistant visibility on a fixed set of real customer questions. Roadmap item for Blog/SEO. |

### Things not to adopt

| Observation | Why not |
|---|---|
| The scraper prompt instructs bypassing the official Ad Library API (which refused permission) by intercepting the web UI's GraphQL with Playwright and tuning delays to avoid blocks | Platform-terms risk. Not built. Signals are entered manually in the MVP. |
| The prompt asks to be pasted into a new agent session and to run an `install.sh` | Treated as text only. Not executed. |
| Storyboard rules: frame change every 3 s, "always bright, saturated colours" | Conflicts with Back App's calm visual direction. Only the table shape is reused. |
| Week 2 "stories sale" pattern: discount with deadline, managed FOMO, price increase as trigger | Explicitly forbidden for Back App (false urgency, pressure on vulnerable users). |
| AI actors, face replacement, synthetic personas scoring creatives | Out of scope; synthetic personas must never be presented as customer evidence. |
| Transcripts and chats as knowledge-base material | Contain other people's names and messages; not imported. See `licensing.md`. |

---

## 3. `AJTBD prompt.md` — AJTBD pipeline v2

A six-role pipeline for analysing sales calls with Advanced Jobs To Be Done / Next Move Theory (methodology attributed to Ivan Zamesin; the referenced `Next-Move-Theory-Canon/` files were **not provided**).

- **Shared iron rules (12):** verbatim quotes with call id; only two stamps, QUOTE or HYPOTHESIS ("when in doubt → hypothesis"); **the model does not count** — every number comes from the aggregator's tables or the text says "no data"; Job grammar "want + infinitive", one verb per Job; success criterion = direction + threshold; criteria **order** defines a segment; said-themselves vs echoed-the-manager (`self | echoed | mgr_only`); fear ≠ barrier (prediction removable by proof vs fact removable only by changing reality); past investment, not intentions — no spend means Fake Job; one person in one segment, assigned to the lead, not the call; product facts only from the brief, anything else a manager said goes to "risky claims"; consult the canon, not memory.
- **Roles:** A Unpacker (one JSON record per call, strict schema); **B Aggregator — code, not a model**, prints data-quality checks, marks cells with N < 20, Wilson intervals; C Period report synthesiser (every number cites a table, e.g. "(T4)"); D Messenger (segment card → value-proposition formula, five consideration activators, creative formulas, each line with provenance, honesty check); E Reviewer (PASS / NEEDS_FIXES checklist, ideally a second model); F Cartographer (quarterly re-clustering, proposes codebook v(N+1) with migration map; a human approves).
- **Modes:** monthly measurement; map rebuild; winback; first run.
- **Hardcoded example content to remove:** SternMeister, "Buchhaltung" course, Germany, Jobcenter / Berater / voucher funnel (b2g), specific prices, specific forbidden phrases about German certificates and DEKRA/IHK, a `codex exec review …` shell command.

## 4. `03-schema-call-record.json` — call record schema v1

One JSON line per call, every field typed with description and example; `null` instead of invention; schema version stored in each record; old records never rewritten.

Blocks: `meta` (call, lead, date, period, product, funnel, call type, diarization flag), `usability` (three gates — past investment, own experience, concrete episode; leading contamination; quality clean / directional / weak / not_usable with weights 1.0 / 0.66 / 0.33 / 0), `profile_causal` (only attributes that change criteria, margin or demand), `job` (eight elements: context, negative emotions, consideration set in four slots, trigger as a dated event with kind, expected outcome, success criteria with direction/threshold/concrete/source/quote, priority order, positive emotions, Big Job, Super Big Job, job type, budget), `past_investment`, `solution` (current solution, Job → Solution → Problem chains, tax jobs, aha moments), `fears` (class, reducible by communication, source, quote), `barriers` (class, chain node, owner who can change reality), `chain` (stage, drop point, drop mode, switched to, cycle detected), `sales`, `crosssell_signals`, `client_language`, `segment` (codebook version, segment id or null + candidate), `b2g_decision_chain`.

**Germany- and sales-specific fields** to turn into product-configurable fields: `funding_path`, `de_level`, `residence_status`, `years_in_de`, `current_work_type` enumerations, the whole `b2g_decision_chain`, and most of `sales` (Back App is a self-serve mobile app; its "calls" will mostly be user interviews, support conversations, reviews and surveys).

## 5. `04-codebook-template.md` — segment codebook

- Three principles: segment = similar Core Jobs + similar success criteria **in similar priority order** (not demographics, not Big Job, not conversion); the level-1 segment card is the source of truth; a segment id never changes silently.
- Segment card template: definition, Job level 2 sentence, motivation, causal criteria → qualification questions, consideration set, fears and barriers in separate tables with classes, current solutions and problems, past investments, four economics questions, chain behaviour, switching class, at least 3 anchor quotes, confidence (support N, summed weight, saturation, consistency → Solid / Emerging / Hypothesis), message bank link, history.
- Ids `{product}-{funnel}{n}`, never reused.
- Versioning: codebook frozen during measurement; rebuild proposes v(N+1) with operations keep / refine / split / merge / new / retire and a **mandatory migration map**; old records recalculated by script, not by hand or model; changelog with who approved; rebuild triggers (e.g. share of unassigned > 15%).
- Aggregator spec: unit = lead; flow composition, segment characteristics (criterion #1 distribution, top fears/barriers, consideration set), chain behaviour with maturity windows, data quality, drift with Wilson intervals; N < 20 cells shown as "not enough data" without percentages; "what changed on our side" shown next to every delta.
- Table "what counts as a segment change and what does not" (composition shift ≠ segment change).

---

## 6. Environment evaluation

- No existing Marketing OS project was found in this session; nothing was provided on the owner's computer besides the five sources. Stage B will therefore start a new project with the default stack from the brief, unless the owner points to an existing repository.
- The working copy for Stage A lives in a cloud workspace (`marketing-os/`); see the open decision on where the repository should live.

## 7. Gaps found during the audit

1. The Next Move Theory canon files referenced by the AJTBD prompt are not available. Definitions must come from the owner, not be reconstructed from model memory.
2. No Back App product brief, approved facts, prohibited claims list beyond §6 of the brief, store links, brand assets, languages or target countries were provided.
3. No data exports (app analytics, store, subscriptions) exist yet to define CSV import formats.
4. No customer interviews for Back App were provided, so no real segment or Job can be created in Stage C without them (Stage C will use owner-entered data, labelled as such).
