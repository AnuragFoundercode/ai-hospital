CREATE TABLE IF NOT EXISTS diagnostic_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  diagnostic_center_id INT NOT NULL,
  day_of_week ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes INT DEFAULT 30,
  max_bookings_per_slot INT DEFAULT 1,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_center_id) REFERENCES diagnostic_centers(id) ON DELETE CASCADE,
  INDEX idx_center (diagnostic_center_id),
  INDEX idx_day (day_of_week)
)
