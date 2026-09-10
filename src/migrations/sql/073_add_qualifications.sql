-- Vendor qualifications: array of { name, url } captured in the documents step.
-- Stored as JSON text (nullable). Applies to the 5 multi-step vendors.
ALTER TABLE doctors ADD COLUMN qualifications TEXT DEFAULT NULL AFTER rejected_steps;
ALTER TABLE delivery_partners ADD COLUMN qualifications TEXT DEFAULT NULL AFTER rejected_steps;
ALTER TABLE blood_delivery_partners ADD COLUMN qualifications TEXT DEFAULT NULL AFTER rejected_steps;
ALTER TABLE sample_collectors ADD COLUMN qualifications TEXT DEFAULT NULL AFTER rejected_steps;
ALTER TABLE ambulance_services ADD COLUMN qualifications TEXT DEFAULT NULL AFTER rejected_steps;
