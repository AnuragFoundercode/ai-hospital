const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN HELP & SUPPORT MANAGEMENT
// - support_config: single-row contact (number/email/whatsapp)
// - faqs: audience-based Q&A
// ─────────────────────────────────────────────

const VALID_AUDIENCES = ['all', 'user', 'doctor', 'pharmacy', 'pathology_lab', 'diagnostic_center', 'blood_bank', 'ambulance_service', 'delivery_partner', 'sample_collector'];

/**
 * GET /api/v1/admin/support/contact
 * The single support contact row.
 */
const getContact = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, contact_number, contact_email, whatsapp_number, updated_at FROM support_config ORDER BY id ASC LIMIT 1');
    return res.status(200).json({ message: 'Support contact fetched.', data: rows[0] || null });
  } catch (error) {
    console.error('admin getContact error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/support/contact
 * Body: { contact_number, contact_email, whatsapp_number }
 * Upserts the single contact row.
 */
const updateContact = async (req, res) => {
  try {
    const { contact_number, contact_email, whatsapp_number } = req.body;

    const [existing] = await pool.query('SELECT id FROM support_config ORDER BY id ASC LIMIT 1');
    if (existing.length) {
      const fields = [];
      const values = [];
      if (contact_number !== undefined) { fields.push('contact_number = ?'); values.push(contact_number); }
      if (contact_email !== undefined) { fields.push('contact_email = ?'); values.push(contact_email); }
      if (whatsapp_number !== undefined) { fields.push('whatsapp_number = ?'); values.push(whatsapp_number); }
      if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });
      values.push(existing[0].id);
      await pool.query(`UPDATE support_config SET ${fields.join(', ')} WHERE id = ?`, values);
    } else {
      await pool.query('INSERT INTO support_config (contact_number, contact_email, whatsapp_number) VALUES (?, ?, ?)', [contact_number || null, contact_email || null, whatsapp_number || null]);
    }

    const [rows] = await pool.query('SELECT id, contact_number, contact_email, whatsapp_number, updated_at FROM support_config ORDER BY id ASC LIMIT 1');
    return res.status(200).json({ message: 'Support contact updated.', data: rows[0] });
  } catch (error) {
    console.error('admin updateContact error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/faqs?audience=&is_active=
 * All FAQs (admin view — includes inactive).
 */
const getFaqs = async (req, res) => {
  try {
    const { audience, is_active } = req.query;
    const where = ['1=1'];
    const params = [];
    if (audience) { where.push('audience = ?'); params.push(audience); }
    if (is_active !== undefined) { where.push('is_active = ?'); params.push(parseInt(is_active)); }
    const [rows] = await pool.query(
      `SELECT id, audience, question, answer, sort_order, is_active, updated_at FROM faqs WHERE ${where.join(' AND ')} ORDER BY audience, sort_order ASC, id ASC`,
      params
    );
    return res.status(200).json({ message: 'FAQs fetched.', data: rows });
  } catch (error) {
    console.error('admin getFaqs error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/admin/faqs
 * Body: { audience, question, answer, sort_order }
 */
const createFaq = async (req, res) => {
  try {
    const { audience = 'all', question, answer, sort_order = 0 } = req.body;
    if (!question || !answer) return res.status(400).json({ message: 'question and answer are required.' });
    if (!VALID_AUDIENCES.includes(audience)) return res.status(400).json({ message: `audience must be one of: ${VALID_AUDIENCES.join(', ')}` });

    const [result] = await pool.query(
      'INSERT INTO faqs (audience, question, answer, sort_order) VALUES (?, ?, ?, ?)',
      [audience, question, answer, parseInt(sort_order) || 0]
    );
    return res.status(201).json({ message: 'FAQ created.', data: { id: result.insertId, audience, question, answer, sort_order: parseInt(sort_order) || 0 } });
  } catch (error) {
    console.error('admin createFaq error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/faqs/:id
 * Body: { audience, question, answer, sort_order, is_active }
 */
const updateFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const { audience, question, answer, sort_order, is_active } = req.body;

    const fields = [];
    const values = [];
    if (audience !== undefined) {
      if (!VALID_AUDIENCES.includes(audience)) return res.status(400).json({ message: `audience must be one of: ${VALID_AUDIENCES.join(', ')}` });
      fields.push('audience = ?'); values.push(audience);
    }
    if (question !== undefined) { fields.push('question = ?'); values.push(question); }
    if (answer !== undefined) { fields.push('answer = ?'); values.push(answer); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(parseInt(sort_order) || 0); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    values.push(id);
    const [result] = await pool.query(`UPDATE faqs SET ${fields.join(', ')} WHERE id = ?`, values);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'FAQ not found.' });
    return res.status(200).json({ message: 'FAQ updated.' });
  } catch (error) {
    console.error('admin updateFaq error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/admin/faqs/:id
 */
const deleteFaq = async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM faqs WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'FAQ not found.' });
    return res.status(200).json({ message: 'FAQ deleted.' });
  } catch (error) {
    console.error('admin deleteFaq error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getContact,
  updateContact,
  getFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
};
