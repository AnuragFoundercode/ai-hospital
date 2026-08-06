const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DIAGNOSTIC SERVICE MANAGEMENT
// Center can create own services + set pricing
// ─────────────────────────────────────────────

/**
 * GET /api/v1/diagnostic/services
 * My services with pricing
 */
const getMyServices = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;

    const [rows] = await pool.query(
      `SELECT dsp.id, dsp.service_id, dsp.price, dsp.discount_percent, dsp.duration_minutes, dsp.is_available,
              ds.name, dc.name as category_name
       FROM diagnostic_service_pricing dsp
       JOIN diagnostic_services ds ON dsp.service_id = ds.id
       LEFT JOIN diagnostic_categories dc ON ds.category_id = dc.id
       WHERE dsp.diagnostic_center_id = ?
       ORDER BY dc.sort_order, ds.name`,
      [centerId]
    );

    return res.status(200).json({
      message: 'Services fetched.',
      data: rows.map((r) => ({
        id: r.id,
        service_id: r.service_id,
        name: r.name,
        category: r.category_name,
        price: r.price,
        discount_percent: r.discount_percent,
        duration_minutes: r.duration_minutes,
        is_available: r.is_available,
      })),
    });
  } catch (error) {
    console.error('diagnostic getMyServices error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/diagnostic/services/categories
 */
const getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM diagnostic_categories WHERE is_active = 1 ORDER BY sort_order');
    return res.status(200).json({ message: 'Categories fetched.', data: rows });
  } catch (error) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/diagnostic/services
 * Create new service + set price
 * Body: { name, category_id, price, discount_percent, duration_minutes, description, preparation_instructions }
 */
const addService = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { name, category_id, price, discount_percent, duration_minutes, description, preparation_instructions } = req.body;

    if (!name || !price) {
      return res.status(400).json({ message: 'name and price required.' });
    }

    // Create service in diagnostic_services
    const [serviceResult] = await pool.query(
      'INSERT INTO diagnostic_services (center_id, name, category_id, description, preparation_instructions, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)',
      [centerId, name, category_id || null, description || null, preparation_instructions || null, duration_minutes || 30]
    );

    const serviceId = serviceResult.insertId;

    // Add pricing
    const [pricingResult] = await pool.query(
      'INSERT INTO diagnostic_service_pricing (diagnostic_center_id, service_id, price, discount_percent, duration_minutes) VALUES (?, ?, ?, ?, ?)',
      [centerId, serviceId, price, discount_percent || 0, duration_minutes || 30]
    );

    return res.status(201).json({
      message: 'Service added.',
      data: { id: pricingResult.insertId, service_id: serviceId, name, price, category_id },
    });
  } catch (error) {
    console.error('diagnostic addService error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/services/:id
 * Update pricing (id = diagnostic_service_pricing.id)
 * Body: { price, discount_percent, duration_minutes, is_available }
 */
const updateService = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { id } = req.params;
    const { price, discount_percent, duration_minutes, is_available } = req.body;

    const [existing] = await pool.query(
      'SELECT id FROM diagnostic_service_pricing WHERE id = ? AND diagnostic_center_id = ?',
      [id, centerId]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    const fields = [];
    const values = [];

    if (price !== undefined) { fields.push('price = ?'); values.push(price); }
    if (discount_percent !== undefined) { fields.push('discount_percent = ?'); values.push(discount_percent); }
    if (duration_minutes !== undefined) { fields.push('duration_minutes = ?'); values.push(duration_minutes); }
    if (is_available !== undefined) { fields.push('is_available = ?'); values.push(is_available ? 1 : 0); }

    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    values.push(id, centerId);
    await pool.query(`UPDATE diagnostic_service_pricing SET ${fields.join(', ')} WHERE id = ? AND diagnostic_center_id = ?`, values);

    return res.status(200).json({ message: 'Service updated.' });
  } catch (error) {
    console.error('diagnostic updateService error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/diagnostic/services/:id
 */
const removeService = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { id } = req.params;

    const [existing] = await pool.query(
      'SELECT service_id FROM diagnostic_service_pricing WHERE id = ? AND diagnostic_center_id = ?',
      [id, centerId]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    // Remove pricing
    await pool.query('DELETE FROM diagnostic_service_pricing WHERE id = ? AND diagnostic_center_id = ?', [id, centerId]);

    // Remove service if it was center-created
    await pool.query('DELETE FROM diagnostic_services WHERE id = ? AND center_id = ?', [existing[0].service_id, centerId]);

    return res.status(200).json({ message: 'Service removed.' });
  } catch (error) {
    console.error('diagnostic removeService error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getMyServices,
  getCategories,
  addService,
  updateService,
  removeService,
};
