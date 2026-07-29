-- Add category_id to doctors table (links to doctor_categories)
ALTER TABLE doctors ADD COLUMN category_id INT DEFAULT NULL AFTER specialization;
ALTER TABLE doctors ADD INDEX idx_category_id (category_id);
ALTER TABLE doctors ADD CONSTRAINT fk_doctor_category FOREIGN KEY (category_id) REFERENCES doctor_categories(id) ON DELETE SET NULL
