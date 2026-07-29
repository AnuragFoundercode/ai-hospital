const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DOCTOR CATEGORY MODEL - For patient app
// ─────────────────────────────────────────────

const getAll = async () => {
  const [rows] = await pool.query(
    'SELECT id, name, icon_url FROM doctor_categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC'
  );
  return rows;
};

const findById = async (id) => {
  const [rows] = await pool.query(
    'SELECT id, name, icon_url FROM doctor_categories WHERE id = ? AND is_active = 1',
    [id]
  );
  return rows[0] || null;
};

module.exports = {
  getAll,
  findById,
};
