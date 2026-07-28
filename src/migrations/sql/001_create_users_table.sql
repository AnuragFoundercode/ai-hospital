-- =============================================
-- PATIENTS / END USERS
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
  blood_group VARCHAR(5) DEFAULT NULL,
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
-- DOCTORS
-- =============================================
CREATE TABLE IF NOT EXISTS doctors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  
  -- Professional Details
  registration_number VARCHAR(100) NOT NULL,
  registration_council VARCHAR(100) DEFAULT NULL,
  qualification VARCHAR(255) NOT NULL,
  specialization VARCHAR(150) DEFAULT NULL,
  experience_years INT DEFAULT 0,
  bio TEXT DEFAULT NULL,
  languages VARCHAR(255) DEFAULT NULL,
  
  -- Fees
  consultation_fee DECIMAL(10, 2) DEFAULT 0.00,
  follow_up_fee DECIMAL(10, 2) DEFAULT 0.00,
  
  -- Documents
  medical_license_url VARCHAR(255) DEFAULT NULL,
  degree_certificate_url VARCHAR(255) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  
  -- Availability
  is_available_online TINYINT(1) DEFAULT 1,
  
  -- Stats
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  total_consultations INT DEFAULT 0,
  
  -- Verification
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at DATETIME DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_specialization (specialization),
  INDEX idx_verification (verification_status)
);

-- =============================================
-- PHARMACIES
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  
  -- Business Details
  drug_license_number VARCHAR(100) NOT NULL,
  gst_number VARCHAR(20) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  business_registration_number VARCHAR(100) DEFAULT NULL,
  
  -- Documents
  drug_license_url VARCHAR(255) DEFAULT NULL,
  gst_certificate_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  store_photo_url VARCHAR(255) DEFAULT NULL,
  
  -- Address
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  
  -- Operations
  opening_time TIME DEFAULT NULL,
  closing_time TIME DEFAULT NULL,
  is_24hours TINYINT(1) DEFAULT 0,
  delivery_available TINYINT(1) DEFAULT 1,
  delivery_radius_km DECIMAL(5, 2) DEFAULT 5.00,
  
  -- Verification
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at DATETIME DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_city (city),
  INDEX idx_verification (verification_status)
);

-- =============================================
-- PATHOLOGY LABS
-- =============================================
CREATE TABLE IF NOT EXISTS pathology_labs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  
  -- Business Details
  nabl_accreditation_number VARCHAR(100) DEFAULT NULL,
  lab_license_number VARCHAR(100) NOT NULL,
  gst_number VARCHAR(20) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  
  -- Documents
  nabl_certificate_url VARCHAR(255) DEFAULT NULL,
  lab_license_url VARCHAR(255) DEFAULT NULL,
  gst_certificate_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  
  -- Address
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  
  -- Operations
  home_collection_available TINYINT(1) DEFAULT 1,
  home_collection_radius_km DECIMAL(5, 2) DEFAULT 10.00,
  opening_time TIME DEFAULT NULL,
  closing_time TIME DEFAULT NULL,
  
  -- Verification
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at DATETIME DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_city (city)
);

-- =============================================
-- BLOOD BANKS
-- =============================================
CREATE TABLE IF NOT EXISTS blood_banks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  
  -- Business Details
  license_number VARCHAR(100) NOT NULL,
  gst_number VARCHAR(20) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  blood_bank_category ENUM('government', 'private', 'ngo') DEFAULT 'private',
  
  -- Documents
  license_url VARCHAR(255) DEFAULT NULL,
  gst_certificate_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  
  -- Address
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  
  -- Operations
  is_24hours TINYINT(1) DEFAULT 1,
  opening_time TIME DEFAULT NULL,
  closing_time TIME DEFAULT NULL,
  
  -- Verification
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at DATETIME DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_city (city)
);

