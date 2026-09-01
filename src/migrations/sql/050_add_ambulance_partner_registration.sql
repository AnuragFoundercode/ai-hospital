-- =============================================
-- Ambulance Partner (driver) step-wise registration columns
-- Provider IS the driver (single entity in ambulance_services)
-- =============================================

-- Relax NOT NULL constraints so a partner row can be created via OTP first
ALTER TABLE ambulance_services MODIFY COLUMN name VARCHAR(200) DEFAULT NULL;
ALTER TABLE ambulance_services MODIFY COLUMN owner_name VARCHAR(100) DEFAULT NULL;
ALTER TABLE ambulance_services MODIFY COLUMN registration_number VARCHAR(100) DEFAULT NULL;
ALTER TABLE ambulance_services MODIFY COLUMN city VARCHAR(100) DEFAULT NULL;
ALTER TABLE ambulance_services MODIFY COLUMN state VARCHAR(100) DEFAULT NULL;

-- Personal (Step 1)
ALTER TABLE ambulance_services ADD COLUMN full_name VARCHAR(150) DEFAULT NULL AFTER owner_name;
ALTER TABLE ambulance_services ADD COLUMN dob DATE DEFAULT NULL AFTER full_name;
ALTER TABLE ambulance_services ADD COLUMN gender ENUM('male','female','other') DEFAULT NULL AFTER dob;

-- License (Step 2)
ALTER TABLE ambulance_services ADD COLUMN driving_license_number VARCHAR(50) DEFAULT NULL AFTER gender;
ALTER TABLE ambulance_services ADD COLUMN license_expiry_date DATE DEFAULT NULL AFTER driving_license_number;

-- Vehicle (Step 3)
ALTER TABLE ambulance_services ADD COLUMN ambulance_type_id INT DEFAULT NULL AFTER license_expiry_date;
ALTER TABLE ambulance_services ADD COLUMN vehicle_number VARCHAR(30) DEFAULT NULL AFTER ambulance_type_id;
ALTER TABLE ambulance_services ADD COLUMN vehicle_registration_date DATE DEFAULT NULL AFTER vehicle_number;
ALTER TABLE ambulance_services ADD COLUMN insurance_valid_till DATE DEFAULT NULL AFTER vehicle_registration_date;

-- Documents (Step 4)
ALTER TABLE ambulance_services ADD COLUMN aadhaar_url VARCHAR(255) DEFAULT NULL AFTER pan_card_url;
ALTER TABLE ambulance_services ADD COLUMN driving_licence_url VARCHAR(255) DEFAULT NULL AFTER aadhaar_url;
ALTER TABLE ambulance_services ADD COLUMN rc_book_url VARCHAR(255) DEFAULT NULL AFTER driving_licence_url;
ALTER TABLE ambulance_services ADD COLUMN emergency_training_certificate_url VARCHAR(255) DEFAULT NULL AFTER rc_book_url;

-- Registration progress tracking
ALTER TABLE ambulance_services ADD COLUMN registration_step INT DEFAULT 0 AFTER emergency_training_certificate_url;
ALTER TABLE ambulance_services ADD COLUMN is_verified_mobile TINYINT(1) DEFAULT 0 AFTER registration_step;

-- Default verification_status to 'incomplete' for new registrations
ALTER TABLE ambulance_services MODIFY COLUMN verification_status ENUM('incomplete','pending','under_review','approved','rejected') DEFAULT 'incomplete';
