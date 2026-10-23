# Changelog

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
