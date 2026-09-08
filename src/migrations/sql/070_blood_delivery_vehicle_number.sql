-- =============================================
-- Blood delivery: add vehicle_number (number plate), drop rider_selfie_url
-- (profile_photo from step1 is used as the rider photo instead)
-- =============================================
ALTER TABLE blood_delivery_partners ADD COLUMN vehicle_number VARCHAR(20) DEFAULT NULL AFTER vehicle_type_id;
ALTER TABLE blood_delivery_partners DROP COLUMN rider_selfie_url;
