-- =============================================
-- Unified vendor reviews
-- A user can review ANY vendor type (doctor, pharmacy, lab, diagnostic, blood bank, ambulance).
-- One review per user per vendor (UNIQUE) — user can later update star + text.
-- =============================================

CREATE TABLE IF NOT EXISTS vendor_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_type ENUM('doctor','pharmacy','pathology_lab','diagnostic_center','blood_bank','ambulance_service') NOT NULL,
  vendor_id INT NOT NULL,
  user_id INT NOT NULL,
  rating DECIMAL(2, 1) NOT NULL,
  review TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_vendor (user_id, vendor_type, vendor_id),
  INDEX idx_vendor (vendor_type, vendor_id),
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
