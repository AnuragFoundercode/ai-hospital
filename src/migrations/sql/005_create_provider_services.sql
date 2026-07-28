-- =============================================
-- PHARMACY INVENTORY (what each pharmacy stocks & prices)
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pharmacy_id INT NOT NULL,
  medicine_id INT NOT NULL,
  selling_price DECIMAL(10, 2) NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT 0.00,
  stock_quantity INT DEFAULT 0,
  batch_number VARCHAR(50) DEFAULT NULL,
  expiry_date DATE DEFAULT NULL,
  is_available TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
  UNIQUE KEY unique_pharmacy_medicine (pharmacy_id, medicine_id, batch_number),
  INDEX idx_pharmacy (pharmacy_id),
  INDEX idx_medicine (medicine_id),
  INDEX idx_expiry (expiry_date)
);

-- =============================================
-- LAB TEST PRICING (per pathology lab)
-- =============================================
CREATE TABLE IF NOT EXISTS lab_test_pricing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pathology_lab_id INT NOT NULL,
  test_id INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT 0.00,
  report_delivery_hours INT DEFAULT 24,
  is_available TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pathology_lab_id) REFERENCES pathology_labs(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id) REFERENCES lab_tests(id) ON DELETE CASCADE,
  UNIQUE KEY unique_lab_test (pathology_lab_id, test_id),
  INDEX idx_lab (pathology_lab_id),
  INDEX idx_test (test_id)
);

-- =============================================
-- LAB PACKAGE PRICING (per pathology lab)
-- =============================================
CREATE TABLE IF NOT EXISTS lab_package_pricing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pathology_lab_id INT NOT NULL,
  package_id INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT 0.00,
  is_available TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pathology_lab_id) REFERENCES pathology_labs(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES lab_test_packages(id) ON DELETE CASCADE,
  UNIQUE KEY unique_lab_package (pathology_lab_id, package_id),
  INDEX idx_lab (pathology_lab_id)
);

-- =============================================
-- DIAGNOSTIC SERVICE PRICING (per diagnostic center)
-- =============================================
CREATE TABLE IF NOT EXISTS diagnostic_service_pricing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diagnostic_center_id INT NOT NULL,
  service_id INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT 0.00,
  duration_minutes INT DEFAULT 30,
  is_available TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES diagnostic_services(id) ON DELETE CASCADE,
  UNIQUE KEY unique_center_service (diagnostic_center_id, service_id),
  INDEX idx_center (diagnostic_center_id),
  INDEX idx_service (service_id)
);

-- =============================================
-- DOCTOR AVAILABILITY SLOTS
-- =============================================
CREATE TABLE IF NOT EXISTS doctor_availability (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT NOT NULL,
  day_of_week ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes INT DEFAULT 15,
  consultation_type ENUM('online', 'offline', 'both') DEFAULT 'both',
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  INDEX idx_doctor (doctor_id),
  INDEX idx_day (day_of_week)
)
