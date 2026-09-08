-- ============================================================
-- DUMMY SEED for Blood Delivery Partner testing
-- Partner mobile: 9200000001  (OTP: 111111)
-- Run:  /Applications/XAMPP/xamppfiles/bin/mysql -u root ai_hospital < blood_delivery_dummy_seed.sql
-- Cleanup at bottom (commented).
-- ============================================================

-- 1) Blood bank (approved, Lucknow coords)
INSERT INTO blood_banks
  (uuid, name, contact_person, mobile, license_number, address_line1, city, state, pincode, latitude, longitude, is_active, is_verified, admin_commission_percent)
VALUES
  ('demo-bank-uuid-0001', 'Demo Blood Bank', 'Demo Contact', '9200000010', 'DEMO-LIC-001', '1 Demo Road', 'Lucknow', 'UP', '226001', 26.84670000, 80.94620000, 1, 1, 15);

SET @bank_id = LAST_INSERT_ID();

-- 2) Inventory: 3 O+ bags (price 1000), not expired
INSERT INTO bloodbank_inventory_items (blood_bank_id, blood_group, units, price_per_unit, batch_number, bag_number, collection_date, expiry_date, status) VALUES
  (@bank_id, 'O+', 1, 1000, 'DEMO-BATCH-1', 'DEMO-BAG-1', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'reserved'),
  (@bank_id, 'O+', 1, 1000, 'DEMO-BATCH-1', 'DEMO-BAG-2', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'reserved'),
  (@bank_id, 'O+', 1, 1000, 'DEMO-BATCH-1', 'DEMO-BAG-3', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'available');

-- 3) Blood delivery partner (approved, online, near bank)
INSERT INTO blood_delivery_partners
  (uuid, mobile, is_verified_mobile, full_name, email, date_of_birth, gender, profile_photo,
   vehicle_type, vehicle_type_id, vehicle_number, rc_number, dl_number, zone_id,
   aadhaar_front_url, aadhaar_back_url, pan_card_url, driving_licence_url,
   registration_step, verification_status, latitude, longitude, is_online, is_active,
   average_rating, total_deliveries, total_earned, admin_commission_percent)
VALUES
  ('demo-partner-uuid-0001', '9200000001', 1, 'Demo Rider', 'rider@demo.com', '1995-01-01', 'male', 'https://picsum.photos/200',
   'bike', 1, 'UP32AB1234', 'RC12345', 'DL12345', 1,
   'https://picsum.photos/300', 'https://picsum.photos/301', 'https://picsum.photos/302', 'https://picsum.photos/303',
   4, 'approved', 26.84670000, 80.94620000, 1, 1,
   4.50, 1, 22.49, 2.00);

SET @partner_id = LAST_INSERT_ID();

-- 4) Partner bank details
INSERT INTO blood_delivery_bank_details (delivery_partner_id, account_holder_name, bank_name, account_number, ifsc_code)
VALUES (@partner_id, 'Demo Rider', 'SBI', '1234567890', 'SBIN0001');

-- 5) Partner wallet (with some balance) + a credit transaction
INSERT INTO blood_delivery_wallets (delivery_partner_id, balance, total_earned, total_withdrawn)
VALUES (@partner_id, 22.49, 22.49, 0.00);

INSERT INTO blood_delivery_wallet_transactions
  (delivery_partner_id, type, amount, description, reference_type, reference_id, admin_commission, balance_after)
VALUES
  (@partner_id, 'credit', 22.49, 'Blood delivery BDL-DEMO-OLD completed', 'delivery_earning', NULL, 0.46, 22.49);

-- 6) A user's blood request (confirmed + paid, has drop location + delivery fee)
INSERT INTO blood_requests
  (request_id, user_id, blood_bank_id, patient_name, patient_age, patient_gender, hospital_name,
   drop_address, drop_latitude, drop_longitude,
   blood_group, units_required, required_date, attendant_name, attendant_mobile,
   price_per_unit, total_amount, delivery_distance_km, delivery_fee,
   payment_method, payment_status, status)
