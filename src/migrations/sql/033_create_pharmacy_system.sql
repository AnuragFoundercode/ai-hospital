-- =============================================
-- PHARMACIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  owner_name VARCHAR(100) NOT NULL,
  mobile VARCHAR(15) NOT NULL UNIQUE,
  email VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  profile_photo VARCHAR(255) DEFAULT NULL,
  about_description TEXT DEFAULT NULL,
  
  -- Business Details
  license_number VARCHAR(100) NOT NULL,
  gst_number VARCHAR(20) DEFAULT NULL,
  pan_number VARCHAR(15) DEFAULT NULL,
  drug_license_url VARCHAR(255) DEFAULT NULL,
  gst_certificate_url VARCHAR(255) DEFAULT NULL,
  pan_card_url VARCHAR(255) DEFAULT NULL,
  
  -- Address
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) DEFAULT NULL,
  landmark VARCHAR(255) DEFAULT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  zone_id INT DEFAULT NULL,
  latitude DECIMAL(10, 8) DEFAULT NULL,
  longitude DECIMAL(11, 8) DEFAULT NULL,
  
  -- Operations
  is_24hours TINYINT(1) DEFAULT 0,
  opening_time TIME DEFAULT NULL,
  closing_time TIME DEFAULT NULL,
  delivery_available TINYINT(1) DEFAULT 1,
  delivery_radius_km DECIMAL(5, 2) DEFAULT 5.00,
  delivery_charge DECIMAL(10, 2) DEFAULT 0.00,
  free_delivery_above DECIMAL(10, 2) DEFAULT 500.00,
  
  -- Commission & Verification
  admin_commission_percent DECIMAL(5, 2) DEFAULT 10.00,
  is_verified TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  verification_status ENUM('pending', 'under_review', 'approved', 'rejected') DEFAULT 'pending',
  verified_at DATETIME DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  average_rating DECIMAL(3, 2) DEFAULT 0.00,
  fcm_token VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile),
  INDEX idx_uuid (uuid),
  INDEX idx_city (city),
  INDEX idx_pincode (pincode)
);

-- =============================================
-- MEDICINE CATEGORIES
-- =============================================
CREATE TABLE IF NOT EXISTS medicine_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon_url VARCHAR(255) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- MEDICINE BRANDS
-- =============================================
CREATE TABLE IF NOT EXISTS medicine_brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- PHARMACY MEDICINES (per pharmacy inventory)
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pharmacy_id INT NOT NULL,
  
  -- Basic Info
  name VARCHAR(200) NOT NULL,
  generic_name VARCHAR(200) DEFAULT NULL,
  category_id INT DEFAULT NULL,
  brand_id INT DEFAULT NULL,
  manufacturer VARCHAR(150) DEFAULT NULL,
  short_description TEXT DEFAULT NULL,
  
  -- Pricing
  purchase_price DECIMAL(10, 2) DEFAULT 0.00,
  mrp DECIMAL(10, 2) NOT NULL,
  selling_price DECIMAL(10, 2) NOT NULL,
  gst_percent DECIMAL(5, 2) DEFAULT 0.00,
  
  -- Inventory
  quantity INT DEFAULT 0,
  batch_number VARCHAR(50) DEFAULT NULL,
  expiry_date DATE DEFAULT NULL,
  low_stock_alert INT DEFAULT 10,
  
  -- Medicine Details
  prescription_required TINYINT(1) DEFAULT 0,
  salt_composition VARCHAR(500) DEFAULT NULL,
  dosage VARCHAR(255) DEFAULT NULL,
  uses TEXT DEFAULT NULL,
  how_to_use TEXT DEFAULT NULL,
  side_effects TEXT DEFAULT NULL,
  storage_instructions VARCHAR(255) DEFAULT NULL,
  
  -- Images (Cloudinary URLs)
  medicine_image_url VARCHAR(500) DEFAULT NULL,
  strip_image_url VARCHAR(500) DEFAULT NULL,
  additional_images JSON DEFAULT NULL,
  
  -- Status
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES medicine_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (brand_id) REFERENCES medicine_brands(id) ON DELETE SET NULL,
  INDEX idx_pharmacy (pharmacy_id),
  INDEX idx_category (category_id),
  INDEX idx_name (name),
  INDEX idx_prescription (prescription_required)
);

