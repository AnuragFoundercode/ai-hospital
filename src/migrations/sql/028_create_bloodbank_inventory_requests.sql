-- =============================================
-- BLOOD BANK INVENTORY (available blood units per group)
-- =============================================
CREATE TABLE IF NOT EXISTS bloodbank_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blood_bank_id INT NOT NULL,
  blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  available_units INT DEFAULT 0,
  price_per_unit DECIMAL(10, 2) DEFAULT 0.00,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id) ON DELETE CASCADE,
  UNIQUE KEY unique_bank_group (blood_bank_id, blood_group),
  INDEX idx_bank (blood_bank_id)
);

-- =============================================
-- BLOOD REQUESTS (user requests blood from a blood bank)
-- =============================================
CREATE TABLE IF NOT EXISTS blood_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(30) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  blood_bank_id INT NOT NULL,
  
  -- Patient info
  patient_name VARCHAR(150) NOT NULL,
  patient_age INT NOT NULL,
  patient_gender ENUM('male', 'female', 'other') NOT NULL,
  hospital_name VARCHAR(200) NOT NULL,
  
  -- Blood requirement
  blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  units_required INT NOT NULL DEFAULT 1,
  required_date DATE NOT NULL,
  reason TEXT DEFAULT NULL,
  
  -- Attendant
  attendant_name VARCHAR(150) NOT NULL,
  attendant_mobile VARCHAR(15) NOT NULL,
  
  -- Documents (Cloudinary URLs)
  doctor_prescription_url VARCHAR(500) DEFAULT NULL,
  blood_requirement_letter_url VARCHAR(500) DEFAULT NULL,
  patient_id_proof_url VARCHAR(500) DEFAULT NULL,
  
  -- Pricing
  price_per_unit DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  
  -- Payment
  payment_method ENUM('online', 'offline') DEFAULT 'online',
  payment_status ENUM('unpaid', 'paid', 'refund_initiated', 'refunded', 'failed') DEFAULT 'unpaid',
  transaction_id VARCHAR(100) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  
  -- Status
  status ENUM('pending', 'confirmed', 'ready', 'completed', 'rejected', 'cancelled') DEFAULT 'pending',
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id),
  INDEX idx_user (user_id),
  INDEX idx_bank (blood_bank_id),
  INDEX idx_status (status),
  INDEX idx_request_id (request_id)
);