VALUES
  ('BR-DEMO-0001', 1, @bank_id, 'Demo Patient', 35, 'male', 'City Hospital',
   'Drop Address, Lucknow', 26.86000000, 80.95000000,
   'O+', 2, DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'Demo Attendant', '9999999999',
   1000.00, 2022.95, 1.53, 22.95,
   'offline', 'paid', 'ready');

SET @blood_request_id = LAST_INSERT_ID();

-- 7) ACTIVE blood delivery request (status 'searching') -> shows in GET /blood-delivery/requests
INSERT INTO blood_delivery_requests
  (request_id, blood_request_id, blood_bank_id, partner_id,
   pickup_address, pickup_latitude, pickup_longitude,
   drop_address, drop_latitude, drop_longitude,
   distance_km, per_km_charge, delivery_fee, admin_commission_percent, admin_commission, delivery_earning,
   status)
VALUES
  ('BDL-DEMO-0001', @blood_request_id, @bank_id, NULL,
   '1 Demo Road, Lucknow', 26.84670000, 80.94620000,
   'Drop Address, Lucknow', 26.86000000, 80.95000000,
   1.53, 15.00, 22.95, 0.00, 0.00, 22.95,
   'searching');

-- 8) A DELIVERED blood delivery request (history + earnings ke liye)
INSERT INTO blood_requests
  (request_id, user_id, blood_bank_id, patient_name, patient_age, patient_gender, hospital_name,
   drop_address, drop_latitude, drop_longitude,
   blood_group, units_required, required_date, attendant_name, attendant_mobile,
   price_per_unit, total_amount, delivery_distance_km, delivery_fee,
   payment_method, payment_status, status, delivery_partner_id)
VALUES
  ('BR-DEMO-0002', 1, @bank_id, 'Old Patient', 40, 'female', 'Old Hospital',
   'Old Drop, Lucknow', 26.85500000, 80.95500000,
   'O+', 1, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Old Attendant', '9888888888',
   1000.00, 1015.30, 1.02, 15.30,
   'offline', 'paid', 'completed', @partner_id);

SET @old_blood_request_id = LAST_INSERT_ID();

INSERT INTO blood_delivery_requests
  (request_id, blood_request_id, blood_bank_id, partner_id,
   pickup_address, pickup_latitude, pickup_longitude,
   drop_address, drop_latitude, drop_longitude,
   distance_km, per_km_charge, delivery_fee, admin_commission_percent, admin_commission, delivery_earning,
   status, assigned_at, picked_up_at, reached_at, delivered_at)
VALUES
  ('BDL-DEMO-0002', @old_blood_request_id, @bank_id, @partner_id,
   '1 Demo Road, Lucknow', 26.84670000, 80.94620000,
   'Old Drop, Lucknow', 26.85500000, 80.95500000,
   1.02, 15.00, 15.30, 2.00, 0.31, 14.99,
   'delivered', NOW(), NOW(), NOW(), NOW());

-- Show what got created
SELECT @bank_id AS bank_id, @partner_id AS partner_id, @blood_request_id AS blood_request_id;

-- ============================================================
-- CLEANUP (uncomment and run to remove all demo rows):
-- DELETE FROM blood_delivery_requests WHERE request_id IN ('BDL-DEMO-0001','BDL-DEMO-0002');
-- DELETE FROM blood_delivery_wallet_transactions WHERE delivery_partner_id IN (SELECT id FROM blood_delivery_partners WHERE mobile='9200000001');
-- DELETE FROM blood_delivery_wallets WHERE delivery_partner_id IN (SELECT id FROM blood_delivery_partners WHERE mobile='9200000001');
-- DELETE FROM blood_delivery_bank_details WHERE delivery_partner_id IN (SELECT id FROM blood_delivery_partners WHERE mobile='9200000001');
-- DELETE FROM blood_delivery_partners WHERE mobile='9200000001';
-- DELETE FROM blood_requests WHERE request_id IN ('BR-DEMO-0001','BR-DEMO-0002');
-- DELETE FROM bloodbank_inventory_items WHERE blood_bank_id IN (SELECT id FROM blood_banks WHERE uuid='demo-bank-uuid-0001');
-- DELETE FROM blood_banks WHERE uuid='demo-bank-uuid-0001';
-- ============================================================
