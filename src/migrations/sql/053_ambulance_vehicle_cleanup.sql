-- =============================================
-- Keep vehicle details ONLY in ambulance_vehicles table.
-- Add missing vehicle-specific columns, drop duplicates from ambulance_services.
-- =============================================

-- Add vehicle-specific date columns to ambulance_vehicles
ALTER TABLE ambulance_vehicles ADD COLUMN vehicle_registration_date DATE DEFAULT NULL AFTER vehicle_model;
ALTER TABLE ambulance_vehicles ADD COLUMN insurance_valid_till DATE DEFAULT NULL AFTER vehicle_registration_date;

-- Allow vehicle_model to be optional (not collected in registration)
ALTER TABLE ambulance_vehicles MODIFY COLUMN vehicle_model VARCHAR(100) DEFAULT NULL;

-- Remove duplicated vehicle columns from ambulance_services (data lives in ambulance_vehicles now)
ALTER TABLE ambulance_services DROP COLUMN ambulance_type_id;
ALTER TABLE ambulance_services DROP COLUMN vehicle_number;
ALTER TABLE ambulance_services DROP COLUMN vehicle_registration_date;
ALTER TABLE ambulance_services DROP COLUMN insurance_valid_till;
