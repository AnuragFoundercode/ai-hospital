const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────
// DIAGNOSTIC CENTER MODEL
// ─────────────────────────────────────────────

const findByEmail = async (email) => {
  const [rows] = await pool.query('SELECT * FROM diagnostic_centers WHERE email = ?', [email]);
  return rows[0] || null;
};

const findByMobile = async (mobile) => {
  const [rows] = await pool.query('SELECT * FROM diagnostic_centers WHERE mobile = ?', [mobile]);
  return rows[0] || null;
};

const findById = async (id) => {
  const [rows] = await pool.query('SELECT * FROM diagnostic_centers WHERE id = ?', [id]);
  return rows[0] || null;
};

const register = async (data) => {
  const uuid = uuidv4();
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const [result] = await pool.query(
    `INSERT INTO diagnostic_centers (uuid, name, owner_name, mobile, email, password_hash, registration_number, gst_number, pan_number, nabh_accreditation_number, nabh_certificate_url, registration_certificate_url, gst_certificate_url, pan_card_url, profile_photo, address_line1, address_line2, landmark, city, state, pincode, zone_id, latitude, longitude, opening_time, closing_time, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      uuid, data.name, data.owner_name, data.mobile, data.email, hashedPassword,
      data.registration_number, data.gst_number || null, data.pan_number || null,
      data.nabh_accreditation_number || null,
      data.nabh_certificate_url || null, data.registration_certificate_url || null,
      data.gst_certificate_url || null, data.pan_card_url || null, data.profile_photo || null,
      data.address, data.address2 || null, data.landmark || null,
      data.city, data.state, data.pincode,
      data.zone_id || null, data.latitude || null, data.longitude || null,
      data.opening_time || null, data.closing_time || null
    ]
  );

  return { id: result.insertId, uuid };
};

const verifyPassword = async (plain, hashed) => {
  return bcrypt.compare(plain, hashed);
};

const updateProfile = async (id, data) => {
  const allowedFields = ['name', 'owner_name', 'mobile', 'profile_photo', 'registration_number', 'gst_number', 'pan_number', 'nabh_accreditation_number', 'nabh_certificate_url', 'registration_certificate_url', 'gst_certificate_url', 'pan_card_url', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'pincode', 'zone_id', 'latitude', 'longitude', 'opening_time', 'closing_time'];
  const fields = [];
  const values = [];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (!fields.length) return null;
  values.push(id);
  await pool.query(`UPDATE diagnostic_centers SET ${fields.join(', ')} WHERE id = ?`, values);
};

const updateFcmToken = async (id, fcmToken) => {
  await pool.query('UPDATE diagnostic_centers SET fcm_token = ? WHERE id = ?', [fcmToken, id]);
};

module.exports = {
  findByEmail,
  findByMobile,
  findById,
  register,
  verifyPassword,
  updateProfile,
  updateFcmToken,
};
