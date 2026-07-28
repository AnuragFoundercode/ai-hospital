-- =============================================
-- UNIFIED BOOKINGS TABLE
-- One table for ALL types of bookings
-- service_type + provider_id tells which service & provider
-- =============================================
CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(30) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  
  -- Service identification
  service_type ENUM('doctor_consultation', 'medicine_order', 'pathology_test', 'blood_request', 'diagnostic_scan', 'ambulance') NOT NULL,
  provider_id INT NOT NULL,
  
  -- Assigned partner (delivery boy, sample collector, driver)
  partner_id INT DEFAULT NULL,
  
  -- Booking Status
  status ENUM('pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled', 'failed') NOT NULL DEFAULT 'pending',
  cancellation_reason VARCHAR(500) DEFAULT NULL,
  cancelled_by ENUM('user', 'provider', 'admin', 'system') DEFAULT NULL,
  
  -- Schedule
  booking_date DATE DEFAULT NULL,
  slot_start_time TIME DEFAULT NULL,
  slot_end_time TIME DEFAULT NULL,
  
  -- Pricing
  base_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(10, 2) DEFAULT 0.00,
  tax_amount DECIMAL(10, 2) DEFAULT 0.00,
  delivery_charge DECIMAL(10, 2) DEFAULT 0.00,
  final_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  
  -- Payment
  payment_status ENUM('unpaid', 'paid', 'partial', 'refund_initiated', 'refunded', 'failed') NOT NULL DEFAULT 'unpaid',
  payment_method ENUM('wallet', 'online', 'cod', 'card', 'upi') DEFAULT NULL,
  transaction_id VARCHAR(100) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  
  -- Address (for home services)
  delivery_address_id INT DEFAULT NULL,
  pickup_latitude DECIMAL(10, 8) DEFAULT NULL,
  pickup_longitude DECIMAL(11, 8) DEFAULT NULL,
  
  -- Extra data (service-specific info as JSON)
  metadata JSON DEFAULT NULL,
  
  -- Notes
  user_notes TEXT DEFAULT NULL,
  provider_notes TEXT DEFAULT NULL,
  
  -- Ratings
  user_rating DECIMAL(2, 1) DEFAULT NULL,
  user_review TEXT DEFAULT NULL,
  rated_at DATETIME DEFAULT NULL,
  
  -- Timestamps
  confirmed_at DATETIME DEFAULT NULL,
  started_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  cancelled_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_booking_id (booking_id),
  INDEX idx_user_id (user_id),
  INDEX idx_service_type (service_type),
  INDEX idx_provider (service_type, provider_id),
  INDEX idx_status (status),
  INDEX idx_payment_status (payment_status),
  INDEX idx_booking_date (booking_date),
  INDEX idx_partner_id (partner_id)
);

-- =============================================
-- BOOKING STATUS HISTORY (audit trail)
-- =============================================
CREATE TABLE IF NOT EXISTS booking_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  from_status VARCHAR(30) DEFAULT NULL,
  to_status VARCHAR(30) NOT NULL,
  changed_by_type ENUM('user', 'provider', 'partner', 'admin', 'system') NOT NULL,
  changed_by_id INT DEFAULT NULL,
  remarks VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  INDEX idx_booking_id (booking_id)
)
