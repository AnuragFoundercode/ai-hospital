-- =============================================
-- LAB WALLET
-- =============================================
CREATE TABLE IF NOT EXISTS lab_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lab_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (lab_id) REFERENCES pathology_labs(id) ON DELETE CASCADE
);

-- =============================================
-- LAB WALLET TRANSACTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS lab_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lab_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('test_fee', 'withdrawal', 'refund_deduction', 'bonus', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lab_id) REFERENCES pathology_labs(id),
  INDEX idx_lab (lab_id)
);

-- =============================================
-- LAB WITHDRAWAL REQUESTS
-- =============================================
CREATE TABLE IF NOT EXISTS lab_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lab_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (lab_id) REFERENCES pathology_labs(id),
  INDEX idx_lab (lab_id),
  INDEX idx_status (status)
);

-- =============================================
-- LAB BANK DETAILS
-- =============================================
CREATE TABLE IF NOT EXISTS lab_bank_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lab_id INT NOT NULL UNIQUE,
  account_holder_name VARCHAR(150) NOT NULL,
  bank_name VARCHAR(150) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  ifsc_code VARCHAR(15) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (lab_id) REFERENCES pathology_labs(id) ON DELETE CASCADE
)
