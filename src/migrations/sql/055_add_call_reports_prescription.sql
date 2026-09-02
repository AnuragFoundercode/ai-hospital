-- =============================================
-- Reports (uploaded by user) + Prescription/notes (uploaded by doctor) for a call
-- Stored as JSON arrays of { url, name, uploaded_at }
-- =============================================
ALTER TABLE doctor_calls ADD COLUMN user_reports JSON DEFAULT NULL AFTER doctor_earning;
ALTER TABLE doctor_calls ADD COLUMN prescriptions JSON DEFAULT NULL AFTER user_reports;
ALTER TABLE doctor_calls ADD COLUMN doctor_notes TEXT DEFAULT NULL AFTER prescriptions;
ALTER TABLE doctor_calls ADD COLUMN diagnosis VARCHAR(500) DEFAULT NULL AFTER doctor_notes;
