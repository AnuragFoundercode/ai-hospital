ALTER TABLE diagnostic_centers ADD COLUMN zone_id INT DEFAULT NULL AFTER pincode;
ALTER TABLE diagnostic_centers ADD INDEX idx_zone_id (zone_id)
