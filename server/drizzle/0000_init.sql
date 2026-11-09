CREATE TABLE `admission_notes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`admission_id` bigint unsigned NOT NULL,
	`type` enum('progress','nursing','transfer','procedure') NOT NULL DEFAULT 'progress',
	`note` text NOT NULL,
	`vitals` json,
	`created_by` bigint unsigned,
	`created_by_name` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admission_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admissions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`admission_no` varchar(30) NOT NULL,
	`patient_id` bigint unsigned NOT NULL,
	`doctor_id` bigint unsigned NOT NULL,
	`department_id` bigint unsigned,
	`bed_id` bigint unsigned NOT NULL,
	`invoice_id` bigint unsigned,
	`status` enum('admitted','discharged','cancelled') NOT NULL DEFAULT 'admitted',
	`admitted_at` timestamp NOT NULL DEFAULT (now()),
	`discharged_at` timestamp,
	`reason` varchar(500),
	`provisional_diagnosis` varchar(500),
	`attendant_name` varchar(120),
	`attendant_phone` varchar(20),
	`discharge_type` enum('normal','lama','referred','absconded','death'),
	`discharge_summary` text,
	`bed_charges_billed_until` timestamp,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `adm_tenant_no_uq` UNIQUE(`tenant_id`,`admission_no`)
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned,
	`appointment_no` varchar(30) NOT NULL,
	`patient_id` bigint unsigned NOT NULL,
	`doctor_id` bigint unsigned NOT NULL,
	`department_id` bigint unsigned,
	`date` date NOT NULL,
	`start_time` time NOT NULL,
	`end_time` time NOT NULL,
	`token_no` int NOT NULL,
	`visit_type` enum('new','follow_up') NOT NULL DEFAULT 'new',
	`mode` enum('in_person','video') NOT NULL DEFAULT 'in_person',
	`source` enum('walk_in','phone','desk','portal') NOT NULL DEFAULT 'desk',
	`status` enum('booked','checked_in','in_consultation','completed','cancelled','no_show') NOT NULL DEFAULT 'booked',
	`fee` decimal(12,2) NOT NULL DEFAULT 0,
	`reason` varchar(300),
	`notes` varchar(500),
	`cancel_reason` varchar(300),
	`invoice_id` bigint unsigned,
	`checked_in_at` timestamp,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`),
	CONSTRAINT `appt_tenant_no_uq` UNIQUE(`tenant_id`,`appointment_no`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned,
	`user_id` bigint unsigned,
	`user_name` varchar(120),
	`action` varchar(40) NOT NULL,
	`entity` varchar(60) NOT NULL,
	`entity_id` varchar(40),
	`summary` varchar(500),
	`details` json,
	`ip` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `beds` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`ward_id` bigint unsigned NOT NULL,
	`bed_no` varchar(20) NOT NULL,
	`status` enum('available','occupied','cleaning','maintenance','reserved') NOT NULL DEFAULT 'available',
	`daily_rate` decimal(12,2),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `beds_id` PRIMARY KEY(`id`),
	CONSTRAINT `bed_ward_no_uq` UNIQUE(`tenant_id`,`ward_id`,`bed_no`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`code` varchar(20) NOT NULL,
	`address` varchar(300),
	`phone` varchar(30),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_tenant_code_uq` UNIQUE(`tenant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`code` varchar(20),
	`description` varchar(300),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `dept_tenant_name_uq` UNIQUE(`tenant_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `doctor_leaves` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`doctor_id` bigint unsigned NOT NULL,
	`date_from` date NOT NULL,
	`date_to` date NOT NULL,
	`reason` varchar(200),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `doctor_leaves_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `doctor_schedules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`doctor_id` bigint unsigned NOT NULL,
	`day_of_week` tinyint NOT NULL,
	`start_time` time NOT NULL,
	`end_time` time NOT NULL,
	CONSTRAINT `doctor_schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `doctors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`department_id` bigint unsigned,
	`branch_id` bigint unsigned,
	`name` varchar(120) NOT NULL,
	`specialization` varchar(120),
	`qualification` varchar(200),
	`registration_no` varchar(60),
	`experience_years` int DEFAULT 0,
	`phone` varchar(30),
	`email` varchar(150),
	`bio` text,
	`photo_url` varchar(500),
	`consultation_fee` decimal(12,2) NOT NULL DEFAULT 0,
	`follow_up_fee` decimal(12,2) NOT NULL DEFAULT 0,
	`follow_up_days` int NOT NULL DEFAULT 7,
	`slot_minutes` int NOT NULL DEFAULT 15,
	`max_per_slot` int NOT NULL DEFAULT 1,
	`telehealth_enabled` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `doctors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`patient_id` bigint unsigned NOT NULL,
	`doctor_id` bigint unsigned NOT NULL,
	`appointment_id` bigint unsigned,
	`admission_id` bigint unsigned,
	`type` enum('opd','ipd') NOT NULL DEFAULT 'opd',
	`status` enum('draft','final') NOT NULL DEFAULT 'draft',
	`chief_complaint` text,
	`history` text,
	`examination` text,
	`vitals` json NOT NULL,
	`diagnoses` json NOT NULL,
	`notes` text,
	`advice` text,
	`follow_up_date` date,
	`rx_status` enum('none','pending','dispensed') NOT NULL DEFAULT 'none',
	`finalized_at` timestamp,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `encounters_id` PRIMARY KEY(`id`),
	CONSTRAINT `enc_appt_uq` UNIQUE(`tenant_id`,`appointment_id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`invoice_id` bigint unsigned NOT NULL,
	`item_type` enum('consultation','service','medicine','lab_test','bed','registration','other') NOT NULL,
	`ref_id` bigint unsigned,
	`batch_id` bigint unsigned,
	`description` varchar(200) NOT NULL,
	`quantity` decimal(10,2) NOT NULL DEFAULT 1,
	`unit_price` decimal(12,2) NOT NULL,
	`discount` decimal(12,2) NOT NULL DEFAULT 0,
	`tax_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`tax_amount` decimal(12,2) NOT NULL DEFAULT 0,
	`amount` decimal(12,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned,
	`invoice_no` varchar(30) NOT NULL,
	`patient_id` bigint unsigned NOT NULL,
	`type` enum('opd','ipd','pharmacy','lab','general') NOT NULL DEFAULT 'general',
	`status` enum('draft','unpaid','partially_paid','paid','cancelled','refunded') NOT NULL DEFAULT 'unpaid',
	`appointment_id` bigint unsigned,
	`admission_id` bigint unsigned,
	`lab_order_id` bigint unsigned,
	`encounter_id` bigint unsigned,
	`subtotal` decimal(12,2) NOT NULL DEFAULT 0,
	`discount_total` decimal(12,2) NOT NULL DEFAULT 0,
	`tax_total` decimal(12,2) NOT NULL DEFAULT 0,
	`total` decimal(12,2) NOT NULL DEFAULT 0,
	`amount_paid` decimal(12,2) NOT NULL DEFAULT 0,
	`balance` decimal(12,2) NOT NULL DEFAULT 0,
	`notes` varchar(500),
	`cancel_reason` varchar(300),
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `inv_tenant_no_uq` UNIQUE(`tenant_id`,`invoice_no`)
);
--> statement-breakpoint
CREATE TABLE `lab_order_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`lab_order_id` bigint unsigned NOT NULL,
	`lab_test_id` bigint unsigned NOT NULL,
	`test_name` varchar(150) NOT NULL,
	`price` decimal(12,2) NOT NULL DEFAULT 0,
	`results` json NOT NULL,
	`result_notes` varchar(500),
	CONSTRAINT `lab_order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lab_orders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`order_no` varchar(30) NOT NULL,
	`patient_id` bigint unsigned NOT NULL,
	`doctor_id` bigint unsigned,
	`encounter_id` bigint unsigned,
	`invoice_id` bigint unsigned,
	`priority` enum('routine','urgent','stat') NOT NULL DEFAULT 'routine',
	`status` enum('ordered','sample_collected','completed','verified','cancelled') NOT NULL DEFAULT 'ordered',
	`sample_id` varchar(40),
	`notes` varchar(500),
	`collected_at` timestamp,
	`completed_at` timestamp,
	`verified_at` timestamp,
	`verified_by` bigint unsigned,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lab_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `lab_tenant_no_uq` UNIQUE(`tenant_id`,`order_no`)
);
--> statement-breakpoint
CREATE TABLE `lab_tests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`code` varchar(30),
	`name` varchar(150) NOT NULL,
	`category` varchar(60),
	`sample_type` varchar(60),
	`price` decimal(12,2) NOT NULL DEFAULT 0,
	`tax_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`turnaround_hours` int NOT NULL DEFAULT 24,
	`parameters` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lab_tests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `medicine_batches` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`medicine_id` bigint unsigned NOT NULL,
	`batch_no` varchar(40) NOT NULL,
	`expiry_date` date NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`purchase_price` decimal(12,2) NOT NULL DEFAULT 0,
	`mrp` decimal(12,2) NOT NULL DEFAULT 0,
	`sale_price` decimal(12,2) NOT NULL DEFAULT 0,
	`supplier` varchar(120),
	`received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `medicine_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `medicines` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(150) NOT NULL,
	`generic_name` varchar(150),
	`form` varchar(40),
	`strength` varchar(40),
	`manufacturer` varchar(120),
	`category` varchar(60),
	`hsn_code` varchar(20),
	`unit` varchar(20) NOT NULL DEFAULT 'unit',
	`reorder_level` int NOT NULL DEFAULT 10,
	`sale_price` decimal(12,2) NOT NULL DEFAULT 0,
	`tax_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `medicines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`patient_id` bigint unsigned,
	`channel` enum('sms','email','whatsapp','portal') NOT NULL,
	`recipient` varchar(150) NOT NULL,
	`subject` varchar(200),
	`body` text NOT NULL,
	`status` enum('sent','failed','simulated') NOT NULL DEFAULT 'simulated',
	`sent_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `message_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned,
	`permission` varchar(60),
	`title` varchar(150) NOT NULL,
	`body` varchar(500),
	`link` varchar(200),
	`type` varchar(40) NOT NULL DEFAULT 'info',
	`read_by` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`uhid` varchar(30) NOT NULL,
	`first_name` varchar(80) NOT NULL,
	`last_name` varchar(80),
	`gender` enum('male','female','other') NOT NULL,
	`dob` date,
	`phone` varchar(20) NOT NULL,
	`email` varchar(150),
	`blood_group` varchar(5),
	`address` varchar(300),
	`city` varchar(80),
	`state` varchar(80),
	`pincode` varchar(10),
	`national_id` varchar(40),
	`emergency_name` varchar(120),
	`emergency_phone` varchar(20),
	`allergies` json NOT NULL,
	`conditions` json NOT NULL,
	`notes` text,
	`custom_fields` json NOT NULL,
	`is_deleted` boolean NOT NULL DEFAULT false,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `patients_id` PRIMARY KEY(`id`),
	CONSTRAINT `patients_tenant_uhid_uq` UNIQUE(`tenant_id`,`uhid`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`invoice_id` bigint unsigned NOT NULL,
	`patient_id` bigint unsigned NOT NULL,
	`receipt_no` varchar(30) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`method` enum('cash','card','upi','netbanking','cheque','insurance','wallet') NOT NULL,
	`reference` varchar(100),
	`is_refund` boolean NOT NULL DEFAULT false,
	`notes` varchar(300),
	`received_by` bigint unsigned,
	`paid_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `pay_tenant_receipt_uq` UNIQUE(`tenant_id`,`receipt_no`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` varchar(500),
	`price_monthly` decimal(12,2) NOT NULL DEFAULT 0,
	`price_yearly` decimal(12,2) NOT NULL DEFAULT 0,
	`max_users` int NOT NULL DEFAULT 10,
	`max_branches` int NOT NULL DEFAULT 1,
	`modules` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `plans_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `prescription_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`encounter_id` bigint unsigned NOT NULL,
	`medicine_id` bigint unsigned,
	`medicine_name` varchar(150) NOT NULL,
	`dose` varchar(60),
	`frequency` varchar(60),
	`duration_days` int,
	`route` varchar(40),
	`instructions` varchar(300),
	`quantity` int NOT NULL DEFAULT 0,
	`dispensed_qty` int NOT NULL DEFAULT 0,
	CONSTRAINT `prescription_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	`user_agent` varchar(300),
	`ip` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_tokenHash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`code` varchar(40) NOT NULL,
	`name` varchar(80) NOT NULL,
	`description` varchar(300),
	`permissions` json NOT NULL,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_tenant_code_uq` UNIQUE(`tenant_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`tenant_id` bigint unsigned NOT NULL,
	`name` varchar(40) NOT NULL,
	`value` bigint unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `sequences_tenant_id_name_pk` PRIMARY KEY(`tenant_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`code` varchar(30),
	`name` varchar(150) NOT NULL,
	`category` enum('consultation','procedure','investigation','room','nursing','package','other') NOT NULL DEFAULT 'other',
	`price` decimal(12,2) NOT NULL DEFAULT 0,
	`tax_rate` decimal(5,2) NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`medicine_id` bigint unsigned NOT NULL,
	`batch_id` bigint unsigned NOT NULL,
	`type` enum('purchase','sale','adjustment','return','expired') NOT NULL,
	`quantity` int NOT NULL,
	`reference_type` varchar(30),
	`reference_id` bigint unsigned,
	`notes` varchar(300),
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name` varchar(150) NOT NULL,
	`type` enum('clinic','polyclinic','hospital','diagnostic','nursing_home') NOT NULL DEFAULT 'clinic',
	`email` varchar(150),
	`phone` varchar(30),
	`address` varchar(300),
	`city` varchar(80),
	`state` varchar(80),
	`country` varchar(80) DEFAULT 'India',
	`plan_id` bigint unsigned NOT NULL,
	`status` enum('trial','active','suspended','cancelled') NOT NULL DEFAULT 'trial',
	`trial_ends_at` timestamp,
	`subscription_ends_at` timestamp,
	`settings` json NOT NULL,
	`module_overrides` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned,
	`role_id` bigint unsigned,
	`branch_id` bigint unsigned,
	`email` varchar(150) NOT NULL,
	`password_hash` varchar(100) NOT NULL,
	`full_name` varchar(120) NOT NULL,
	`phone` varchar(30),
	`is_platform_admin` boolean NOT NULL DEFAULT false,
	`patient_id` bigint unsigned,
	`doctor_id` bigint unsigned,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`failed_logins` int NOT NULL DEFAULT 0,
	`locked_until` timestamp,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_tenant_email_uq` UNIQUE(`tenant_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `wards` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tenant_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned,
	`name` varchar(100) NOT NULL,
	`type` enum('general','semi_private','private','icu','nicu','emergency','maternity') NOT NULL DEFAULT 'general',
	`floor` varchar(20),
	`daily_rate` decimal(12,2) NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admission_notes` ADD CONSTRAINT `admission_notes_admission_id_admissions_id_fk` FOREIGN KEY (`admission_id`) REFERENCES `admissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_doctor_id_doctors_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admissions` ADD CONSTRAINT `admissions_bed_id_beds_id_fk` FOREIGN KEY (`bed_id`) REFERENCES `beds`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_doctor_id_doctors_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `beds` ADD CONSTRAINT `beds_ward_id_wards_id_fk` FOREIGN KEY (`ward_id`) REFERENCES `wards`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctor_leaves` ADD CONSTRAINT `doctor_leaves_doctor_id_doctors_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctor_schedules` ADD CONSTRAINT `doctor_schedules_doctor_id_doctors_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctors` ADD CONSTRAINT `doctors_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `doctors` ADD CONSTRAINT `doctors_department_id_departments_id_fk` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `encounters` ADD CONSTRAINT `encounters_doctor_id_doctors_id_fk` FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD CONSTRAINT `invoice_items_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_order_items` ADD CONSTRAINT `lab_order_items_lab_order_id_lab_orders_id_fk` FOREIGN KEY (`lab_order_id`) REFERENCES `lab_orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_orders` ADD CONSTRAINT `lab_orders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_orders` ADD CONSTRAINT `lab_orders_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lab_tests` ADD CONSTRAINT `lab_tests_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicine_batches` ADD CONSTRAINT `medicine_batches_medicine_id_medicines_id_fk` FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicines` ADD CONSTRAINT `medicines_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_logs` ADD CONSTRAINT `message_logs_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `patients` ADD CONSTRAINT `patients_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prescription_items` ADD CONSTRAINT `prescription_items_encounter_id_encounters_id_fk` FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `services` ADD CONSTRAINT `services_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wards` ADD CONSTRAINT `wards_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admnote_adm_idx` ON `admission_notes` (`tenant_id`,`admission_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `adm_tenant_status_idx` ON `admissions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `adm_patient_idx` ON `admissions` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `appt_doctor_date_idx` ON `appointments` (`tenant_id`,`doctor_id`,`date`,`start_time`);--> statement-breakpoint
CREATE INDEX `appt_tenant_date_idx` ON `appointments` (`tenant_id`,`date`,`status`);--> statement-breakpoint
CREATE INDEX `appt_patient_idx` ON `appointments` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `audit_tenant_created_idx` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_tenant_entity_idx` ON `audit_logs` (`tenant_id`,`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `leave_doctor_idx` ON `doctor_leaves` (`tenant_id`,`doctor_id`,`date_from`);--> statement-breakpoint
CREATE INDEX `sched_doctor_day_idx` ON `doctor_schedules` (`tenant_id`,`doctor_id`,`day_of_week`);--> statement-breakpoint
CREATE INDEX `doctors_tenant_dept_idx` ON `doctors` (`tenant_id`,`department_id`);--> statement-breakpoint
CREATE INDEX `enc_patient_idx` ON `encounters` (`tenant_id`,`patient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `enc_rx_idx` ON `encounters` (`tenant_id`,`rx_status`);--> statement-breakpoint
CREATE INDEX `invitem_invoice_idx` ON `invoice_items` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `inv_tenant_created_idx` ON `invoices` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `inv_tenant_status_idx` ON `invoices` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `inv_patient_idx` ON `invoices` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `labitem_order_idx` ON `lab_order_items` (`tenant_id`,`lab_order_id`);--> statement-breakpoint
CREATE INDEX `lab_tenant_status_idx` ON `lab_orders` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `lab_patient_idx` ON `lab_orders` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `labtest_tenant_idx` ON `lab_tests` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `batch_med_expiry_idx` ON `medicine_batches` (`tenant_id`,`medicine_id`,`expiry_date`);--> statement-breakpoint
CREATE INDEX `med_tenant_name_idx` ON `medicines` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `msg_tenant_created_idx` ON `message_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notif_tenant_created_idx` ON `notifications` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `patients_tenant_phone_idx` ON `patients` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE INDEX `patients_tenant_name_idx` ON `patients` (`tenant_id`,`first_name`,`last_name`);--> statement-breakpoint
CREATE INDEX `pay_tenant_paid_idx` ON `payments` (`tenant_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `pay_invoice_idx` ON `payments` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `rx_encounter_idx` ON `prescription_items` (`tenant_id`,`encounter_id`);--> statement-breakpoint
CREATE INDEX `refresh_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `services_tenant_idx` ON `services` (`tenant_id`,`category`);--> statement-breakpoint
CREATE INDEX `stockmv_med_idx` ON `stock_movements` (`tenant_id`,`medicine_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tenants_status_idx` ON `tenants` (`status`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `ward_tenant_idx` ON `wards` (`tenant_id`);