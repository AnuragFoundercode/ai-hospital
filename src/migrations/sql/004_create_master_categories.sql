-- =============================================
-- DOCTOR CATEGORIES (Admin managed)
-- e.g., Physician, ENT, Gynecologist, Surgeon, Cardiologist
-- =============================================
CREATE TABLE IF NOT EXISTS doctor_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  icon_url VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =============================================
-- MEDICINE CATEGORIES (Admin managed)
-- e.g., Antibiotics, Pain Relief, Vitamins, Ayurvedic, Diabetes
-- =============================================
CREATE TABLE IF NOT EXISTS medicine_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INT DEFAULT NULL,
  icon_url VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES medicine_categories(id) ON DELETE SET NULL,
  INDEX idx_parent (parent_id)
);

-- =============================================
-- MEDICINES MASTER
-- e.g., Paracetamol 500mg, Amoxicillin 250mg
-- =============================================
CREATE TABLE IF NOT EXISTS medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  generic_name VARCHAR(200) DEFAULT NULL,
  category_id INT DEFAULT NULL,
  manufacturer VARCHAR(150) DEFAULT NULL,
  composition VARCHAR(500) DEFAULT NULL,
  dosage_form ENUM('tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'powder', 'inhaler', 'other') DEFAULT 'tablet',
  strength VARCHAR(50) DEFAULT NULL,
  pack_size VARCHAR(50) DEFAULT NULL,
  mrp DECIMAL(10, 2) DEFAULT 0.00,
  prescription_required TINYINT(1) DEFAULT 0,
  image_url VARCHAR(255) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES medicine_categories(id) ON DELETE SET NULL,
  INDEX idx_name (name),
  INDEX idx_category (category_id)
);

-- =============================================
-- LAB TEST CATEGORIES (Admin managed)
-- e.g., Blood Test, Urine Test, Thyroid, Diabetes, Liver Function
-- =============================================
CREATE TABLE IF NOT EXISTS lab_test_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INT DEFAULT NULL,
  icon_url VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES lab_test_categories(id) ON DELETE SET NULL,
  INDEX idx_parent (parent_id)
);

-- =============================================
-- LAB TESTS MASTER
-- e.g., CBC, HbA1c, Lipid Profile, Thyroid Panel, Vitamin D
-- =============================================
CREATE TABLE IF NOT EXISTS lab_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category_id INT DEFAULT NULL,
  test_code VARCHAR(50) DEFAULT NULL,
  sample_type ENUM('blood', 'urine', 'stool', 'saliva', 'swab', 'other') DEFAULT 'blood',
  preparation_instructions TEXT DEFAULT NULL,
  report_delivery_hours INT DEFAULT 24,
  home_collection_available TINYINT(1) DEFAULT 1,
  description TEXT DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES lab_test_categories(id) ON DELETE SET NULL,
  INDEX idx_category (category_id)
);

-- =============================================
-- LAB TEST PACKAGES
-- e.g., Full Body Checkup, Heart Health Package, Diabetes Panel
-- =============================================
CREATE TABLE IF NOT EXISTS lab_test_packages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lab_test_package_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  package_id INT NOT NULL,
  test_id INT NOT NULL,
  FOREIGN KEY (package_id) REFERENCES lab_test_packages(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id) REFERENCES lab_tests(id) ON DELETE CASCADE,
  UNIQUE KEY unique_package_test (package_id, test_id)
);

-- =============================================
-- DIAGNOSTIC CATEGORIES (Admin managed)
-- e.g., MRI, CT Scan, X-Ray, Ultrasound, ECG
-- =============================================
CREATE TABLE IF NOT EXISTS diagnostic_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  icon_url VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =============================================
-- DIAGNOSTIC SERVICES MASTER
-- e.g., Brain MRI, Chest X-Ray, Abdominal Ultrasound, Full Body CT
-- =============================================
CREATE TABLE IF NOT EXISTS diagnostic_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category_id INT DEFAULT NULL,
  description TEXT DEFAULT NULL,
  preparation_instructions TEXT DEFAULT NULL,
  duration_minutes INT DEFAULT 30,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES diagnostic_categories(id) ON DELETE SET NULL,
  INDEX idx_category (category_id)
);

-- =============================================
-- BLOOD GROUPS (Admin managed)
-- A+, A-, B+, B-, AB+, AB-, O+, O-
-- =============================================
CREATE TABLE IF NOT EXISTS blood_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(10) NOT NULL UNIQUE,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- BLOOD BANK INVENTORY (per blood bank, per group)
-- =============================================
CREATE TABLE IF NOT EXISTS blood_bank_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blood_bank_id INT NOT NULL,
  blood_group_id INT NOT NULL,
  component ENUM('whole_blood', 'packed_rbc', 'platelets', 'plasma', 'cryoprecipitate') DEFAULT 'whole_blood',
  units_available INT DEFAULT 0,
  last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (blood_bank_id) REFERENCES blood_banks(id) ON DELETE CASCADE,
  FOREIGN KEY (blood_group_id) REFERENCES blood_groups(id),
  UNIQUE KEY unique_inventory (blood_bank_id, blood_group_id, component),
  INDEX idx_blood_bank (blood_bank_id)
);

-- =============================================
-- AMBULANCE TYPES (Admin managed)
-- e.g., Basic Life Support (BLS), Advanced Life Support (ALS), Patient Transport
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500) DEFAULT NULL,
  icon_url VARCHAR(255) DEFAULT NULL,
  base_fare DECIMAL(10, 2) DEFAULT 0.00,
  per_km_charge DECIMAL(10, 2) DEFAULT 0.00,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =============================================
-- AMBULANCE VEHICLES (linked to service + type)
-- =============================================
CREATE TABLE IF NOT EXISTS ambulance_vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ambulance_service_id INT NOT NULL,
  ambulance_type_id INT NOT NULL,
  vehicle_number VARCHAR(20) NOT NULL,
  vehicle_model VARCHAR(100) DEFAULT NULL,
  driver_partner_id INT DEFAULT NULL,
  is_available TINYINT(1) DEFAULT 1,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (ambulance_service_id) REFERENCES ambulance_services(id) ON DELETE CASCADE,
  FOREIGN KEY (ambulance_type_id) REFERENCES ambulance_types(id),
  FOREIGN KEY (driver_partner_id) REFERENCES partners(id) ON DELETE SET NULL,
  INDEX idx_service (ambulance_service_id),
  INDEX idx_available (is_available)
)
