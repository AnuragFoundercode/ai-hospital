-- =============================================
-- SAMPLE COLLECTION PARTNERS
-- =============================================
CREATE TABLE IF NOT EXISTS sample_collectors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  is_verified_mobile TINYINT(1) DEFAULT 0,
  
  -- Step 1: Personal Info
  full_name VARCHAR(150) DEFAULT NULL,
  email VARCHAR(100) DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  
  -- Step 2: Experience & Zone
  experience_years INT DEFAULT 0,
  zone_id INT DEFAULT NULL,
  
  -- Step 3: Documents
  aadhaar_url VARCHAR(500) DEFAULT NULL,
  pan_url VARCHAR(500) DEFAULT NULL,
  dl_url VARCHAR(500) DEFAULT NULL,
  profile_photo_url VARCHAR(500) DEFAULT NULL,
  
  -- Registration
  registration_step INT DEFAULT 0,
  verification_status ENUM('incomplete', 'pending', 'under_review', 'approved', 'rejected') DEFAULT 'incomplete',
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  -- Live Location & Status
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  last_location_update DATETIME DEFAULT NULL,
  is_online TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  
  -- Stats
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  total_collections INT DEFAULT 0,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_uuid (uuid),
  INDEX idx_mobile (mobile),
  INDEX idx_online (is_online),
  INDEX idx_location (latitude, longitude),
  INDEX idx_zone (zone_id)
);

-- =============================================
-- SAMPLE COLLECTOR BANK DETAILS
-- =============================================
CREATE TABLE IF NOT EXISTS sample_collector_bank_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collector_id INT NOT NULL UNIQUE,
  account_holder_name VARCHAR(150) NOT NULL,
  bank_name VARCHAR(150) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  ifsc_code VARCHAR(15) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (collector_id) REFERENCES sample_collectors(id) ON DELETE CASCADE
);

-- =============================================
-- SAMPLE COLLECTION REQUESTS
-- =============================================
CREATE TABLE IF NOT EXISTS sample_collection_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(30) NOT NULL UNIQUE,
  booking_id INT NOT NULL,
  lab_id INT NOT NULL,
  collector_id INT DEFAULT NULL,
  
  -- User (patient) location
  pickup_address VARCHAR(500) NOT NULL,
  pickup_latitude DECIMAL(10, 8) NOT NULL,
  pickup_longitude DECIMAL(11, 8) NOT NULL,
  
  -- Lab location (drop)
  lab_address VARCHAR(500) NOT NULL,
  lab_latitude DECIMAL(10, 8) NOT NULL,
  lab_longitude DECIMAL(11, 8) NOT NULL,
  
  -- Distance & Earning
  distance_km DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  per_km_charge DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  collection_earning DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  
  -- Status
  status ENUM('searching', 'assigned', 'reached_patient', 'sample_collected', 'delivered_to_lab', 'cancelled') DEFAULT 'searching',
  collection_otp VARCHAR(6) DEFAULT NULL,
  
  -- Timestamps
  assigned_at DATETIME DEFAULT NULL,
  reached_at DATETIME DEFAULT NULL,
  collected_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (lab_id) REFERENCES pathology_labs(id),
  FOREIGN KEY (collector_id) REFERENCES sample_collectors(id),
  INDEX idx_request_id (request_id),
  INDEX idx_booking (booking_id),
  INDEX idx_collector (collector_id),
  INDEX idx_status (status)
);

-- =============================================
-- SAMPLE COLLECTOR WALLET
-- =============================================
CREATE TABLE IF NOT EXISTS sample_collector_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collector_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (collector_id) REFERENCES sample_collectors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sample_collector_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collector_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('collection_earning', 'withdrawal', 'bonus', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collector_id) REFERENCES sample_collectors(id),
  INDEX idx_collector (collector_id)
);

CREATE TABLE IF NOT EXISTS sample_collector_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collector_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (collector_id) REFERENCES sample_collectors(id),
  INDEX idx_collector (collector_id),
  INDEX idx_status (status)
);

-- Admin config for sample collection
INSERT INTO admin_config (config_key, config_value, description) VALUES
('sample_collection_per_km_charge', '15', 'Per km charge for sample collection partners'),
('sample_collection_search_radius_km', '10', 'Radius to search nearby sample collectors');
