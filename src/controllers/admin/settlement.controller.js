const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN UNIFIED SETTLEMENTS (WITHDRAWALS) MANAGEMENT
// Across all vendor types: doctor, pharmacy, lab, diagnostic,
// bloodbank, delivery, blood_delivery, ambulance, collector.
// ─────────────────────────────────────────────

// Per vendor-type config: withdrawal table, fk column, vendor table, name expr, wallet table.
const VENDORS = {
  doctor:         { wt: 'doctor_withdrawals',            fk: 'doctor_id',            vt: 'doctors',                nameCol: 'full_name',  wallet: 'doctor_wallets',            wfk: 'doctor_id' },
  pharmacy:       { wt: 'pharmacy_withdrawals',          fk: 'pharmacy_id',          vt: 'pharmacies',             nameCol: 'name',       wallet: 'pharmacy_wallets',          wfk: 'pharmacy_id' },
  lab:            { wt: 'lab_withdrawals',               fk: 'lab_id',               vt: 'pathology_labs',         nameCol: 'name',       wallet: 'lab_wallets',               wfk: 'lab_id' },
  diagnostic:     { wt: 'diagnostic_withdrawals',        fk: 'diagnostic_center_id', vt: 'diagnostic_centers',     nameCol: 'name',       wallet: 'diagnostic_wallets',        wfk: 'diagnostic_center_id' },
  bloodbank:      { wt: 'bloodbank_withdrawals',         fk: 'blood_bank_id',        vt: 'blood_banks',            nameCol: 'name',       wallet: 'bloodbank_wallets',         wfk: 'blood_bank_id' },
  delivery:       { wt: 'delivery_withdrawals',          fk: 'delivery_partner_id',  vt: 'delivery_partners',      nameCol: 'full_name',  wallet: 'delivery_wallets',          wfk: 'delivery_partner_id' },
  blood_delivery: { wt: 'blood_delivery_withdrawals',    fk: 'delivery_partner_id',  vt: 'blood_delivery_partners',nameCol: 'full_name',  wallet: 'blood_delivery_wallets',    wfk: 'delivery_partner_id' },
  ambulance:      { wt: 'ambulance_withdrawals',         fk: 'ambulance_service_id', vt: 'ambulance_services',     nameCol: 'name',       wallet: 'ambulance_wallets',         wfk: 'ambulance_service_id' },
  collector:      { wt: 'sample_collector_withdrawals',  fk: 'collector_id',         vt: 'sample_collectors',      nameCol: 'full_name',  wallet: 'sample_collector_wallets',  wfk: 'collector_id' },
};

// One SELECT per vendor type, normalized to the same columns.
const buildSelect = (key) => {
  const c = VENDORS[key];
  return `SELECT w.id, '${key}' AS vendor_type, w.${c.fk} AS vendor_internal_id,
                 v.uuid AS vendor_uuid, v.${c.nameCol} AS vendor_name, v.mobile AS vendor_mobile,
                 w.amount, w.status, w.remarks, w.admin_remarks, w.processed_at, w.created_at
          FROM ${c.wt} w
          JOIN ${c.vt} v ON w.${c.fk} = v.id`;
};

/**
 * GET /api/v1/admin/settlements
 * Unified list across all vendor types.
 * Filters: vendor_type, status, from, to, search, min_amount, max_amount. Pagination.
 * + global summary (by status), unaffected by filters.
 */
