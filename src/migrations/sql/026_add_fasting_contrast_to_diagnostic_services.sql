ALTER TABLE diagnostic_services ADD COLUMN is_fasting_required TINYINT(1) DEFAULT 0 AFTER preparation_instructions;
ALTER TABLE diagnostic_services ADD COLUMN is_contrast_required TINYINT(1) DEFAULT 0 AFTER is_fasting_required;
ALTER TABLE diagnostic_services ADD COLUMN report_delivery_hours INT DEFAULT 24 AFTER is_contrast_required;
ALTER TABLE diagnostic_services ADD COLUMN patient_instructions TEXT DEFAULT NULL AFTER report_delivery_hours;
