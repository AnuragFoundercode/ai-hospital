-- =============================================
-- BLOOD DELIVERY PARTNERS (clone of delivery_partners)
-- =============================================
CREATE TABLE IF NOT EXISTS blood_delivery_partners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  is_verified_mobile TINYINT(1) DEFAULT 0,

  full_name VARCHAR(150) DEFAULT NULL,
  email VARCHAR(100) DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  profile_photo VARCHAR(500) DEFAULT NULL,

  vehicle_type ENUM('bike', 'scooter', 'bicycle', 'ev') DEFAULT NULL,
  vehicle_type_id INT DEFAULT NULL,
  rc_number VARCHAR(50) DEFAULT NULL,
  dl_number VARCHAR(50) DEFAULT NULL,
  zone_id INT DEFAULT NULL,

  aadhaar_front_url VARCHAR(500) DEFAULT NULL,
  aadhaar_back_url VARCHAR(500) DEFAULT NULL,
  pan_card_url VARCHAR(500) DEFAULT NULL,
  driving_licence_url VARCHAR(500) DEFAULT NULL,
  rider_selfie_url VARCHAR(500) DEFAULT NULL,

  registration_step INT DEFAULT 0,
  verification_status ENUM('incomplete', 'pending', 'under_review', 'approved', 'rejected') DEFAULT 'incomplete',
  rejection_reason VARCHAR(500) DEFAULT NULL,

  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  last_location_update DATETIME DEFAULT NULL,
  is_online TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,

  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  total_deliveries INT DEFAULT 0,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  admin_commission_percent DECIMAL(5, 2) DEFAULT 2.00,

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
-- BLOOD DELIVERY BANK DETAILS
-- =============================================
CREATE TABLE IF NOT EXISTS blood_delivery_bank_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_partner_id INT NOT NULL UNIQUE,
  account_holder_name VARCHAR(150) NOT NULL,
  bank_name VARCHAR(150) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  ifsc_code VARCHAR(15) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_partner_id) REFERENCES blood_delivery_partners(id) ON DELETE CASCADE
);

-- =============================================
-- BLOOD DELIVERY WALLET
-- =============================================
CREATE TABLE IF NOT EXISTS blood_delivery_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_partner_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_partner_id) REFERENCES blood_delivery_partners(id) ON DELETE CASCADE
);

-- =============================================
-- BLOOD DELIVERY WALLET TRANSACTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS blood_delivery_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_partner_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('delivery_earning', 'withdrawal', 'bonus', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  admin_commission DECIMAL(10, 2) DEFAULT 0.00,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_partner_id) REFERENCES blood_delivery_partners(id),
  INDEX idx_partner (delivery_partner_id),
  INDEX idx_type (type)
);

-- =============================================
-- BLOOD DELIVERY WITHDRAWALS
-- =============================================
CREATE TABLE IF NOT EXISTS blood_delivery_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_partner_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_partner_id) REFERENCES blood_delivery_partners(id),
  INDEX idx_partner (delivery_partner_id),
  INDEX idx_status (status)
);

-- =============================================
-- Add blood_delivery_partner to notifications recipient_type enum
-- =============================================
ALTER TABLE notifications MODIFY COLUMN recipient_type ENUM('user','doctor','pharmacy','pathology_lab','blood_bank','diagnostic_center','ambulance_service','delivery_partner','blood_delivery_partner','sample_collector','partner','admin') NOT NULL;
