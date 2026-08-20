-- =============================================
-- DELIVERY PARTNERS
-- =============================================
CREATE TABLE IF NOT EXISTS delivery_partners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  is_verified_mobile TINYINT(1) DEFAULT 0,
  
  -- Step 1: Personal Info
  full_name VARCHAR(150) DEFAULT NULL,
  email VARCHAR(100) DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  gender ENUM('male', 'female', 'other') DEFAULT NULL,
  profile_photo VARCHAR(500) DEFAULT NULL,
  
  -- Step 2: Vehicle & Zone
  vehicle_type ENUM('bike', 'scooter', 'bicycle', 'ev') DEFAULT NULL,
  rc_number VARCHAR(50) DEFAULT NULL,
  dl_number VARCHAR(50) DEFAULT NULL,
  zone_id INT DEFAULT NULL,
  
  -- Step 3: Documents
  aadhaar_front_url VARCHAR(500) DEFAULT NULL,
  aadhaar_back_url VARCHAR(500) DEFAULT NULL,
  pan_card_url VARCHAR(500) DEFAULT NULL,
  driving_licence_url VARCHAR(500) DEFAULT NULL,
  rider_selfie_url VARCHAR(500) DEFAULT NULL,
  
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
  total_deliveries INT DEFAULT 0,
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
-- DELIVERY REQUESTS (sent to nearby partners)
-- =============================================
CREATE TABLE IF NOT EXISTS delivery_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(30) NOT NULL UNIQUE,
  order_id INT NOT NULL,
  pharmacy_id INT NOT NULL,
  partner_id INT DEFAULT NULL,
  
  -- Pickup (Pharmacy)
  pickup_address VARCHAR(500) NOT NULL,
  pickup_latitude DECIMAL(10, 8) NOT NULL,
  pickup_longitude DECIMAL(11, 8) NOT NULL,
  
  -- Drop (User)
  drop_address VARCHAR(500) NOT NULL,
  drop_latitude DECIMAL(10, 8) NOT NULL,
  drop_longitude DECIMAL(11, 8) NOT NULL,
  
  -- Distance & Earning
  distance_km DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  per_km_charge DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  delivery_earning DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  
  -- Status
  status ENUM('searching', 'assigned', 'picked_up', 'delivered', 'cancelled') DEFAULT 'searching',
  
  -- Timestamps
  assigned_at DATETIME DEFAULT NULL,
  picked_up_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (order_id) REFERENCES pharmacy_orders(id),
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  FOREIGN KEY (partner_id) REFERENCES delivery_partners(id),
  INDEX idx_request_id (request_id),
  INDEX idx_order (order_id),
  INDEX idx_partner (partner_id),
  INDEX idx_status (status)
);

-- =============================================
-- ADMIN CONFIG (delivery charges etc)
-- =============================================
CREATE TABLE IF NOT EXISTS admin_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_value VARCHAR(255) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO admin_config (config_key, config_value, description) VALUES
('delivery_per_km_charge', '12', 'Per km charge for delivery partners in rupees'),
('delivery_search_radius_km', '5', 'Radius in km to search nearby delivery partners');

-- =============================================
-- ADD delivery_partner_id to pharmacy_orders
-- =============================================
ALTER TABLE pharmacy_orders ADD COLUMN delivery_partner_id INT DEFAULT NULL AFTER pharmacy_id;
ALTER TABLE pharmacy_orders ADD COLUMN delivery_request_id INT DEFAULT NULL AFTER delivery_partner_id;
