const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────
// LAB MODEL - For lab panel
// ─────────────────────────────────────────────

const findByEmail = async (email) => {
  const [rows] = await pool.query('SELECT * FROM pathology_labs WHERE email = ?', [email]);
  return rows[0] || null;
};

const findByMobile = async (mobile) => {
  const [rows] = await pool.query('SELECT * FROM pathology_labs WHERE mobile = ?', [mobile]);
  return rows[0] || null;
};

const findById = async (id) => {
  const [rows] = await pool.query('SELECT * FROM pathology_labs WHERE id = ?', [id]);
  return rows[0] || null;
};

const register = async (data) => {
  const uuid = uuidv4();
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const [result] = await pool.query(
    `INSERT INTO pathology_labs (uuid, name, owner_name, mobile, email, password_hash, lab_license_number, gst_number, pan_number, nabl_accreditation_number, nabl_certificate_url, lab_license_url, gst_certificate_url, pan_card_url, profile_photo, address_line1, address_line2, landmark, city, state, pincode, zone_id, latitude, longitude, home_collection_available, opening_time, closing_time, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      uuid, data.name, data.owner_name, data.mobile, data.email, hashedPassword,
      data.lab_license_number, data.gst_number || null, data.pan_number || null,
      data.nabl_accreditation_number || null,
      data.nabl_certificate_url || null, data.lab_license_url || null,
      data.gst_certificate_url || null, data.pan_card_url || null, data.profile_photo || null,
      data.address, data.address2 || null, data.landmark || null,
      data.city, data.state, data.pincode, data.zone_id || null,
      data.latitude || null, data.longitude || null,
      data.home_collection_available ? 1 : 0, data.opening_time || null, data.closing_time || null
    ]
  );

  return { id: result.insertId, uuid };
};

const verifyPassword = async (plainPassword, hashedPassword) => {
  return bcrypt.compare(plainPassword, hashedPassword);
};

const updateProfile = async (id, data) => {
  const allowedFields = ['name', 'owner_name', 'mobile', 'profile_photo', 'about_description', 'lab_license_number', 'gst_number', 'pan_number', 'nabl_accreditation_number', 'nabl_certificate_url', 'lab_license_url', 'gst_certificate_url', 'pan_card_url', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'pincode', 'zone_id', 'latitude', 'longitude', 'home_collection_available', 'home_collection_radius_km', 'opening_time', 'closing_time'];
  const fields = [];
  const values = [];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      // Convert boolean to 0/1 for tinyint fields
      if (key === 'home_collection_available') {
        values.push(data[key] ? 1 : 0);
      } else {
        values.push(data[key]);
      }
    }
  }

  if (fields.length === 0) return null;
  values.push(id);
  await pool.query(`UPDATE pathology_labs SET ${fields.join(', ')} WHERE id = ?`, values);
};

const updateFcmToken = async (id, fcmToken) => {
  await pool.query('UPDATE pathology_labs SET fcm_token = ? WHERE id = ?', [fcmToken, id]);
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