-- =============================================
-- PHARMACY CART (user adds medicines from same pharmacy)
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_cart (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  pharmacy_id INT NOT NULL,
  medicine_id INT NOT NULL,
  quantity INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES pharmacy_medicines(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_medicine (user_id, medicine_id),
  INDEX idx_user (user_id),
  INDEX idx_user_pharmacy (user_id, pharmacy_id)
);

-- =============================================
-- PHARMACY ORDERS
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(30) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  pharmacy_id INT NOT NULL,
  
  -- Status
  status ENUM('pending', 'accepted', 'prescription_pending', 'packing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'rejected') DEFAULT 'pending',
  cancellation_reason VARCHAR(500) DEFAULT NULL,
  cancelled_by ENUM('user', 'pharmacy', 'admin') DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  
  -- Items
  items JSON NOT NULL,
  total_items INT DEFAULT 0,
  
  -- Prescription
  prescription_url VARCHAR(500) DEFAULT NULL,
  prescription_required TINYINT(1) DEFAULT 0,
  
  -- Pricing
  base_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(10, 2) DEFAULT 0.00,
  delivery_charge DECIMAL(10, 2) DEFAULT 0.00,
  tax_amount DECIMAL(10, 2) DEFAULT 0.00,
  final_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  
  -- Payment
  payment_method ENUM('online', 'cod') DEFAULT 'online',
  payment_status ENUM('unpaid', 'paid', 'refund_initiated', 'refunded', 'failed') DEFAULT 'unpaid',
  transaction_id VARCHAR(100) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  
  -- Delivery
  delivery_address JSON DEFAULT NULL,
  remark TEXT DEFAULT NULL,
  
  -- Rating
  user_rating DECIMAL(2, 1) DEFAULT NULL,
  user_review TEXT DEFAULT NULL,
  rated_at DATETIME DEFAULT NULL,
  
  -- Timestamps
  accepted_at DATETIME DEFAULT NULL,
  packed_at DATETIME DEFAULT NULL,
  ready_at DATETIME DEFAULT NULL,
  dispatched_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,
  cancelled_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  INDEX idx_order_id (order_id),
  INDEX idx_user (user_id),
  INDEX idx_pharmacy (pharmacy_id),
  INDEX idx_status (status)
);

-- =============================================
-- PHARMACY WALLET
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pharmacy_id INT NOT NULL UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0.00,
  total_earned DECIMAL(10, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE
);

-- =============================================
-- PHARMACY WALLET TRANSACTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pharmacy_id INT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  reference_type ENUM('order_fee', 'withdrawal', 'refund_deduction', 'bonus', 'adjustment') NOT NULL,
  reference_id INT DEFAULT NULL,
  admin_commission DECIMAL(10, 2) DEFAULT 0.00,
  balance_after DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  INDEX idx_pharmacy (pharmacy_id)
);

-- =============================================
-- PHARMACY WITHDRAWALS
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pharmacy_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'processed') DEFAULT 'pending',
  remarks VARCHAR(500) DEFAULT NULL,
  admin_remarks VARCHAR(500) DEFAULT NULL,
  processed_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  INDEX idx_pharmacy (pharmacy_id),
  INDEX idx_status (status)
);

-- =============================================
-- PHARMACY BANK DETAILS
-- =============================================
CREATE TABLE IF NOT EXISTS pharmacy_bank_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pharmacy_id INT NOT NULL UNIQUE,
  account_holder_name VARCHAR(150) NOT NULL,
  bank_name VARCHAR(150) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  ifsc_code VARCHAR(15) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE
);

-- =============================================
-- SEED MEDICINE CATEGORIES
-- =============================================
INSERT INTO medicine_categories (name, sort_order) VALUES
('Pain Relief', 1),
('Antibiotics', 2),
('Vitamins', 3),
('Liver Care', 4),
('Stomach Care', 5),
('Allergy', 6),
('Diabetes', 7),
('Heart Care', 8),
('Skin Care', 9),
('Eye Care', 10);

-- =============================================
-- SEED MEDICINE BRANDS
-- =============================================
INSERT INTO medicine_brands (name) VALUES
('Micro Labs'), ('GSK'), ('Cipla'), ('Sun Pharma'), ('Himalaya'),
('Abbott'), ('Mankind'), ('Torrent'), ('Zydus'), ('Dr. Reddy''s');
