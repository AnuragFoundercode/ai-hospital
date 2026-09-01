-- =============================================
-- Ambulance Partner bank details (step 4)
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_bank_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ambulance_service_id INT NOT NULL,
  account_holder_name VARCHAR(150) NOT NULL,
  bank_name VARCHAR(150) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  ifsc_code VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ambulance_bank (ambulance_service_id),
  FOREIGN KEY (ambulance_service_id) REFERENCES ambulance_services(id) ON DELETE CASCADE
);
