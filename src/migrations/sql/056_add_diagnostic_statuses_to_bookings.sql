-- =============================================
-- Add diagnostic scan workflow statuses to bookings.status
-- so the actual status is stored (single status field, no mapping to in_progress)
-- =============================================
ALTER TABLE bookings MODIFY COLUMN status ENUM(
  'pending',
  'confirmed',
  'assigned',
  'collector_assigned',
  'collector_reached',
  'sample_collected',
  'patient_arrived',
  'scan_started',
  'scan_completed',
  'report_uploaded',
  'in_progress',
  'completed',
  'cancelled',
  'failed'
) NOT NULL DEFAULT 'pending';
