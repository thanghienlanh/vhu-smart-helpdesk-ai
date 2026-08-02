[![CI](https://github.com/surveyjs/supabase-helpdesk/actions/workflows/ci.yml/badge.svg)](https://github.com/surveyjs/supabase-helpdesk/actions/workflows/ci.yml)

## VHU Smart Helpdesk AI — Submission

- **Live deployment:** https://vhu-smart-helpdesk-ai.vercel.app
- **Step-by-step Word report:** [Bao_cao_VHU_Smart_Helpdesk_AI.docx](docs/submission/Bao_cao_VHU_Smart_Helpdesk_AI.docx)
- **Result screenshots:** [docs/submission/screenshots](docs/submission/screenshots)

# HelpDesk

A full-featured customer-support ticket system built with **Next.js 16**, **Supabase**, **Tailwind CSS**, and **TypeScript**. End-users submit and track support requests while agents and admins manage, respond to, and resolve them.

## Features

### Ticketing
- Create, view, and reply to support tickets with Markdown support
- Ticket types, categories, tags, urgency, and severity
- Custom fields (text, number, dropdown, checkbox, date)
- SEO-friendly URLs with slugs
- Public and private ticket visibility
- File attachments with image previews and SVG sanitization

### Agent Dashboard
- Filterable/sortable paginated ticket list with saved views
- Agent actions: assign, change status, priority, type, category, privacy
- Mark as duplicate, merge tickets, bulk operations (close, assign, tag, delete)
- Personal stats panel (assigned, resolved, response time, CSAT, SLA)
- Real-time updates via Supabase Realtime

### Knowledge Base
- Article management with draft/published/archived states
- Public help center with full-text search
- Article feedback (helpful / not helpful)
- Suggested articles on ticket creation
- Create ticket from article

### SLA Management
- Configurable SLA policies with severity-based targets
- Business hours support
- Timer tracking (first response & resolution deadlines)
- SLA indicators on ticket detail and dashboard
- Automated breach/approaching notifications via `pg_cron`

### CSAT (Customer Satisfaction)
- Token-based rating page (no login required)
- Automatic survey scheduling on ticket close
- Rating display on ticket detail
- CSAT summary in reporting dashboard

### Notifications
- In-app notifications with bell icon and unread count
- Email notifications via SMTP with customizable templates
- Notification coalescing (batched digest emails)
- User notification preferences
- Real-time notification updates

### AI Features
- Auto-categorization on ticket creation
- Duplicate ticket detection (semantic similarity)
- Suggested replies for agents
- Ticket summary generation
- KB article generation from tickets
- Configurable AI provider, model, and per-feature toggles

### Reporting & Analytics
- Ticket volume, resolution metrics, agent performance
- CSAT summary and SLA compliance stats
- Backlog overview with trend charts
- CSV export
- Agent-scoped vs admin-scoped access

### Administration
- Role management (User / Agent / Admin) with last-admin guard
- Team management (create, rename, assign members)
- Ticket types, categories, tags, custom fields CRUD
- Email/SMTP configuration and notification templates
- SLA policies, CSAT settings, file upload settings
- Subscription tiers with capability and limit overrides
- Authentication modes (built-in, social OAuth, external SSO)
- Logo/URL configuration, error page templates
- Audit log

### Inbound Email
- Create tickets and replies via email
- Attachment handling and signature stripping
- Unknown sender auto-replies with rate limiting
- Blocked user and duplicate ticket rejection

### Additional Features
- Subscription tiers with per-tier capabilities and rate limits
- Canned responses (personal and shared)
- Follow/unfollow tickets
- User profile management with account deletion (anonymization)
- User notes (agent-viewable)
- Mobile responsive design
- WCAG 2.1 Level AA accessibility

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Backend | [Supabase](https://supabase.com) (Postgres, Auth, Storage, Realtime, pg_cron) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) |
| Language | TypeScript |
| Font | [Geist](https://vercel.com/font) |
| Charts | [Recharts](https://recharts.org) |
| Markdown | unified / remark / rehype with sanitization |
| Email | Nodemailer |
| Testing | Vitest (database), Playwright (E2E), axe-core (accessibility) |

## Architecture

- **Server-rendered** — No client-side state management. Minimal `"use client"` wrappers only for Realtime subscriptions, Markdown preview, charts, and notification bell.
- **No custom API** — All mutations via Next.js Server Actions. Data reads via Supabase client.
- **Database-enforced security** — Row-Level Security on every table. Helper functions (`is_agent()`, `is_admin()`, `is_teammate()`, `user_has_tier_capability()`) used in RLS policies.
- **URL-driven state** — Filters, pagination, and views use URL search params.
- **Cookie-based auth** — `@supabase/ssr` with session refresh middleware.

See [docs/architecture.md](docs/architecture.md) for full details.

## Getting Started

### Prerequisites

- Node.js 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (for local Supabase)

### Setup

```bash
# Install dependencies
npm install

# Start local Supabase (runs Postgres, Auth, Storage, Realtime)
supabase start

# Apply migrations and seed data
supabase db reset

# Start the dev server
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

The anon key and service role key are printed by `supabase start`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test:db` | Run database/RLS tests (Vitest) |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run test` | Run all tests (db + e2e) |

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/             # Login, signup, forgot password
│   ├── (main)/             # Authenticated layout
│   │   ├── tickets/        # Ticket pages
│   │   ├── agent/          # Agent dashboard
│   │   ├── admin/          # Admin setup
│   │   ├── kb/             # Knowledge base management
│   │   ├── help/           # Public help center
│   │   ├── reports/        # Reporting dashboard
│   │   ├── notifications/  # Notifications page
│   │   ├── profile/        # User profile
│   │   └── canned-responses/
│   ├── api/                # API routes (webhooks)
│   └── csat/               # CSAT rating page
├── components/
│   ├── ui/                 # Reusable primitives (Badge, Button, Card, etc.)
│   ├── layout/             # NavBar, Sidebar, Footer
│   └── features/           # Feature-specific components
├── lib/
│   ├── actions/            # Server Actions by feature
│   ├── ai/                 # AI provider client
│   ├── email/              # Email sending and templates
│   ├── queries/            # Complex data queries
│   ├── supabase/           # Supabase client helpers
│   └── utils/              # Shared utilities
supabase/
├── migrations/             # 20 SQL migrations
├── seed.sql                # Development seed data
└── config.toml             # Supabase local config
tests/
├── db/                     # Database/RLS tests (Vitest)
├── e2e/                    # End-to-end tests (Playwright)
└── helpers/                # Test utilities
```

## Documentation

- [docs/requirements.md](docs/requirements.md) — Full product specification
- [docs/design.md](docs/design.md) — UI design and layout
- [docs/architecture.md](docs/architecture.md) — Architecture constraints
- [docs/build-plan.md](docs/build-plan.md) — Phased build plan (22 phases)
- [docs/seed-data.md](docs/seed-data.md) — Seed data specification

## License

[MIT](LICENSE) — Copyright (c) 2026 SurveyJS
