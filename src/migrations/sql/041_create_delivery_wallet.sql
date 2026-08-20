-- =============================================
-- DELIVERY PARTNER WALLET
-- =============================================
CREATE TABLE IF NOT EXISTS delivery_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_partner_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_partner_id) REFERENCES delivery_partners(id) ON DELETE CASCADE
);

-- =============================================
-- DELIVERY WALLET TRANSACTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS delivery_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_partner_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('delivery_earning', 'withdrawal', 'bonus', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_partner_id) REFERENCES delivery_partners(id),
  INDEX idx_partner (delivery_partner_id),
  INDEX idx_type (type)
);

-- =============================================
-- DELIVERY WITHDRAWALS
-- =============================================
CREATE TABLE IF NOT EXISTS delivery_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_partner_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_partner_id) REFERENCES delivery_partners(id),
  INDEX idx_partner (delivery_partner_id),
  INDEX idx_status (status)
);
