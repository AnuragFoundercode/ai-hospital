const { pool } = require('../config/database');

/**
 * Called after a vendor re-submits a registration step.
 * If that step was in the rejected_steps list, remove it. When no rejected
 * steps remain (and the vendor was in 'rejected' state), flip the profile back
 * to 'pending' and clear the rejection reason so admin can re-review.
 *
 * @param {string} table  e.g. 'delivery_partners'
 * @param {number} id     vendor row id
 * @param {number} step   the step number that was just submitted
 */
const clearRejectedStep = async (table, id, step) => {
  try {
    const [rows] = await pool.query(`SELECT verification_status, rejected_steps FROM ${table} WHERE id = ?`, [id]);
    if (!rows.length) return;
    const current = rows[0].rejected_steps;
    if (!current) return; // nothing was rejected

    const remaining = String(current)
      .split(',')
      .map((s) => parseInt(s.trim()))
      .filter((n) => Number.isInteger(n) && n !== parseInt(step));

    if (remaining.length) {
      // still has other rejected steps to fix
      await pool.query(`UPDATE ${table} SET rejected_steps = ? WHERE id = ?`, [remaining.join(','), id]);
    } else {
      // all rejected steps fixed -> back to pending for admin review
      await pool.query(
        `UPDATE ${table} SET rejected_steps = NULL, rejection_reason = NULL, verification_status = 'pending' WHERE id = ?`,
        [id]
      );
    }
  } catch (e) {
    console.error(`clearRejectedStep(${table}, ${id}, ${step}) error:`, e.message);
  }
};

module.exports = { clearRejectedStep };
