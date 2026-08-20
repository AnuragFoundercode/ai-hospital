CREATE TABLE IF NOT EXISTS vehicle_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon_url VARCHAR(255) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO vehicle_types (name) VALUES ('Bike'), ('Scooter'), ('Bicycle'), ('EV (Electric)');

-- Change delivery_partners vehicle_type from ENUM to INT (FK)
ALTER TABLE delivery_partners ADD COLUMN vehicle_type_id INT DEFAULT NULL AFTER rider_selfie_url;
