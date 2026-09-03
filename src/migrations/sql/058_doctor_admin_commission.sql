-- =============================================
-- Doctor vendor-style registration: admin commission + nullable signup fields
-- no columns dropped, existing profile fields kept
-- =============================================

-- Admin commission percentage per doctor (applied on doctor call earnings), default 15%
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS admin_commission_percent DECIMAL(5,2) NOT NULL DEFAULT 15.00 AFTER per_minute_fee;

-- registration_number / qualification filled in step 2, not at signup -> make nullable
ALTER TABLE doctors MODIFY COLUMN registration_number VARCHAR(100) NULL;
ALTER TABLE doctors MODIFY COLUMN qualification VARCHAR(255) NULL;
