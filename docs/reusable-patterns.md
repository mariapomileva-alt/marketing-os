# Reusable methodologies and patterns

Stage A · 2026-10-19

Every pattern below is re-expressed in our own words and will be implemented independently. Nothing here is copied code or copied text. "Source" names where the idea was observed; `licensing.md` explains why reuse of the idea is acceptable.

Legend: **Adopt** = use as is · **Adapt** = use with changes listed · **Defer** = roadmap · **Reject** = do not use.

## A. Data Flywheel and epistemics

| # | Pattern | Decision | Where it lives in Marketing OS | Source |
|---|---|---|---|---|
| A1 | A flywheel exists only if past outcomes change the next decision | Adopt | Recommendations must cite experiments; Overview shows "decisions changed by results" | AIM-PDF-01 |
| A2 | Record per case: what was known before, decision, rule/prompt version, what was actually shown, reaction, outcome and when | Adopt | `experiments` + immutable `content_versions` + `publications` + `metric_events`; the exact published text is frozen at approval | AIM-PDF-01 |
| A3 | Define primary metric, counter-metric, window and minimum effect **before** publishing | Adopt | Experiment "pre-registration" fields; editable only until first publication | AIM-PDF-01 |
| A4 | Fast loop (per item) vs slow loop (owner changes rules weekly) | Adapt | MVP has only the slow loop: weekly Experiment Review screen; no automatic rule changes | AIM-PDF-01 |
| A5 | Never back-fill information the system did not know at decision time | Adopt | Experiment dimensions are snapshotted at creation; later re-tagging is a new audited event | AIM-PDF-01 |
| A6 | Context layers: stated / observed / inferred (hypothesis + confidence) / confirmed by outcome | Adapt | Becomes the six-way **epistemic status** on every assertion: fact · quote · observation · hypothesis · recommendation · confirmed result | AIM-B2C-ONB-01 + brief §3 |
| A7 | Only two stamps for interpretations: QUOTE or HYPOTHESIS; "when in doubt → hypothesis" | Adopt | Default status of any AI-produced statement is `hypothesis`; promotion requires evidence or a human | AJTBD prompt |
| A8 | The model does not count; numbers come from code with a table reference | Adopt | All metrics, shares and percentages come from SQL/TypeScript; AI text may only reference computed values by id | AJTBD prompt |
| A9 | Cells with small N are labelled "not enough data", no percentages | Adopt | `Not enough data` state in Analytics; thresholds configurable (default N < 20 for segment shares) | Codebook §4 |
| A10 | Wilson intervals for proportions | Adopt | Stats module, unit-tested | AJTBD prompt |
| A11 | Next to every delta, show "what changed on our side" | Adapt | Change log of campaigns, offers, prompts and guardrails displayed beside trend charts | AJTBD prompt / codebook |
| A12 | Attribution shows association, not causation | Adopt | Analytics never says "caused"; only designed tests with control can become `confirmed result`, and only by human sign-off | AIM-PDF-01 |
| A13 | Avoid the "clicked → show more of the same" loop | Adapt | Recommendations keep an exploration share and always list untested combinations | AIM-PDF-01 |

## B. AJTBD research model

| # | Pattern | Decision | Notes |
|---|---|---|---|
| B1 | Eight elements of a Job; Job grammar "want + verb", one verb per Job, Job levels (Micro / Small / Core / Big / Super Big) | Adopt | Grammar check is a soft validator with explanation, not a hard block |
| B2 | Success criterion = direction + threshold, `concrete` flag, `source: self / echoed / mgr_only` | Adopt | `mgr_only` generalised to `prompted_by_interviewer` |
| B3 | Segment = Core Job + **ordered** success criteria; not demographics | Adopt | Segment definition stores criteria as an ordered list |
| B4 | Fear (prediction, removable by proof) vs barrier (fact, removable by changing reality) in separate tables with classes | Adopt | Different tables; UI never offers "address with copy" for a barrier |
| B5 | Past investment gate → otherwise Fake Job | Adopt | Fake Jobs never count toward segment support |
| B6 | Usability gates + quality weights (1.0 / 0.66 / 0.33 / 0) | Adopt | Used for segment confidence |
| B7 | Codebook versioning: frozen during measurement; keep / refine / split / merge / new / retire; migration map; ids never reused | Adopt | `codebook_versions`, `segment_definitions`, `segment_migrations` |
| B8 | Segment confidence Solid / Emerging / Hypothesis from support and consistency | Adopt | Computed by code |
| B9 | Message bank with provenance per line ("from criterion #1 / quote c012 / fear F3") | Adopt | Content Studio variants carry `evidence` links |
| B10 | Five consideration activators, value-proposition formula, creative formulas | Adapt | Offered as optional generation frames; terminology attributed to its author |
| B11 | Reviewer role with PASS / NEEDS_FIXES checklist, ideally a different model | Adapt | Brand + compliance review steps; second model optional |
| B12 | RAT hypothesis cards (riskiest assumption, cheapest test, kill criterion, confidence level, no fake "+X sales") | Adopt | `hypotheses` table |
| B13 | Germany/sales-specific fields (funding path, language level, residence, Jobcenter chain) | Reject as hardcode | Become per-product custom "causal profile fields" |
| B14 | Unpacking calls with an LLM (role A), quarterly AI re-clustering (role F) | Defer | Post-MVP; MVP is manual entry + JSON import of already-unpacked records |

