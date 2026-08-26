ALTER TABLE ambulance_partners ADD COLUMN zone_id INT DEFAULT NULL AFTER insurance_url;
ALTER TABLE ambulance_partners ADD COLUMN owner_name VARCHAR(150) DEFAULT NULL AFTER name;
