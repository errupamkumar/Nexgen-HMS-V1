# 03 · Business Requirements Document — NexGen HMS

| | |
|---|---|
| Product | **NexGen HMS** — multi-tenant cloud Hospital & Clinic Management SaaS |
| Version | 1.0 · 2026-11-09 |
| Owner | SRM Products |
| Status | Baseline for build |

## 1. Purpose
Give clinics, polyclinics, diagnostic-attached practices and hospitals one subscription platform that runs their front office, clinical, diagnostic, pharmacy, in-patient and billing operations. Each organisation configures the platform to its own workflows without code changes or redeploys.

## 2. Business objectives

| ID | Objective | Measure of success |
|---|---|---|
| BO-1 | Sell one codebase to many organisations | A new tenant goes live in under 10 minutes via self-signup or the platform console |
| BO-2 | Grow revenue per tenant via module upsell | Modules switch on or off per plan instantly |
| BO-3 | Cut front-desk time | Register and book in 3 screens or fewer; global search under 300 ms |
| BO-4 | Protect patient data | Zero cross-tenant data exposure; every PHI change is audited |
| BO-5 | Be configurable "at any time" | Numbering, tax, booking rules, custom fields, branding and roles are editable live by the tenant admin |
| BO-6 | Scale | Stateless API, horizontally scalable; indexed tenant-scoped schema on MySQL 8 |

## 3. Stakeholders & users

| Persona | Needs |
|---|---|
| **Platform owner** (SRM) | Onboard tenants, manage plans and modules, suspend accounts, see platform KPIs |
| **Tenant admin** (hospital/clinic owner) | Configure settings, users, roles, masters; see business reports |
| **Receptionist / front desk** | Register patients, book and check in, collect payments, manage the queue |
| **Doctor** | Queue, consultation workspace (vitals, diagnosis, Rx, lab orders), patient history |
| **Nurse** | Vitals, IPD progress notes, bed status |
| **Pharmacist** | Dispense against prescriptions, manage stock, batches and expiry |
| **Lab technician** | Collect samples, enter and verify results |
| **Accountant** | Invoices, payments, refunds, collection reports |
| **Patient** | Self-booking, view prescriptions, lab reports and invoices |

## 4. Scope

### In scope (Release 1)
1. **SaaS platform:** tenants, plans, module licensing, trial self-signup, suspension, platform dashboard.
2. **Identity & access:** secure login per tenant, rotating sessions, lockout, roles with a permission matrix, user management.
3. **Configuration engine:** organisation profile and branding (logo, brand colour), localisation (currency, timezone, date format), tax (GST label and rates), document numbering, appointment rules, billing rules, clinical preferences, custom patient fields, module visibility.
4. **Masters:** branches, departments, doctors and weekly schedules and leave, service/charge master, medicine master, lab test master with parameters, wards and beds.
5. **Patients:** UHID registration, demographics, allergies, chronic conditions, custom fields, search, de-duplication hint, unified timeline.
6. **Appointments & queue:** slot generation from schedules, capacity-safe booking, walk-in, follow-up detection, daily tokens, check-in → consult → complete, cancel/no-show/reschedule, live queue board.
7. **OPD / EMR:** encounter with vitals (auto BMI), complaint, history, examination, diagnoses, notes, advice, follow-up, e-prescription, lab orders, printable branded prescription.
8. **Billing:** invoices (OPD/IPD/pharmacy/lab/general), server-computed discounts and taxes, partial payments, receipts, refunds, cancellation, dues, printable invoice.
9. **Pharmacy:** stock-in by batch, FEFO dispensing against Rx or OTC, auto-invoicing, adjustments, low-stock and near-expiry alerts, stock ledger.
10. **Laboratory:** orders (from EMR or direct), sample collection, result entry with auto H/L flags, verification, printable report.
11. **IPD:** live bed board, admission, bed transfer, progress/nursing notes, running charges, discharge with summary and bed-day billing.
12. **Reports & dashboard:** KPIs, revenue trend, collections by mode, appointments by status, department and doctor performance, CSV export.
13. **Notifications & audit:** in-app notifications, message log (simulated SMS/email/WhatsApp), immutable audit trail with viewer.
14. **Patient portal:** login, book (if enabled by tenant), view appointments, prescriptions, lab reports and invoices.

### Out of scope (roadmap)
Insurance/TPA claims, OT scheduling, radiology/PACS, ABDM HIP/HIU certification, FHIR API, real SMS/WhatsApp/payment gateways, AI scribe, native mobile apps, multi-currency within one tenant.

## 5. Business rules (key)

| ID | Rule |
|---|---|
| BR-1 | All business data belongs to exactly one tenant and is never visible to another tenant. |
| BR-2 | A suspended or expired tenant cannot sign in (platform owner unaffected). |
| BR-3 | A module disabled for a tenant is hidden in the UI **and** rejected by the API (403). |
| BR-4 | Only clinical roles (permission `opd.write`) may record diagnoses, prescriptions or clinical notes (carried over from v1). |
| BR-5 | A slot cannot be booked in the past or beyond doctor capacity; concurrent bookings must not overbook. |
| BR-6 | A visit within the doctor's follow-up window after a completed visit is a *follow-up* and is charged the follow-up fee. |
| BR-7 | Invoice, receipt, UHID, appointment, lab and admission numbers are sequential per tenant with configurable prefixes (GST requires sequential invoices). |
| BR-8 | Invoice totals are always computed server-side from line items; client-sent totals are ignored. |
| BR-9 | A paid or partially paid invoice cannot be cancelled until refunded. |
| BR-10 | Pharmacy dispenses earliest-expiry stock first and never dispenses expired or insufficient stock. |
| BR-11 | A bed can hold one active admission; discharge frees the bed to *cleaning*. |
| BR-12 | Lab results outside the reference range are flagged automatically (H/L). |
| BR-13 | Every create/update/delete of business data and every sign-in is written to the audit log. |
| BR-14 | Finalised encounters are read-only. |

## 6. Non-functional requirements (summary — detail in 04)
Security (OWASP ASVS L2 practices, bcrypt, JWT 15-min access, httpOnly refresh rotation, rate-limited auth, helmet headers), privacy (DPDP Act 2023 principles: purpose limitation, audit, access control), performance (p95 API under 300 ms at 50 rps on a single node), availability target 99.5%, responsive UI (desktop and tablet; patient portal mobile-first), accessibility (keyboard navigation, WCAG AA contrast), maintainability (modular per domain, typed end-to-end, automated tests).

## 7. Assumptions & constraints
- MySQL 8 (local dev credentials `root/root`); Node.js 22.
- Messaging and payment gateways are simulated in R1; the integration points are isolated so real providers plug in later.
- India-first defaults (INR, GST, Asia/Kolkata), but everything is overridable per tenant.

## 8. Acceptance
Release 1 is accepted when every **Must** requirement in `04-REQUIREMENTS.md` passes in the QA report (`06-QA-REPORT.md`), there are no open Critical/High defects, and the tenant-isolation test suite is green.
