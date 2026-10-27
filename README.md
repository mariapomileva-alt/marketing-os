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
5. Vercel → Environment Variables: `ALLOWED_EMAILS=<your email>`. That address gets its account on the first sign-in link; nobody else is let in. To sign in with a password instead, also set `OWNER_PASSWORD` (12+ characters) and sign in with your email and that password.

## YouTube community agent

Conversations → YouTube. Drafts only: every comment and reply waits in the Approval Queue, and publishing stays off until you switch it on after the dry run.

1. Google Cloud console → new project → enable **YouTube Data API v3** → Credentials → **API key** (restrict it to that API). Vercel: `YOUTUBE_API_KEY`.
2. Vercel: `CRON_SECRET` = a long random string (the daily search at 06:00 UTC uses it).
3. Optional Telegram alerts: create a bot with @BotFather → `TELEGRAM_BOT_TOKEN`; send the bot a message, then read your chat id from `https://api.telegram.org/bot<token>/getUpdates` → `TELEGRAM_CHAT_ID`.
4. In the app: Conversations → YouTube → Settings: product name used in comments, search phrases, limits; tick "Search once a day".

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

## Posting to YouTube

1. Google Cloud (same project as the API key) → Google Auth Platform / OAuth consent screen: External, add yourself as a test user.
2. Clients → Create client → Web application. Authorized redirect URI: `https://<APP_URL>/api/youtube/oauth/callback`.
3. Vercel → Environment Variables: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `YOUTUBE_PUBLISHING_ENABLED=true`, `APP_URL` (the main address). Redeploy.
4. Connections → Connect YouTube channel, sign in with the account that owns the channel and choose the channel.

While the consent screen is in Testing, Google expires the token after 7 days: reconnect, or switch the app to In production.

## Threads

1. developers.facebook.com → Create app → use case "Access the Threads API". Permissions: threads_basic, threads_content_publish, threads_manage_replies, threads_read_replies, threads_keyword_search, threads_manage_insights.
2. Redirect callback URL: `https://<APP_URL>/api/threads/oauth/callback`. Add your Threads account as a Threads Tester and accept the invite in the Threads app (Settings → Account → Website permissions → Invites).
3. Vercel: `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_PUBLISHING_ENABLED=true`. Redeploy, then Connections → Connect Threads.

Keyword search returns only your own posts until Meta approves `threads_keyword_search` (App Review). Replies under your posts, publishing approved posts and insights work in development mode for tester accounts.

## Instagram

Comments under our own reels (Instagram API with Instagram Login, professional account):
1. In the same Meta app add the use case "Manage messaging & content on Instagram" (Instagram API). Permissions: instagram_business_basic, instagram_business_manage_comments.
2. Business login settings → OAuth redirect URI: `https://<APP_URL>/api/instagram/oauth/callback`. Add the Instagram account as an Instagram Tester (App roles) and accept the invite in Instagram (Settings → Website permissions → Tester invites, or instagram.com/accounts/manage_access).
3. Vercel: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (the Instagram app id and secret shown in the Instagram use case, not the Meta app id), `INSTAGRAM_PUBLISHING_ENABLED=true`. Redeploy, then Connections → Connect Instagram.

Other accounts' reels: the API does not allow commenting on other accounts' media. Reels are added by hand (link + what it says), the agent drafts a comment, you approve it and post it yourself.

## Calm Videos

1. Connections → AI providers: store an OpenAI API key (voice). Optional: `PIXABAY_API_KEY` (free at pixabay.com/api/docs) or `PEXELS_API_KEY` in Vercel for stock nature footage when the Creative Library has fewer than three clips tagged calm.
2. Calm Videos → Create renderer key. GitHub → repository Settings → Secrets and variables → Actions: secret `MOS_RENDER_TOKEN` = the key; variable `MOS_URL` = the app address.
3. The workflow "Calm video renderer" runs every two hours (or Run workflow by hand), renders waiting videos and uploads them to YouTube as private. Approve them in Calm Videos.

YouTube keeps videos uploaded through the API private while the Google Cloud project has not passed the YouTube API audit (projects created after July 2020). Request it with the "YouTube API Services Audit and Quota Extension Form"; until then, download the rendered file from the GitHub run and upload it in YouTube Studio.

## TikTok (calm shorts)

1. TikTok for Developers → app **Back Publisher** (Login Kit + Content Posting API; redirect URI `https://marketing-os-kappa-one.vercel.app/api/tiktok/oauth/callback`; terms and privacy at `/legal/terms`, `/legal/privacy`).
2. Vercel → Settings → Environment Variables: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (from the app's Credentials). Redeploy.
3. Connections → **Connect TikTok**. Tokens (access 24 h, refresh 1 year) are stored encrypted and refreshed automatically.
4. Calm Videos → tick **TikTok** for a short. When approving, the exact caption is fixed; at its time the posting queue uploads it.
   - Until TikTok audits the app: the video arrives in the TikTok inbox as a draft; finish the post in the TikTok app.
   - After the audit: set `TIKTOK_DIRECT_POST=true`; the approval form then shows the account, who can see it (no default), comments/duet/stitch (off unless ticked), the brand toggle, and the video is posted directly.
