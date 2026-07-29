const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// BOOKING MODEL - For patient app
// ─────────────────────────────────────────────

// Generate unique booking ID like BK-20260729-A3X9F
const generateBookingId = () => {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BK-${y}${m}${d}-${code}`;
};

// Check if slot already booked
const isSlotBooked = async (serviceType, providerId, date, slotTime) => {
  const [rows] = await pool.query(
    `SELECT id FROM bookings 
     WHERE service_type = ? AND provider_id = ? AND booking_date = ? AND slot_start_time = ? 
     AND status IN ('pending', 'confirmed', 'in_progress')`,
    [serviceType, providerId, date, slotTime]
  );
  return rows.length > 0;
};

// Create booking
const create = async (data) => {
  const bookingId = generateBookingId();
  const [result] = await pool.query(
    `INSERT INTO bookings 
     (booking_id, user_id, service_type, provider_id, status, booking_date, slot_start_time, slot_end_time, base_amount, discount_amount, tax_amount, final_amount, payment_status, payment_method, metadata, user_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bookingId,
      data.user_id,
      data.service_type,
      data.provider_id,
      data.status,
      data.booking_date,
      data.slot_start_time,
      data.slot_end_time,
      data.base_amount,
      data.discount_amount || 0,
      data.tax_amount || 0,
      data.final_amount,
      data.payment_status,
      data.payment_method,
      JSON.stringify(data.metadata || {}),
      data.user_notes || null,
    ]
  );
  return { id: result.insertId, booking_id: bookingId };
};

// Update payment status
const updatePayment = async (bookingId, paymentData) => {
  const [result] = await pool.query(
    `UPDATE bookings SET payment_status = ?, transaction_id = ?, paid_at = NOW(), status = 'confirmed', confirmed_at = NOW() WHERE booking_id = ? AND user_id = ?`,
    [paymentData.payment_status, paymentData.transaction_id, bookingId, paymentData.user_id]
  );
  return result;
};

// Find booking by booking_id
const findByBookingId = async (bookingId) => {
  const [rows] = await pool.query('SELECT * FROM bookings WHERE booking_id = ?', [bookingId]);
  return rows[0] || null;
};

// Get user bookings
const getUserBookings = async (userId, { page = 1, limit = 10, status }) => {
  const offset = (page - 1) * limit;
  let where = ['b.user_id = ?'];
  let params = [userId];

  if (status) {
    where.push('b.status = ?');
    params.push(status);
  }

  const whereClause = where.join(' AND ');

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM bookings b WHERE ${whereClause}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT b.*, d.full_name as doctor_name, d.profile_photo as doctor_photo, d.uuid as doctor_uuid, dc.name as category_name
     FROM bookings b
     LEFT JOIN doctors d ON b.service_type = 'doctor_consultation' AND b.provider_id = d.id
     LEFT JOIN doctor_categories dc ON d.category_id = dc.id
     WHERE ${whereClause}
     ORDER BY b.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { bookings: rows, total: countResult[0].total, page, limit };
};

// Get upcoming appointments
const getUpcomingAppointments = async (userId, { page = 1, limit = 10 }) => {
  const offset = (page - 1) * limit;
  const today = new Date().toISOString().split('T')[0];

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM bookings WHERE user_id = ? AND service_type = 'doctor_consultation' AND booking_date >= ? AND status IN ('confirmed', 'pending', 'in_progress')`,
    [userId, today]
  );

  const [rows] = await pool.query(
    `SELECT b.*, d.full_name as doctor_name, d.profile_photo as doctor_photo, d.uuid as doctor_uuid, d.consultation_fee, dc.name as category_name
     FROM bookings b
     LEFT JOIN doctors d ON b.provider_id = d.id
     LEFT JOIN doctor_categories dc ON d.category_id = dc.id
     WHERE b.user_id = ? AND b.service_type = 'doctor_consultation' AND b.booking_date >= ? AND b.status IN ('confirmed', 'pending', 'in_progress')
     ORDER BY b.booking_date ASC, b.slot_start_time ASC
     LIMIT ? OFFSET ?`,
    [userId, today, limit, offset]
  );

  return { bookings: rows, total: countResult[0].total, page, limit };
};

// Get past appointments
const getPastAppointments = async (userId, { page = 1, limit = 10 }) => {
  const offset = (page - 1) * limit;
  const today = new Date().toISOString().split('T')[0];

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM bookings WHERE user_id = ? AND service_type = 'doctor_consultation' AND (booking_date < ? OR status IN ('completed', 'cancelled'))`,
    [userId, today]
  );

  const [rows] = await pool.query(
    `SELECT b.*, d.full_name as doctor_name, d.profile_photo as doctor_photo, d.uuid as doctor_uuid, d.consultation_fee, d.average_rating as doctor_rating, dc.name as category_name
     FROM bookings b
     LEFT JOIN doctors d ON b.provider_id = d.id
     LEFT JOIN doctor_categories dc ON d.category_id = dc.id
     WHERE b.user_id = ? AND b.service_type = 'doctor_consultation' AND (b.booking_date < ? OR b.status IN ('completed', 'cancelled'))
     ORDER BY b.booking_date DESC, b.slot_start_time DESC
     LIMIT ? OFFSET ?`,
    [userId, today, limit, offset]
  );

  return { bookings: rows, total: countResult[0].total, page, limit };
};

// Add status history
const addStatusHistory = async (bookingDbId, fromStatus, toStatus, changedByType, changedById, remarks) => {
  await pool.query(
    `INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_type, changed_by_id, remarks) VALUES (?, ?, ?, ?, ?, ?)`,
    [bookingDbId, fromStatus, toStatus, changedByType, changedById, remarks]
  );
};

module.exports = {
  generateBookingId,
  isSlotBooked,
  create,
  updatePayment,
  findByBookingId,
  getUserBookings,
  getUpcomingAppointments,
  getPastAppointments,
  addStatusHistory,
};
