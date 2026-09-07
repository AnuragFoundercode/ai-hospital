-- User credit limit + credit application (loan) flow

ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER abha_number;

CREATE TABLE IF NOT EXISTS credit_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_id VARCHAR(30) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  purpose VARCHAR(255) DEFAULT NULL,
  employment_type VARCHAR(100) DEFAULT NULL,
  monthly_income DECIMAL(12,2) DEFAULT NULL,
  remark TEXT DEFAULT NULL,
  aadhaar_card_url VARCHAR(500) DEFAULT NULL,
  pan_card_url VARCHAR(500) DEFAULT NULL,
  income_proof_url VARCHAR(500) DEFAULT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  admin_remark VARCHAR(500) DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_status (status)
);
