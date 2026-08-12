const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN STATE MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/states?is_active=1
 */
const getStates = async (req, res) => {
  try {
    const { is_active } = req.query;
    let where = '1=1';
    let params = [];

    if (is_active !== undefined) { where = 'is_active = ?'; params.push(parseInt(is_active)); }

    const [rows] = await pool.query(`SELECT * FROM states WHERE ${where} ORDER BY name`, params);

    return res.status(200).json({ message: 'States fetched.', data: rows });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/admin/states
 * Body: { name, code }
 */
const createState = async (req, res) => {
  try {
    const { name, code } = req.body;

    if (!name) return res.status(400).json({ message: 'State name required.' });

    const [existing] = await pool.query('SELECT id FROM states WHERE name = ?', [name]);
    if (existing.length) return res.status(409).json({ message: 'State already exists.' });

    const [result] = await pool.query('INSERT INTO states (name, code) VALUES (?, ?)', [name, code || null]);

    return res.status(201).json({ message: 'State added.', data: { id: result.insertId, name, code } });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/states/:id
 * Body: { name, code, is_active }
 */
const updateState = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, is_active } = req.body;

    const fields = [];
    const values = [];

    if (name) { fields.push('name = ?'); values.push(name); }
    if (code !== undefined) { fields.push('code = ?'); values.push(code); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    values.push(id);
    await pool.query(`UPDATE states SET ${fields.join(', ')} WHERE id = ?`, values);

    return res.status(200).json({ message: 'State updated.' });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getStates,
  createState,
  updateState,
};
