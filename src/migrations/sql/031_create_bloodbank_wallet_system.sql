-- =============================================
-- ADD ADMIN COMMISSION TO BLOOD BANKS TABLE
-- =============================================
ALTER TABLE blood_banks ADD COLUMN admin_commission_percent DECIMAL(5, 2) DEFAULT 15.00 AFTER about_description;

-- =============================================
-- BLOOD BANK WALLET
-- =============================================
CREATE TABLE IF NOT EXISTS bloodbank_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blood_bank_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id) ON DELETE CASCADE
);

-- =============================================
-- BLOOD BANK WALLET TRANSACTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS bloodbank_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blood_bank_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('blood_request_fee', 'withdrawal', 'refund_deduction', 'bonus', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  admin_commission DECIMAL(10, 2) DEFAULT 0.00,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id),
  INDEX idx_bank (blood_bank_id),
  INDEX idx_type (type),
  INDEX idx_ref (reference_type)
);

-- =============================================
-- BLOOD BANK WITHDRAWAL REQUESTS
-- =============================================
CREATE TABLE IF NOT EXISTS bloodbank_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blood_bank_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id),
  INDEX idx_bank (blood_bank_id),
  INDEX idx_status (status)
);
