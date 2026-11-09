# 04 · Software Requirements Specification — NexGen HMS R1

Priority: **M** = Must, **S** = Should, **C** = Could. Each requirement maps to tests in `06-QA-REPORT.md`.

## FR-PLT · SaaS platform
| ID | Requirement | P |
|---|---|---|
| PLT-1 | Platform owner signs in without a tenant code and sees the platform console only | M |
| PLT-2 | CRUD plans (name, monthly/yearly price, max users, module list) | M |
| PLT-3 | Create a tenant with code, type, plan and first admin user; the system provisions default roles, settings, departments and sequences | M |
| PLT-4 | Public self-signup creates a tenant on a 14-day trial | M |
| PLT-5 | Suspend/activate a tenant; suspended tenants cannot sign in | M |
| PLT-6 | Per-tenant module override (enable or disable beyond the plan) | S |
| PLT-7 | Platform KPIs: tenants by status, users, patients, estimated MRR | S |

## FR-IAM · Identity & access
| ID | Requirement | P |
|---|---|---|
| IAM-1 | Login with tenant code + email + password; bcrypt hashes | M |
| IAM-2 | 15-minute access JWT; refresh token in httpOnly cookie, rotated on each use, revocable on logout | M |
| IAM-3 | Lock the account for 15 minutes after 5 failed attempts; rate-limit auth endpoints | M |
| IAM-4 | Roles hold permission lists; seven system roles seeded; tenant admin can create custom roles | M |
| IAM-5 | Every API route enforces permission and module licensing server-side | M |
| IAM-6 | User CRUD, deactivate, reset password, link to a doctor profile | M |
| IAM-7 | Change own password | S |

## FR-CFG · Configuration engine
| ID | Requirement | P |
|---|---|---|
| CFG-1 | Organisation profile: name, contact, address, GSTIN, logo URL, brand colour (applied to the UI theme live) | M |
| CFG-2 | Localisation: currency code and symbol, timezone, date format | M |
| CFG-3 | Numbering prefixes for UHID, appointment, invoice, receipt, lab, admission | M |
| CFG-4 | Appointment rules: default slot minutes, booking window days, allow online booking, allow overbooking | M |
| CFG-5 | Billing rules: tax label, default tax rate, registration fee, auto-invoice on booking, invoice footer | M |
| CFG-6 | Clinical: prescription header/footer, require vitals before finalising | S |
| CFG-7 | Custom patient fields (text, number, date, select; required flag) rendered in registration | M |
| CFG-8 | Settings changes take effect without restart | M |

## FR-MST · Masters
| ID | Requirement | P |
|---|---|---|
| MST-1 | Branches CRUD | S |
| MST-2 | Departments CRUD | M |
| MST-3 | Doctors CRUD: department, qualification, registration no., fees (new/follow-up), follow-up days, slot minutes, capacity per slot | M |
| MST-4 | Doctor weekly schedule (multiple sessions per day) and leave dates | M |
| MST-5 | Service/charge master with category, price, tax rate | M |
| MST-6 | Medicine master; lab test master with parameters and reference ranges; wards and beds | M |

## FR-PAT · Patients
| ID | Requirement | P |
|---|---|---|
| PAT-1 | Register with auto UHID; mandatory name, gender, phone; optional DOB/age, contact, blood group, ABHA, emergency contact, allergies, conditions, custom fields | M |
| PAT-2 | Search by name, UHID or phone (paginated) | M |
| PAT-3 | Warn on possible duplicate (same phone and name) | S |
| PAT-4 | Patient profile with timeline: appointments, encounters, prescriptions, lab orders, invoices, admissions | M |
| PAT-5 | Edit; soft-delete (permission-gated) | M |

## FR-APT · Appointments & queue
| ID | Requirement | P |
|---|---|---|
| APT-1 | Available slots for a doctor/date are generated from schedules, minus leaves and full slots | M |
| APT-2 | Booking rejects past slots, out-of-schedule slots, leave days and full slots (transaction-safe) | M |
| APT-3 | Daily token number per doctor | M |
| APT-4 | Auto-detect follow-up (BR-6) and price accordingly | M |
| APT-5 | Optional auto-invoice on booking (CFG-5) | M |
| APT-6 | Status workflow with validated transitions: booked → checked_in → in_consultation → completed; cancel/no_show | M |
| APT-7 | Reschedule with the same validation | S |
| APT-8 | Queue view per doctor/date with live refresh | M |
| APT-9 | Walk-in booking (current time, bypasses slot grid, permission-gated) | S |

