-- Allow labs to create their own tests
-- lab_id NULL means admin-created (master), lab_id set means lab-created
ALTER TABLE lab_tests ADD COLUMN lab_id INT DEFAULT NULL AFTER id;
ALTER TABLE lab_tests ADD INDEX idx_lab_id (lab_id)
