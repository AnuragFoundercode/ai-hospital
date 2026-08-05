const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// LAB TEST MANAGEMENT CONTROLLER
// Lab can add/update/remove tests they offer
// ─────────────────────────────────────────────

/**
 * GET /api/v1/lab/tests
 * Get all tests this lab offers with pricing
 */
const getMyTests = async (req, res) => {
  try {
    const labId = req.lab.id;

    const [rows] = await pool.query(
      `SELECT ltp.id, ltp.test_id, ltp.price, ltp.discount_percent, ltp.report_delivery_hours, ltp.is_available,
              lt.name, lt.test_code, lt.sample_type, ltc.name as category_name
       FROM lab_test_pricing ltp
       JOIN lab_tests lt ON ltp.test_id = lt.id
       LEFT JOIN lab_test_categories ltc ON lt.category_id = ltc.id
       WHERE ltp.pathology_lab_id = ?
       ORDER BY ltc.sort_order, lt.name`,
      [labId]
    );

    return res.status(200).json({
      message: 'Tests fetched.',
      data: rows.map((r) => ({
        id: r.id,
        test_id: r.test_id,
        name: r.name,
        test_code: r.test_code,
        sample_type: r.sample_type,
        category: r.category_name,
        price: r.price,
        discount_percent: r.discount_percent,
        report_delivery_hours: r.report_delivery_hours,
        is_available: r.is_available,
      })),
    });
  } catch (error) {
    console.error('lab getMyTests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/tests/master
 * Get all master tests available in system (to add)
 */
const getMasterTests = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { search, category_id } = req.query;

    let where = ['lt.is_active = 1'];
    let params = [];

    if (search) {
      where.push('lt.name LIKE ?');
      params.push(`%${search}%`);
    }

    if (category_id) {
      where.push('lt.category_id = ?');
      params.push(parseInt(category_id));
    }

    const [rows] = await pool.query(
      `SELECT lt.id, lt.name, lt.test_code, lt.sample_type, lt.report_delivery_hours, ltc.name as category_name,
              (SELECT COUNT(*) FROM lab_test_pricing WHERE pathology_lab_id = ? AND test_id = lt.id) as already_added
       FROM lab_tests lt
       LEFT JOIN lab_test_categories ltc ON lt.category_id = ltc.id
       WHERE ${where.join(' AND ')}
       ORDER BY ltc.sort_order, lt.name`,
      [labId, ...params]
    );

    return res.status(200).json({
      message: 'Master tests fetched.',
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        test_code: r.test_code,
        sample_type: r.sample_type,
        category: r.category_name,
        report_delivery_hours: r.report_delivery_hours,
        already_added: r.already_added > 0,
      })),
    });
  } catch (error) {
    console.error('lab getMasterTests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/tests/categories
 * Get test categories
 */
const getTestCategories = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name FROM lab_test_categories WHERE is_active = 1 ORDER BY sort_order'
    );
    return res.status(200).json({ message: 'Categories fetched.', data: rows });
  } catch (error) {
    console.error('lab getTestCategories error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/lab/tests
 * Add a test - either choose from master OR create new
 * Body option 1 (choose master): { test_id, price, discount_percent, report_delivery_hours }
 * Body option 2 (create new): { name, category_id, sample_type, price, discount_percent, report_delivery_hours, preparation_instructions }
 */
const addTest = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { test_id, name, category_id, sample_type, price, discount_percent, report_delivery_hours, preparation_instructions } = req.body;

    if (!price) {
      return res.status(400).json({ message: 'Price is required.' });
    }

    let finalTestId = test_id;

    // If no test_id provided, lab is creating a new test
    if (!test_id) {
      if (!name) {
        return res.status(400).json({ message: 'Either test_id (from master) or name (create new) is required.' });
      }

      // Create new test in lab_tests table with lab_id
      const [result] = await pool.query(
        'INSERT INTO lab_tests (lab_id, name, category_id, sample_type, preparation_instructions, report_delivery_hours) VALUES (?, ?, ?, ?, ?, ?)',
        [labId, name, category_id || null, sample_type || 'blood', preparation_instructions || null, report_delivery_hours || 24]
      );
      finalTestId = result.insertId;
    } else {
      // Check if master test exists
      const [testExists] = await pool.query('SELECT id FROM lab_tests WHERE id = ? AND is_active = 1', [test_id]);
      if (!testExists.length) {
        return res.status(404).json({ message: 'Test not found.' });
      }
    }

    // Check if already added to pricing
    const [existing] = await pool.query(
      'SELECT id FROM lab_test_pricing WHERE pathology_lab_id = ? AND test_id = ?',
      [labId, finalTestId]
    );

    if (existing.length) {
      return res.status(409).json({ message: 'Test already added. Use update to change price.' });
    }

    // Add to pricing
    const [pricingResult] = await pool.query(
      'INSERT INTO lab_test_pricing (pathology_lab_id, test_id, price, discount_percent, report_delivery_hours) VALUES (?, ?, ?, ?, ?)',
      [labId, finalTestId, price, discount_percent || 0, report_delivery_hours || 24]
    );

    return res.status(201).json({
      message: 'Test added.',
      data: { id: pricingResult.insertId, test_id: finalTestId, name: name || null, price, discount_percent: discount_percent || 0 },
    });
  } catch (error) {
    console.error('lab addTest error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/tests/:id
 * Update test pricing
 * Body: { price, discount_percent, report_delivery_hours, is_available }
 */
const updateTest = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { id } = req.params;
    const { price, discount_percent, report_delivery_hours, is_available } = req.body;

    // Check ownership
    const [existing] = await pool.query(
      'SELECT id FROM lab_test_pricing WHERE id = ? AND pathology_lab_id = ?',
      [id, labId]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Test not found.' });
    }

    const fields = [];
    const values = [];

    if (price !== undefined) { fields.push('price = ?'); values.push(price); }
    if (discount_percent !== undefined) { fields.push('discount_percent = ?'); values.push(discount_percent); }
    if (report_delivery_hours !== undefined) { fields.push('report_delivery_hours = ?'); values.push(report_delivery_hours); }
    if (is_available !== undefined) { fields.push('is_available = ?'); values.push(is_available ? 1 : 0); }

    if (!fields.length) {
      return res.status(400).json({ message: 'Nothing to update.' });
    }

    values.push(id, labId);
    await pool.query(`UPDATE lab_test_pricing SET ${fields.join(', ')} WHERE id = ? AND pathology_lab_id = ?`, values);

    return res.status(200).json({ message: 'Test updated.' });
  } catch (error) {
    console.error('lab updateTest error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/lab/tests/:id
 * Remove test from lab's offering
 */
const removeTest = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { id } = req.params;

    const [existing] = await pool.query(
      'SELECT id FROM lab_test_pricing WHERE id = ? AND pathology_lab_id = ?',
      [id, labId]
    );

    if (!existing.length) {
      return res.status(404).json({ message: 'Test not found.' });
    }

    await pool.query('DELETE FROM lab_test_pricing WHERE id = ? AND pathology_lab_id = ?', [id, labId]);

    return res.status(200).json({ message: 'Test removed.' });
  } catch (error) {
    console.error('lab removeTest error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getMyTests,
  getMasterTests,
  getTestCategories,
  addTest,
  updateTest,
  removeTest,
};
