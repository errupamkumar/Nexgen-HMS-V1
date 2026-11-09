<p align="center">
  <img src="docs/images/diagrams/banner.png" alt="NexGen HMS — run your entire hospital from one beautiful workspace" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white" alt="Node 22">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white" alt="MySQL 8">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind 4">
  <img src="https://img.shields.io/badge/API_tests-86%2F86_passing-0d9488" alt="86 of 86 API tests passing">
  <img src="https://img.shields.io/badge/UI_QA-38%2F38_screens-0d9488" alt="38 of 38 screens clean">
</p>

<p align="center">
  <b>Multi-tenant cloud software for clinics, polyclinics, diagnostic centres and hospitals.</b><br>
  One codebase · switch modules on per plan · configure everything per hospital, live, without code.
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-step-by-step-user-guide">User guide</a> ·
  <a href="#-features-at-a-glance">Features</a> ·
  <a href="#%EF%B8%8F-how-it-is-built">Architecture</a> ·
  <a href="#-quality">Quality</a> ·
  <a href="#-documentation">Docs</a>
</p>

---

## 📑 Contents

1. [Features at a glance](#-features-at-a-glance)
2. [Quick start](#-quick-start) — installed and running in 5 steps
3. [Demo accounts](#-demo-accounts)
4. [Step-by-step user guide](#-step-by-step-user-guide) — 16 steps with screenshots
5. [How it is built](#%EF%B8%8F-how-it-is-built) — architecture, journey, security, roles, plans, configuration, data model
6. [Quality](#-quality)
7. [Commands](#-commands) · [Production deployment](#-production-deployment) · [Project structure](#-project-structure)
8. [Troubleshooting](#%EF%B8%8F-troubleshooting) · [Roadmap](#%EF%B8%8F-roadmap) · [Documentation](#-documentation)

---

## ✨ Features at a glance

<table>
<tr>
<td width="33%" valign="top">

### 🗓️ Front office
- UHID registration, custom fields, duplicate warning
- Slot booking from doctors' weekly schedules
- Walk-ins, daily tokens, live queue board
- Check-in, reschedule, cancel, no-show

</td>
<td width="33%" valign="top">

### 🩺 Clinical
- Consultation workspace with vitals and live BMI
- ICD-10 diagnoses, e-prescription from the catalogue
- Lab orders, previous visits, repeat prescription
- Finalise-and-lock, branded printouts

</td>
<td width="33%" valign="top">

### 💳 Billing
- Server-computed invoices with GST per line
- Partial payments, receipts, refunds, cancel rules
- Dues tracking, collections by payment mode
- Printable tax invoice, CSV export

</td>
</tr>
<tr>
<td valign="top">

### 💊 Pharmacy
- Batch stock-in with expiry and prices
- Earliest-expiry-first (FEFO) dispensing
- Low-stock and near-expiry alerts
- Stock ledger and adjustments

</td>
<td valign="top">

### 🧪 Laboratory
- Test catalogue with reference ranges
- Sample → results → verify workflow
- Automatic **High / Low** flags
- Printable lab report

</td>
<td valign="top">

### 🛏️ In-patient
- Live colour-coded bed board
- Admission with deposit, running bill
- Progress / nursing notes, bed transfer
- Discharge with bed-day billing and summary

</td>
</tr>
<tr>
<td valign="top">

### 📊 Insight
- Live dashboard and KPIs
- Collections, doctor productivity, peak hours
- Pharmacy and lab analytics
- Full audit trail

</td>
<td valign="top">

### 📱 Patient portal
- Online self-booking (when the clinic allows it)
- Prescriptions, verified lab reports, bills
- Cancel upcoming visits

</td>
<td valign="top">

### ☁️ SaaS platform
- Tenants, plans, module licensing
- 14-day trial self-signup
- Per-tenant branding and settings
- Roles and permission matrix

</td>
</tr>
</table>

<p align="center">
  <img src="docs/images/screens/03-dashboard.jpg" alt="Hospital dashboard" width="49%">
  <img src="docs/images/screens/08-consultation.jpg" alt="Consultation workspace" width="49%">
  <img src="docs/images/screens/15-bed-board.jpg" alt="Live bed board" width="49%">
  <img src="docs/images/screens/28-dark-mode.jpg" alt="Dark mode" width="49%">
</p>

---

## 🚀 Quick start

### Step 1 — Check the prerequisites

| You need | Version | Check with |
|---|---|---|
| Node.js | 22 or newer | `node -v` |
| MySQL Server | 8.x, running | `mysql --version` (or check *Services* → **MySQL80** on Windows) |
| Google Chrome | any (only for the optional screenshot/QA scripts) | — |

The default MySQL login is **`root` / `root`**. If yours is different, edit `server/.env` (Step 3).

### Step 2 — Install

```bash
cd nexgen-hms
npm install
```

### Step 3 — Configure (optional)

`server/.env` is already filled in for local use. The settings you are most likely to change:

```ini
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=root
DB_NAME=nexgen_hms
PORT=4000
```

### Step 4 — Create the database with demo data

```bash
npm run db:setup
```

```text
✔ database nexgen_hms ready
✔ migrations applied
✔ plans
✔ platform owner
✔ sunrise (Enterprise) seeded
✔ carewell (Starter trial) seeded
```

### Step 5 — Start and sign in

```bash
npm run dev
```

Open **http://localhost:5173**. Click a **demo account** button on the sign-in page, then **Sign in**. Press **Ctrl + C** in the terminal to stop.

<p align="center"><img src="docs/images/screens/01-sign-in.jpg" alt="Sign-in page with organisation branding and demo accounts" width="85%"></p>

> 💡 The sign-in page picks up each organisation's name, tagline and brand colour as soon as you type its code.

---

## 👤 Demo accounts

| Organisation code | Email | Password | You'll see |
|---|---|---|---|
| `sunrise` | admin@sunrise.health | `Admin@123` | 🏥 Everything — all modules, settings, users |
| `sunrise` | doctor@sunrise.health | `Staff@123` | 🩺 Queue, consultations, prescriptions |
| `sunrise` | reception@sunrise.health | `Staff@123` | 🗓️ Registration, booking, collections |
| `sunrise` | nurse@sunrise.health | `Staff@123` | ❤️ Vitals, nursing notes, beds |
| `sunrise` | pharmacy@sunrise.health | `Staff@123` | 💊 Dispensing, stock |
| `sunrise` | lab@sunrise.health | `Staff@123` | 🧪 Samples, results, verification |
| `sunrise` | accounts@sunrise.health | `Staff@123` | 💳 Invoices, refunds, reports |
| `sunrise` | patient@sunrise.health | `Patient@123` | 📱 Patient portal |
| `carewell` | admin@carewell.clinic | `Admin@123` | 🏪 Small clinic on the Starter plan (no pharmacy / lab / IPD) |
| *(leave empty)* | owner@nexgen.health | `Owner@123` | 👑 SaaS platform owner console |

`sunrise` comes with 6 doctors, about 50 patients, 30 days of appointments and payments, a stocked pharmacy, a lab catalogue, 24 beds and live admissions.

---

## 🧭 Step-by-step user guide

Follow a patient through the hospital, then configure the system. Each step says **who** does it and **where** to click.

### 1️⃣ Get your bearings — Dashboard
**Who:** any staff · **Where:** *Dashboard*

KPI cards show today's appointments, collections, dues, bed occupancy, pending lab work and prescriptions to dispense. Below them: the 30-day collections chart, today's OPD flow, department load and payment-mode mix. Each role sees only the figures it is allowed to see.

<p align="center"><img src="docs/images/screens/03-dashboard.jpg" alt="Dashboard" width="90%"></p>

### 2️⃣ Register a patient
**Who:** Receptionist · **Where:** *Patients → Register patient*

1. Enter the name, gender, age or date of birth, and mobile number. A **UHID** is generated automatically.
2. Add blood group, ABHA number, allergies and conditions (press **Enter** after each tag).
3. Fill your clinic's **custom fields** (for example insurance scheme or occupation).
4. If the mobile number is already registered, a **possible duplicate** warning appears before you save.

<p align="center"><img src="docs/images/screens/04-register-patient.jpg" alt="Register patient dialog" width="49%"> <img src="docs/images/screens/05-patient-profile.jpg" alt="Patient profile with timeline" width="49%"></p>

The **patient profile** (right) brings together contact details, medical summary, latest vitals and one timeline: visits, consultations, lab, billing and admissions.

### 3️⃣ Book an appointment
**Who:** Receptionist · **Where:** *Appointments → Book appointment*

1. Search the patient by name, UHID or phone, or register a new one from the search box.
2. Pick the **doctor** and **date**. Slots come from the doctor's weekly schedule; full, past and on-leave slots are disabled, and shared slots show how many places are left.
3. Choose a slot, add the reason, then click **Book**. The token number and fee are confirmed, and an invoice is raised automatically if the clinic has enabled that.
4. For a **walk-in**, switch on *Walk-in now*. The patient is added to today's queue and checked in straight away.

<p align="center"><img src="docs/images/screens/06-book-appointment.jpg" alt="Booking dialog with slot grid" width="90%"></p>

> 💡 A repeat visit to the same doctor within the follow-up window is detected automatically and charged the **follow-up fee**.

### 4️⃣ Run the live queue
**Who:** Receptionist / Doctor · **Where:** *Appointments → Live queue*

Patients move across **Booked → Waiting → In consultation → Completed**. Each card shows the token, patient, doctor, visit type and payment status, with one-click **Check in**, **Consult** and **Collect**. The board refreshes itself every 20 seconds.

<p align="center"><img src="docs/images/screens/07-live-queue.jpg" alt="Live OPD queue" width="90%"></p>

### 5️⃣ Consult the patient
**Who:** Doctor · **Where:** queue card → **Consult**

1. **Vitals:** values outside the normal range turn red, and BMI is calculated as you type.
2. **Clinical notes:** complaint, history, examination. Allergies are shown in a red banner.
3. **Diagnosis:** ICD-10 code and description; one-click chips add common diagnoses.
4. **Prescription:** pick medicines from the pharmacy catalogue (or type free text). Quantity = frequency × days.
5. **Investigations:** tick lab tests and choose a priority (Routine / Urgent / STAT).
6. **Previous visits:** earlier diagnoses and medicines, with **Repeat prescription**.
7. **Save draft** at any time, then **Finalise & complete**. The record locks, the appointment completes, and the prescription goes to the pharmacy queue.

<p align="center"><img src="docs/images/screens/09-prescription.jpg" alt="Diagnosis and prescription builder" width="90%"></p>

### 6️⃣ Print the prescription
**Who:** Doctor · **Where:** consultation → **Print prescription**

A branded A4 layout with your logo, registration number, GSTIN, doctor's qualifications, vitals, diagnosis, ℞ table, investigations, advice and follow-up date. Use **Print / Save PDF**.

<p align="center"><img src="docs/images/screens/11-print-prescription.jpg" alt="Printed prescription" width="80%"></p>

### 7️⃣ Collect payment
**Who:** Receptionist / Accountant · **Where:** *Billing* → invoice → **Collect**

Choose the mode (Cash, UPI, Card, Net banking, Cheque, Insurance, Wallet), add a reference and record it. The receipt number is generated automatically and partial payments are supported. **Refund** and **Cancel** follow strict rules: you can't cancel a paid invoice until it has been refunded.

<p align="center"><img src="docs/images/screens/10-collect-payment.jpg" alt="Collect payment dialog" width="90%"></p>

### 8️⃣ Dispense medicines
**Who:** Pharmacist · **Where:** *Pharmacy → Prescriptions → Dispense*

Finalised prescriptions appear here automatically, with the patient's allergies. Confirm quantities (or substitute) and click **Dispense & bill**. Stock is taken from the **earliest-expiring batch first**; expired or insufficient stock is blocked. For walk-in customers use **Counter sale**.

<p align="center"><img src="docs/images/screens/12-dispense.jpg" alt="Dispense dialog" width="49%"> <img src="docs/images/screens/13-pharmacy-stock.jpg" alt="Pharmacy stock with alerts" width="49%"></p>

The **Stock** tab (right) filters for low stock, out of stock, expiring soon and expired. Click a medicine to see its batches and stock ledger, or **Stock in** a new purchase.

### 9️⃣ Enter and verify lab results
**Who:** Lab technician · **Where:** *Laboratory* → order

1. **Collect sample:** a sample ID is assigned.
2. Type the results. Values are flagged **High ↑ / Low ↓ / Normal** against the reference range as you type.
3. **Complete**, then **Verify & release**. The doctor is notified and the report appears in the patient portal.

<p align="center"><img src="docs/images/screens/14-lab-results.jpg" alt="Lab result entry with flags" width="49%"> <img src="docs/images/screens/14b-lab-report.jpg" alt="Printed lab report" width="49%"></p>

### 🔟 Admit, care for and discharge an in-patient
**Who:** Doctor / Nurse / Receptionist · **Where:** *In-Patient*

1. The **bed board** shows every ward. Green is available, solid is occupied, amber is being cleaned, grey is under maintenance.
2. Click a free bed → **Admit here** (or **Admit patient**), choose the doctor, and optionally collect a deposit.
3. On the admission page, add **progress / nursing notes** with vitals, add **charges** from the service list, or **Transfer bed**.
4. **Discharge:** choose the discharge type and write the summary. Bed-days are billed automatically and the bed goes for cleaning.

<p align="center"><img src="docs/images/screens/15-bed-board.jpg" alt="Bed board" width="49%"> <img src="docs/images/screens/16-admission.jpg" alt="Admission page with timeline and running bill" width="49%"></p>

### 1️⃣1️⃣ Analyse with reports
**Who:** Admin / Accountant · **Where:** *Reports*

Pick a date range (or 7 / 30 / 90 days). Tabs: **Collections** (daily, by mode, by department), **Doctors** (booked, seen, follow-ups, revenue), **Appointments** (outcomes, channels, peak hours), **Pharmacy** (top sellers), **Laboratory** (test volume). Every table exports to **CSV**.

<p align="center"><img src="docs/images/screens/17-reports.jpg" alt="Reports" width="90%"></p>

### 1️⃣2️⃣ The patient's view — portal
**Who:** Patient · **Where:** sign in with a patient account

Upcoming and past visits, **Book appointment** (choose doctor → date → time → confirm), and **My records**: prescriptions, verified lab reports and bills. Staff give a patient access from the patient profile → **⋯ → Portal access**.

<p align="center"><img src="docs/images/screens/22-portal-home.jpg" alt="Patient portal home" width="49%"> <img src="docs/images/screens/23-portal-booking.jpg" alt="Patient self-booking" width="49%"></p>

### 1️⃣3️⃣ Make it yours — branding and custom fields
**Who:** Admin · **Where:** *Settings*

- **Branding:** pick a colour and the whole app re-themes immediately for every user; add a logo, tagline and GSTIN.
- **Patient fields:** add your own registration fields (text, number, date, dropdown; required or optional).
- Also under Settings: **Localisation**, **Numbering**, **Appointments**, **Billing & tax**, **Clinical**, **Pharmacy**, **Notifications** and **Subscription**.

<p align="center"><img src="docs/images/screens/18-branding.jpg" alt="Branding settings with live preview" width="49%"> <img src="docs/images/screens/19-custom-fields.jpg" alt="Custom patient fields" width="49%"></p>

### 1️⃣4️⃣ Control access — users and roles
**Who:** Admin · **Where:** *Users & Roles*

Add staff (optionally linked to a doctor profile), reset passwords and unlock accounts. Under **Roles & permissions**, edit a role's permission matrix or create custom roles. Modules outside your plan are greyed out.

<p align="center"><img src="docs/images/screens/20-roles-permissions.jpg" alt="Role permission matrix" width="90%"></p>

### 1️⃣5️⃣ Work fast — search everything
**Who:** any staff · **Where:** press **Ctrl + K**

Jump to any patient (name, UHID, phone), invoice, appointment or page from the keyboard.

<p align="center"><img src="docs/images/screens/21-command-palette.jpg" alt="Command palette" width="80%"></p>

### 1️⃣6️⃣ Run the SaaS — platform owner
**Who:** Platform owner (sign in with an empty organisation code) · **Where:** *Platform console*

- **Overview:** organisations, MRR, users, patients, and organisations by plan.
- **Organisations:** onboard a clinic in seconds (default roles, departments and services are created automatically). Click one to **Activate / Suspend / Extend trial**, change its plan, or switch individual modules on or off.
- **Plans & modules:** set prices, user limits and which modules each plan includes.

<p align="center"><img src="docs/images/screens/24-platform-overview.jpg" alt="Platform overview" width="49%"> <img src="docs/images/screens/25-tenant-modules.jpg" alt="Tenant plan and module overrides" width="49%"></p>

New clinics can also **sign up themselves** from the sign-in page (*Start a 14-day free trial*): organisation, administrator, plan, and the workspace is ready in seconds.

<p align="center"><img src="docs/images/screens/02-signup.jpg" alt="Self-signup with plan selection" width="49%"> <img src="docs/images/screens/26-plans.jpg" alt="Plans and modules editor" width="49%"></p>

### 🎨 Every organisation, every device

Each clinic gets its own colour, name and plan-trimmed navigation (CareWell below, in indigo, on the Starter plan with a trial banner). There's dark mode on every screen, and phones and tablets are fully supported.

<p align="center">
  <img src="docs/images/screens/27-second-tenant.jpg" alt="Second tenant with its own theme" width="55%">
  <img src="docs/images/screens/29-mobile-queue.jpg" alt="Mobile live queue" width="19%">
  <img src="docs/images/screens/30-mobile-dashboard.jpg" alt="Mobile dashboard" width="19%">
</p>

---

## 🏗️ How it is built

### System architecture
<p align="center"><img src="docs/images/diagrams/architecture.png" alt="System architecture" width="100%"></p>

### Patient journey
<p align="center"><img src="docs/images/diagrams/journey.png" alt="Patient journey across departments" width="100%"></p>

### Security model
<p align="center"><img src="docs/images/diagrams/security.png" alt="Security layers" width="92%"></p>

### Role-based access
<p align="center"><img src="docs/images/diagrams/roles.png" alt="Role access matrix" width="92%"></p>

### Plans and module licensing
<p align="center"><img src="docs/images/diagrams/plans.png" alt="Plans and modules" width="92%"></p>

### Configuration engine
<p align="center"><img src="docs/images/diagrams/config.png" alt="Per-tenant configuration" width="100%"></p>

### Data model
<p align="center"><img src="docs/images/diagrams/datamodel.png" alt="Data model" width="100%"></p>

### Tech stack

| Layer | Technology |
|---|---|
| Web | React 19 · Vite 8 · Tailwind CSS 4 · Radix UI (shadcn/ui pattern) · TanStack Query · React Router 7 · Recharts · cmdk · Sonner · Inter |
| API | Node.js 22 · Express 5 · TypeScript (strict) · Zod · Pino · Helmet · express-rate-limit |
| Data | MySQL 8 · Drizzle ORM · versioned SQL migrations |
| Auth | bcrypt · JWT access tokens · rotating httpOnly refresh cookies |
| Testing | Vitest + Supertest · scripted end-to-end journey · Playwright-driven headless Chrome |

---

## ✅ Quality

<p align="center"><img src="docs/images/diagrams/quality.png" alt="Quality summary" width="100%"></p>

Full details, requirement traceability and the defect log are in the **[QA report](docs/06-QA-REPORT.md)**.

---

## 🧰 Commands

Run these from the `nexgen-hms` folder.

| Command | What it does |
|---|---|
| `npm run dev` | Start API (port 4000, auto-reload) and web (port 5173) |
| `npm run db:setup` | Create the database, apply migrations, load demo data (safe to re-run) |
| `npm run db:reset` | Wipe and rebuild the demo database (refuses in production) |
| `npm test` | Run the 86 API tests on a separate `nexgen_hms_test` database |
| `npm run typecheck` | Strict TypeScript check of API and web |
| `npm run build` | Build API to `server/dist` and web to `web/dist` |
| `npm start` | Production server on port 4000: serves the API **and** the web app |
| `npm run e2e -- <url>` | 18-step end-to-end patient journey |
| `npm run qa:ui -- <url>` | Headless-Chrome check of 38 screens and a real booking |
| `npm run docs:shots -- <url>` | Regenerate the README screenshots (run after `npm run db:reset`) |
| `npm run docs:diagrams` | Regenerate the README diagrams from `docs/images/diagrams/src` |

> The QA and screenshot scripts use your installed Google Chrome. Set `CHROME_PATH` if it isn't in the default Windows location.

---

## 🚢 Production deployment

```bash
npm ci
npm run build
cd server
# set real secrets and database details (see server/.env.example)
NODE_ENV=production PORT=8080 \
JWT_ACCESS_SECRET=<32+ random characters> JWT_REFRESH_SECRET=<32+ random characters> \
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=nexgen_hms \
CORS_ORIGINS=https://app.example.com \
node dist/db/migrate.js && node dist/index.js
```

- One process serves both the API and the built web app. Put HTTPS in front of it (nginx, Caddy, or a cloud load balancer).
- The API is stateless. To run several instances, move the rate-limit counters to a shared store (Redis) and run migrations once per deploy.
- Sign-in limits are configurable: `LOGIN_LIMIT_PER_ACCOUNT` (default 20) and `LOGIN_LIMIT_PER_IP` (default 500) per 15 minutes.

---

## 📁 Project structure

```text
nexgen-hms/
├── server/                     API (Express 5 + TypeScript)
│   ├── src/
│   │   ├── config/             environment validation
│   │   ├── core/               auth & RBAC · module catalogue · settings engine · audit · numbering
│   │   ├── db/                 schema (32 tables) · migrations · seed / setup / reset
│   │   └── modules/            auth · platform · admin · masters · patients · appointments · opd
│   │                           billing · pharmacy · lab · ipd · reports · comms · portal
│   ├── drizzle/                SQL migrations
│   └── tests/                  86 API tests, grouped by requirement ID
├── web/                        React app
│   └── src/
│       ├── components/         UI kit · app shell · data table · pickers · dialogs
│       ├── lib/                API client (silent token refresh) · auth · formatters
│       └── features/           one folder per module
├── scripts/                    e2e-smoke · ui-qa · readme-shots · render-diagrams
└── docs/                       analysis → research → BRD → requirements → plan → QA report
    └── images/                 README screenshots and diagrams (+ diagram sources)
```

---

## 🛠️ Troubleshooting

<details>
<summary><b>“Port 4000 (or 5173) is already in use”</b></summary>

An earlier copy is still running. Close that terminal, or run:

```bash
npx kill-port 4000 5173
```
</details>

<details>
<summary><b>Database error / “Access denied for user 'root'”</b></summary>

Make sure MySQL is running (Windows: *Services* → **MySQL80** → Start), and that `DB_USER` / `DB_PASSWORD` in `server/.env` match your MySQL login. Then run `npm run db:setup` again.
</details>

<details>
<summary><b>“Too many sign-in attempts” or “Account locked”</b></summary>

After 5 wrong passwords an account locks for 15 minutes. An admin can unlock it immediately: *Users & Roles* → key icon → reset password. Restarting the server also clears the in-memory rate limits.
</details>

<details>
<summary><b>I want to start again with clean demo data</b></summary>

```bash
npm run db:reset
```
This deletes everything in the `nexgen_hms` database and reloads the demo data.
</details>

<details>
<summary><b>A page says “You do not have access”</b></summary>

Either your role lacks that permission or the organisation's plan doesn't include that module. For example, CareWell (Starter) has no Pharmacy, Lab or In-patient. Change the role under *Users & Roles*, or the plan from the platform console.
</details>

---

## 🗺️ Roadmap

| Status | Item |
|---|---|
| ✅ Done | Multi-tenant SaaS, OPD/EMR, billing, pharmacy, lab, IPD, reports, patient portal, RBAC, audit |
| 🔜 Next | Real SMS / WhatsApp / email and payment gateways (integration points already isolated) |
| 🔜 Next | Document uploads and AI document summaries (from the v1 prototype) |
| 🗓️ Planned | Insurance / TPA claims · OT scheduling · radiology / PACS |
| 🗓️ Planned | ABDM (ABHA) and HL7 FHIR R4 integration · telehealth video |
| 🗓️ Planned | Branch-level filtering · Redis-backed rate limits for multi-instance scaling |

---

## 📚 Documentation

| Document | Contents |
|---|---|
| [01 · Codebase analysis](docs/01-CODEBASE-ANALYSIS.md) | The v1 prototype, its gaps, and why the platform was rebuilt |
| [02 · Market research](docs/02-MARKET-RESEARCH.md) | Competitor features and positioning |
| [03 · Business requirements (BRD)](docs/03-BRD.md) | Objectives, users, scope, business rules |
| [04 · Requirements (SRS)](docs/04-REQUIREMENTS.md) | Functional and non-functional requirements with IDs |
| [05 · Implementation plan](docs/05-IMPLEMENTATION-PLAN.md) | Architecture, data model, phases, test strategy |
| [06 · QA report](docs/06-QA-REPORT.md) | Results, traceability, defect log, known limitations |

<p align="center"><sub>Built by SRM Products · NexGen HMS Release 1</sub></p>
