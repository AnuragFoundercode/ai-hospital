const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// BLOOD BANK INVENTORY MANAGEMENT
// ─────────────────────────────────────────────

/**
 * POST /api/v1/bloodbank/inventory
 * Add new blood stock (batch)
 */
const addInventory = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const {
      blood_group, units, blood_type, batch_number,
      collection_date, expiry_date, storage_location, rack_number,
      donor_id, donor_name, test_report_url, collection_document_url, remarks
    } = req.body;

    if (!blood_group || !units || !batch_number || !collection_date || !expiry_date) {
      return res.status(400).json({ message: 'Required: blood_group, units, batch_number, collection_date, expiry_date' });
    }

    const totalUnits = parseInt(units);
    if (!totalUnits || totalUnits < 1) {
      return res.status(400).json({ message: 'units must be at least 1.' });
    }

    // One entry per batch. `units` holds the count of bags (1 bag = 1 unit).
    // Individual bag numbers are derived on the fly in the detail API (not stored).
    const [result] = await pool.query(
      `INSERT INTO bloodbank_inventory_items
        (blood_bank_id, blood_group, units, blood_type, batch_number, collection_date, expiry_date, storage_location, rack_number, donor_id, donor_name, test_report_url, collection_document_url, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bankId, blood_group, totalUnits, blood_type || 'whole_blood', batch_number, collection_date, expiry_date, storage_location || 'main_refrigerator', rack_number || null, donor_id || null, donor_name || null, test_report_url || null, collection_document_url || null, remarks || null]
    );

    // Update summary table
    await updateInventorySummary(bankId, blood_group);

    return res.status(201).json({
      message: 'Blood stock added.',
      data: { id: result.insertId, blood_group, units: totalUnits, batch_number, status: 'available' },
    });
  } catch (error) {
    console.error('addInventory error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * Build derived bag list from a batch entry (1 bag = 1 unit). Not stored in DB.
 */
const buildBags = (item) => {
  const groupTag = String(item.blood_group || '').replace(/[^A-Za-z0-9]/g, '');
  const count = parseInt(item.units) || 0;
  const bags = [];
  for (let i = 1; i <= count; i++) {
    bags.push({
      bag_number: `${item.batch_number}-${groupTag}-${String(i).padStart(3, '0')}`,
      units: 1,
      status: item.status,
    });
  }
  return bags;
};

/**
 * GET /api/v1/bloodbank/inventory?blood_group=&status=&page=1&limit=20
 * Inventory list (batch level)
 */
const getInventoryItems = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { blood_group, status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['blood_bank_id = ?'];
    let params = [bankId];

    if (blood_group) { where.push('blood_group = ?'); params.push(blood_group); }
    if (status) { where.push('status = ?'); params.push(status); }

    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM bloodbank_inventory_items WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM bloodbank_inventory_items WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Inventory fetched.',
      data: rows.map((r) => ({
        id: r.id,
        blood_group: r.blood_group,
        units: r.units,
        blood_type: r.blood_type,
        batch_number: r.batch_number,
        collection_date: r.collection_date,
        expiry_date: r.expiry_date,
        storage_location: r.storage_location,
        rack_number: r.rack_number,
        donor_id: r.donor_id,
        donor_name: r.donor_name,
        test_report_url: r.test_report_url,
        collection_document_url: r.collection_document_url,
        status: r.status,
        remarks: r.remarks,
        created_at: r.created_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('getInventoryItems error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/bloodbank/inventory/summary
 * Summary grouped by blood group (for dashboard/list view)
 */
const getInventorySummary = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;

    const [rows] = await pool.query(
      `SELECT blood_group,
              SUM(units) as total_units,
              SUM(CASE WHEN status = 'available' THEN units ELSE 0 END) as available_units,
              SUM(CASE WHEN status = 'reserved' THEN units ELSE 0 END) as reserved_units,
              SUM(CASE WHEN status = 'available' AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN units ELSE 0 END) as expire_soon
       FROM bloodbank_inventory_items
       WHERE blood_bank_id = ? AND status IN ('available', 'reserved')
       GROUP BY blood_group
       ORDER BY blood_group`,
      [bankId]
    );

    const LOW_STOCK_THRESHOLD = 10;
    let totalUnits = 0;
    let availableUnits = 0;
    let reservedUnits = 0;
    let lowStockGroups = 0;

    const groups = rows.map((r) => {
      totalUnits += r.total_units;
      availableUnits += r.available_units;
      reservedUnits += r.reserved_units;
      const isLow = r.available_units <= LOW_STOCK_THRESHOLD;
      if (isLow) lowStockGroups++;

      let statusLabel = 'healthy';
      if (r.available_units <= 5) statusLabel = 'critical';
      else if (r.available_units <= LOW_STOCK_THRESHOLD) statusLabel = 'low_stock';

      return {
        blood_group: r.blood_group,
        total_units: r.total_units,
        available_units: r.available_units,
        reserved_units: r.reserved_units,
        expire_soon: r.expire_soon,
        status: statusLabel,
      };
    });

    return res.status(200).json({
      message: 'Inventory summary fetched.',
      data: {
        total_units: totalUnits,
        available_units: availableUnits,
        reserved_units: reservedUnits,
        low_stock_groups: lowStockGroups,
        groups,
      },
    });
  } catch (error) {
    console.error('getInventorySummary error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/bloodbank/inventory/:id
 * Update inventory item (status, units, storage, remarks)
 */
const updateInventoryItem = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { id } = req.params;

    const [existing] = await pool.query('SELECT id, blood_group FROM bloodbank_inventory_items WHERE id = ? AND blood_bank_id = ?', [id, bankId]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Inventory item not found.' });
    }

    const allowedFields = ['units', 'blood_type', 'expiry_date', 'storage_location', 'rack_number', 'donor_id', 'donor_name', 'test_report_url', 'collection_document_url', 'status', 'remarks'];
    const fields = [];
    const values = [];

    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }

    if (!fields.length) return res.status(400).json({ message: 'Nothing to update.' });

    values.push(id, bankId);
    await pool.query(`UPDATE bloodbank_inventory_items SET ${fields.join(', ')} WHERE id = ? AND blood_bank_id = ?`, values);

    // Update summary
    await updateInventorySummary(bankId, existing[0].blood_group);

    return res.status(200).json({ message: 'Inventory updated.' });
  } catch (error) {
    console.error('updateInventoryItem error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/v1/bloodbank/inventory/:id
 * Remove/discard inventory item
 */
const deleteInventoryItem = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { id } = req.params;

    const [existing] = await pool.query('SELECT id, blood_group FROM bloodbank_inventory_items WHERE id = ? AND blood_bank_id = ?', [id, bankId]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Inventory item not found.' });
    }

    await pool.query('DELETE FROM bloodbank_inventory_items WHERE id = ? AND blood_bank_id = ?', [id, bankId]);

    // Update summary
    await updateInventorySummary(bankId, existing[0].blood_group);

    return res.status(200).json({ message: 'Inventory item removed.' });
  } catch (error) {
    console.error('deleteInventoryItem error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * Helper: Update bloodbank_inventory summary table from items
 */
const updateInventorySummary = async (bankId, bloodGroup) => {
  const [summary] = await pool.query(
    `SELECT SUM(CASE WHEN status = 'available' THEN units ELSE 0 END) as available
     FROM bloodbank_inventory_items
     WHERE blood_bank_id = ? AND blood_group = ?`,
    [bankId, bloodGroup]
  );

  const available = summary[0].available || 0;

  // Check if exists in summary table
  const [existing] = await pool.query(
    'SELECT id FROM bloodbank_inventory WHERE blood_bank_id = ? AND blood_group = ?',
    [bankId, bloodGroup]
  );

  if (existing.length) {
    await pool.query('UPDATE bloodbank_inventory SET available_units = ? WHERE blood_bank_id = ? AND blood_group = ?', [available, bankId, bloodGroup]);
  } else {
    await pool.query('INSERT INTO bloodbank_inventory (blood_bank_id, blood_group, available_units) VALUES (?, ?, ?)', [bankId, bloodGroup, available]);
  }
};

/**
 * GET /api/v1/bloodbank/inventory/:id
 * Single inventory item (bag) detail by id.
 */
const getInventoryItemDetail = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM bloodbank_inventory_items WHERE id = ? AND blood_bank_id = ?',
      [id, bankId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Inventory item not found.' });

    const r = rows[0];
    return res.status(200).json({
      message: 'Inventory item fetched.',
      data: {
        id: r.id,
        blood_group: r.blood_group,
        units: r.units,
        blood_type: r.blood_type,
        batch_number: r.batch_number,
        collection_date: r.collection_date,
        expiry_date: r.expiry_date,
        storage_location: r.storage_location,
        rack_number: r.rack_number,
        donor_id: r.donor_id,
        donor_name: r.donor_name,
        test_report_url: r.test_report_url,
        collection_document_url: r.collection_document_url,
        status: r.status,
        remarks: r.remarks,
        created_at: r.created_at,
        updated_at: r.updated_at,
        // Individual bags derived from units (1 bag = 1 unit)
        bags: buildBags(r),
      },
    });
  } catch (error) {
    console.error('getInventoryItemDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  addInventory,
  getInventoryItems,
  getInventorySummary,
  getInventoryItemDetail,
  updateInventoryItem,
  deleteInventoryItem,
};
