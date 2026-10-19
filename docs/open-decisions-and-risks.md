# Open decisions and key risks

Stage A · 2026-10-19. Each decision has a recommendation; Stage B starts with the recommendation unless you choose otherwise.

**2026-10-19: owner approved the architecture and chose "use recommendations" for all open decisions.** D-6 (languages, countries) and the provider choice inside D-5 have no default that can be assumed; they are needed before Stage C and do not block Stage B (mock AI provider). Decisions that affect security, cost or architecture are marked.

## Open decisions

| ID | Decision | Recommendation | Affects |
|---|---|---|---|
| D-1 | Where the repository lives and where the app runs | Private GitHub repository; local Supabase (Docker) during Stage B; Supabase project in an **EU region** plus an EU-region host for Next.js from Stage C | Security, cost |
| D-2 | Background jobs: Inngest or Trigger.dev | Inngest (runs inside the Next.js deployment, local dev server, enough for embeddings/imports/AI runs) | Architecture |
| D-3 | Data access layer | Drizzle ORM + committed SQL migrations; RLS and triggers in hand-written SQL | Architecture |
| D-4 | Secret encryption | Application-level AES-256-GCM envelope encryption with versioned master key held in server env / KMS; Supabase Vault as alternative | Security |
| D-5 | AI providers and models | Mock provider through Stage B; in Stage C one provider for generation and reviews (Anthropic or OpenAI — your choice, based on which accounts and data-processing terms you have); a multilingual embedding model chosen once languages are known | Cost, security |
| D-6 | Languages and countries for Back App (and the other two products) | Needed from you; drives embeddings, guardrail lexicons and crisis lines | Architecture |
| D-7 | Threads in v0.1 | Export/copy only in v0.1; official API publishing after approval in v0.2 (needs a Meta app with Threads permissions) | Scope, platform risk |
| D-8 | Attribution path for app installs | Every social link goes to a Back App web landing page that records UTM, then to stores with store campaign parameters; conversions imported by CSV until an analytics source is chosen | Data quality |
| D-9 | Attribution object and model | Object: trial start (fallback: registration). Primary model: last non-direct click. One model team-wide | Analytics |
| D-10 | "Not enough data" thresholds | Rates: ≥ 5 publications **and** ≥ 1,000 impressions per group; shares: N ≥ 20 per cell; winner only if Wilson 95% intervals do not overlap. All configurable in Settings | Analytics |
| D-11 | Owner authentication | Email magic link + mandatory TOTP | Security |
| D-12 | Course and AJTBD materials inside the product | **Resolved 2026-10-19:** the whole course vault and the AJTBD files become the workspace methodology knowledge base (private, attributed, participant names pseudonymised, not in Git). See `licensing.md` §2 | Licensing, privacy |
| D-13 | Back App compliance owner and crisis wording | You (or a clinician/legal adviser you name) approve: prohibited-claims list, safety line for crisis-adjacent content, emergency resources per country | Safety |
| D-14 | Ask com-factory's author for a licence | Not needed: independent implementation covers all patterns we need | Licensing |
| D-15 | Personal and health data in AI calls | Store interviews only with consent flag; pseudonymous lead ids; redact names, emails and phone numbers before sending text to an AI provider; use provider settings that exclude data from training; EU hosting | Security, legal |
| D-16 | Visual identity for the app itself | Calm palette from the brief; final typeface chosen in B4 from openly licensed fonts | UI |

## Key risks

| ID | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | **Health-related personal data.** Interviews about panic and anxiety are likely special-category data under GDPR; storing them or sending them to AI providers without a lawful basis, consent and processor agreements creates legal exposure | Medium / High | D-15, EU hosting, data processing agreements with Supabase and the AI provider, consent records, retention policy, a short DPIA before real interviews are imported |
| R-2 | **Harm to vulnerable users** from generated content (implied cure, diagnosis, pressure, wrong advice during a crisis) | Medium / High | Deterministic blocking rules + golden-set tests, AI compliance review, mandatory human approval, crisis-adjacent content flagged for extra review, no autonomous replies ever for Back App |
| R-3 | **Platform restrictions** from automation | Low in v0.1 (no automation) / High later | Official APIs only, export-first, limits and circuit breaker before any API action, no browser automation |
| R-4 | **Broken attribution for a mobile app**: UTM parameters do not pass through app stores, so installs and trials cannot be tied to posts | High / High | Landing page capturing UTM, store campaign parameters, conversions imported with explicit match rules, unmatched share shown on the dashboard; MMP decision in v0.5 |
| R-5 | **False winners** from small samples and non-random organic posting (time of day, topic, algorithm) | High / Medium | Thresholds (D-10), Wilson intervals, labels "observation/hypothesis", only designed tests can become confirmed results |
| R-6 | **Scope creep**: 19 sections and ~55 tables for a first version | High / Medium | Strict MVP boundaries; honest empty states for sections without v0.1 functionality; staged approvals |
| R-7 | **Product data mixing** | Low / High | Composite FKs, RLS, product in URL, isolation tests |
| R-8 | **Prompt injection** via imported documents, signals or comments | Medium / Medium | Data delimiting, no tools in generation steps, schema-validated outputs, human approval, audit |
| R-9 | **AI cost overruns** | Medium / Low | Per-run and per-day budget caps, mock provider in development, token and cost logging per run |
| R-10 | **Secret leakage** | Low / High | Server-only secrets, encryption at rest, log redaction, rotation, revocation |
| R-11 | **Licensing**: accidental reuse of com-factory code, or course text leaking into public content | Low / Medium | Independent implementation of com-factory patterns; course files kept out of Git; generated content checked for long verbatim overlaps with methodology sources (n-gram check) before approval |
| R-12 | **Meta app review delays** for Threads/Instagram APIs | Medium / Medium | v0.1 does not depend on them; start the app setup in parallel if you want v0.2 soon |
| R-13 | **Missing inputs**: Back App brief, approved facts, interviews, analytics exports | High / Medium | Stage C uses only what you provide, labelled by evidence level; empty fields stay empty, not invented |

## What I need from you to start Stage B

1. Approval of the architecture (or changes).
2. Answers to D-1, D-5, D-6, D-7 (or "use recommendations").
3. ~~Confirmation on D-12~~ — resolved: course materials are the knowledge base.

Stage C additionally needs D-8, D-13 and the Back App materials listed in R-13.
