# Marketing OS (working title: Marketing God)

One administration platform for the marketing of several products — Back App, MyTeam Space, Momentrami and future products — built around a Data Flywheel: every content item is an experiment, every decision is linked to its outcome, and past results shape the next recommendations.

## Status

**Stage A — audit and architecture.** No application code yet. Implementation starts after the owner approves the architecture.

## Documents

| Document | Contents |
|---|---|
| [docs/source-audit.md](docs/source-audit.md) | What was found in each provided source |
| [docs/reusable-patterns.md](docs/reusable-patterns.md) | Methods and patterns to adopt, adapt, defer or reject |
| [docs/licensing.md](docs/licensing.md) | What may be reused and what is reference only |
| [docs/product-architecture.md](docs/product-architecture.md) | System architecture, interfaces, workflow, ER model |
| [docs/mvp-scope.md](docs/mvp-scope.md) | Strict v0.1 boundaries, Definition of Done mapping, implementation order |
| [docs/roadmap.md](docs/roadmap.md) | Stages after the MVP |
| [docs/open-decisions-and-risks.md](docs/open-decisions-and-risks.md) | Decisions needed from the owner and key risks |

## Planned stack (pending approval)

Next.js (App Router) · TypeScript strict · Supabase (Postgres, Auth, Storage) · pgvector · node-postgres · Tailwind CSS · shadcn/ui · Zod · Inngest · Sentry. AI providers behind an `LLMProvider` interface (mock first).