-- =============================================
-- DIAGNOSTIC CENTERS
-- =============================================
CREATE TABLE IF NOT EXISTS diagnostic_centers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  
  -- Business Details
  nabh_accreditation_number VARCHAR(100) DEFAULT NULL,
  registration_number VARCHAR(100) NOT NULL,
  gst_number VARCHAR(20) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  
  -- Documents
  nabh_certificate_url VARCHAR(255) DEFAULT NULL,
  registration_certificate_url VARCHAR(255) DEFAULT NULL,
  gst_certificate_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  
  -- Services Available (flags)
  has_mri TINYINT(1) DEFAULT 0,
  has_ct_scan TINYINT(1) DEFAULT 0,
  has_xray TINYINT(1) DEFAULT 0,
  has_ultrasound TINYINT(1) DEFAULT 0,
  has_ecg TINYINT(1) DEFAULT 0,
  
  -- Address
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  
  -- Operations
  opening_time TIME DEFAULT NULL,
  closing_time TIME DEFAULT NULL,
  
  -- Verification
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at DATETIME DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_city (city)
);

-- =============================================
-- AMBULANCE SERVICES
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  
  -- Business Details
  registration_number VARCHAR(100) NOT NULL,
  gst_number VARCHAR(20) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  fleet_size INT DEFAULT 1,
  
  -- Documents
  registration_certificate_url VARCHAR(255) DEFAULT NULL,
  gst_certificate_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  
  -- Coverage
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  coverage_radius_km DECIMAL(6, 2) DEFAULT 25.00,
  base_latitude DECIMAL(10, 8) DEFAULT NULL,
  base_longitude DECIMAL(11, 8) DEFAULT NULL,
  
  -- Pricing
  base_fare DECIMAL(10, 2) DEFAULT 0.00,
  per_km_charge DECIMAL(10, 2) DEFAULT 0.00,
  
  -- Verification
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at DATETIME DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_city (city)
);

-- =============================================
-- FIELD PARTNERS (Delivery, Sample Collector, Ambulance Driver)
-- =============================================
CREATE TABLE IF NOT EXISTS partners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  partner_type ENUM('delivery_partner', 'sample_collector', 'ambulance_driver') NOT NULL,
  linked_entity_type ENUM('pharmacy', 'pathology_lab', 'ambulance_service') DEFAULT NULL,
  linked_entity_id INT DEFAULT NULL,
  
  full_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  
  -- Identity
  aadhaar_number VARCHAR(12) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  driving_license_number VARCHAR(50) DEFAULT NULL,
  aadhaar_front_url VARCHAR(255) DEFAULT NULL,
  aadhaar_back_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  driving_license_url VARCHAR(255) DEFAULT NULL,
  
  -- Vehicle
  vehicle_number VARCHAR(20) DEFAULT NULL,
  vehicle_type VARCHAR(50) DEFAULT NULL,
  vehicle_document_url VARCHAR(255) DEFAULT NULL,
  
  -- Status
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  is_online TINYINT(1) DEFAULT 0,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  
  -- Live Location
  current_latitude DECIMAL(10, 8) DEFAULT NULL,
  current_longitude DECIMAL(11, 8) DEFAULT NULL,
  last_location_update DATETIME DEFAULT NULL,
  
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_partner_type (partner_type),
  INDEX idx_is_online (is_online)
);

-- =============================================
-- OTP VERIFICATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mobile VARCHAR(15) NOT NULL,
  otp VARCHAR(6) NOT NULL,
  user_type ENUM('user', 'doctor', 'pharmacy', 'pathology_lab', 'blood_bank', 'diagnostic_center', 'ambulance_service', 'partner', 'admin') NOT NULL DEFAULT 'user',
  purpose ENUM('registration', 'login', 'reset_password', 'delivery_verify') NOT NULL DEFAULT 'login',
  is_used TINYINT(1) DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mobile_otp (mobile, otp)
);

-- =============================================
-- ADMIN USERS
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
  last_login DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
)
