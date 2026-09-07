-- Global dynamic policies (admin can add any number)

CREATE TABLE IF NOT EXISTS policies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  content LONGTEXT NOT NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (is_active, sort_order)
);

INSERT INTO policies (title, slug, content, sort_order) VALUES
('Privacy Policy', 'privacy-policy', 'Your privacy is important to us. This policy explains what data we collect and how we use it.', 1),
('Terms and Conditions', 'terms-and-conditions', 'By using this app you agree to our terms of service. Please read them carefully.', 2),
('Refund Policy', 'refund-policy', 'Refunds are processed as per the applicable service terms.', 3);
