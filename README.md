# RHM: Rental House Management

A web app for managing rental houses, paddy fields and coconut groves in one dashboard, with rent and
expense rules for Tamil Nadu, India. Single admin, mobile-friendly.

## Features

- **Rental houses:** houses, current and past tenants, advance payments, move-in and move-out dates
- **Rent collection:** monthly rent records generated automatically, partial payments, previous dues, overdue alerts
- **Expenses and bill splitting:** electricity, house tax, motor and water bills, split across houses
- **Paddy fields and coconut groves:** fields and groves, workers, expenses, income and reports
- **Business overview:** one dashboard across all three modules
- **WhatsApp reminders:** one-click rent reminder messages
- **PDF reports:** tenant, house and yearly financial summaries
- **Backups:** monthly SQL export to R2 (last 12 kept), optional Google Drive copy
- Tamil labels for worker categories, dark mode, responsive layout

## Architecture

```
Browser ──► Cloudflare Access (optional)
              │
              ▼
        Cloudflare Worker (Hono)
         ├── /api/*  → REST API ──► D1 (SQLite)
         ├── static  → React app (frontend/dist)
         └── daily Cron Trigger → rent generation, monthly backups ──► R2 / Google Drive
```

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, React Router |
| API | Hono on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Auth | App login (JWT, bcrypt) + optional Cloudflare Access check |
| Scheduled jobs | Cron Trigger (rent generation, backups) |
| Backups | Cloudflare R2, Google Drive API |
| PDF | jsPDF + jspdf-autotable |

## Notable details

- **Two layers of auth (optional):** the app has its own login, and can also sit behind Cloudflare Access. When
  Access is configured, the Worker verifies the Access JWT against the team's public keys
  (`worker/src/middleware/access.js`).
- **Timezone-safe rent rules:** Workers run in UTC, but rent is due by the Indian calendar, so dates are
  shifted to IST before any rule is applied (`worker/src/utils/scheduler.js`).
- **Light on resources:** one Cron Trigger handles every scheduled job, and existing rent months are read
  in one query instead of one per tenant, to stay within Workers CPU and D1 per-request limits.
- **No secrets in the repo:** secrets live in Worker secrets; the admin password is typed in at setup and only
  its bcrypt hash is stored.

## Project structure

```
frontend/              React app (Vite)
worker/
  src/index.js         Hono app, route mounting, cron handler
  src/routes/          houses, tenants, payments, expenses, paddy/*, coconut/*, reports, backup
  src/middleware/      Cloudflare Access check, app auth
  src/utils/           scheduler (rent generation), backups, notifications
  migrations/          D1 schema
  scripts/             create-admin
  wrangler.jsonc       Worker config
```

## Running locally

Requires Node.js 20+.

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars    # set JWT_SECRET; leave ACCESS_AUD empty locally
npm run build:frontend
npm run db:migrate:local
npm run create-admin -- --local
npm run dev
```
