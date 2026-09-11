const { pool } = require('../config/database');

/**
 * Record one admin-commission event into the central ledger.
 * Best-effort: never throws (won't break the main flow).
 *
 * @param {object} p
 *   module          - 'pharmacy' | 'delivery' | 'blood_delivery' | 'blood_bank' | 'doctor' | 'diagnostic' | 'ambulance'
 *   reference_type  - e.g. 'order' | 'delivery_request' | 'blood_request' | 'call' | 'booking'
 *   reference_id    - numeric id of that record
 *   reference_code  - human code e.g. 'ORD-123', 'CALL-45'
 *   user_id         - paying customer id (nullable)
 *   vendor_type     - 'pharmacy' | 'delivery_partner' | 'blood_delivery_partner' | 'blood_bank' | 'doctor' | 'diagnostic_center' | 'ambulance_service'
 *   vendor_id       - numeric id of the vendor (nullable)
 *   gross_amount    - amount commission was computed on
 *   commission_percent
 *   commission_amount
 */
const recordCommission = async (p = {}) => {
  try {
    if (!p.module || !(parseFloat(p.commission_amount) >= 0)) return;
    await pool.query(
      `INSERT INTO admin_commissions
        (module, reference_type, reference_id, reference_code, user_id, vendor_type, vendor_id, gross_amount, commission_percent, commission_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.module,
        p.reference_type || null,
        p.reference_id || null,
        p.reference_code || null,
        p.user_id || null,
        p.vendor_type || null,
        p.vendor_id || null,
        parseFloat(p.gross_amount) || 0,
        parseFloat(p.commission_percent) || 0,
        parseFloat(p.commission_amount) || 0,
      ]
    );
  } catch (e) {
    console.error('recordCommission error:', e.message);
  }
};

module.exports = { recordCommission };
