const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// PHARMACY INVENTORY (MEDICINES) MANAGEMENT
// ─────────────────────────────────────────────

const getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, icon_url FROM medicine_categories WHERE is_active = 1 ORDER BY sort_order');
    return res.status(200).json({ message: 'Categories fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getBrands = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM medicine_brands WHERE is_active = 1 ORDER BY name');
    return res.status(200).json({ message: 'Brands fetched.', data: rows });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/pharmacy/medicines?category_id=&search=&stock_status=active|low_stock|out_of_stock&page=&limit=
 */
const getMedicines = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    const { category_id, search, stock_status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['pm.pharmacy_id = ?'];
    let params = [pharmacyId];

    if (category_id) { where.push('pm.category_id = ?'); params.push(parseInt(category_id)); }
    if (search) { where.push('pm.name LIKE ?'); params.push(`%${search}%`); }
    if (stock_status === 'out_of_stock') { where.push('pm.quantity = 0'); }
    else if (stock_status === 'low_stock') { where.push('pm.quantity > 0 AND pm.quantity <= pm.low_stock_alert'); }
    else if (stock_status === 'active') { where.push('pm.quantity > pm.low_stock_alert'); }

    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM pharmacy_medicines pm WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT pm.*, mc.name as category_name, mb.name as brand_name FROM pharmacy_medicines pm LEFT JOIN medicine_categories mc ON pm.category_id = mc.id LEFT JOIN medicine_brands mb ON pm.brand_id = mb.id WHERE ${whereClause} ORDER BY pm.name LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Medicines fetched.',
      data: rows.map(m => ({
        id: m.id, name: m.name, generic_name: m.generic_name, category: m.category_name, brand: m.brand_name, manufacturer: m.manufacturer, mrp: m.mrp, selling_price: m.selling_price, quantity: m.quantity, batch_number: m.batch_number, expiry_date: m.expiry_date, prescription_required: m.prescription_required, medicine_image_url: m.medicine_image_url, is_active: m.is_active,
        stock_status: m.quantity === 0 ? 'out_of_stock' : m.quantity <= m.low_stock_alert ? 'low_stock' : 'active',
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('pharmacy getMedicines error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/pharmacy/medicines
 */
const addMedicine = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    const { name, generic_name, category_id, brand_id, manufacturer, short_description, purchase_price, mrp, selling_price, gst_percent, quantity, batch_number, expiry_date, low_stock_alert, prescription_required, salt_composition, dosage, uses, how_to_use, side_effects, storage_instructions, medicine_image_url, strip_image_url, additional_images } = req.body;

    if (!name || !mrp || !selling_price) return res.status(400).json({ message: 'name, mrp, selling_price required.' });

    const [result] = await pool.query(
      `INSERT INTO pharmacy_medicines (pharmacy_id, name, generic_name, category_id, brand_id, manufacturer, short_description, purchase_price, mrp, selling_price, gst_percent, quantity, batch_number, expiry_date, low_stock_alert, prescription_required, salt_composition, dosage, uses, how_to_use, side_effects, storage_instructions, medicine_image_url, strip_image_url, additional_images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pharmacyId, name, generic_name || null, category_id || null, brand_id || null, manufacturer || null, short_description || null, purchase_price || 0, mrp, selling_price, gst_percent || 0, quantity || 0, batch_number || null, expiry_date || null, low_stock_alert || 10, prescription_required ? 1 : 0, salt_composition || null, dosage || null, uses || null, how_to_use || null, side_effects || null, storage_instructions || null, medicine_image_url || null, strip_image_url || null, additional_images ? JSON.stringify(additional_images) : null]
    );

    return res.status(201).json({ message: 'Medicine added.', data: { id: result.insertId, name, selling_price, quantity } });
  } catch (error) {
    console.error('pharmacy addMedicine error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/pharmacy/medicines/:id
 */
const updateMedicine = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    const { id } = req.params;

    const [existing] = await pool.query('SELECT id FROM pharmacy_medicines WHERE id = ? AND pharmacy_id = ?', [id, pharmacyId]);
    if (!existing.length) return res.status(404).json({ message: 'Medicine not found.' });

    const allowedFields = ['name', 'generic_name', 'category_id', 'brand_id', 'manufacturer', 'short_description', 'purchase_price', 'mrp', 'selling_price', 'gst_percent', 'quantity', 'batch_number', 'expiry_date', 'low_stock_alert', 'prescription_required', 'salt_composition', 'dosage', 'uses', 'how_to_use', 'side_effects', 'storage_instructions', 'medicine_image_url', 'strip_image_url', 'additional_images', 'is_active'];
    const fields = []; const values = [];
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        if (key === 'additional_images') values.push(JSON.stringify(req.body[key]));
        else if (key === 'prescription_required' || key === 'is_active') values.push(req.body[key] ? 1 : 0);
        else values.push(req.body[key]);
      }
    }
    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });
    values.push(id, pharmacyId);
    await pool.query(`UPDATE pharmacy_medicines SET ${fields.join(', ')} WHERE id = ? AND pharmacy_id = ?`, values);
    return res.status(200).json({ message: 'Medicine updated.' });
  } catch (error) {
    console.error('pharmacy updateMedicine error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const deleteMedicine = async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM pharmacy_medicines WHERE id = ? AND pharmacy_id = ?', [req.params.id, req.pharmacy.id]);
    if (!existing.length) return res.status(404).json({ message: 'Medicine not found.' });
    await pool.query('DELETE FROM pharmacy_medicines WHERE id = ? AND pharmacy_id = ?', [req.params.id, req.pharmacy.id]);
    return res.status(200).json({ message: 'Medicine deleted.' });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { getCategories, getBrands, getMedicines, addMedicine, updateMedicine, deleteMedicine };
