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
      `SELECT dsp.id, dsp.service_id, dsp.price, dsp.discount_percent, dsp.duration_minutes, dsp.is_available, dsp.booking_type, dsp.slot_duration_minutes_config, dsp.working_days, dsp.working_hours_from, dsp.working_hours_to, dsp.break_from, dsp.break_to,
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
        booking_type: r.booking_type,
        slot_config: r.booking_type === 'appointment' ? {
          slot_duration: r.slot_duration_minutes_config,
          working_days: r.working_days ? r.working_days.split(',') : [],
          working_hours_from: r.working_hours_from,
          working_hours_to: r.working_hours_to,
          break_from: r.break_from,
          break_to: r.break_to,
        } : null,
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
 * Create new service + set price + booking config
 * Body: { name, category_id, price, discount_percent, duration_minutes, description, preparation_instructions, booking_type, slot_duration_minutes_config, working_days, working_hours_from, working_hours_to, break_from, break_to }
 */
const addService = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { name, category_id, price, discount_percent, duration_minutes, description, preparation_instructions, booking_type, slot_duration_minutes_config, working_days, working_hours_from, working_hours_to, break_from, break_to } = req.body;

    if (!name || !price) {
      return res.status(400).json({ message: 'name and price required.' });
    }

    // Create service in diagnostic_services
    const [serviceResult] = await pool.query(
      'INSERT INTO diagnostic_services (center_id, name, category_id, description, preparation_instructions, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)',
      [centerId, name, category_id || null, description || null, preparation_instructions || null, duration_minutes || 30]
    );

    const serviceId = serviceResult.insertId;

    // Add pricing + booking config
    const workingDaysStr = Array.isArray(working_days) ? working_days.join(',') : (working_days || 'mon,tue,wed,thu,fri,sat');

    const [pricingResult] = await pool.query(
      `INSERT INTO diagnostic_service_pricing (diagnostic_center_id, service_id, price, discount_percent, duration_minutes, booking_type, slot_duration_minutes_config, working_days, working_hours_from, working_hours_to, break_from, break_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [centerId, serviceId, price, discount_percent || 0, duration_minutes || 30, booking_type || 'appointment', slot_duration_minutes_config || 30, workingDaysStr, working_hours_from || '08:00', working_hours_to || '20:00', break_from || null, break_to || null]
    );

    return res.status(201).json({
      message: 'Service added.',
      data: { id: pricingResult.insertId, service_id: serviceId, name, price, booking_type: booking_type || 'appointment' },
    });
  } catch (error) {
    console.error('diagnostic addService error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/diagnostic/services/:id
 * Update pricing + booking config
 */
const updateService = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { id } = req.params;
    const { price, discount_percent, duration_minutes, is_available, booking_type, slot_duration_minutes_config, working_days, working_hours_from, working_hours_to, break_from, break_to } = req.body;

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
    if (booking_type) { fields.push('booking_type = ?'); values.push(booking_type); }
    if (slot_duration_minutes_config !== undefined) { fields.push('slot_duration_minutes_config = ?'); values.push(slot_duration_minutes_config); }
    if (working_days) { fields.push('working_days = ?'); values.push(Array.isArray(working_days) ? working_days.join(',') : working_days); }
    if (working_hours_from) { fields.push('working_hours_from = ?'); values.push(working_hours_from); }
    if (working_hours_to) { fields.push('working_hours_to = ?'); values.push(working_hours_to); }
    if (break_from !== undefined) { fields.push('break_from = ?'); values.push(break_from || null); }
    if (break_to !== undefined) { fields.push('break_to = ?'); values.push(break_to || null); }

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