const getSettlements = async (req, res) => {
  try {
    const { vendor_type, status, from, to, search, min_amount, max_amount, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const keys = vendor_type && VENDORS[vendor_type] ? [vendor_type] : Object.keys(VENDORS);

    // Build UNION ALL of per-vendor selects, then filter on outer query.
    const union = keys.map(buildSelect).join('\n        UNION ALL\n        ');

    const where = ['1=1']; const params = [];
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (from) { where.push('t.created_at >= ?'); params.push(from); }
    if (to) { where.push('t.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (min_amount) { where.push('t.amount >= ?'); params.push(parseFloat(min_amount)); }
    if (max_amount) { where.push('t.amount <= ?'); params.push(parseFloat(max_amount)); }
    if (search) { where.push('(t.vendor_name LIKE ? OR t.vendor_mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    const whereClause = where.join(' AND ');

    const baseQuery = `FROM (${union}) t WHERE ${whereClause}`;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total ${baseQuery}`, params);
    const [rows] = await pool.query(
      `SELECT t.* ${baseQuery} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    // Global summary by status (all vendor types, ignore filters).
    const summaryUnion = Object.keys(VENDORS).map((k) => `SELECT status, amount FROM ${VENDORS[k].wt}`).join(' UNION ALL ');
    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status='pending') AS pending,
              SUM(status='approved') AS approved,
              SUM(status='rejected') AS rejected,
              SUM(status='processed') AS processed,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending_amount,
              COALESCE(SUM(CASE WHEN status='processed' THEN amount END),0) AS processed_amount
       FROM (${summaryUnion}) s`
    );

    return res.status(200).json({
      message: 'Settlements fetched.',
      summary: {
        total: summary.total,
        pending: Number(summary.pending) || 0,
        approved: Number(summary.approved) || 0,
        rejected: Number(summary.rejected) || 0,
        processed: Number(summary.processed) || 0,
        pending_amount: parseFloat(summary.pending_amount),
        processed_amount: parseFloat(summary.processed_amount),
      },
      data: rows.map((r) => ({
        id: r.id,
        vendor_type: r.vendor_type,
        vendor: { id: r.vendor_uuid, name: r.vendor_name, mobile: r.vendor_mobile },
        amount: r.amount,
        status: r.status,
        remarks: r.remarks,
        admin_remarks: r.admin_remarks,
        processed_at: r.processed_at,
        requested_at: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getSettlements error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

// Fetch a single withdrawal row for a vendor type.
const fetchWithdrawal = async (cfg, id) => {
  const [rows] = await pool.query(`SELECT * FROM ${cfg.wt} WHERE id = ?`, [id]);
  return rows[0] || null;
};

/**
 * PUT /api/v1/admin/settlements/:vendorType/:id/approve
 * pending -> approved. Body: { admin_remarks? }
 */
const approveSettlement = async (req, res) => {
  try {
    const cfg = VENDORS[req.params.vendorType];
    if (!cfg) return res.status(404).json({ message: 'Unknown vendor type.' });
    const row = await fetchWithdrawal(cfg, req.params.id);
    if (!row) return res.status(404).json({ message: 'Settlement not found.' });
    if (row.status !== 'pending') return res.status(400).json({ message: `Cannot approve a ${row.status} settlement.` });

    await pool.query(
      `UPDATE ${cfg.wt} SET status = 'approved', admin_remarks = ?, updated_at = NOW() WHERE id = ?`,
      [req.body.admin_remarks || null, req.params.id]
    );
    return res.status(200).json({ message: 'Settlement approved.', data: { id: parseInt(req.params.id), vendor_type: req.params.vendorType, status: 'approved' } });
  } catch (error) {
    console.error('admin approveSettlement error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/settlements/:vendorType/:id/reject
 * pending|approved -> rejected. Body: { admin_remarks? }
 */
const rejectSettlement = async (req, res) => {
  try {
    const cfg = VENDORS[req.params.vendorType];
    if (!cfg) return res.status(404).json({ message: 'Unknown vendor type.' });
    const row = await fetchWithdrawal(cfg, req.params.id);
    if (!row) return res.status(404).json({ message: 'Settlement not found.' });
    if (!['pending', 'approved'].includes(row.status)) return res.status(400).json({ message: `Cannot reject a ${row.status} settlement.` });

    await pool.query(
      `UPDATE ${cfg.wt} SET status = 'rejected', admin_remarks = ?, updated_at = NOW() WHERE id = ?`,
      [req.body.admin_remarks || null, req.params.id]
    );
    return res.status(200).json({ message: 'Settlement rejected.', data: { id: parseInt(req.params.id), vendor_type: req.params.vendorType, status: 'rejected' } });
  } catch (error) {
    console.error('admin rejectSettlement error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/settlements/:vendorType/:id/process
 * approved -> processed. Deducts amount from vendor wallet (balance) and adds to total_withdrawn.
 * Body: { admin_remarks? }
 */
const processSettlement = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const cfg = VENDORS[req.params.vendorType];
    if (!cfg) { conn.release(); return res.status(404).json({ message: 'Unknown vendor type.' }); }

    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT * FROM ${cfg.wt} WHERE id = ? FOR UPDATE`, [req.params.id]);
    const row = rows[0];
    if (!row) { await conn.rollback(); conn.release(); return res.status(404).json({ message: 'Settlement not found.' }); }
    if (row.status !== 'approved') { await conn.rollback(); conn.release(); return res.status(400).json({ message: `Only approved settlements can be processed (current: ${row.status}).` }); }

    // Deduct from wallet balance, bump total_withdrawn.
    await conn.query(
      `UPDATE ${cfg.wallet} SET balance = balance - ?, total_withdrawn = total_withdrawn + ?, updated_at = NOW() WHERE ${cfg.wfk} = ?`,
      [row.amount, row.amount, row[cfg.fk]]
    );
    await conn.query(
      `UPDATE ${cfg.wt} SET status = 'processed', admin_remarks = ?, processed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [req.body.admin_remarks || row.admin_remarks || null, req.params.id]
    );

    await conn.commit();
    conn.release();
    return res.status(200).json({ message: 'Settlement processed & wallet updated.', data: { id: parseInt(req.params.id), vendor_type: req.params.vendorType, status: 'processed', amount: row.amount } });
  } catch (error) {
    await conn.rollback(); conn.release();
    console.error('admin processSettlement error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getSettlements,
  approveSettlement,
  rejectSettlement,
  processSettlement,
};
