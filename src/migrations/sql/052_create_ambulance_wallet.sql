-- =============================================
-- AMBULANCE PARTNER WALLET
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ambulance_service_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (ambulance_service_id) REFERENCES ambulance_services(id) ON DELETE CASCADE
);

-- =============================================
-- AMBULANCE WALLET TRANSACTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ambulance_service_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('trip_earning', 'withdrawal', 'bonus', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ambulance_service_id) REFERENCES ambulance_services(id),
  INDEX idx_amb (ambulance_service_id),
  INDEX idx_type (type)
);

-- =============================================
-- AMBULANCE WITHDRAWALS
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ambulance_service_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (ambulance_service_id) REFERENCES ambulance_services(id),
  INDEX idx_amb (ambulance_service_id),
  INDEX idx_status (status)
);
