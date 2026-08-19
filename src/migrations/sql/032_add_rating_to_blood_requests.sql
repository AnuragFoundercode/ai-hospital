ALTER TABLE blood_requests ADD COLUMN user_rating DECIMAL(2, 1) DEFAULT NULL AFTER rejection_reason;
ALTER TABLE blood_requests ADD COLUMN user_review TEXT DEFAULT NULL AFTER user_rating;
ALTER TABLE blood_requests ADD COLUMN rated_at DATETIME DEFAULT NULL AFTER user_review;
ALTER TABLE blood_banks ADD COLUMN average_rating DECIMAL(3, 2) DEFAULT 0.00 AFTER about_description;
