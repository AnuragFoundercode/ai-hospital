ALTER TABLE delivery_requests MODIFY COLUMN status ENUM('searching', 'assigned', 'picked_up', 'reached', 'delivered', 'cancelled') DEFAULT 'searching';
ALTER TABLE delivery_requests ADD COLUMN reached_at DATETIME DEFAULT NULL AFTER picked_up_at;
