const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN ZONE MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/zones?state=&is_active=&page=1&limit=20
 */
const getZones = async (req, res) => {
  try {
    const { state, is_active, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['1=1'];
    let params = [];

    if (state) { where.push('state = ?'); params.push(state); }
    if (is_active !== undefined) { where.push('is_active = ?'); params.push(parseInt(is_active)); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM zones WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT * FROM zones WHERE ${whereClause} ORDER BY state, name LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    return res.status(200).json({
      message: 'Zones fetched.',
      data: rows.map((z) => ({
        id: z.id,
        name: z.name,
        state: z.state,
        description: z.description,
        pincodes: typeof z.pincodes === 'string' ? JSON.parse(z.pincodes) : z.pincodes,
        is_active: z.is_active,
        created_at: z.created_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('admin getZones error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/zones/:id
 */
const getZoneById = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM zones WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Zone not found.' });

    const z = rows[0];
    return res.status(200).json({
      message: 'Zone fetched.',
      data: {
        id: z.id, name: z.name, state: z.state, description: z.description,
        pincodes: typeof z.pincodes === 'string' ? JSON.parse(z.pincodes) : z.pincodes,
        is_active: z.is_active, created_at: z.created_at,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/admin/zones
 * Body: { name, state, description, pincodes }
 */
const createZone = async (req, res) => {
  try {
    const { name, state, description, pincodes } = req.body;

    if (!name || !state || !pincodes || !pincodes.length) {
      return res.status(400).json({ message: 'name, state, pincodes (array) required.' });
    }

    const pincodesArray = Array.isArray(pincodes) ? pincodes : [pincodes];

    const [result] = await pool.query(
      'INSERT INTO zones (name, state, description, pincodes) VALUES (?, ?, ?, ?)',
      [name, state, description || null, JSON.stringify(pincodesArray)]
    );

    return res.status(201).json({
      message: 'Zone created.',
      data: { id: result.insertId, name, state, pincodes: pincodesArray },
    });
  } catch (error) {
    console.error('admin createZone error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/zones/:id
 * Body: { name, state, description, pincodes, is_active }
 */
const updateZone = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, state, description, pincodes, is_active } = req.body;

    const [existing] = await pool.query('SELECT id FROM zones WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Zone not found.' });

    const fields = [];
    const values = [];

    if (name) { fields.push('name = ?'); values.push(name); }
    if (state) { fields.push('state = ?'); values.push(state); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description || null); }
    if (pincodes) {
      const arr = Array.isArray(pincodes) ? pincodes : [pincodes];
      fields.push('pincodes = ?'); values.push(JSON.stringify(arr));
    }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    values.push(id);
    await pool.query(`UPDATE zones SET ${fields.join(', ')} WHERE id = ?`, values);

    return res.status(200).json({ message: 'Zone updated.' });
  } catch (error) {
    console.error('admin updateZone error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/zones/:id/toggle-status
 * Toggle active/inactive
 */
const toggleZoneStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT is_active FROM zones WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Zone not found.' });

    const newStatus = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE zones SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);

    return res.status(200).json({ message: newStatus ? 'Zone activated.' : 'Zone deactivated.', data: { is_active: newStatus } });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getZones,
  getZoneById,
  createZone,
  updateZone,
  toggleZoneStatus,
};
