-- =============================================
-- PATIENTS / END USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  fcm_token VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  aadhaar_number VARCHAR(12) DEFAULT NULL,
  abha_number VARCHAR(20) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid)
);

-- =============================================
-- SERVICE PROVIDERS / VENDORS TABLE
-- (Doctors, Pharmacies, Pathology Labs, Blood Banks, 
--  Diagnostic Centers, Ambulance Services)
-- =============================================
CREATE TABLE IF NOT EXISTS vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  vendor_type ENUM('doctor', 'pharmacy', 'pathology_lab', 'blood_bank', 'diagnostic_center', 'ambulance_service') NOT NULL,
  
  -- Basic Info
  name VARCHAR(150) NOT NULL,
  contact_person VARCHAR(100) DEFAULT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  
  -- Business Details
  business_name VARCHAR(200) DEFAULT NULL,
  business_registration_number VARCHAR(100) DEFAULT NULL,
  gst_number VARCHAR(20) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  license_number VARCHAR(100) DEFAULT NULL,
  
  -- Business Documents (file paths)
  business_certificate_url VARCHAR(255) DEFAULT NULL,
  gst_certificate_url VARCHAR(255) DEFAULT NULL,
  license_document_url VARCHAR(255) DEFAULT NULL,
  
  -- Verification & Status
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  is_kyc_completed TINYINT(1) DEFAULT 0,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at TIMESTAMP DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  -- FCM
  fcm_token VARCHAR(255) DEFAULT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_vendor_type (vendor_type),
  INDEX idx_verification_status (verification_status)
);

-- =============================================
-- VENDOR ADDRESSES
-- =============================================
CREATE TABLE IF NOT EXISTS vendor_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  label VARCHAR(50) DEFAULT 'Main',
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  is_default TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  INDEX idx_vendor_id (vendor_id)
);

-- =============================================
-- FIELD PARTNERS TABLE
-- (Delivery Boys, Sample Collectors, Ambulance Drivers)
-- These are individual workers linked to vendors
-- =============================================
CREATE TABLE IF NOT EXISTS partners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  vendor_id INT DEFAULT NULL,
  partner_type ENUM('delivery_partner', 'sample_collector', 'ambulance_driver') NOT NULL,
  
  -- Basic Info
  full_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  
  -- Identity Documents
  aadhaar_number VARCHAR(12) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  driving_license_number VARCHAR(50) DEFAULT NULL,
  
  -- Document URLs
  aadhaar_front_url VARCHAR(255) DEFAULT NULL,
  aadhaar_back_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  driving_license_url VARCHAR(255) DEFAULT NULL,
  
  -- Vehicle (for ambulance drivers & delivery)
  vehicle_number VARCHAR(20) DEFAULT NULL,
  vehicle_type VARCHAR(50) DEFAULT NULL,
  vehicle_document_url VARCHAR(255) DEFAULT NULL,
  
  -- Status
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  is_online TINYINT(1) DEFAULT 0,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  
  -- Location (live tracking)
  current_latitude DECIMAL(10, 8) DEFAULT NULL,
  current_longitude DECIMAL(11, 8) DEFAULT NULL,
  last_location_update TIMESTAMP DEFAULT NULL,
  
  -- FCM
  fcm_token VARCHAR(255) DEFAULT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_partner_type (partner_type),
  INDEX idx_vendor_id (vendor_id),
  INDEX idx_is_online (is_online)
);

-- =============================================
-- DOCTOR PROFILES (extra details for doctor vendors)
-- =============================================
CREATE TABLE IF NOT EXISTS doctor_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL UNIQUE,
  registration_number VARCHAR(100) NOT NULL,
  registration_council VARCHAR(100) DEFAULT NULL,
  qualification VARCHAR(255) NOT NULL,
  specialization VARCHAR(150) DEFAULT NULL,
  experience_years INT DEFAULT 0,
  consultation_fee DECIMAL(10, 2) DEFAULT 0.00,
  follow_up_fee DECIMAL(10, 2) DEFAULT 0.00,
  bio TEXT DEFAULT NULL,
  languages VARCHAR(255) DEFAULT NULL,
  is_available_online TINYINT(1) DEFAULT 1,
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  total_consultations INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

-- =============================================
-- OTP VERIFICATIONS (shared for all user types)
-- =============================================
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mobile VARCHAR(15) NOT NULL,
  otp VARCHAR(6) NOT NULL,
  user_type ENUM('user', 'vendor', 'partner', 'admin') NOT NULL DEFAULT 'user',
  purpose ENUM('registration', 'login', 'reset_password', 'delivery_verify') NOT NULL DEFAULT 'login',
  is_used TINYINT(1) DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mobile_otp (mobile, otp)
);

-- =============================================
-- USER ADDRESSES
-- =============================================
CREATE TABLE IF NOT EXISTS user_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(50) DEFAULT 'Home',
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  is_default TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id)
);

-- =============================================
-- ADMIN USERS (Super Admin, Support Staff)
-- =============================================
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  mobile VARCHAR(15) DEFAULT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin', 'admin', 'support') NOT NULL DEFAULT 'admin',
  is_active TINYINT(1) DEFAULT 1,
  last_login TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_uuid (uuid)
)
