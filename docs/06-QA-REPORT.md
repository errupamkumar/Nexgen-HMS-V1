# 06 · QA Report — NexGen HMS Release 1

| | |
|---|---|
| Build under test | `nexgen-hms` working tree, 2026-11-09 |
| Environments | Windows 11 · Node 22.12 · MySQL 8.0.40 · Chrome (headless) |
| Verdict | **Pass.** Every *Must* requirement verified. 9 defects found and fixed, none open at Critical/High. |

## 1. Summary of results

| Layer | Scope | Result | Evidence |
|---|---|---|---|
| Static analysis | Strict TypeScript, API + web | **0 errors** | `npm run typecheck` |
| Production build | Vite 8 build; API compiled to JS | **Pass**: 57 code-split chunks (route pages 2–25 kB each); vendor bundles react 95 kB, charts 118 kB, radix 37 kB (gzip) | `npm run build` |
| API integration | 86 tests in 6 suites, real MySQL test DB rebuilt per run | **86 / 86 pass** | `npm test` → `docs/qa/test-results.json` |
| End-to-end journey | 18 steps through the web proxy and the production build | **18 / 18 pass** on both | `npm run e2e` → `docs/qa/e2e-smoke-results.json` |
| Browser UI | 38 screens · 7 personas · light/dark/mobile · real booking flow · production CSP | **38 / 38 clean** (no console errors, no uncaught exceptions, no 5xx) | `npm run qa:ui` → `docs/qa/screenshots/`, `docs/qa/ui-report.json` |
| Dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** in shipped dependencies; 4 moderate in dev-only tooling (esbuild via drizzle-kit) | — |

### API suites
| Suite | Tests | Covers |
|---|---|---|
| auth-platform | 14 | IAM-1/2/3/7, PLT-1…7 |
| tenancy-rbac-settings | 18 | NFR-1 isolation, BR-3 licensing, IAM-4/5, CFG-1/3/7/8, AUD-1 |
| patients-appointments | 16 | PAT-1…5, APT-1…9, BR-5 concurrency, BR-6 follow-up pricing |
| clinical-billing | 11 | OPD-1…6, BR-4, BR-14, BIL-1…7, BR-8, BR-9 |
| pharmacy-lab-ipd-portal | 20 | PHM-1…5, BR-10 FEFO, LAB-1…4, BR-12, IPD-2…6, BR-11, POR-1/2, RPT-1/3 |
| regression | 7 | One test per data defect (DEF-002/003/004/007) |

## 2. Requirement traceability

| Area | Must reqs | Verified by | Status |
|---|---|---|---|
| SaaS platform (PLT) | 1–5 | API tests · UI (owner console) · E2E | ✅ |
| Identity & access (IAM) | 1–6 | API tests (lockout, rotation, replay, RBAC matrix) | ✅ |
| Configuration (CFG) | 1–5, 7, 8 | API tests (live prefix change, custom fields, validation) · UI settings screens | ✅ |
| Masters (MST) | 2–6 | API tests · UI masters screens | ✅ |
| Patients (PAT) | 1, 2, 4, 5 | API tests · E2E timeline | ✅ |
| Appointments (APT) | 1–6, 8 | API tests incl. 4-way concurrent booking · UI booking flow | ✅ |
| OPD / EMR (OPD) | 1–8 | API tests · E2E · UI consultation + print | ✅ |
| Billing (BIL) | 1–7 | API tests (math, partial, refund, cancel rules) · print | ✅ |
| Pharmacy (PHM) | 1–4 | API tests (FEFO across batches, expired excluded) · E2E | ✅ |
| Laboratory (LAB) | 1–4 | API tests (H/L/N flags, lock after verify) · E2E · print | ✅ |
| In-patient (IPD) | 1, 2, 4, 5, 6 | API tests · E2E · UI bed board | ✅ |
| Reports (RPT) | 1–3 | API tests (collections reconcile with payments) · UI | ✅ |
| Audit (AUD-1) | 1 | API test · E2E | ✅ |
| Non-functional (NFR) | 1–6, 8, 9 | Isolation suite, Zod on every route, Helmet CSP/HSTS, layered rate limits, pagination, stateless API, strict TS | ✅ |
| *Should / Could* | PLT-6/7, IAM-7, CFG-6, MST-1, PAT-3, APT-7/9, PHM-5, IPD-3, COM-1/2, POR-1/2, NFR-7 | API tests + UI | ✅ delivered |

## 3. Defect log

