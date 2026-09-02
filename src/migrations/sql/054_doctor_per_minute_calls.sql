-- =============================================
-- Convert doctor from consultation-fee/slot model to PER-MINUTE VIDEO CALL model
-- =============================================

-- 3-state call status (online / offline / busy)
ALTER TABLE doctors ADD COLUMN call_status ENUM('online','offline','busy') DEFAULT 'offline' AFTER verification_status;

-- Per-minute fee (replaces consultation_fee / follow_up_fee)
ALTER TABLE doctors ADD COLUMN per_minute_fee DECIMAL(10,2) DEFAULT 0.00 AFTER call_status;

-- Drop old fee + availability columns
ALTER TABLE doctors DROP COLUMN consultation_fee;
ALTER TABLE doctors DROP COLUMN follow_up_fee;
ALTER TABLE doctors DROP COLUMN is_available_online;

-- Drop slot/availability table (no longer used)
DROP TABLE IF EXISTS doctor_availability;

-- Extend wallet transaction enums for call earnings/charges
ALTER TABLE doctor_wallet_transactions MODIFY COLUMN reference_type ENUM('consultation_fee','call_earning','withdrawal','refund_deduction','bonus','adjustment') NOT NULL;
ALTER TABLE wallet_transactions MODIFY COLUMN reference_type ENUM('recharge','booking_payment','call_charge','refund','cashback','admin_credit') DEFAULT NULL;

-- =============================================
-- DOCTOR CALL SESSIONS (per-minute video calls)
-- =============================================
CREATE TABLE IF NOT EXISTS doctor_calls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  call_id VARCHAR(40) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  doctor_id INT NOT NULL,
  channel_name VARCHAR(100) NOT NULL,
  per_minute_fee DECIMAL(10,2) NOT NULL,
  status ENUM('ringing','ongoing','completed','rejected','missed','cancelled') DEFAULT 'ringing',
  total_minutes INT DEFAULT 0,
  total_charged DECIMAL(10,2) DEFAULT 0.00,
  doctor_earning DECIMAL(10,2) DEFAULT 0.00,
  admin_commission DECIMAL(10,2) DEFAULT 0.00,
  started_at DATETIME DEFAULT NULL,
  ended_at DATETIME DEFAULT NULL,
  ended_by ENUM('user','doctor','system') DEFAULT NULL,
  end_reason VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  INDEX idx_user (user_id),
  INDEX idx_doctor (doctor_id),
  INDEX idx_status (status)
);
