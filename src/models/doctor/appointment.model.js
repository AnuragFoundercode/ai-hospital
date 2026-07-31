const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// APPOINTMENT MODEL - For doctor panel
// ─────────────────────────────────────────────

// Get appointments by type for a doctor
const getAppointments = async (doctorId, { type = 'upcoming', page = 1, limit = 10 }) => {
  const offset = (page - 1) * limit;
  const today = new Date().toISOString().split('T')[0];

  let statusFilter = '';
  let dateFilter = '';

  if (type === 'upcoming') {
    statusFilter = "b.status IN ('confirmed', 'pending')";
    dateFilter = '1=1';
  } else if (type === 'ongoing') {
    statusFilter = "b.status = 'in_progress'";
    dateFilter = '1=1';
  } else if (type === 'completed') {
    statusFilter = "b.status = 'completed'";
    dateFilter = '1=1';
  }

  const where = `b.service_type = 'doctor_consultation' AND b.provider_id = ? AND ${statusFilter} AND ${dateFilter}`;

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM bookings b WHERE ${where}`,
    [doctorId]
  );

  const orderBy = type === 'upcoming'
    ? 'b.booking_date ASC, b.slot_start_time ASC'
    : 'b.booking_date DESC, b.slot_start_time DESC';

  const [rows] = await pool.query(
    `SELECT b.booking_id, b.booking_date, b.slot_start_time, b.slot_end_time, b.status, b.user_notes, b.metadata,
            u.full_name as user_name, u.gender as user_gender, u.profile_photo as user_photo
     FROM bookings b
     JOIN users u ON b.user_id = u.id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [doctorId, limit, offset]
  );

  return { appointments: rows, total: countResult[0].total, page, limit };
};

module.exports = {
  getAppointments,
};