| ID | Sev. | Found by | Defect | Fix | Verified by |
|---|---|---|---|---|---|
| DEF-001 | **Critical** | API test BR-5 (4 parallel bookings) | A capacity-1 slot was booked 4 times. The doctor row was locked, but MySQL REPEATABLE READ took its snapshot *before* the lock, so the capacity count was stale. | Lock the doctor row first; run lock-then-check flows (booking, reschedule, admission, dispensing) under READ COMMITTED (`lockingTx`) | BR-5 test: exactly 1 × 201, 3 × 409 |
| DEF-002 | High | API test PHM-2 | Correlated subqueries bound to the *inner* table's `id` (Drizzle omits table names in single-table selects). Stock on-hand, role user counts, plan tenant counts, patient last-visit and dashboard low-stock were all wrong. | `qcol()` fully-qualified column helper used in every correlated subquery | 5 regression tests |
| DEF-003 | Medium | Code review + regression test | Double-clicking "Consult" could create two encounters for one appointment | Unique index `(tenant_id, appointment_id)` on encounters | Parallel-start regression test |
| DEF-004 | High | Code review while building the UI | The encounter API returned `history` for both the clinical-history text and the past-visit list, so the doctor's history notes were lost in the UI | Past visits renamed `pastVisits` | Regression test + E2E step |
| DEF-005 | **Critical** (UI) | Browser QA | `<Button asChild>` passed two children to Radix `Slot`, crashing 7 screens: both dashboards, patient profile, portal home, platform overview | `Button` renders `Slot` with its single child only | 38/38 screens clean |
| DEF-006 | Medium | QA runs hit the limiter | Login rate limit was keyed by IP only (30 per 15 min). A hospital whose staff share one NAT address would be locked out at shift change. | Per-account limiter (IP+org+email, 20/15 min) plus per-IP ceiling (500/15 min), both env-configurable; account lockout unchanged | `RateLimit-Policy` headers |
| DEF-007 | Low | Browser QA screenshot | Vitals stored with unbounded precision (36.513433216884 °C) | Server-side normalisation: integers for BP/pulse/SpO₂/RR, 1 dp for temperature/weight/height | Regression test |
| DEF-008 | Medium | Design review of refresh rotation | Concurrent refreshes (StrictMode double effect, several restored tabs) looked like token replay and revoked the session family, logging users out | 15 s rotation grace window (`TOKEN_ROTATED`), client single-flight bootstrap and one retry; replay outside the window still revokes | Updated IAM-2 test (grace + real replay) |
| DEF-009 | Low | Code review | Counter-sale payment used the client's pre-tax estimate, leaving a small unpaid balance | Payment amount optional — defaults to the server-computed total | E2E dispense step → `paid` |

**UI polish fixed during browser QA:**
- Mobile header label wrapping.
- Occupied vs available beds indistinguishable under a teal brand colour; occupied beds are now solid.
- "Icu" label now "ICU".
- Plan badge was shown to patients.
- Two-column pages overflowed when an inner table was wide (`min-w-0`).
- Print header wrapped.
- SPA fallback ignored `HEAD` requests.

**Tooling issues resolved:**
- drizzle-kit can't emit fractional-second `ON UPDATE`, so timestamps are second-precision.
- TypeScript 7 removed `baseUrl`.
- Vite 8 (Rolldown) requires function-form `manualChunks`.

Three tests initially failed because of bad test data, not product defects: an invalid e-mail, a name that failed validation before the 403 check, and a deposit larger than the bill. They were corrected.

## 4. Security checks performed
- Cross-tenant read/update/book attempts return **404** (no existence leak); list endpoints never include another tenant's rows.
- Unlicensed module → **403** at the API, independent of the UI (BR-3); a per-tenant override takes effect immediately.
- Front desk cannot write diagnoses or prescriptions (BR-4); lab staff cannot see billing; accountants cannot see lab; patients cannot reach staff APIs; staff cannot reach portal APIs.
- Lockout after 5 failures; generic sign-in error (no user enumeration); refresh-token rotation with replay detection; logout and password change revoke sessions.
- Helmet CSP (`script-src 'self'`, no inline scripts), HSTS, frame protection; the whole UI was verified under this CSP with zero violations.
- Sequential, gap-safe numbering per tenant (GST requirement) via atomic `LAST_INSERT_ID` counters.

## 5. Known limitations (accepted for R1, on the roadmap)
- **Gateways are simulated:** SMS, WhatsApp, e-mail and online payments are logged, not sent. Integration points are isolated (`core/notify.ts`, `billing/service.ts`).
- **Not yet built:** insurance/TPA, OT scheduling, radiology/PACS, ABDM/FHIR, document uploads and the v1 Gemini document analysis, and live video for telehealth (mode flag only).
- **Branches:** the branch master exists, but scheduling and billing are not yet branch-filtered.
- **Scaling:** rate-limit counters and the 30 s session-context cache are in-memory. Use a shared store before running several API instances.
- **Report bucketing:** reports bucket days by the tenant's *current* UTC offset. That's exact for IST; regions with DST need tz tables.
- **Bed-day billing:** transfers bill completed days; discharge rounds up, with a minimum of one day per stay.
- **No frontend unit tests:** the UI is covered by the scripted headless-browser walk-through instead.

## 6. How to reproduce
```bash
npm test                                   # API suites (fresh nexgen_hms_test DB)
npm run build && npm start                 # production server on :4000 serving the SPA
npm run e2e -- http://localhost:4000       # 18-step journey
npm run qa:ui -- http://localhost:4000     # 38 screens + booking flow, screenshots to docs/qa/screenshots
```
