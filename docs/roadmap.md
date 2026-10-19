# Roadmap after the MVP

Stage A · 2026-10-19 · status: proposal. Order may change based on what the first experiments show; each stage needs your approval before it starts.

| Version | Theme | Main deliverables | Entry condition |
|---|---|---|---|
| **v0.1** | MVP | See `mvp-scope.md` | Architecture approved |
| **v0.2** | Real channels, richer inputs | Threads official API: OAuth, publish **after approval only**, reply publishing after approval, metrics pull (requires Meta app + permissions); Instagram metrics via API (publishing still export unless you decide otherwise); PDF, DOCX, URL ingestion; remaining Content Studio formats (long post, X thread, storyboard, static concept, email, article); click-tracking redirect for UTM links; second-model reviewer | ≥ 4 weeks of v0.1 use; Meta app review done |
| **v0.3** | AJTBD at scale | LLM call/interview unpacking into the adapted record schema (with human verification of every quote); aggregator views and period report with table references; codebook rebuild proposals (v(N+1) + migration map, human approval); message bank per segment with provenance; reference-vs-ours weekly debugging | ≥ 20 interviews per product for meaningful segment shares |
| **v0.4** | Distribution assistance | Comment-opportunity discovery via official search APIs where allowed (e.g. Threads keyword search), scored by a cheap classifier with visible skip reasons; drafts into the Approval Queue; limits, cooldowns, dedupe, circuit breaker live; natural-language settings commands with confirmation | v0.2 Threads integration stable; your explicit approval of policy limits |
| **v0.5** | Measurement depth | App-store / subscription data imports (App Store Connect, Google Play, RevenueCat or an MMP if adopted); cohort views; early-LTV proxies; counter-metrics (refunds, early cancellations) on every experiment; designed tests with holdouts | Attribution path (R-4) solved |
| **v0.6** | More channels | Adapters in order of value for your products, each starting draft-only: LinkedIn (MyTeam Space likely), YouTube Shorts, TikTok, Pinterest, X, Snapchat; Blog/SEO (+ AI-assistant visibility tracking on a fixed question set); Email/newsletter via provider API | Per channel: official API access and terms reviewed |
| **v0.7** | Creative production | `AssetGenerator` adapters (carousel rendering from brand templates, image concepts); Creative Library tagging by visual device | Brand system finalised per product |
| **v0.8** | Fast loop and limited autonomy | Optional `automatic` mode **per action type**, only after: ≥ N approved items with zero compliance incidents, owner sign-off, daily caps, kill switch; never for Back App replies to people in distress | Explicit decision by you; red lines unchanged |
| **v1.0** | Hardening | Team roles, backups and restore drills, data retention jobs, DPIA documentation, performance budgets, admin export of all data | — |

## Things that stay out permanently (unless you decide otherwise in writing)

- Fake or sock-puppet accounts, AI posing as customers, invented testimonials.
- Scraping that bypasses refused API permissions.
- Fully autonomous replies to vulnerable users of Back App.
- AI-declared causation or AI-written statistics.
