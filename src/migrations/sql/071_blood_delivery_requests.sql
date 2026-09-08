-- =============================================
-- BLOOD DELIVERY REQUESTS (clone of delivery_requests, for blood bank to user)
-- Created when a blood bank marks a request ready, then a nearby blood delivery
-- partner picks it up. One request equals one trip.
-- =============================================
CREATE TABLE IF NOT EXISTS blood_delivery_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(30) NOT NULL UNIQUE,
  blood_request_id INT NOT NULL,
  blood_bank_id INT NOT NULL,
  partner_id INT DEFAULT NULL,

  -- Pickup (Blood Bank)
  pickup_address VARCHAR(500) NOT NULL,
  pickup_latitude DECIMAL(10, 8) NOT NULL,
  pickup_longitude DECIMAL(11, 8) NOT NULL,

  -- Drop (User / Hospital)
  drop_address VARCHAR(500) NOT NULL,
  drop_latitude DECIMAL(10, 8) NOT NULL,
  drop_longitude DECIMAL(11, 8) NOT NULL,

  -- Distance and Fee. user pays delivery_fee, partner earns delivery_earning (fee minus admin commission)
  distance_km DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  per_km_charge DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  admin_commission_percent DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  admin_commission DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  delivery_earning DECIMAL(10, 2) NOT NULL DEFAULT 0.00,

  -- Handover OTP (generated when partner reaches the user)
  delivery_otp VARCHAR(6) DEFAULT NULL,

  -- Status
  status ENUM('searching', 'assigned', 'picked_up', 'reached', 'delivered', 'cancelled') DEFAULT 'searching',

  -- Timestamps
  assigned_at DATETIME DEFAULT NULL,
  picked_up_at DATETIME DEFAULT NULL,
  reached_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (blood_request_id) REFERENCES blood_requests(id),
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id),
  FOREIGN KEY (partner_id) REFERENCES blood_delivery_partners(id),
  INDEX idx_request_id (request_id),
  INDEX idx_blood_request (blood_request_id),
  INDEX idx_partner (partner_id),
  INDEX idx_status (status)
);

-- =============================================
-- blood_requests: add drop location (delivery destination) + delivery leg columns
-- =============================================
ALTER TABLE blood_requests ADD COLUMN drop_address VARCHAR(500) DEFAULT NULL AFTER hospital_name;
ALTER TABLE blood_requests ADD COLUMN drop_latitude DECIMAL(10, 8) DEFAULT NULL AFTER drop_address;
ALTER TABLE blood_requests ADD COLUMN drop_longitude DECIMAL(11, 8) DEFAULT NULL AFTER drop_latitude;

ALTER TABLE blood_requests ADD COLUMN delivery_distance_km DECIMAL(8, 2) NOT NULL DEFAULT 0.00 AFTER total_amount;
ALTER TABLE blood_requests ADD COLUMN delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00 AFTER delivery_distance_km;
ALTER TABLE blood_requests ADD COLUMN delivery_partner_id INT DEFAULT NULL AFTER delivery_fee;
ALTER TABLE blood_requests ADD COLUMN delivery_request_id INT DEFAULT NULL AFTER delivery_partner_id;

-- =============================================
-- admin_config: blood delivery pricing/search settings
-- =============================================
INSERT INTO admin_config (config_key, config_value, description) VALUES
('blood_delivery_per_km_charge', '15', 'Per km charge for blood delivery partners in rupees'),
('blood_delivery_search_radius_km', '5', 'Radius in km to search nearby blood delivery partners'),
('blood_delivery_admin_commission_percent', '2', 'Admin commission percent on blood delivery fee');
