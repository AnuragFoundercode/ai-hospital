ALTER TABLE ambulance_services ADD COLUMN is_online TINYINT(1) DEFAULT 0 AFTER is_active;
ALTER TABLE ambulance_services ADD COLUMN latitude DECIMAL(10, 8) DEFAULT NULL AFTER base_longitude;
ALTER TABLE ambulance_services ADD COLUMN longitude DECIMAL(11, 8) DEFAULT NULL AFTER latitude;
ALTER TABLE ambulance_services ADD COLUMN last_location_update DATETIME DEFAULT NULL AFTER longitude;
