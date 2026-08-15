-- =============================================
-- LAB CART - User can add tests from same lab
-- =============================================
CREATE TABLE IF NOT EXISTS lab_cart (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  lab_id INT NOT NULL,
  test_id INT NOT NULL,
  pricing_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lab_id) REFERENCES pathology_labs(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id) REFERENCES lab_tests(id) ON DELETE CASCADE,
  FOREIGN KEY (pricing_id) REFERENCES lab_test_pricing(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_test (user_id, pricing_id),
  INDEX idx_user (user_id),
  INDEX idx_user_lab (user_id, lab_id)
);
