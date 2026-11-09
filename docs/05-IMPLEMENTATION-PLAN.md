# 05 · Implementation Plan — NexGen HMS R1

## 1. Architecture

```
┌──────────────── Browser (React 19 SPA) ────────────────┐
│ Staff app  ·  Platform console  ·  Patient portal      │
│ TanStack Query ⇄ /api (JWT in memory, refresh cookie)  │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS (Vite proxy in dev)
┌───────────────────────────▼────────────────────────────┐
│ Express 5 API (stateless, horizontally scalable)       │
│  helmet · cors · rate-limit · pino · cookie-parser     │
│  authenticate → tenant context → requireModule →       │
│  requirePermission → zod validate → service → audit    │
│  modules/: auth platform settings users roles masters  │
│   patients appointments opd billing pharmacy lab ipd   │
│   reports notifications audit portal                   │
└───────────────────────────┬────────────────────────────┘
                            │ mysql2 pool + Drizzle ORM
┌───────────────────────────▼────────────────────────────┐
│ MySQL 8 · database `nexgen_hms` · shared schema,       │
│ row-level tenancy (`tenant_id` on every business row,  │
│ composite indexes led by tenant_id)                    │
└────────────────────────────────────────────────────────┘
```

**Tenancy model:** shared DB, shared schema, `tenant_id` discriminator. All tenant queries go through helpers that inject the `tenant_id` predicate. Cross-tenant tests are part of CI. A tenant can later be moved to its own database (the module boundaries allow it).

**Configuration engine:** `tenants.settings` JSON is deep-merged over code defaults (`settings/defaults.ts`) on every read, so new settings ship with safe defaults and tenants override only what they need. Modules = plan modules ∪ overrides.enable − overrides.disable.

**Numbering:** `sequences(tenant_id, name)` with the atomic `INSERT … ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)` pattern, which is gap-safe within a transaction.

## 2. Repository layout

```
nexgen-hms/
├─ package.json            # npm workspaces: server, web; `npm run dev` runs both
├─ docs/                   # 01–06 analysis, research, BRD, SRS, plan, QA
├─ server/
│  ├─ src/
│  │  ├─ config/env.ts
│  │  ├─ db/ client.ts · schema.ts · migrate.ts · seed.ts
│  │  ├─ core/ errors · http · auth · rbac(permissions) · tenancy · audit · sequences · pagination
│  │  ├─ modules/<domain>/ routes.ts · service.ts · schemas.ts
│  │  ├─ app.ts · index.ts
│  ├─ drizzle/              # generated SQL migrations
│  └─ tests/                # vitest + supertest integration tests (DB: nexgen_hms_test)
└─ web/
   └─ src/
      ├─ components/ui/     # shadcn/ui primitives
      ├─ components/        # layout, data-table, forms, pickers, print
      ├─ lib/               # api client, auth, format, permissions
      └─ features/<domain>/ # pages per module
```

## 3. Data model (MySQL)

Platform: `plans`, `tenants`, `users`, `roles`, `refresh_tokens`, `audit_logs`, `sequences`, `notifications`, `message_logs`.
Masters: `branches`, `departments`, `doctors`, `doctor_schedules`, `doctor_leaves`, `services`, `medicines`, `lab_tests`, `wards`, `beds`.
Transactions: `patients`, `appointments`, `encounters`, `prescription_items`, `lab_orders`, `lab_order_items`, `invoices`, `invoice_items`, `payments`, `medicine_batches`, `stock_movements`, `admissions`, `admission_notes`.

Conventions: `BIGINT UNSIGNED` auto-increment ids; `tenant_id` + `created_at`/`updated_at` on every business table; money `DECIMAL(12,2)`; JSON for flexible structures (vitals, diagnoses, lab parameters/results, custom fields, settings); soft delete for patients.

## 4. Permissions

`dashboard.view` · `patients.view|create|update|delete` · `appointments.view|create|update|cancel` · `opd.view|write` · `billing.view|create|payment|refund|cancel` · `pharmacy.view|manage|dispense` · `lab.view|manage|order|result|verify` · `ipd.view|admit|discharge|manage` · `reports.view` · `masters.manage` · `staff.view|manage` · `settings.manage` · `roles.manage` · `audit.view` · `communication.send`

System roles: Administrator, Doctor, Receptionist, Nurse, Pharmacist, Lab Technician, Accountant (+ portal Patient).

## 5. Delivery phases

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **P0 Foundation** | Workspace, env, Drizzle schema, migrations, seed, core middleware, error model | `npm run db:migrate && npm run db:seed` green |
| **P1 Platform & IAM** | Auth, refresh rotation, lockout, RBAC, tenancy, plans/tenants/signup, settings engine, users/roles, audit | Auth + isolation tests pass |
| **P2 Front office** | Masters (departments, doctors, schedules, services), patients, appointments, queue | Booking concurrency/capacity tests pass |
| **P3 Clinical & money** | OPD/EMR + prescription print, billing + payments + print | Billing math tests pass |
| **P4 Ancillary** | Pharmacy (FEFO), Lab (flags), IPD (bed board, discharge billing) | Module tests pass |
| **P5 Insight & reach** | Dashboard, reports + CSV, notifications, patient portal | Smoke tests pass |
| **P6 UI shell** | App shell, theming from tenant brand colour, dark mode, command palette, responsive nav from modules + permissions | `tsc` + production build green |
| **P7 QA** | Full API test run, manual smoke via HTTP, bug fixes, QA report | 06-QA-REPORT signed off |

## 6. Testing strategy
- **API integration (Vitest + Supertest)** against a real MySQL test database, reset per run: auth/lockout/refresh, tenant isolation (cross-tenant reads/writes → 404), RBAC (403), module gating, booking rules and concurrency, follow-up pricing, invoice math, payments/refunds, FEFO dispensing, lab flags, IPD lifecycle, settings merge, portal scoping.
- **Static:** TypeScript strict `tsc --noEmit` on server and web; production `vite build`.
- **Smoke:** scripted end-to-end flow against the running server (register → book → consult → bill → pay → dispense → lab → admit → discharge).

## 7. Running locally
```
cd nexgen-hms
npm install
npm run db:setup      # creates DB, runs migrations, seeds demo tenants
npm run dev           # API :4000, web :5173
```
Demo logins are listed in the root README.
