const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────
// BLOOD BANK MODEL
// ─────────────────────────────────────────────

const findByEmail = async (email) => {
  const [rows] = await pool.query('SELECT * FROM blood_banks WHERE email = ?', [email]);
  return rows[0] || null;
};

const findByMobile = async (mobile) => {
  const [rows] = await pool.query('SELECT * FROM blood_banks WHERE mobile = ?', [mobile]);
  return rows[0] || null;
};

const findById = async (id) => {
  const [rows] = await pool.query('SELECT * FROM blood_banks WHERE id = ?', [id]);
  return rows[0] || null;
};

const register = async (data) => {
  const uuid = uuidv4();
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const [result] = await pool.query(
    `INSERT INTO blood_banks (uuid, name, contact_person, mobile, email, password_hash, license_number, gst_number, pan_number, blood_bank_category, license_url, gst_certificate_url, pan_card_url, profile_photo, address_line1, address_line2, landmark, city, state, pincode, zone_id, latitude, longitude, is_24hours, opening_time, closing_time, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      uuid, data.name, data.contact_person, data.mobile, data.email, hashedPassword,
      data.license_number, data.gst_number || null, data.pan_number || null,
      data.blood_bank_category || 'private',
      data.license_url || null, data.gst_certificate_url || null,
      data.pan_card_url || null, data.profile_photo || null,
      data.address, data.address2 || null, data.landmark || null,
      data.city, data.state, data.pincode, data.zone_id || null,
      data.latitude || null, data.longitude || null,
      data.is_24hours ? 1 : 1,
      data.opening_time || null, data.closing_time || null
    ]
  );

  return { id: result.insertId, uuid };
};

const verifyPassword = async (plainPassword, hashedPassword) => {
  return bcrypt.compare(plainPassword, hashedPassword);
};

const updateProfile = async (id, data) => {
  const allowedFields = ['name', 'contact_person', 'mobile', 'profile_photo', 'license_number', 'gst_number', 'pan_number', 'blood_bank_category', 'license_url', 'gst_certificate_url', 'pan_card_url', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'pincode', 'zone_id', 'latitude', 'longitude', 'is_24hours', 'opening_time', 'closing_time'];
  const fields = [];
  const values = [];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      if (key === 'is_24hours') {
        values.push(data[key] ? 1 : 0);
      } else {
        values.push(data[key]);
      }
    }
  }

  if (fields.length === 0) return null;
  values.push(id);
  await pool.query(`UPDATE blood_banks SET ${fields.join(', ')} WHERE id = ?`, values);
};

const updateFcmToken = async (id, fcmToken) => {
  await pool.query('UPDATE blood_banks SET fcm_token = ? WHERE id = ?', [fcmToken, id]);
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
