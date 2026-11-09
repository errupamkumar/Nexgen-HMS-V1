# 01 · Codebase Analysis — `nexgen-Medical` (v1 prototype)

**Date:** 2026-11-09 · **Scope:** `d:\SRM Products\nexgen-Medical_v1\nexgen-Medical`

## 1. What exists today

| Area | Implementation |
|---|---|
| Frontend | React 19 + Vite 6 + Tailwind 4, single SPA, `lucide-react`, `recharts`, `motion` |
| Backend | `server.ts` — one Express 4 file (1,708 lines) serving API + Vite middleware |
| Persistence | **`data.json` on disk**, read & rewritten whole on every request (`loadData()` / `saveData()`) |
| Alt backend | `backend/` — FastAPI + SQLAlchemy + MySQL draft (848 lines), **not wired to the UI**, schema out of sync with TS types |
| AI | Gemini document analysis (`/api/documents/:id/analyze`) |
| Auth | **None server-side.** Demo accounts + passwords hard-coded in `Login.tsx`; OTP is a fixed `123456` from `.env` |
| Docs/deploy | User manual with screenshots, `deploy.sh` tarball release to a Linux VM |

Size: ~19.8K lines. Largest files: `PersonaConsole.tsx` (4,033), `DoctorBooking.tsx` (2,444), `server.ts` (1,708), `DoctorQueue.tsx` (1,458).

## 2. Functional flow (as built)

```
Login (client-side role pick: patient | doctor | hospital desk | admin)
  ├─ Patient  → Profile · Book (doctor search → slot → pay ₹50 platform fee → token/QR) · Upcoming · History · Messages · Vault
  ├─ Doctor   → KPI dashboard · Appointment queue → consultation (diagnosis, advice, Rx) · Completed · Telehealth room
  ├─ Desk     → Persona console (analytics, availability, onboard doctor) · Queue · Book for walk-ins · Broadcast messages
  └─ Admin    → Same as desk + hospital config (name, tax rate, SMS/telehealth flags)
Server: doctors · patients · documents(+AI) · appointments(+capacity check, waitlist notify) · messages(simulated channels) · stats · reset
```

### Strengths worth carrying forward
- Good domain modelling for Indian OPD: multiple chambers per doctor, landmarks/pincode, ABHA id, UPI, GST.
- Real business rules: slot capacity, no booking in the past, waitlist auto-notify on cancellation, **desk cannot write clinical content (403)**, server stamps consultation identity.
- Feature flags already exist (`VITE_*`) — evidence the business wants per-clinic configurability.

## 3. Gaps blocking a SaaS product

| # | Gap | Impact | Severity |
|---|---|---|---|
| G1 | No authentication/authorisation on the API; roles chosen in the browser | Anyone can read/modify all PHI | **Critical** |
| G2 | JSON file database, whole-file rewrite per request, no transactions | Data loss under concurrency; cannot scale past one process | **Critical** |
| G3 | Single-tenant; one hospital config object | Cannot sell to more than one clinic | **Critical** |
| G4 | Configuration via build-time `VITE_*` env flags | Per-clinic config needs a rebuild/redeploy | High |
| G5 | No billing ledger (only a ₹50 platform fee flag), no pharmacy, lab, IPD, inventory | Missing the modules hospitals buy HMS for | High |
| G6 | No audit trail | Not compliant with DPDP Act 2023 / HIPAA-style audit expectations | High |
| G7 | Monolithic components (4K-line files), duplicated logic client/server (`slotStartTime`, pricing) | Slow to change, regressions | Medium |
| G8 | No automated tests | No safety net | Medium |
| G9 | Two divergent backends (Express JSON vs FastAPI MySQL) | Confusion, drift | Medium |
| G10 | IDs from `Date.now()`; booking numbers from `Math.random()` | Collisions, non-sequential invoices (GST needs sequential numbering) | Medium |

## 4. Decision

Re-platform rather than refactor in place. The prototype is a UX reference and a source of business rules, but G1–G3 touch every file. The new product **`nexgen-hms/`** is a clean, modular, multi-tenant build:

- **API:** Node 22 + Express 5 + TypeScript, Drizzle ORM on **MySQL 8** (`root/root` locally), Zod validation, JWT + rotating httpOnly refresh tokens, RBAC, audit log.
- **Web:** React 19 + Vite + Tailwind CSS 4 + shadcn/ui (Radix), TanStack Query, React Router, React Hook Form + Zod, Recharts, Sonner, cmdk.
- The v1 prototype is left untouched in `nexgen-Medical/`.
