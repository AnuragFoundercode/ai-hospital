-- =============================================
-- Global Help & Support
-- Single contact (number + email) shared by everyone.
-- FAQs are audience-based (user, doctor, pharmacy, ... or 'all').
-- =============================================

-- Single-row contact config (admin editable)
CREATE TABLE IF NOT EXISTS support_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contact_number VARCHAR(20) DEFAULT NULL,
  contact_email VARCHAR(150) DEFAULT NULL,
  whatsapp_number VARCHAR(20) DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Audience-based FAQs
CREATE TABLE IF NOT EXISTS faqs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  audience ENUM('all','user','doctor','pharmacy','pathology_lab','diagnostic_center','blood_bank','ambulance_service','delivery_partner','sample_collector') NOT NULL DEFAULT 'all',
  question VARCHAR(500) NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_audience (audience, is_active)
);

-- Seed default contact (single row)
INSERT INTO support_config (contact_number, contact_email, whatsapp_number)
SELECT '+91 1800-000-0000', 'support@aihospital.com', '+91 9000000000'
WHERE NOT EXISTS (SELECT 1 FROM support_config);

-- Seed a few FAQs
INSERT INTO faqs (audience, question, answer, sort_order) VALUES
('all', 'How do I contact support?', 'You can call or email us using the contact details shown on this screen. Our team is available 9 AM to 9 PM.', 1),
('all', 'How do I reset my account?', 'Log out and log in again with your mobile number and OTP. Your data stays safe.', 2),
('user', 'How do I book a doctor consultation?', 'Open the Doctors section, pick an online doctor, and tap Call. Charges are per minute from your wallet.', 1),
('user', 'How are delivery charges calculated?', 'Delivery fee is based on distance between the pharmacy and your address (per-km rate).', 2),
('user', 'How do I add money to my wallet?', 'Go to Wallet > Add Money, enter the amount, and complete the payment.', 3),
('doctor', 'How is my earning calculated?', 'You earn your per-minute fee for the call duration, minus the admin commission percentage.', 1),
('doctor', 'When can I go online?', 'You can go online only after your account is verified and approved by admin.', 2),
('pharmacy', 'How do I receive new orders?', 'New paid orders appear in real time on your dashboard. Accept to start processing.', 1),
('ambulance_service', 'How do I get ride requests?', 'Go online to receive nearby ride requests. Accept a request to start the trip.', 1);
