# Changelog

## [Unreleased]

### Stage A — 2026-10-19

- Audited the com-factory repository (commit `fc55f71`), the AI Mindset Marketing Sprint vault, the AJTBD pipeline prompt v2, the call-record schema v1 and the codebook template. Nothing was executed.
- Added `docs/source-audit.md`, `docs/reusable-patterns.md`, `docs/licensing.md`, `docs/product-architecture.md` (including the ER model), `docs/mvp-scope.md`, `docs/roadmap.md`, `docs/open-decisions-and-risks.md`.
- No application code, migrations or integrations yet.

### Stage A addendum — 2026-10-19

- Owner decision: the AI Mindset course vault and the AJTBD files are the methodology knowledge base (private, attributed, participants pseudonymised, kept out of Git). Updated `licensing.md` §2–3, `product-architecture.md` §11.1 (methodology layer + Playbook), `mvp-scope.md` (B6a, B6b), `reusable-patterns.md`, D-12.
- Owner approved the architecture and accepted the recommendations for open decisions.
- Added `.gitignore` (blocks `knowledge-imports/`).

- Paid advertising (Meta Ads, Google Ads) added to scope: `AdsConnector`, ads tables, CSV import in v0.1, API later (D-17). Facebook Page added as an export channel. Owner's existing tools recorded (D-18).
