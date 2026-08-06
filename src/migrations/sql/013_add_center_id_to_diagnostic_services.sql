ALTER TABLE diagnostic_services ADD COLUMN center_id INT DEFAULT NULL AFTER id;
ALTER TABLE diagnostic_services ADD INDEX idx_center_id (center_id)