## FR-OPD · Consultation / EMR
| ID | Requirement | P |
|---|---|---|
| OPD-1 | Start a consultation from the queue; creates a draft encounter | M |
| OPD-2 | Record vitals (BP, pulse, temperature, SpO₂, RR, weight, height → BMI) | M |
| OPD-3 | Complaint, history, examination, diagnoses (with optional ICD-10 code), notes, advice, follow-up date | M |
| OPD-4 | Prescription items: medicine (catalogue or free text), dose, frequency, duration, route, instructions, quantity | M |
| OPD-5 | Order lab tests from the encounter | M |
| OPD-6 | Finalise → encounter locked, appointment completed | M |
| OPD-7 | Printable prescription with tenant branding | M |
| OPD-8 | Previous encounters visible in the workspace | M |

## FR-BIL · Billing
| ID | Requirement | P |
|---|---|---|
| BIL-1 | Create an invoice with lines (service, consultation, medicine, lab, bed, custom); per-line discount and tax | M |
| BIL-2 | Server computes subtotal, discount, tax, total, paid, balance and status | M |
| BIL-3 | Record payments (cash, card, UPI, net banking, cheque, insurance, wallet) with receipt numbers; partial payments | M |
| BIL-4 | Refunds (permission-gated) | M |
| BIL-5 | Cancel an unpaid invoice with a reason | M |
| BIL-6 | Printable invoice and receipt | M |
| BIL-7 | List and filter invoices by status, date and patient | M |

## FR-PHM · Pharmacy
| ID | Requirement | P |
|---|---|---|
| PHM-1 | Stock-in by batch (batch no., expiry, qty, purchase price, MRP, sale price) | M |
| PHM-2 | Stock view with on-hand, low-stock and near-expiry (≤ 90 days) indicators | M |
| PHM-3 | Dispense against a prescription or OTC; FEFO allocation; blocks expired/insufficient stock | M |
| PHM-4 | Dispense creates a pharmacy invoice and stock-ledger entries | M |
| PHM-5 | Stock adjustment with reason | S |

## FR-LAB · Laboratory
| ID | Requirement | P |
|---|---|---|
| LAB-1 | Create a lab order with one or more tests (from encounter or direct), with optional invoice | M |
| LAB-2 | Workflow ordered → sample_collected → completed → verified; cancel | M |
| LAB-3 | Result entry per parameter with auto H/L flag | M |
| LAB-4 | Printable lab report | M |

## FR-IPD · In-patient
| ID | Requirement | P |
|---|---|---|
| IPD-1 | Bed board by ward with status colours | M |
| IPD-2 | Admit to an available bed; creates a running IPD invoice | M |
| IPD-3 | Transfer bed | S |
| IPD-4 | Progress/nursing notes with optional vitals | M |
| IPD-5 | Add charges to the running bill | M |
| IPD-6 | Discharge: summary, type; bed-day charges added; bed → cleaning; mark bed available | M |

## FR-RPT · Reports & dashboard
| ID | Requirement | P |
|---|---|---|
| RPT-1 | Dashboard KPIs: today's appointments, new patients, today's collection, outstanding dues, bed occupancy, pending lab, low stock | M |
| RPT-2 | Charts: 30-day revenue, appointments by status, department load, payment modes | M |
| RPT-3 | Reports with date range: collections, doctor performance, appointments; CSV export | M |

## FR-COM · Notifications, audit, portal
| ID | Requirement | P |
|---|---|---|
| COM-1 | In-app notifications (e.g. online booking, lab result ready) with unread count | S |
| COM-2 | Message log; send a message to a patient via a simulated channel | C |
| AUD-1 | Audit log of all mutations and sign-ins; filterable viewer | M |
| POR-1 | Patient portal login; view appointments, prescriptions, lab reports, invoices | S |
| POR-2 | Portal self-booking when the tenant allows online booking | S |

## NFR · Non-functional
| ID | Requirement | P |
|---|---|---|
| NFR-1 | Every tenant table carries `tenant_id`; every query is tenant-scoped; isolation test suite | M |
| NFR-2 | Input validation on every endpoint (Zod); consistent error envelope | M |
| NFR-3 | Helmet security headers, CORS allow-list, JSON body limit, rate limiting | M |
| NFR-4 | No secrets in the frontend bundle; config via server `.env` | M |
| NFR-5 | Indexed queries on `(tenant_id, …)`; pagination on all lists | M |
| NFR-6 | Stateless API (scale horizontally); DB migrations versioned | M |
| NFR-7 | Structured JSON logs with request ids | S |
| NFR-8 | UI: responsive, dark mode, keyboard command palette, loading/empty/error states | M |
| NFR-9 | TypeScript strict on API and web; automated API tests | M |
