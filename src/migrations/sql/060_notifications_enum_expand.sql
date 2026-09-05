-- =============================================
-- Expand notifications enums so every recipient type + event can be persisted
-- =============================================

-- Add delivery_partner + sample_collector as recipients
ALTER TABLE notifications
  MODIFY COLUMN recipient_type ENUM(
    'user','doctor','pharmacy','pathology_lab','blood_bank','diagnostic_center',
    'ambulance_service','delivery_partner','sample_collector','partner','admin'
  ) NOT NULL;

-- Add 'call' event type (video consultation events)
ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    'booking','payment','order','call','report','ambulance','promotional','system'
  ) DEFAULT 'system';
