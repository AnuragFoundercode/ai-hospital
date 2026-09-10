const { pool } = require('../../config/database');
const { notify } = require('../../services/notify');

// ─────────────────────────────────────────────
// ADMIN VENDOR MANAGEMENT
// One approve/reject API for ALL vendors.
//  - Multi-step vendors (delivery, blood_delivery, collector, ambulance, doctor):
//    reject can flag specific steps -> stored in rejected_steps; vendor re-submits
//    only those steps.
//  - Single-register vendors (pharmacy, lab, diagnostic, blood_bank):
//    reject is whole-profile with a reason (no steps).
// ─────────────────────────────────────────────

// vendor type -> config
//   table       : DB table
//   nameCol     : column holding the display name (full_name vs name)
//   steps       : number of registration steps (0 = single-register, no steps)
//   hasSteps    : whether the table has rejected_steps + registration_step columns
//   notifyType  : notify() recipient type
//   label       : human label
const VENDORS = {
  delivery:       { table: 'delivery_partners',        nameCol: 'full_name', steps: 4, hasSteps: true,  notifyType: 'delivery_partner',       label: 'Delivery Partner' },
  blood_delivery: { table: 'blood_delivery_partners',  nameCol: 'full_name', steps: 4, hasSteps: true,  notifyType: 'blood_delivery_partner', label: 'Blood Delivery Partner' },
  collector:      { table: 'sample_collectors',        nameCol: 'full_name', steps: 4, hasSteps: true,  notifyType: 'sample_collector',       label: 'Sample Collector' },
  ambulance:      { table: 'ambulance_services',       nameCol: 'full_name', steps: 5, hasSteps: true,  notifyType: 'ambulance_service',      label: 'Ambulance Partner' },
  doctor:         { table: 'doctors',                  nameCol: 'full_name', steps: 4, hasSteps: true,  notifyType: 'doctor',                 label: 'Doctor' },
  pharmacy:       { table: 'pharmacies',               nameCol: 'name',      steps: 0, hasSteps: false, notifyType: 'pharmacy',               label: 'Pharmacy' },
  lab:            { table: 'pathology_labs',           nameCol: 'name',      steps: 0, hasSteps: false, notifyType: 'pathology_lab',          label: 'Pathology Lab' },
  diagnostic:     { table: 'diagnostic_centers',       nameCol: 'name',      steps: 0, hasSteps: false, notifyType: 'diagnostic_center',      label: 'Diagnostic Center' },
  blood_bank:     { table: 'blood_banks',              nameCol: 'name',      steps: 0, hasSteps: false, notifyType: 'blood_bank',             label: 'Blood Bank' },
};

const getVendorConfig = (type) => VENDORS[type] || null;
const invalidType = (res) => res.status(400).json({ message: `Invalid vendor type. Use one of: ${Object.keys(VENDORS).join(', ')}` });

/**
 * GET /api/v1/admin/vendors/:type
 * Query: page, limit, search (name/mobile), verification_status
 */
