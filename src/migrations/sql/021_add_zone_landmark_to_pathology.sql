ALTER TABLE pathology_labs ADD COLUMN landmark VARCHAR(255) DEFAULT NULL AFTER address_line2;
ALTER TABLE pathology_labs ADD COLUMN zone_id INT DEFAULT NULL AFTER pincode
