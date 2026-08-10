ALTER TABLE diagnostic_service_pricing ADD COLUMN booking_type ENUM('walk_in', 'appointment') DEFAULT 'appointment' AFTER is_available;
ALTER TABLE diagnostic_service_pricing ADD COLUMN slot_duration_minutes_config INT DEFAULT 30 AFTER booking_type;
ALTER TABLE diagnostic_service_pricing ADD COLUMN working_days VARCHAR(100) DEFAULT 'mon,tue,wed,thu,fri,sat' AFTER slot_duration_minutes_config;
ALTER TABLE diagnostic_service_pricing ADD COLUMN working_hours_from TIME DEFAULT '08:00:00' AFTER working_days;
ALTER TABLE diagnostic_service_pricing ADD COLUMN working_hours_to TIME DEFAULT '20:00:00' AFTER working_hours_from;
ALTER TABLE diagnostic_service_pricing ADD COLUMN break_from TIME DEFAULT NULL AFTER working_hours_to;
ALTER TABLE diagnostic_service_pricing ADD COLUMN break_to TIME DEFAULT NULL AFTER break_from
