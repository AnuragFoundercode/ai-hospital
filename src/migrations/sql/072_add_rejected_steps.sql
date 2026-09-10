-- =============================================
-- Per-step rejection support for multi-step vendors.
-- rejected_steps = comma-separated step numbers the admin flagged, e.g. "2,3".
-- When a vendor re-submits a rejected step it is removed from this list, and
-- once the list is empty the profile goes back to pending for review.
-- =============================================
ALTER TABLE delivery_partners ADD COLUMN rejected_steps VARCHAR(50) DEFAULT NULL AFTER rejection_reason;
ALTER TABLE blood_delivery_partners ADD COLUMN rejected_steps VARCHAR(50) DEFAULT NULL AFTER rejection_reason;
ALTER TABLE sample_collectors ADD COLUMN rejected_steps VARCHAR(50) DEFAULT NULL AFTER rejection_reason;
ALTER TABLE ambulance_services ADD COLUMN rejected_steps VARCHAR(50) DEFAULT NULL AFTER rejection_reason;
ALTER TABLE doctors ADD COLUMN rejected_steps VARCHAR(50) DEFAULT NULL AFTER rejection_reason;
