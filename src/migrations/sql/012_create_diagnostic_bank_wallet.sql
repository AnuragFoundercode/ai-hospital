CREATE TABLE IF NOT EXISTS diagnostic_bank_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diagnostic_center_id INT NOT NULL UNIQUE,
  account_holder_name VARCHAR(150) NOT NULL,
  bank_name VARCHAR(150) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  ifsc_code VARCHAR(15) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id) ON DELETE CASCADE
)
