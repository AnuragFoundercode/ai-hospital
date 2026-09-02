const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// DOCTOR MODEL - For doctor panel
// ─────────────────────────────────────────────

const findByMobile = async (mobile) => {
  const [rows] = await pool.query('SELECT * FROM doctors WHERE mobile = ?', [mobile]);
  return rows[0] || null;
};

const findById = async (id) => {
  const [rows] = await pool.query(
    `SELECT d.*, dc.name as category_name FROM doctors d
     LEFT JOIN doctor_categories dc ON d.category_id = dc.id
     WHERE d.id = ?`,
    [id]
  );
  return rows[0] || null;
};

const create = async (mobile) => {
  const uuid = uuidv4();
  const [result] = await pool.query(
    'INSERT INTO doctors (uuid, full_name, mobile, registration_number, qualification) VALUES (?, ?, ?, ?, ?)',
    [uuid, '', mobile, '', '']
  );
  return { id: result.insertId, uuid, mobile };
};

const updateFcmToken = async (id, fcmToken) => {
  await pool.query('UPDATE doctors SET fcm_token = ? WHERE id = ?', [fcmToken, id]);
};

const markVerified = async (id) => {
  await pool.query('UPDATE doctors SET is_verified = 1 WHERE id = ?', [id]);
};

// ─── STEP 1: Personal Details ───
const updatePersonalDetails = async (id, data) => {
  const [result] = await pool.query(
    `UPDATE doctors SET full_name = ?, email = ?, date_of_birth = ?, gender = ?, registration_step = GREATEST(registration_step, 1) WHERE id = ?`,
    [data.full_name, data.email || null, data.date_of_birth || null, data.gender || null, id]
  );
  return result;
};

// ─── STEP 2: Professional Details ───
const updateProfessionalDetails = async (id, data) => {
  const [result] = await pool.query(
    `UPDATE doctors SET category_id = ?, qualification = ?, experience_years = ?, registration_number = ?, per_minute_fee = ?, spoken_languages = ?, registration_step = GREATEST(registration_step, 2) WHERE id = ?`,
    [data.category_id, data.qualification, data.experience_years || 0, data.registration_number, data.per_minute_fee || 0, data.spoken_languages || null, id]
  );
  return result;
};

// ─── STEP 3: Clinic Details ───
const upsertClinicDetails = async (doctorId, data) => {
  // Check if clinic exists
  const [existing] = await pool.query('SELECT id FROM doctor_clinics WHERE doctor_id = ? AND is_primary = 1', [doctorId]);

  if (existing.length > 0) {
    await pool.query(
      `UPDATE doctor_clinics SET clinic_name = ?, address = ?, city = ?, state = ?, pincode = ?, zone = ? WHERE doctor_id = ? AND is_primary = 1`,
      [data.clinic_name, data.address, data.city, data.state, data.pincode, data.zone || null, doctorId]
    );
  } else {
    await pool.query(
      `INSERT INTO doctor_clinics (doctor_id, clinic_name, address, city, state, pincode, zone) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [doctorId, data.clinic_name, data.address, data.city, data.state, data.pincode, data.zone || null]
    );
  }

  await pool.query('UPDATE doctors SET registration_step = GREATEST(registration_step, 3) WHERE id = ?', [doctorId]);
};

// ─── STEP 4: Document Upload ───
const updateDocuments = async (id, data) => {
  const [result] = await pool.query(
    `UPDATE doctors SET medical_license_url = ?, degree_certificate_url = ?, aadhaar_url = ?, pan_card_url = ?, profile_photo = ?, registration_step = GREATEST(registration_step, 4) WHERE id = ?`,
    [data.medical_registration_certificate || null, data.degree_certificate || null, data.aadhaar_card || null, data.pan_card || null, data.profile_photo || null, id]
  );
  return result;
};

// ─── STEP 5: Bank Details ───
const upsertBankDetails = async (doctorId, data) => {
  const [existing] = await pool.query('SELECT id FROM doctor_bank_details WHERE doctor_id = ?', [doctorId]);

  if (existing.length > 0) {
    await pool.query(
      `UPDATE doctor_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE doctor_id = ?`,
      [data.account_holder_name, data.bank_name, data.account_number, data.ifsc_code, doctorId]
    );
  } else {
    await pool.query(
      `INSERT INTO doctor_bank_details (doctor_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)`,
      [doctorId, data.account_holder_name, data.bank_name, data.account_number, data.ifsc_code]
    );
  }

  // Mark registration complete, set verification to pending
  await pool.query(
    `UPDATE doctors SET registration_step = 5, verification_status = 'pending' WHERE id = ?`,
    [doctorId]
  );
};

// ─── Get Clinic Details ───
const getClinicDetails = async (doctorId) => {
  const [rows] = await pool.query('SELECT * FROM doctor_clinics WHERE doctor_id = ? AND is_primary = 1', [doctorId]);
  return rows[0] || null;
};

// ─── Get Bank Details ───
const getBankDetails = async (doctorId) => {
  const [rows] = await pool.query('SELECT * FROM doctor_bank_details WHERE doctor_id = ?', [doctorId]);
  return rows[0] || null;
};

// ─── Generic Update ───
const updateProfile = async (id, data) => {
  const allowedFields = ['full_name', 'email', 'gender', 'qualification', 'specialization', 'registration_number', 'experience_years', 'bio', 'per_minute_fee', 'category_id', 'call_status', 'spoken_languages'];
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
  const [result] = await pool.query(`UPDATE doctors SET ${fields.join(', ')} WHERE id = ?`, values);
  return result;
};

module.exports = {
  findByMobile,
  findById,
  create,
  updateFcmToken,
  markVerified,
  updatePersonalDetails,
  updateProfessionalDetails,
  upsertClinicDetails,
  updateDocuments,
  upsertBankDetails,
  getClinicDetails,
  getBankDetails,
  updateProfile,
};
