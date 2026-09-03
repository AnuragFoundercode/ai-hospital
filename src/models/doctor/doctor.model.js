const { pool } = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// DOCTOR MODEL - vendor-style 4-step registration
// step1 personal | step2 professional | step3 documents | step4 bank
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
    'INSERT INTO doctors (uuid, full_name, mobile) VALUES (?, ?, ?)',
    [uuid, '', mobile]
  );
  return { id: result.insertId, uuid, mobile };
};

const updateFcmToken = async (id, fcmToken) => {
  await pool.query('UPDATE doctors SET fcm_token = ? WHERE id = ?', [fcmToken, id]);
};

// ─── Categories (specializations) for dropdown ───
const getCategories = async () => {
  const [rows] = await pool.query(
    'SELECT id, name, icon_url FROM doctor_categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC'
  );
  return rows;
};

// ─── STEP 1: Personal Details ───
const updatePersonalDetails = async (id, data) => {
  const [result] = await pool.query(
    `UPDATE doctors SET full_name = ?, email = ?, date_of_birth = ?, gender = ?,
       registration_step = GREATEST(registration_step, 1) WHERE id = ?`,
    [data.full_name, data.email || null, data.date_of_birth || null, data.gender || null, id]
  );
  return result;
};

// ─── STEP 2: Professional Details ───
// specialization (doctor_categories), qualification, experience, registration number, per-minute fee
const updateProfessionalDetails = async (id, data) => {
  const [result] = await pool.query(
    `UPDATE doctors SET category_id = ?, qualification = ?, experience_years = ?,
       registration_number = ?, per_minute_fee = ?,
       registration_step = GREATEST(registration_step, 2) WHERE id = ?`,
    [data.category_id || null, data.qualification, data.experience_years || 0, data.registration_number, data.per_minute_fee || 0, id]
  );
  return result;
};

// ─── STEP 3: Documents ───
const updateDocuments = async (id, data) => {
  const [result] = await pool.query(
    `UPDATE doctors SET medical_license_url = ?, degree_certificate_url = ?,
       aadhaar_url = ?, pan_card_url = ?, profile_photo = ?,
       registration_step = GREATEST(registration_step, 3) WHERE id = ?`,
    [data.medical_registration_url || null, data.degree_certificate_url || null, data.aadhaar_card_url || null, data.pan_card_url || null, data.profile_photo || null, id]
  );
  return result;
};

// ─── STEP 4: Bank Details → registration complete, verification pending ───
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

  await pool.query(
    `UPDATE doctors SET registration_step = 4, verification_status = 'pending' WHERE id = ?`,
    [doctorId]
  );
};

const getBankDetails = async (doctorId) => {
  const [rows] = await pool.query('SELECT * FROM doctor_bank_details WHERE doctor_id = ?', [doctorId]);
  return rows[0] || null;
};

// ─── Generic profile update ───
const updateProfile = async (id, data) => {
  const allowedFields = ['full_name', 'email', 'gender', 'qualification', 'specialization', 'registration_number', 'registration_council', 'experience_years', 'bio', 'spoken_languages', 'per_minute_fee', 'category_id', 'call_status'];
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
  getCategories,
  updatePersonalDetails,
  updateProfessionalDetails,
  updateDocuments,
  upsertBankDetails,
  getBankDetails,
  updateProfile,
};
