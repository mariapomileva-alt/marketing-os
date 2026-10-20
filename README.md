# Marketing OS (working title: Marketing God)

One administration platform for the marketing of several products — Back App, MyTeam Space, Momentrami and future products — built around a Data Flywheel: every content item is an experiment, every decision is linked to its outcome, and past results shape the next recommendations.

## Status

**Stage B — application foundation, done.** All 19 sections work on a mock AI provider. Nothing is published automatically: every post goes through the Approval Queue and is posted by you (export), then marked as published. Paid ads (Meta, Google) and post metrics come in through CSV import. Stage C (first live Back App workflow with a real AI provider) needs the owner decisions listed in [docs/open-decisions-and-risks.md](docs/open-decisions-and-risks.md).

What is mock, demo or real is always labelled in the interface: AI output starts with `[MOCK]`, demo products and rows carry a “demo” tag, and planned channels say “planned”.

## Run it locally

Requirements: Node 22+, PostgreSQL 16 with the `pgvector` extension (for example `apt install postgresql-16-pgvector`, or the Supabase local stack).

```bash
npm install
cp .env.example .env.local      # then fill in the values below
npm run db:migrate              # applies db/migrations/*.sql; refuses edited migrations
npm run dev                     # http://localhost:3000
```

In `.env.local`:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | Your development database |
| `TEST_DATABASE_URL` | A database whose name ends in `_test` (it is wiped by the tests) |
| `AUTH_MODE` | `dev` for a local owner sign-in without password (refused in production builds), `supabase` for magic links |
| `SESSION_SECRET` | 32+ random bytes, e.g. `openssl rand -base64 32` |
| `ENCRYPTION_KEY_V1` | 32 random bytes in base64 — encrypts API keys at rest |
| `AI_DEFAULT_PROVIDER` | `mock` (the only provider wired in Stage B) |

After the first sign-in:

```bash
npm run db:seed                 # Back App with its claims and safety rules
npm run db:seed:demo            # optional: "Demo: Calm app" with invented, labelled data to try Analytics
npm run knowledge:import-course -- <path-to-course.zip>   # methodology knowledge base (stays private, never in Git)
```

## Hosting (Vercel + Supabase)

1. Create the Vercel project from this repository (no settings to change; `vercel-build` applies migrations first, functions run in Dublin).
2. In Supabase: Project Settings → Integrations → Vercel → connect this Vercel project. It syncs the database URL and Supabase keys; nothing is copied by hand (ADR-17).
3. Redeploy in Vercel so the build sees the variables.
4. Supabase → Authentication → URL Configuration: Site URL = the Vercel address, Redirect URLs = `<address>/auth/callback`.
5. Supabase → Authentication → Users → Add user (your email, Auto Confirm). Only users created there can sign in.

## Checks

```bash
npm run typecheck && npm run lint
npm test                        # unit + integration (recreates TEST_DATABASE_URL)
npx playwright test             # end-to-end, desktop and phone; uses its own *_e2e_test database and port 3200
npm run licenses                # licences of production dependencies
```

Stop any other `next dev` in this folder before running Playwright: Next.js allows one dev server per project.

## Documents

| Document | Contents |
|---|---|
| [docs/source-audit.md](docs/source-audit.md) | What was found in each provided source |
| [docs/reusable-patterns.md](docs/reusable-patterns.md) | Methods and patterns to adopt, adapt, defer or reject |
| [docs/licensing.md](docs/licensing.md) | What may be reused and what is reference only |
| [docs/product-architecture.md](docs/product-architecture.md) | System architecture, interfaces, workflow, ER model, ADRs |
| [docs/mvp-scope.md](docs/mvp-scope.md) | Strict v0.1 boundaries, Definition of Done mapping, implementation order |
| [docs/roadmap.md](docs/roadmap.md) | Stages after the MVP |
| [docs/open-decisions-and-risks.md](docs/open-decisions-and-risks.md) | Decisions needed from the owner and key risks |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · PostgreSQL 16 + pgvector with row-level security (Supabase-compatible) · `pg` + Zod · Tailwind CSS 4 · Vitest · Playwright. AI providers sit behind one `LLMProvider` interface; only the mock is wired so far.

## Layout

```
db/migrations/        SQL schema: isolation, append-only history, approvals bound to a hash, evidence rules
src/domain/           Pure logic: guardrails, policy, statistics, UTM, CSV, chunking, approvals, prompts
src/server/           Database access, auth, encryption, storage, services per area
src/app/              Pages (19 sections under /p/[product]/…) and server actions
tests/                unit, integration (real database, RLS on), e2e (Playwright)
```
