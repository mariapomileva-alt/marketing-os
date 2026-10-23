# Changelog

## God of Marketing; one knowledge base for everything
- Renamed to God of Marketing (header, sign-in, page titles).
- Comments, replies (YouTube, Threads, Instagram) and calm video scripts now draw on the knowledge base: approved facts, claims never to make, tone, the approved playbook from the course and matching excerpts (our articles, research). Prompt changes from app updates are recorded as new prompt versions.
- Our blog: every morning the site's sitemap is read; each new article (guides/blog) becomes a knowledge source, an idea with drafted Threads posts (drafts, approved as usual) and the first calm video topic. Knowledge → Our blog shows the articles and has "Check the blog now".

## Calm Videos use the Creative Library
- Creative Library accepts video (MP4/MOV/WebM up to 50 MB), music (MP3/M4A/WAV up to 30 MB) and large images, uploaded straight from the browser to private storage; videos and music play in the library.
- Calm Videos takes footage from the library first (tagged calm or the nature theme; images get a slow push-in), fills up from Pexels only when there are fewer than three, and uses the product's own music tagged calm (in turn), else the generated pad. Competitor references are never used.

## Calm Videos (YouTube affirmation videos)
- New page Make → Calm Videos. Claude writes a slow affirmation script for a topic and nature theme (lines checked against the product's safety rules), OpenAI text-to-speech records each line, Pexels supplies nature footage (fallback: a slow generated gradient).
- A renderer on GitHub Actions (`.github/workflows/calm-render.yml`, `scripts/render-calm.mjs`, ffmpeg) builds a 1080p video: cross-faded footage, each line fading in and out, the voice over a generated ambient pad that ducks under it, and uploads it to YouTube as PRIVATE (synthetic voice declared).
- The owner watches it and approves: scheduled at the next slot (default Tue/Fri 16:00 UTC) or published now. Rejected videos stay private. Every step is logged.
- Daily cron keeps two videos in the pipeline when automatic videos are on. Renderer key: shown once, only its hash is stored.

## Instagram: comments under our own reels
- Connect the Instagram professional account (Instagram Login, long-lived token encrypted and refreshed). Comments under our reels are read every morning and on demand; each person's comment becomes a conversation with an answer drafted; approved answers are posted as replies under their comment from the same queue and limits.
- Other accounts' reels stay manual (the API does not allow it).

## Threads and Instagram in Conversations
- Conversations tabs: YouTube, Threads, Instagram, Comments log.
- Threads: connect the account (Meta OAuth, long-lived token encrypted, refreshed before expiry); keyword search finds posts, every post recorded with a reason (ads, crises, kids, own posts, recent contact skipped); replies drafted for approval and posted from the same queue as YouTube (10 min apart, daytime, daily cap); replies people write back are read daily and on demand; likes and replies on our replies; approved Threads posts from Content Studio published now or at their calendar time, with views, likes and replies as metrics.
- Instagram: add a reel by hand, the agent drafts a comment, you approve, copy and post it yourself (the API does not allow comments on other accounts' media).
- Posting gate and queue are channel-aware; the daily cap and gap are per connected account.

## Website traffic by source, YouTube comment stats
- Own cookieless site counter (`/t.js` + `/api/t`): visits, visitors (daily hash, no IP stored) and App Store button clicks per source (UTM tags, then referrer, then in-app browser: Instagram, Threads, Facebook, TikTok). With an App Store provider token the counter adds campaign tags to App Store links, so Apple counts installs per source.
- Analytics: "Website visitors by source", "YouTube comments" (likes and replies on what we posted, read daily and on "Check for new replies"), and a setup panel with the snippet, a Cursor prompt, tagged links and App Store campaign links.

## YouTube posting queue
- Approve as many comments and replies as you like; they go out by themselves, one at a time (10 min apart, 08–23 Riga, daily cap), from a queue checked every 5 minutes.
- The schedule lives in the database (Supabase pg_cron + pg_net), set up by the production build; the endpoint token is derived from the server key and kept in Supabase Vault. Only approved texts are ever in the queue; the gate re-checks the approval hash before each post.
- The YouTube tab shows whether the queue is running; "Post now" remains for impatience.

## Sign in with a password
- Login page: email + password (the email link stays as an option). The first password comes from `OWNER_PASSWORD` for an address in `ALLOWED_EMAILS`; Supabase stores only its hash.

## YouTube: approve and post, live conversations
- Connect the product's YouTube channel with Google sign-in (Connections → Connect YouTube channel). The token is encrypted server-side; Disconnect revokes it at Google.
- With `YOUTUBE_PUBLISHING_ENABLED=true` and a connected channel, **Approve and post** publishes the exact approved text as the channel. Limits: daily cap, 10 min gap, 08–23 Riga. Every attempt is in outbound_actions; a YouTube error pauses the channel instead of retrying. "Post now" retries an approved draft later.
- Replies under our posted comments are read (button and daily cron), answers drafted for approval; high-risk replies get only a safety note and an urgent Telegram alert.
- Conversations tab: Live conversations (our comment, replies as a thread, drafted answer), New comments to approve, Posted with no replies yet.

## [Unreleased]

### Real AI voice and simpler approval — 2026-10-23

- Anthropic provider (Claude Sonnet 5.5) behind the provider interface: the workspace's encrypted key from Connections is decrypted server-side and used for every draft; JSON validated against the task schema with one corrective retry; cost recorded per run. Without a key the labelled mock stays.
- Community prompts v2 with a shared voice guide: short, specific, spoken; reacts to one concrete thing; adds something new; light open questions to keep threads alive; banned bot phrases. Top viewer comments (public, read-only) are given as context so the team adds something new.
- Voice check now rejects bot phrases and hashtags.
- YouTube tab: "Start here" steps; approve, edit and reject right in the thread; approved comments get Copy text, Open the video and I posted it. Choosing one variant closes the other. Threads waiting for you come first.

### YouTube community agent (dry run) — 2026-10-22

- Conversations → YouTube: daily search through the official YouTube Data API (read-only key), filters with a visible reason for every video (topic score, Shorts, comments off, made for kids, crisis / drugs / sensational / political / children content, one comment per channel per 30 days).
- Drafts in a warm human voice from the team (`community_comment.v1`, `community_reply.v1`): a helpful variant and, only when it fits, an open mention ("We're building Back…"). Every draft is checked for repetition against earlier comments, disclosure, invented experience, medical promises and sales language, plus the product's safety rules; drafts that fail are held back with the reason.
- Replies: the drafter reads the whole thread and states what the person means. Danger, self-harm, chest pain and similar messages are marked HIGH RISK, get only a fixed, product-free safety note and an urgent Telegram alert; a person decides.
- Approval Queue for every comment and reply; publishing is off (`YOUTUBE_PUBLISHING_ENABLED=false`) and `publishGate` refuses anything not approved or over the limits. Approved comments are posted from the channel by the owner and marked as posted.
- Telegram notifications (counts and links only, never comment text). Vercel Cron `/api/cron/youtube` daily at 06:00 UTC with `CRON_SECRET`.
- Migration 0009 (yt_settings, yt_videos, conversation risk and draft metadata). 29 new tests.

### Stage B — 2026-10-19

- Application foundation: Next.js 16, PostgreSQL + pgvector with row-level security, seven migrations (products, knowledge, AJTBD, research and content, distribution and measurement, AI evidence, per-product source dedupe).
- Sign-in (dev owner or Supabase magic link), product selector, all 19 sections; the Overview shows the flywheel for the selected product.
- Products: profile, languages, links, claims, safety rules, UTM templates; Back App seed with its red lines and a golden test set.
- Knowledge: uploads with provenance, chunking, hybrid search; course import with pseudonymised participants; Playbook v1 with 21 cited rules.
- Audience & AJTBD: codebook versions, segments, Jobs, success criteria, verbatim quotes checked against their source, fears, barriers.
- Content Studio on mock AI: idea → hooks → content variants → code safety rules + AI reviews (mock reviews always ask for a human) → edits as new versions → UTM link → Approval Queue bound to the exact text → calendar → export → mark as published.
- Measurement: manual metrics, CSV imports for post metrics, conversions and Meta / Google Ads with column mapping, preview and revert.
- Analytics: comparisons by channel, format, segment, hook, angle, CTA and topic with 95% intervals; “Not enough data” below thresholds; recommendations labelled as hypotheses.
- Experiments, Conversations (manual log, replies through approval), Creative Library, Connections (encrypted keys, rotation, revocation), Automations (limits shown, nothing automatic), Settings, Activity Log.
- Tests: 74 unit/integration + Definition-of-Done integration suite (three products, CSV import, comparisons, disconnect keeps history, activity log); Playwright full flow plus all 19 sections on desktop and phone.
- `npm run licenses` checks production dependency licences. ADR-12…16 added.

### Stage A — 2026-10-19

- Audited the com-factory repository (commit `fc55f71`), the AI Mindset Marketing Sprint vault, the AJTBD pipeline prompt v2, the call-record schema v1 and the codebook template. Nothing was executed.
- Added `docs/source-audit.md`, `docs/reusable-patterns.md`, `docs/licensing.md`, `docs/product-architecture.md` (including the ER model), `docs/mvp-scope.md`, `docs/roadmap.md`, `docs/open-decisions-and-risks.md`.
- No application code, migrations or integrations yet.

### Stage A addendum — 2026-10-19

- Owner decision: the AI Mindset course vault and the AJTBD files are the methodology knowledge base (private, attributed, participants pseudonymised, kept out of Git). Updated `licensing.md` §2–3, `product-architecture.md` §11.1 (methodology layer + Playbook), `mvp-scope.md` (B6a, B6b), `reusable-patterns.md`, D-12.
- Owner approved the architecture and accepted the recommendations for open decisions.
- Added `.gitignore` (blocks `knowledge-imports/`).

- Paid advertising (Meta Ads, Google Ads) added to scope: `AdsConnector`, ads tables, CSV import in v0.1, API later (D-17). Facebook Page added as an export channel. Owner's existing tools recorded (D-18).
