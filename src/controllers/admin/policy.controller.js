const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN POLICY MANAGEMENT
// Dynamic policies (privacy, terms, refund, or any custom page).
// Public read is via /global/policies + /global/policies/:slug.
// ─────────────────────────────────────────────

const slugify = (str) =>
  String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * GET /api/v1/admin/policies?is_active=
 * All policies (admin view — includes inactive).
 */
const getPolicies = async (req, res) => {
  try {
    const { is_active } = req.query;
    const where = ['1=1'];
    const params = [];
    if (is_active !== undefined) { where.push('is_active = ?'); params.push(parseInt(is_active)); }
    const [rows] = await pool.query(
      `SELECT id, title, slug, sort_order, is_active, updated_at FROM policies WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`,
      params
    );
    return res.status(200).json({ message: 'Policies fetched.', data: rows });
  } catch (error) {
    console.error('admin getPolicies error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/policies/:id
 * Full policy with content.
 */
const getPolicy = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, title, slug, content, sort_order, is_active, updated_at FROM policies WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Policy not found.' });
    return res.status(200).json({ message: 'Policy fetched.', data: rows[0] });
  } catch (error) {
    console.error('admin getPolicy error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/admin/policies
 * Body: { title, content, slug?, sort_order? }
 */
const createPolicy = async (req, res) => {
  try {
    const { title, content, slug, sort_order = 0 } = req.body;
    if (!title || !content) return res.status(400).json({ message: 'title and content are required.' });

    const finalSlug = slug ? slugify(slug) : slugify(title);
    const [existing] = await pool.query('SELECT id FROM policies WHERE slug = ?', [finalSlug]);
    if (existing.length) return res.status(409).json({ message: 'A policy with this slug already exists.' });

    const [result] = await pool.query(
      'INSERT INTO policies (title, slug, content, sort_order) VALUES (?, ?, ?, ?)',
      [title, finalSlug, content, parseInt(sort_order) || 0]
    );
    return res.status(201).json({ message: 'Policy created.', data: { id: result.insertId, title, slug: finalSlug, sort_order: parseInt(sort_order) || 0 } });
  } catch (error) {
    console.error('admin createPolicy error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/policies/:id
 * Body: { title, content, slug, sort_order, is_active }
 */
const updatePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, slug, sort_order, is_active } = req.body;

    const fields = [];
    const values = [];
    if (title !== undefined) { fields.push('title = ?'); values.push(title); }
    if (content !== undefined) { fields.push('content = ?'); values.push(content); }
    if (slug !== undefined) {
      const finalSlug = slugify(slug);
      const [dup] = await pool.query('SELECT id FROM policies WHERE slug = ? AND id <> ?', [finalSlug, id]);
      if (dup.length) return res.status(409).json({ message: 'Another policy already uses this slug.' });
      fields.push('slug = ?'); values.push(finalSlug);
    }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(parseInt(sort_order) || 0); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    values.push(id);
    const [result] = await pool.query(`UPDATE policies SET ${fields.join(', ')} WHERE id = ?`, values);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Policy not found.' });
    return res.status(200).json({ message: 'Policy updated.' });
  } catch (error) {
    console.error('admin updatePolicy error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/admin/policies/:id
 */
const deletePolicy = async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM policies WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Policy not found.' });
    return res.status(200).json({ message: 'Policy deleted.' });
  } catch (error) {
    console.error('admin deletePolicy error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
};
