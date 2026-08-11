-- Add admin commission column to diagnostic_centers (default 10%)
ALTER TABLE diagnostic_centers ADD COLUMN admin_commission_percent DECIMAL(5,2) DEFAULT 10.00 AFTER average_rating;

-- DIAGNOSTIC WALLET
CREATE TABLE IF NOT EXISTS diagnostic_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diagnostic_center_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_online_collection DECIMAL(10, 2) DEFAULT 0.00,
  total_offline_collection DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  total_admin_due DECIMAL(10, 2) DEFAULT 0.00,
  total_admin_due_paid DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id) ON DELETE CASCADE
);

-- DIAGNOSTIC WALLET TRANSACTIONS
CREATE TABLE IF NOT EXISTS diagnostic_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diagnostic_center_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('online_booking', 'offline_booking', 'withdrawal', 'admin_due_payment', 'refund_deduction', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id),
  INDEX idx_center (diagnostic_center_id)
);

-- DIAGNOSTIC ADMIN DUE RECORDS
CREATE TABLE IF NOT EXISTS diagnostic_admin_dues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diagnostic_center_id INT NOT NULL,
  booking_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  commission_percent DECIMAL(5, 2) NOT NULL,
  booking_amount DECIMAL(10, 2) NOT NULL,
  payment_type ENUM('online', 'offline') NOT NULL,
  is_paid TINYINT(1) DEFAULT 0,
  paid_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id),
  INDEX idx_center (diagnostic_center_id),
  INDEX idx_paid (is_paid)
);

-- DIAGNOSTIC WITHDRAWALS
CREATE TABLE IF NOT EXISTS diagnostic_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diagnostic_center_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id),
  INDEX idx_center (diagnostic_center_id),
  INDEX idx_status (status)
)
