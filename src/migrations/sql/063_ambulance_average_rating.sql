-- =============================================
-- Ambulance services were missing an average_rating column,
-- so unified vendor reviews could not update/recompute their rating.
-- =============================================

ALTER TABLE ambulance_services
  ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3,2) DEFAULT 0.00 AFTER per_km_charge;
