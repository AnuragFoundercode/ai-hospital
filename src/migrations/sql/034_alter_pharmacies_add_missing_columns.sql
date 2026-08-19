ALTER TABLE pharmacies ADD COLUMN about_description TEXT DEFAULT NULL AFTER profile_photo;
ALTER TABLE pharmacies ADD COLUMN license_number VARCHAR(100) DEFAULT NULL AFTER about_description;
ALTER TABLE pharmacies ADD COLUMN landmark VARCHAR(255) DEFAULT NULL AFTER address_line2;
ALTER TABLE pharmacies ADD COLUMN zone_id INT DEFAULT NULL AFTER pincode;
ALTER TABLE pharmacies ADD COLUMN delivery_charge DECIMAL(10, 2) DEFAULT 0.00 AFTER delivery_radius_km;
ALTER TABLE pharmacies ADD COLUMN free_delivery_above DECIMAL(10, 2) DEFAULT 500.00 AFTER delivery_charge;
ALTER TABLE pharmacies ADD COLUMN admin_commission_percent DECIMAL(5, 2) DEFAULT 10.00 AFTER free_delivery_above;
ALTER TABLE pharmacies ADD INDEX idx_pincode (pincode);
