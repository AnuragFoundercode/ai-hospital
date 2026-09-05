-- =============================================
-- Add reference_code (public id like ORD-.., CALL-.., BK-..) to notifications
-- so the client can deep-link straight to the right screen on tap.
-- =============================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS reference_code VARCHAR(100) DEFAULT NULL AFTER reference_id;
