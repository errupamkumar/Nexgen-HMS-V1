# NexGen HMS — Cloud Hospital & Clinic Management (SaaS)

Multi-tenant platform that runs a single-doctor clinic or a multi-department hospital from one codebase. Each organisation switches modules on per plan and configures numbering, tax, booking rules, branding, roles and custom registration fields live, with no redeploy.

| Area | What's included |
|---|---|
| Platform | Tenants, plans and module licensing, 14-day trial self-signup, suspend/activate, platform KPIs |
| Security | Org-code + email login, bcrypt, 15-min JWT plus rotating httpOnly refresh cookie, account lockout, layered rate limits, RBAC with a permission matrix, tenant isolation, full audit trail, Helmet CSP |
| Front office | UHID registration with custom fields and duplicate warning, slot-based booking, walk-ins, tokens, live queue board, reschedule/cancel/no-show |
| Clinical | Consultation workspace: vitals with BMI, ICD-10 diagnoses, e-prescription from the catalogue, lab orders, previous visits, finalise-and-lock, branded print |
| Billing | Server-computed invoices, partial payments, receipts, refunds, cancellation, dues, CSV export, GST print layout |
| Pharmacy | Batch stock-in, FEFO dispensing against prescriptions or over the counter, low-stock and expiry alerts, stock ledger, adjustments |
| Laboratory | Test catalogue with reference ranges, sample → results → verify workflow, automatic High/Low flags, printable report |
| In-patient | Live bed board, admission with deposit, notes, running bill, transfer, discharge with bed-day billing and summary |
| Insight | Dashboard, collections, doctor productivity, appointment analytics, pharmacy and lab reports |
| Patients | Portal: self-booking (when allowed), prescriptions, lab reports, bills |

Docs: [analysis](docs/01-CODEBASE-ANALYSIS.md) · [market research](docs/02-MARKET-RESEARCH.md) · [BRD](docs/03-BRD.md) · [requirements](docs/04-REQUIREMENTS.md) · [implementation plan](docs/05-IMPLEMENTATION-PLAN.md) · [QA report](docs/06-QA-REPORT.md)

## Stack
- **API:** Node 22, Express 5, TypeScript, Drizzle ORM, MySQL 8, Zod, Pino
- **Web:** React 19, Vite 8, Tailwind CSS 4, Radix UI (shadcn/ui pattern), TanStack Query, React Router 7, Recharts, Sonner, cmdk
- **Tests:** Vitest + Supertest (API), a scripted end-to-end journey, and a headless-Chrome UI walk-through

## Quick start

Prerequisites: Node.js ≥ 22 and MySQL 8 running locally (`root` / `root` by default — change in `server/.env`).

```bash
cd nexgen-hms
npm install
cp server/.env.example server/.env   # already present for local dev
npm run db:setup                     # create DB nexgen_hms, migrate, seed demo data
npm run dev                          # API http://localhost:4000 · Web http://localhost:5173
```

`npm run db:reset` drops and rebuilds the demo database (it refuses to run when `NODE_ENV=production`).

### Demo accounts

| Organisation code | Email | Password | Role |
|---|---|---|---|
| *(leave empty)* | owner@nexgen.health | Owner@123 | Platform owner |
| `sunrise` (Enterprise) | admin@sunrise.health | Admin@123 | Hospital administrator |
| `sunrise` | doctor@sunrise.health | Staff@123 | Doctor (Dr. Rajesh Sharma) |
| `sunrise` | reception@sunrise.health | Staff@123 | Receptionist |
| `sunrise` | nurse@sunrise.health | Staff@123 | Nurse |
| `sunrise` | pharmacy@sunrise.health | Staff@123 | Pharmacist |
| `sunrise` | lab@sunrise.health | Staff@123 | Lab technician |
| `sunrise` | accounts@sunrise.health | Staff@123 | Accountant |
| `sunrise` | patient@sunrise.health | Patient@123 | Patient portal |
| `carewell` (Starter trial) | admin@carewell.clinic | Admin@123 | Clinic admin (no pharmacy/lab/IPD) |

The sign-in page has one-click buttons for each of these.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API (watch) + web dev server |
| `npm test` | API integration suite (builds a fresh `nexgen_hms_test` database) |
| `npm run typecheck` | Strict TypeScript on API and web |
| `npm run build` | Compile API to `server/dist`, build web to `web/dist` |
| `npm start` | Production server — also serves `web/dist` when present (single process) |
| `npm run e2e -- <url>` | End-to-end patient journey (register → discharge → portal → reports) |
| `npm run qa:ui -- <url>` | Headless Chrome walk-through of 38 screens + booking flow (`CHROME_PATH` to override) |

## Production deployment (single VM)

```bash
npm ci && npm run build
cd server
NODE_ENV=production PORT=8080 \
JWT_ACCESS_SECRET=<32+ random chars> JWT_REFRESH_SECRET=<32+ random chars> \
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=nexgen_hms \
CORS_ORIGINS=https://app.example.com \
node dist/db/migrate.js && node dist/index.js
```

Put it behind HTTPS (nginx/Caddy). The API is stateless apart from the in-memory rate-limit and session-context caches; for several instances, move rate limiting to a shared store (Redis) and run migrations once per deploy.

## Project layout

```
server/src/
  config/        env validation
  core/          auth & RBAC, module catalogue, settings engine, errors, audit, numbering, notifications
  db/            Drizzle schema, migrations runner, seed/setup/reset
  modules/       auth · platform · admin · masters · patients · appointments · opd · billing
                 pharmacy · lab · ipd · reports · comms · portal
server/tests/    86 API tests (by requirement ID) + regression tests per defect
web/src/
  components/    ui primitives, app shell, data table, pickers, dialogs
  lib/           api client (silent refresh), auth/session, formatters, types
  features/      one folder per module
scripts/         e2e-smoke.mjs, ui-qa.mjs
docs/            analysis → research → BRD → SRS → plan → QA report (+ qa/ evidence)
```
