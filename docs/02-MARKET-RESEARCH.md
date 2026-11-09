# 02 · Market Research — Hospital & Clinic Management SaaS

**Date:** 2026-11-09. Sources are mostly vendor pages and vendor-written comparisons, so treat claims as directional (see links at the end).

## 1. Landscape

| Segment | Representative products | Positioning |
|---|---|---|
| Indian HMS / HIMS (mid & large hospitals) | MocDoc, KareXpert, Practo Insta, Suvarna, Healthray, Docpulse | Full suites: OPD, IPD, OT, LIMS, RIS, pharmacy, insurance/TPA, MIS |
| Indian clinic / EMR (OPD-heavy) | Eka Care, HealthPlix, Practo Ray, DoctorsApp, Clinicea | Fast e-prescription, appointments, ABHA/ABDM, WhatsApp reminders |
| Global EHR / practice management | Epic, Oracle Health, athenahealth, Tebra, DrChrono | Deep EHR, revenue-cycle management, patient engagement |
| Open source | OpenMRS, Bahmni, HospitalRun | Configurable concept dictionaries, forms, modules |

## 2. Feature inventory (union across the market)

**Front office:** UHID registration, de-duplication, custom registration fields, ABHA linking, appointment calendar, online booking, walk-ins, token/queue display, check-in, waitlist, reminders (SMS/WhatsApp/email).

**Clinical (OPD/EMR):** vitals, chief complaint, history, examination, diagnosis (ICD-10), templates/favourites, e-prescription with drug database, lab/radiology orders, follow-ups, printable branded prescriptions, patient timeline.

**IPD:** ward/bed master, live bed board, admission, transfer, nursing & progress notes, running bill, discharge summary, discharge types (normal/LAMA/referred/death).

**Diagnostics (LIMS):** test master with parameters & reference ranges, sample collection/barcode, result entry with auto high/low flags, verification, printable/QR-verified reports.

**Pharmacy & inventory:** item master, batch & expiry tracking, FEFO dispensing, GST POS billing, purchase entry, low-stock and near-expiry alerts, stock adjustment.

**Billing & RCM:** charge master, OPD/IPD/pharmacy/lab invoices, discounts, GST, partial payments, refunds, receipts, dues, insurance/TPA claims, day-end collection.

**Analytics:** revenue, collections by mode, doctor productivity, department load, occupancy, footfall, exportable reports.

**Patient engagement:** patient portal/app, self-booking, reports & invoices download, notifications.

**Platform (SaaS):** multi-tenant, plan tiers & module licensing, trial signup, multi-branch, role/permission editor, white-label branding, audit trail, data export, API/integrations (HL7 FHIR R4, ABDM).

## 3. What separates leaders

1. **Configurability without code**: custom fields, numbering, templates, module toggles, branding per tenant.
2. **Tenant isolation & auditability**: every row tenant-scoped, immutable access log (tenant, user, resource, action, timestamp, IP), role scoping tied to the tenant.
3. **Speed at the desk**: keyboard-first search (command palette), 3-click booking, token queues.
4. **Modular pricing**: Starter (clinic) → Professional (polyclinic) → Enterprise (hospital with IPD, multi-branch).
5. **Interoperability**: ABDM/ABHA, FHIR export, WhatsApp.

## 4. Positioning for NexGen HMS

*"One configurable cloud platform that grows from a single-doctor clinic to a multi-branch hospital: switch modules on, no reinstall."*

| Plan | Target | Modules |
|---|---|---|
| **Starter** | Single/small clinics | Patients, Appointments & Queue, OPD/EMR, Billing, Reports (basic) |
| **Professional** | Polyclinics, diagnostic-attached clinics | Starter + Pharmacy, Laboratory, Communication, Patient Portal |
| **Enterprise** | Hospitals, nursing homes, chains | Professional + IPD (beds/admissions), Multi-branch, Audit export, API |

Differentiators to build now: per-tenant settings engine (numbering, tax, booking rules, custom patient fields), live module licensing, role-permission matrix editor, unified patient timeline, FEFO pharmacy, auto-flagged lab results, live bed board, platform owner console with self-serve trial signup.

Deferred (roadmap): insurance/TPA claims, OT scheduling, radiology/PACS, ABDM HIP/HIU certification, FHIR API, real SMS/WhatsApp gateways, AI scribe/document analysis (the v1 Gemini feature).

## Sources
- [MocDoc — best hospital management system in India](https://mocdoc.com/blog/best-hospital-management-system-in-india)
- [MocDoc vs Practo comparison](https://mocdoc.com/blog/mocdoc-vs-practo-hospital-management-software-comparison)
- [MocDoc vs Eka Care](https://mocdoc.com/blog/mocdoc-vs-eka-care)
- [MocDoc vs KareXpert](https://mocdoc.com/blog/mocdoc-vs-karexpert-hospital-management-software-comparison)
- [Codingclave — Best HMS India 2026](https://codingclave.com/blog/best-hospital-management-software-india-2026)
- [Elitemindz — KareXpert alternatives](https://elitemindz.co/blog/top-10-karexpert-hims-alternatives)
- [Clinzy — choosing an HMS in India (2026)](https://clinzycare-web.pages.dev/blog/how-to-choose-hospital-management-system-india/)
- [Zoho — clinic software for multi-speciality clinics](https://www.zoho.com/healthcare/digest/clinic-management-software-for-multi-speciality-clinics.html)
- [Squashapps — clinic management software features](https://squashapps.com/blog/clinic-management-software-features/)
- [AccountableHQ — HIPAA for multi-tenant SaaS EHR](https://www.accountablehq.com/post/hipaa-compliance-guide-for-multi-tenant-saas-ehr-platforms-a-step-by-step-checklist)
- [NHIMG — healthcare SaaS identity governance & multi-tenancy](https://nhimg.org/articles/healthcare-saas-identity-governance-needs-native-multi-tenancy/)
- [Censinet — multi-tenancy risks in healthcare cloud](https://censinet.com/perspectives/multi-tenancy-risks-healthcare-cloud-systems)
- [Attract Group — healthcare SaaS architecture](https://attractgroup.com/blog/healthcare-saas/)
