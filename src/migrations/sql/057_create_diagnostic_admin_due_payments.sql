-- =============================================
-- DIAGNOSTIC ADMIN DUE PAYMENTS
-- Records each time the center clears its pending admin due
-- =============================================
CREATE TABLE IF NOT EXISTS diagnostic_admin_due_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_ref VARCHAR(40) NOT NULL UNIQUE,
  diagnostic_center_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  dues_count INT DEFAULT 0,
  method ENUM('online', 'wallet') DEFAULT 'online',
  status ENUM('pending', 'success', 'failed') DEFAULT 'pending',
  transaction_id VARCHAR(100) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id),
  INDEX idx_center (diagnostic_center_id),
  INDEX idx_status (status)
);
