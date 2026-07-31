const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// SLOT MODEL - Doctor manages availability
// ─────────────────────────────────────────────

// Get all slots for a doctor
const getSlots = async (doctorId) => {
  const [rows] = await pool.query(
    'SELECT * FROM doctor_availability WHERE doctor_id = ? ORDER BY FIELD(day_of_week, "monday","tuesday","wednesday","thursday","friday","saturday","sunday"), start_time',
    [doctorId]
  );
  return rows;
};

// Get single slot by id
const findById = async (id, doctorId) => {
  const [rows] = await pool.query(
    'SELECT * FROM doctor_availability WHERE id = ? AND doctor_id = ?',
    [id, doctorId]
  );
  return rows[0] || null;
};

// Create slot
const create = async (doctorId, data) => {
  const [result] = await pool.query(
    'INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, consultation_type, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [doctorId, data.day_of_week, data.start_time, data.end_time, data.slot_duration_minutes || 15, data.consultation_type || 'both', 1]
  );
  return { id: result.insertId };
};

// Update slot
const update = async (id, doctorId, data) => {
  const allowedFields = ['day_of_week', 'start_time', 'end_time', 'slot_duration_minutes', 'consultation_type', 'is_active'];
  const fields = [];
  const values = [];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) return null;

  values.push(id, doctorId);
  const [result] = await pool.query(
    `UPDATE doctor_availability SET ${fields.join(', ')} WHERE id = ? AND doctor_id = ?`,
    values
  );
  return result;
};

// Delete slot
const remove = async (id, doctorId) => {
  const [result] = await pool.query(
    'DELETE FROM doctor_availability WHERE id = ? AND doctor_id = ?',
    [id, doctorId]
  );
  return result;
};

module.exports = {
  getSlots,
  findById,
  create,
  update,
  remove,
};
