-- Centralized admin commission/profit ledger.
-- One row per commission-earning event across all modules.
CREATE TABLE IF NOT EXISTS admin_commissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module VARCHAR(30) NOT NULL,
  reference_type VARCHAR(40) DEFAULT NULL,
  reference_id INT DEFAULT NULL,
  reference_code VARCHAR(50) DEFAULT NULL,
  user_id INT DEFAULT NULL,
  vendor_type VARCHAR(40) DEFAULT NULL,
  vendor_id INT DEFAULT NULL,
  gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_module (module),
  INDEX idx_user (user_id),
  INDEX idx_vendor (vendor_type, vendor_id),
  INDEX idx_ref (reference_type, reference_id),
  INDEX idx_created (created_at)
);
