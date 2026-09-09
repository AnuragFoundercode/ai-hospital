const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN CONFIG MANAGEMENT
// Manages the admin_config key/value table (per-km charges, search radius,
// commission %, emergency call settings, etc.)
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/config?search=
 * List all config entries (optionally filter by key/description).
 */
const getConfigs = async (req, res) => {
  try {
    const { search } = req.query;
    let where = '1=1';
    const params = [];
    if (search) {
      where = '(config_key LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query(`SELECT id, config_key, config_value, description, updated_at FROM admin_config WHERE ${where} ORDER BY config_key`, params);
    return res.status(200).json({ message: 'Config fetched.', data: rows });
  } catch (error) {
    console.error('admin getConfigs error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/config/:key
 * Single config entry by key.
 */
const getConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const [rows] = await pool.query('SELECT id, config_key, config_value, description, updated_at FROM admin_config WHERE config_key = ?', [key]);
    if (!rows.length) return res.status(404).json({ message: 'Config key not found.' });
    return res.status(200).json({ message: 'Config fetched.', data: rows[0] });
  } catch (error) {
    console.error('admin getConfig error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/config/:key
 * Body: { config_value }
 * Update the value of an EXISTING config key only. Admin cannot create new keys
 * (that is done by developers via migrations to avoid breaking dependent code).
 */
const updateConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const { config_value } = req.body;

    if (config_value === undefined || config_value === null || config_value === '') {
      return res.status(400).json({ message: 'config_value is required.' });
    }

    const [result] = await pool.query('UPDATE admin_config SET config_value = ? WHERE config_key = ?', [String(config_value), key]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Config key not found.' });

    const [rows] = await pool.query('SELECT id, config_key, config_value, description, updated_at FROM admin_config WHERE config_key = ?', [key]);
    return res.status(200).json({ message: 'Config updated.', data: rows[0] });
  } catch (error) {
    console.error('admin updateConfig error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/config
 * Body: { configs: [{ config_key, config_value }, ...] }
 * Bulk update multiple existing keys in one call.
 */
const bulkUpdateConfig = async (req, res) => {
  try {
    const { configs } = req.body;
    if (!Array.isArray(configs) || !configs.length) {
      return res.status(400).json({ message: 'configs must be a non-empty array of { config_key, config_value }.' });
    }

    const updated = [];
    const skipped = [];
    for (const c of configs) {
      if (!c || !c.config_key || c.config_value === undefined || c.config_value === null || c.config_value === '') {
        skipped.push(c?.config_key || null);
        continue;
      }
      const [r] = await pool.query('UPDATE admin_config SET config_value = ? WHERE config_key = ?', [String(c.config_value), c.config_key]);
      if (r.affectedRows > 0) updated.push(c.config_key);
      else skipped.push(c.config_key);
    }

    return res.status(200).json({ message: 'Config updated.', data: { updated, skipped } });
  } catch (error) {
    console.error('admin bulkUpdateConfig error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getConfigs,
  getConfig,
  updateConfig,
  bulkUpdateConfig,
};
