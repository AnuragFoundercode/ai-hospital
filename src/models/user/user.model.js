const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// USER MODEL - Database queries for patients
// ─────────────────────────────────────────────

const findByMobile = async (mobile) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE mobile = ?', [mobile]);
  return rows[0] || null;
};

const findById = async (id) => {
  const [rows] = await pool.query(
    'SELECT id, uuid, full_name, mobile, email, gender, date_of_birth, blood_group, profile_photo, aadhaar_number, abha_number, is_verified, created_at FROM users WHERE id = ?',
    [id]
  );
  return rows[0] || null;
};

const create = async (mobile) => {
  const uuid = uuidv4();
  const [result] = await pool.query(
    'INSERT INTO users (uuid, full_name, mobile) VALUES (?, ?, ?)',
    [uuid, '', mobile]
  );
  return { id: result.insertId, uuid, mobile };
};

const updateProfile = async (id, data) => {
  const allowedFields = ['full_name', 'email', 'gender', 'date_of_birth'];
  const fields = [];
  const values = [];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  const [result] = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return result;
};

const updateFcmToken = async (id, fcmToken) => {
  await pool.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcmToken, id]);
};

const markVerified = async (id) => {
  await pool.query('UPDATE users SET is_verified = 1 WHERE id = ?', [id]);
};

module.exports = {
  findByMobile,
  findById,
  create,
  updateProfile,
  updateFcmToken,
  markVerified,
};
