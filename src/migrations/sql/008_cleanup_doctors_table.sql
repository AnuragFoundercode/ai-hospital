-- Remove duplicate columns from doctors table

-- profile_photo_url duplicate hai, profile_photo use karenge
ALTER TABLE doctors DROP COLUMN profile_photo_url;

-- languages duplicate hai, spoken_languages use karenge  
ALTER TABLE doctors DROP COLUMN languages;

-- password_hash not needed (OTP based login)
ALTER TABLE doctors DROP COLUMN password_hash
