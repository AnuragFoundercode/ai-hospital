-- =============================================
-- DOCTOR CLINIC DETAILS
-- =============================================
CREATE TABLE IF NOT EXISTS doctor_clinics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT NOT NULL,
  clinic_name VARCHAR(200) NOT NULL,
  address VARCHAR(500) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  zone VARCHAR(100) DEFAULT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  is_primary TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  INDEX idx_doctor (doctor_id)
);

-- =============================================
-- DOCTOR BANK DETAILS
-- =============================================
CREATE TABLE IF NOT EXISTS doctor_bank_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT NOT NULL UNIQUE,
  account_holder_name VARCHAR(150) NOT NULL,
  bank_name VARCHAR(150) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  ifsc_code VARCHAR(15) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- =============================================
-- ADD registration_step column to doctors
-- Tracks which step the doctor has completed
-- =============================================
ALTER TABLE doctors ADD COLUMN registration_step INT DEFAULT 0 AFTER verification_status;
ALTER TABLE doctors ADD COLUMN spoken_languages VARCHAR(255) DEFAULT NULL AFTER languages;
ALTER TABLE doctors ADD COLUMN aadhaar_url VARCHAR(255) DEFAULT NULL AFTER pan_card_url;
ALTER TABLE doctors ADD COLUMN profile_photo_url VARCHAR(255) DEFAULT NULL AFTER profile_photo