## C. Content and creative analysis

| # | Pattern | Decision | Notes |
|---|---|---|---|
| C1 | Tag every creative by persona, hook, body, angle, format, CTA so combinations can be compared | Adopt | Controlled vocabularies per product (`taxonomy_terms`), hooks and angles as reusable entities |
| C2 | Library of prompts per hook/persona/angle | Adapt | Versioned `prompt_templates`; each generation stores the template version |
| C3 | Decompose competitor creatives into structure (persona, problem, emotional trigger, hook, angle, mechanism, proof, body, CTA, visual device, destination) | Adopt | `signals` structure fields; manual entry in MVP |
| C4 | Signal = source, platform, freshness, response size, why it worked, adaptation idea | Adopt | Plus `validation_status` |
| C5 | Days active is only a proxy for strength; never claim effectiveness of competitor creatives | Adopt | Signal performance fields labelled "observed proxy" |
| C6 | Weekly "reference vs ours" debugging with human diagnosis | Defer | v0.3 |
| C7 | Evaluator model + human sees what was included, excluded and why | Adapt | AI review findings shown with each variant; rejection rate tracked |
| C8 | Storyboard table: timecode · script · visual | Adapt | Reels script format; no "bright colours / 3 s cuts" rule |
| C9 | Psychological mechanics with the line where each becomes manipulation | Adopt | Back App compliance ruleset |
| C10 | Discount + deadline + FOMO "stories sales" | Reject | Forbidden for Back App |

## D. Distribution safety (Comments Factory patterns, independent implementation)

| # | Pattern | Decision | MVP behaviour |
|---|---|---|---|
| D1 | Autonomy modes per channel: draft only / requires approval / automatic | Adopt | `automatic` exists in the type system but is rejected by the policy engine in MVP |
| D2 | A single policy gate that returns allow/deny **with a reason** | Adopt | `ActionPolicy.evaluate()`; every deny reason stored and shown |
| D3 | Daily limit, account-wide cap, active hours in audience time zone, minimum gap | Adopt | Configured per channel connection |
| D4 | Dedupe per target post; author cooldown; stop-list | Adopt | Dedupe keys on `outbound_actions` |
| D5 | Product-mention and link share over last N items | Adopt | Warning in MVP, not auto-blocking |
| D6 | Circuit breaker on error / captcha / restriction / login loss, with visible reason and expiry | Adopt | Connection status `paused` + reason |
| D7 | Deterministic validators after generation + one repair pass | Adopt | Guardrail engine; repair pass only for format rules, never for compliance rules (those go to a human) |
| D8 | UTM enforced by code, links only to known hosts | Adopt | UTM builder + link allow-list |
| D9 | Founder voice, never pretend to be a customer, no invented experience, only facts from the product card | Adopt | Global rules in every prompt + compliance check |
| D10 | Cheap scoring model before expensive writer | Defer | Useful once comment discovery exists (v0.3) |
| D11 | Natural-language command → structured patch → confirm | Defer | v0.4 |
| D12 | `doctor` health checks feeding an onboarding checklist | Adapt | Connections page health checks + Overview "integration problems" |
| D13 | Browser-session automation as the primary channel | Reject | Official APIs first; browser adapter separate, off by default, with disclosed risk |

## E. Architecture and operations

| # | Pattern | Decision | Notes |
|---|---|---|---|
| E1 | Context as portable plain text that survives model/vendor changes | Adapt | Product profiles exportable as Markdown; prompts stored as data, not code |
| E2 | Gates: actions an agent may never take | Adopt | Hard-coded red lines in the policy engine, not configurable from UI in MVP |
| E3 | Evals as tests | Adopt | Golden-set tests for guardrails (Back App forbidden claims must always be caught) |
| E4 | SQL/scripts for deterministic work; LLM only for reasoning; Postgres before specialised stores | Adopt | pgvector inside Postgres; no separate vector DB |
| E5 | Single attribution object and one primary model | Adopt | Default object = registration/trial start; default model = last non-direct click (decision D-9) |
| E6 | Idempotent pipeline steps, raw data kept, truncation always labelled | Adopt | Import batches keep raw files; partial imports flagged |
| E7 | Every run logged with stats and log text | Adopt | `workflow_runs`, `agent_runs`, `automation_runs` |
