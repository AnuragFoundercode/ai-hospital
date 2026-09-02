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
      d.per_minute_fee,
      d.call_status,
      d.qualification,
      d.experience_years,
      d.category_id,
      dc.name as category_name
    FROM doctors d
    LEFT JOIN doctor_categories dc ON d.category_id = dc.id
    WHERE ${whereClause}
    ORDER BY FIELD(d.call_status,'online','busy','offline'), d.average_rating DESC, d.total_consultations DESC
    LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { doctors: rows, total, page, limit };
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

module.exports = {
  getList,
  findById,
  findByUuid,
  getReviews,
};
