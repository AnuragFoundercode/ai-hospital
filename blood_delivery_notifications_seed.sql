-- ============================================================
-- DUMMY NOTIFICATIONS for Blood Delivery Partner (id = 6, mobile 9200000001)
-- Run: /Applications/XAMPP/xamppfiles/bin/mysql -u root ai_hospital < blood_delivery_notifications_seed.sql
-- ============================================================

-- Resolve partner id by mobile (safe even if id changes)
SET @pid = (SELECT id FROM blood_delivery_partners WHERE mobile = '9200000001' LIMIT 1);

INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, reference_code, is_read, sent_via) VALUES
  ('blood_delivery_partner', @pid, 'New Blood Delivery 🩸', 'New delivery request. Fee: ₹22.95 | 1.5 km', 'order', 'blood_delivery_request', NULL, 'BDL-DEMO-0001', 0, 'push'),
  ('blood_delivery_partner', @pid, 'Delivery Assigned ✅', 'You accepted delivery BDL-DEMO-0001.', 'order', 'blood_delivery_request', NULL, 'BDL-DEMO-0001', 0, 'push'),
  ('blood_delivery_partner', @pid, 'Payout Credited 💰', '₹22.49 credited to your wallet for BDL-DEMO-0002.', 'payment', 'blood_delivery_request', NULL, 'BDL-DEMO-0002', 1, 'push'),
  ('blood_delivery_partner', @pid, 'Profile Approved 🎉', 'Your account is verified. You can go online now.', 'system', 'blood_delivery_partner', @pid, NULL, 1, 'push'),
  ('blood_delivery_partner', @pid, 'Withdrawal Processed 🏦', 'Your withdrawal of ₹500 has been processed.', 'payment', 'withdrawal', NULL, NULL, 0, 'push');

SELECT @pid AS partner_id, ROW_COUNT() AS inserted;

-- CLEANUP (uncomment to remove):
-- DELETE FROM notifications WHERE recipient_type='blood_delivery_partner' AND recipient_id=(SELECT id FROM blood_delivery_partners WHERE mobile='9200000001');
