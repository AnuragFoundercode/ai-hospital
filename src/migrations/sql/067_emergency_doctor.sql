-- Emergency doctor video-call feature

-- Doctor can be marked available for emergency calls
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_emergency_available TINYINT(1) NOT NULL DEFAULT 0 AFTER call_status;

-- Distinguish normal vs emergency calls + flat-fee tracking + duration cap
ALTER TABLE doctor_calls ADD COLUMN IF NOT EXISTS call_type ENUM('normal','emergency') NOT NULL DEFAULT 'normal' AFTER channel_name;
ALTER TABLE doctor_calls ADD COLUMN IF NOT EXISTS is_free TINYINT(1) NOT NULL DEFAULT 0 AFTER call_type;
ALTER TABLE doctor_calls ADD COLUMN IF NOT EXISTS max_duration_minutes INT DEFAULT NULL AFTER is_free;

-- Admin-defined emergency config
INSERT INTO admin_config (config_key, config_value, description)
SELECT 'emergency_call_is_free', 'true', 'Whether emergency doctor calls are free'
WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE config_key = 'emergency_call_is_free');

INSERT INTO admin_config (config_key, config_value, description)
SELECT 'emergency_call_fee', '0', 'Flat fee for a paid emergency call (rupees)'
WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE config_key = 'emergency_call_fee');

INSERT INTO admin_config (config_key, config_value, description)
SELECT 'emergency_call_duration_minutes', '10', 'Max duration of an emergency call in minutes'
WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE config_key = 'emergency_call_duration_minutes');