const getVendors = async (req, res) => {
  try {
    const cfg = getVendorConfig(req.params.type);
    if (!cfg) return invalidType(res);

    const { page = 1, limit = 20, search, verification_status } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1'];
    const params = [];
    if (search) { where.push(`(${cfg.nameCol} LIKE ? OR mobile LIKE ?)`); params.push(`%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('verification_status = ?'); params.push(verification_status); }
    const whereClause = where.join(' AND ');

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM ${cfg.table} WHERE ${whereClause}`, params);
    const total = countRows[0].total;

    const stepCols = cfg.hasSteps ? 'registration_step, rejected_steps,' : '';
    const [rows] = await pool.query(
      `SELECT id, uuid, ${cfg.nameCol} AS name, mobile, email, ${stepCols} verification_status, rejection_reason, is_active, created_at
       FROM ${cfg.table} WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Vendors fetched.',
      data: rows.map((v) => ({
        id: v.uuid,
        db_id: v.id,
        name: v.name,
        mobile: v.mobile,
        email: v.email,
        registration_step: cfg.hasSteps ? v.registration_step : null,
        total_steps: cfg.steps,
        verification_status: v.verification_status,
        rejection_reason: v.rejection_reason,
        rejected_steps: cfg.hasSteps ? parseSteps(v.rejected_steps) : [],
        is_active: !!v.is_active,
        created_at: v.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('admin getVendors error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/vendors/:type/:id
 * Full vendor row (id = uuid).
 */
const getVendorDetail = async (req, res) => {
  try {
    const cfg = getVendorConfig(req.params.type);
    if (!cfg) return invalidType(res);

    const [rows] = await pool.query(`SELECT * FROM ${cfg.table} WHERE uuid = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: `${cfg.label} not found.` });

    const v = rows[0];
    delete v.password_hash;
    delete v.fcm_token;
    v.rejected_steps = cfg.hasSteps ? parseSteps(v.rejected_steps) : [];
    v.total_steps = cfg.steps;
    return res.status(200).json({ message: 'Vendor detail fetched.', data: v });
  } catch (error) {
    console.error('admin getVendorDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/vendors/:type/:id/approve
 */
const approveVendor = async (req, res) => {
  try {
    const cfg = getVendorConfig(req.params.type);
    if (!cfg) return invalidType(res);

    const [rows] = await pool.query(`SELECT id FROM ${cfg.table} WHERE uuid = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: `${cfg.label} not found.` });

    const clearSteps = cfg.hasSteps ? ', rejected_steps = NULL' : '';
    await pool.query(
      `UPDATE ${cfg.table} SET verification_status = 'approved', rejection_reason = NULL${clearSteps} WHERE id = ?`,
      [rows[0].id]
    );

    await notify(cfg.notifyType, rows[0].id, {
      title: 'Profile Approved 🎉',
      body: 'Your account has been verified and approved.',
      type: 'system', reference_type: 'verification', reference_id: rows[0].id,
      data: { event: 'profile_approved' },
    });

    return res.status(200).json({ message: 'Vendor approved.', data: { id: req.params.id, verification_status: 'approved' } });
  } catch (error) {
    console.error('admin approveVendor error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/vendors/:type/:id/reject
 * Body: { reason: "...", steps?: [2,3] }
 *  - Multi-step vendor: pass steps -> only those steps flagged for re-submission.
 *  - Single-register vendor: steps ignored -> whole profile rejected with reason.
 */
const rejectVendor = async (req, res) => {
  try {
    const cfg = getVendorConfig(req.params.type);
    if (!cfg) return invalidType(res);

    let { steps, reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ message: 'reason is required.' });

    const [rows] = await pool.query(`SELECT id FROM ${cfg.table} WHERE uuid = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: `${cfg.label} not found.` });

    // Multi-step vendor with steps provided → per-step rejection
    if (cfg.hasSteps && Array.isArray(steps) && steps.length) {
      const normalized = [...new Set(steps.map((s) => parseInt(s)))].filter((s) => Number.isInteger(s) && s >= 1 && s <= cfg.steps).sort((a, b) => a - b);
      if (!normalized.length) return res.status(400).json({ message: `steps must be between 1 and ${cfg.steps}.` });

      const stepsCsv = normalized.join(',');
      await pool.query(
        `UPDATE ${cfg.table} SET verification_status = 'rejected', rejection_reason = ?, rejected_steps = ? WHERE id = ?`,
        [reason.trim(), stepsCsv, rows[0].id]
      );
      await notify(cfg.notifyType, rows[0].id, {
        title: 'Profile Needs Changes ⚠️',
        body: `Please re-submit step(s) ${stepsCsv}. Reason: ${reason.trim()}`,
        type: 'system', reference_type: 'verification', reference_id: rows[0].id,
        data: { event: 'profile_rejected', rejected_steps: stepsCsv, reason: reason.trim() },
      });
      return res.status(200).json({
        message: 'Vendor rejected. Selected steps flagged for re-submission.',
        data: { id: req.params.id, verification_status: 'rejected', rejected_steps: normalized, reason: reason.trim() },
      });
    }

    // Whole-profile rejection (single-register vendors, or multi-step without steps)
    const clearSteps = cfg.hasSteps ? ', rejected_steps = NULL' : '';
    await pool.query(
      `UPDATE ${cfg.table} SET verification_status = 'rejected', rejection_reason = ?${clearSteps} WHERE id = ?`,
      [reason.trim(), rows[0].id]
    );
    await notify(cfg.notifyType, rows[0].id, {
      title: 'Profile Rejected ❌',
      body: `Your profile was rejected. Reason: ${reason.trim()}`,
      type: 'system', reference_type: 'verification', reference_id: rows[0].id,
      data: { event: 'profile_rejected', reason: reason.trim() },
    });
    return res.status(200).json({
      message: 'Vendor rejected.',
      data: { id: req.params.id, verification_status: 'rejected', rejected_steps: [], reason: reason.trim() },
    });
  } catch (error) {
    console.error('admin rejectVendor error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

// helper: "2,3" -> [2,3]; null/'' -> []
function parseSteps(csv) {
  if (!csv) return [];
  return String(csv).split(',').map((s) => parseInt(s.trim())).filter((n) => Number.isInteger(n));
}

module.exports = {
  getVendors,
  getVendorDetail,
  approveVendor,
  rejectVendor,
};
