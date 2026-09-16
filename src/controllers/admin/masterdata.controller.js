const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN MASTER DATA MANAGEMENT
// Vehicle Types | Medicine Categories | Ambulance Types
// ─────────────────────────────────────────────

// Per-entity config: table + editable fields (with type for casting).
const ENTITIES = {
  'vehicle-types': {
    table: 'vehicle_types',
    fields: [
      { key: 'name', type: 'string', required: true },
      { key: 'icon_url', type: 'string' },
    ],
    hasUpdatedAt: false,
    orderBy: 'id ASC',
  },
  'medicine-categories': {
    table: 'medicine_categories',
    fields: [
      { key: 'name', type: 'string', required: true },
      { key: 'parent_id', type: 'int' },
      { key: 'icon_url', type: 'string' },
      { key: 'sort_order', type: 'int' },
    ],
    hasUpdatedAt: true,
    orderBy: 'sort_order ASC, id ASC',
  },
  'ambulance-types': {
    table: 'ambulance_types',
    fields: [
      { key: 'name', type: 'string', required: true },
      { key: 'description', type: 'string' },
      { key: 'icon_url', type: 'string' },
      { key: 'base_fare', type: 'decimal' },
      { key: 'per_km_charge', type: 'decimal' },
      { key: 'sort_order', type: 'int' },
    ],
    hasUpdatedAt: true,
    orderBy: 'sort_order ASC, id ASC',
  },
};

const cast = (type, value) => {
  if (value === undefined || value === null || value === '') return null;
  if (type === 'int') return parseInt(value);
  if (type === 'decimal') return parseFloat(value);
  return value;
};

/**
 * GET /api/v1/admin/master/:entity?search=&is_active=&page=&limit=
 */
const list = async (req, res) => {
  try {
    const cfg = ENTITIES[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown master data type.' });

    const { search, is_active, page = 1, limit = 100 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('name LIKE ?'); params.push(`%${search}%`); }
    if (is_active !== undefined && is_active !== '') { where.push('is_active = ?'); params.push(is_active === 'true' || is_active === '1' ? 1 : 0); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM ${cfg.table} WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM ${cfg.table} WHERE ${whereClause} ORDER BY ${cfg.orderBy} LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Master data fetched.',
      data: rows.map((r) => ({ ...r, is_active: !!r.is_active })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin master list error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/admin/master/:entity
 * Body: editable fields per entity. Defaults is_active = true.
 */
const create = async (req, res) => {
  try {
    const cfg = ENTITIES[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown master data type.' });

    const cols = []; const placeholders = []; const values = [];
    for (const f of cfg.fields) {
      if (f.required && (req.body[f.key] === undefined || req.body[f.key] === null || req.body[f.key] === '')) {
        return res.status(400).json({ message: `${f.key} is required.` });
      }
      if (req.body[f.key] !== undefined) {
        cols.push(f.key); placeholders.push('?'); values.push(cast(f.type, req.body[f.key]));
      }
    }
    // is_active (default 1)
    cols.push('is_active'); placeholders.push('?');
    values.push(req.body.is_active === false || req.body.is_active === 0 || req.body.is_active === '0' ? 0 : 1);

    const [result] = await pool.query(
      `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`, values
    );
    const [rows] = await pool.query(`SELECT * FROM ${cfg.table} WHERE id = ?`, [result.insertId]);
    return res.status(201).json({ message: 'Created.', data: { ...rows[0], is_active: !!rows[0].is_active } });
  } catch (error) {
    console.error('admin master create error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/master/:entity/:id
 * Body: any editable fields (partial update).
 */
const update = async (req, res) => {
  try {
    const cfg = ENTITIES[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown master data type.' });

    const [exists] = await pool.query(`SELECT id FROM ${cfg.table} WHERE id = ?`, [req.params.id]);
    if (!exists.length) return res.status(404).json({ message: 'Record not found.' });

    const sets = []; const values = [];
    for (const f of cfg.fields) {
      if (req.body[f.key] !== undefined) { sets.push(`${f.key} = ?`); values.push(cast(f.type, req.body[f.key])); }
    }
    if (req.body.is_active !== undefined) {
      sets.push('is_active = ?');
      values.push(req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1' ? 1 : 0);
    }
    if (!sets.length) return res.status(400).json({ message: 'No fields to update.' });
    if (cfg.hasUpdatedAt) sets.push('updated_at = NOW()');

    values.push(req.params.id);
    await pool.query(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ?`, values);
    const [rows] = await pool.query(`SELECT * FROM ${cfg.table} WHERE id = ?`, [req.params.id]);
    return res.status(200).json({ message: 'Updated.', data: { ...rows[0], is_active: !!rows[0].is_active } });
  } catch (error) {
    console.error('admin master update error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/master/:entity/:id/toggle-status
 */
const toggleStatus = async (req, res) => {
  try {
    const cfg = ENTITIES[req.params.entity];
    if (!cfg) return res.status(404).json({ message: 'Unknown master data type.' });

    const [rows] = await pool.query(`SELECT id, is_active FROM ${cfg.table} WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Record not found.' });
    const next = rows[0].is_active ? 0 : 1;
    const extra = cfg.hasUpdatedAt ? ', updated_at = NOW()' : '';
    await pool.query(`UPDATE ${cfg.table} SET is_active = ?${extra} WHERE id = ?`, [next, req.params.id]);
    return res.status(200).json({ message: next ? 'Activated.' : 'Deactivated.', data: { id: parseInt(req.params.id), is_active: !!next } });
  } catch (error) {
    console.error('admin master toggleStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { list, create, update, toggleStatus };
