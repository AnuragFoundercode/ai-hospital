-- =============================================
-- Distance-based delivery fee + delivery-partner admin commission
-- delivery_fee = per_km_rate * distance_km
-- partner_earning = delivery_fee - (delivery_fee * admin_commission_percent/100)
-- =============================================

-- Delivery partner commission % (deducted from delivery fee before crediting wallet)
ALTER TABLE delivery_partners
  ADD COLUMN IF NOT EXISTS admin_commission_percent DECIMAL(5,2) NOT NULL DEFAULT 2.00 AFTER total_earned;

-- pharmacy_orders: persist distance-based delivery breakdown
ALTER TABLE pharmacy_orders
  ADD COLUMN IF NOT EXISTS delivery_distance_km DECIMAL(8,2) NOT NULL DEFAULT 0.00 AFTER delivery_charge;
ALTER TABLE pharmacy_orders
  ADD COLUMN IF NOT EXISTS delivery_partner_earning DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER delivery_distance_km;
ALTER TABLE pharmacy_orders
  ADD COLUMN IF NOT EXISTS delivery_admin_commission DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER delivery_partner_earning;

-- delivery_requests: store gross delivery fee + commission alongside net earning
ALTER TABLE delivery_requests
  ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER per_km_charge;
ALTER TABLE delivery_requests
  ADD COLUMN IF NOT EXISTS admin_commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER delivery_fee;
ALTER TABLE delivery_requests
  ADD COLUMN IF NOT EXISTS admin_commission DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER admin_commission_percent;

-- delivery_wallet_transactions: record commission taken from the delivery fee
ALTER TABLE delivery_wallet_transactions
  ADD COLUMN IF NOT EXISTS admin_commission DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER reference_id;

-- Global per-km rate default already seeded as 'delivery_per_km_charge'.
-- Add a global fallback delivery commission % (used if partner has none / for reference).
INSERT INTO admin_config (config_key, config_value, description)
SELECT 'delivery_admin_commission_percent', '2', 'Default admin commission percent on delivery fee'
WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE config_key = 'delivery_admin_commission_percent');
