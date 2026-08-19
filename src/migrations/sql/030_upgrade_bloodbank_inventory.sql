-- =============================================
-- BLOOD BANK INVENTORY ITEMS (Batch level tracking)
-- Each row = 1 batch of blood bags
-- =============================================
CREATE TABLE IF NOT EXISTS bloodbank_inventory_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blood_bank_id INT NOT NULL,
  
  -- Basic Info
  blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  units INT NOT NULL DEFAULT 1,
  blood_type ENUM('whole_blood', 'plasma', 'platelets', 'rbc') DEFAULT 'whole_blood',
  
  -- Batch Info
  batch_number VARCHAR(50) NOT NULL,
  bag_number VARCHAR(50) DEFAULT NULL,
  collection_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  
  -- Storage
  storage_location ENUM('main_refrigerator', 'refrigerator_2', 'mobile_unit') DEFAULT 'main_refrigerator',
  rack_number VARCHAR(30) DEFAULT NULL,
  
  -- Donor (optional)
  donor_id VARCHAR(50) DEFAULT NULL,
  donor_name VARCHAR(150) DEFAULT NULL,
  
  -- Documents (optional)
  test_report_url VARCHAR(500) DEFAULT NULL,
  collection_document_url VARCHAR(500) DEFAULT NULL,
  
  -- Status
  status ENUM('available', 'reserved', 'dispatched', 'expired', 'discarded') DEFAULT 'available',
  remarks TEXT DEFAULT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id) ON DELETE CASCADE,
  INDEX idx_bank (blood_bank_id),
  INDEX idx_group (blood_group),
  INDEX idx_status (status),
  INDEX idx_expiry (expiry_date),
  INDEX idx_batch (batch_number)
);
