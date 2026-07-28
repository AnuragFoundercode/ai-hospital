-- =============================================
-- WALLETS (for patients)
-- =============================================
CREATE TABLE IF NOT EXISTS wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wallet_id INT NOT NULL,
  user_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('recharge', 'booking_payment', 'refund', 'cashback', 'admin_credit') DEFAULT NULL,
  reference_id INT DEFAULT NULL,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_by_type ENUM('user', 'admin', 'system') DEFAULT 'system',
  created_by_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_transactions (user_id),
  INDEX idx_wallet_id (wallet_id),
  INDEX idx_reference (reference_type, reference_id)
);

-- =============================================
-- NOTIFICATIONS LOG
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient_type ENUM('user', 'doctor', 'pharmacy', 'pathology_lab', 'blood_bank', 'diagnostic_center', 'ambulance_service', 'partner', 'admin') NOT NULL,
  recipient_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  type ENUM('booking', 'payment', 'order', 'report', 'ambulance', 'promotional', 'system') DEFAULT 'system',
  reference_type VARCHAR(50) DEFAULT NULL,
  reference_id INT DEFAULT NULL,
  is_read TINYINT(1) DEFAULT 0,
  sent_via ENUM('push', 'sms', 'both') DEFAULT 'push',
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME DEFAULT NULL,
  INDEX idx_recipient (recipient_type, recipient_id),
  INDEX idx_is_read (is_read)
)
