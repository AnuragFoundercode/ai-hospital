const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DOCTOR MODEL - For patient app (user side)
// ─────────────────────────────────────────────

const getList = async ({ page = 1, limit = 10, category_id, min_rating, search }) => {
  const offset = (page - 1) * limit;
  let where = ['d.is_active = 1', 'd.is_verified = 1'];
  let params = [];

  if (category_id) {
    where.push('d.category_id = ?');
    params.push(category_id);
  }

  if (min_rating) {
    where.push('d.average_rating >= ?');
    params.push(min_rating);
  }

  if (search) {
    where.push('d.full_name LIKE ?');
    params.push(`%${search}%`);
  }

  const whereClause = where.join(' AND ');

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM doctors d WHERE ${whereClause}`,
    params
  );
  const total = countResult[0].total;

  const [rows] = await pool.query(
    `SELECT 
      d.id,
      d.uuid,
      d.full_name,
      d.gender,
      d.profile_photo,
      d.average_rating,
      d.consultation_fee,
      d.qualification,
      d.experience_years,
      d.category_id,
      dc.name as category_name
    FROM doctors d
    LEFT JOIN doctor_categories dc ON d.category_id = dc.id
    WHERE ${whereClause}
    ORDER BY d.average_rating DESC, d.total_consultations DESC
    LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { doctors: rows, total, page, limit };
};

const getTodayAvailability = async (doctorIds) => {
  if (!doctorIds.length) return {};

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = days[new Date().getDay()];

  const [rows] = await pool.query(
    `SELECT doctor_id, start_time, end_time 
     FROM doctor_availability 
     WHERE doctor_id IN (?) AND day_of_week = ? AND is_active = 1`,
    [doctorIds, today]
  );

  const availability = {};
  for (const row of rows) {
    if (!availability[row.doctor_id]) {
      availability[row.doctor_id] = [];
    }
    availability[row.doctor_id].push({
      start_time: row.start_time,
      end_time: row.end_time,
    });
  }

  return availability;
};

const findById = async (id) => {
  const [rows] = await pool.query(
    `SELECT d.*, dc.name as category_name
     FROM doctors d
     LEFT JOIN doctor_categories dc ON d.category_id = dc.id
     WHERE d.id = ? AND d.is_active = 1`,
    [id]
  );
  return rows[0] || null;
};

// Find doctor by uuid
const findByUuid = async (uuid) => {
  const [rows] = await pool.query(
    `SELECT d.*, dc.name as category_name
     FROM doctors d
     LEFT JOIN doctor_categories dc ON d.category_id = dc.id
     WHERE d.uuid = ? AND d.is_active = 1 AND d.is_verified = 1`,
    [uuid]
  );
  return rows[0] || null;
};

// Get full weekly availability for a doctor
const getWeeklyAvailability = async (doctorId) => {
  const [rows] = await pool.query(
    `SELECT day_of_week, start_time, end_time, slot_duration_minutes, consultation_type
     FROM doctor_availability
     WHERE doctor_id = ? AND is_active = 1
     ORDER BY FIELD(day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), start_time`,
    [doctorId]
  );
  return rows;
};

// Get reviews for a doctor (from bookings table)
const getReviews = async (doctorId, limit = 10) => {
  const [rows] = await pool.query(
    `SELECT b.user_rating, b.user_review, b.rated_at, u.full_name, u.profile_photo
     FROM bookings b
     JOIN users u ON b.user_id = u.id
     WHERE b.service_type = 'doctor_consultation' AND b.provider_id = ? AND b.user_rating IS NOT NULL
     ORDER BY b.rated_at DESC
     LIMIT ?`,
    [doctorId, limit]
  );
  return rows;
};

// Get slots for a specific date (generates time slots from availability)
const getSlotsByDate = async (doctorId, date) => {
  // Get day of week from date
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = days[new Date(date).getDay()];

  // Get availability for that day
  const [availability] = await pool.query(
    `SELECT start_time, end_time, slot_duration_minutes, consultation_type
     FROM doctor_availability
     WHERE doctor_id = ? AND day_of_week = ? AND is_active = 1`,
    [doctorId, dayOfWeek]
  );

  if (!availability.length) return [];

  // Get already booked slots for that date
  const [bookedSlots] = await pool.query(
    `SELECT slot_start_time FROM bookings
     WHERE service_type = 'doctor_consultation' AND provider_id = ? AND booking_date = ? AND status IN ('pending', 'confirmed', 'in_progress')`,
    [doctorId, date]
  );

  const bookedTimes = bookedSlots.map((b) => b.slot_start_time);

  // Generate individual slots
  const slots = [];
  for (const avail of availability) {
    const duration = avail.slot_duration_minutes;
    let current = timeToMinutes(avail.start_time);
    const end = timeToMinutes(avail.end_time);

    while (current + duration <= end) {
      const slotTime = minutesToTime(current);
      const isBooked = bookedTimes.includes(slotTime);

      slots.push({
        slot_id: `${date}_${slotTime.replace(':', '')}`,
        time: slotTime,
        end_time: minutesToTime(current + duration),
        is_booked: isBooked,
        consultation_type: avail.consultation_type,
      });

      current += duration;
    }
  }

  return slots;
};

// Helper: "09:00:00" -> 540
const timeToMinutes = (time) => {
  const parts = time.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
};

// Helper: 540 -> "09:00"
const minutesToTime = (minutes) => {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
};

module.exports = {
  getList,
  getTodayAvailability,
  findById,
  findByUuid,
  getWeeklyAvailability,
  getReviews,
  getSlotsByDate,
};
