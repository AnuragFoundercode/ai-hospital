-- =============================================
-- AMBULANCE CATEGORIES (Admin managed)
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT NULL,
  base_charge DECIMAL(10, 2) DEFAULT 200.00,
  per_km_charge DECIMAL(10, 2) DEFAULT 50.00,
  icon_url VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed categories
INSERT INTO ambulance_categories (name, description, base_charge, per_km_charge) VALUES
('BLS', 'Basic Life Support - For stable patients needing basic medical care during transport', 200.00, 50.00),
('ALS', 'Advanced Life Support - For critical patients needing advanced medical equipment', 500.00, 80.00),
('Patient Transport', 'Non-emergency patient transport for hospital transfers or discharge', 150.00, 30.00);

-- =============================================
-- AMBULANCE PARTNERS (Drivers)
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_partners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  dob DATE DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  
  -- License Info
  driving_license_number VARCHAR(50) NOT NULL,
  license_expiry_date DATE NOT NULL,
  experience_years INT DEFAULT 0,
  emergency_training_certificate_url VARCHAR(500) DEFAULT NULL,
  
  -- Vehicle Info
  category_id INT DEFAULT NULL,
  vehicle_number VARCHAR(20) NOT NULL,
  registration_number VARCHAR(50) NOT NULL,
  insurance_valid_till DATE DEFAULT NULL,
  
  -- Document URLs
  rc_book_url VARCHAR(500) DEFAULT NULL,
  aadhaar_url VARCHAR(500) DEFAULT NULL,
  dl_url VARCHAR(500) DEFAULT NULL,
  insurance_url VARCHAR(500) DEFAULT NULL,
  
  -- Live Location
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  last_location_update DATETIME DEFAULT NULL,
  
  -- Status
  is_online TINYINT(1) DEFAULT 0,
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  total_trips INT DEFAULT 0,
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (category_id) REFERENCES ambulance_categories(id) ON DELETE SET NULL,
  INDEX idx_uuid (uuid),
  INDEX idx_mobile (mobile),
  INDEX idx_online (is_online),
  INDEX idx_location (latitude, longitude),
  INDEX idx_category (category_id)
);

-- =============================================
-- AMBULANCE BOOKINGS
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(30) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  partner_id INT DEFAULT NULL,
  category_id INT NOT NULL,
  
  -- Pickup
  pickup_latitude DECIMAL(10, 8) NOT NULL,
  pickup_longitude DECIMAL(11, 8) NOT NULL,
  pickup_address VARCHAR(500) NOT NULL,
  
  -- Drop
  drop_latitude DECIMAL(10, 8) NOT NULL,
  drop_longitude DECIMAL(11, 8) NOT NULL,
  drop_address VARCHAR(500) NOT NULL,
  
  -- Distance & Fare
  distance_km DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  estimated_time_minutes INT DEFAULT 0,
  base_charge DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  per_km_charge DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_fare DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  
  -- Payment
  payment_method ENUM('online', 'cash') DEFAULT 'cash',
  payment_status ENUM('unpaid', 'paid', 'refunded', 'failed') DEFAULT 'unpaid',
  transaction_id VARCHAR(100) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  
  -- Status
  status ENUM('searching', 'pending', 'accepted', 'arrived', 'in_transit', 'completed', 'cancelled', 'no_partner_found') DEFAULT 'searching',
  cancellation_reason VARCHAR(500) DEFAULT NULL,
  cancelled_by ENUM('user', 'partner', 'system') DEFAULT NULL,
  
  -- Patient Info (optional)
  patient_name VARCHAR(150) DEFAULT NULL,
  patient_condition TEXT DEFAULT NULL,
  emergency_contact VARCHAR(15) DEFAULT NULL,
  
  -- Rating
  user_rating DECIMAL(2, 1) DEFAULT NULL,
  user_review TEXT DEFAULT NULL,
  rated_at DATETIME DEFAULT NULL,
  
  -- Timestamps
  accepted_at DATETIME DEFAULT NULL,
  arrived_at DATETIME DEFAULT NULL,
  started_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  cancelled_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (partner_id) REFERENCES ambulance_partners(id),
  FOREIGN KEY (category_id) REFERENCES ambulance_categories(id),
  INDEX idx_booking_id (booking_id),
  INDEX idx_user (user_id),
  INDEX idx_partner (partner_id),
  INDEX idx_status (status)
);
