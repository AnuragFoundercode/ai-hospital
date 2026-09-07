const { pool } = require('../config/database');
const notificationService = require('./notification.service');

// ─────────────────────────────────────────────
// CENTRAL NOTIFICATION HELPER
// One call = FCM push (if token) + persisted notifications row.
// Resolves the recipient's fcm_token from the correct table.
// ─────────────────────────────────────────────

// recipient_type -> table that holds its fcm_token
const RECIPIENT_TABLE = {
  user: 'users',
  doctor: 'doctors',
  pharmacy: 'pharmacies',
  pathology_lab: 'pathology_labs',
  blood_bank: 'blood_banks',
  diagnostic_center: 'diagnostic_centers',
  ambulance_service: 'ambulance_services',
  delivery_partner: 'delivery_partners',
  blood_delivery_partner: 'blood_delivery_partners',
  sample_collector: 'sample_collectors',
};

/**
 * Send a notification to a recipient.
 * @param {string} recipientType - user | doctor | pharmacy | pathology_lab | blood_bank | diagnostic_center | ambulance_service | delivery_partner | sample_collector
 * @param {number} recipientId   - internal numeric id in that recipient's table
 * @param {object} opts
 *   - title (string, required)
 *   - body (string, required)
 *   - type (enum: booking|payment|order|call|report|ambulance|promotional|system) default 'system'
 *   - reference_type (string) e.g. 'call' | 'order' | 'booking'
 *   - reference_id (number)   internal id of the referenced entity
 *   - reference_code (string) PUBLIC id for deep-linking e.g. 'ORD-..' | 'CALL-..' | 'BK-..'
 *   - data (object)           extra key/values for FCM data payload (stringified)
 *   - fcmToken (string)       optional: pass token directly to skip the DB lookup
 * @returns {Promise<{ persisted: boolean, pushed: boolean }>}
 */
const notify = async (recipientType, recipientId, opts = {}) => {
  const { title, body, type = 'system', reference_type = null, reference_id = null, reference_code = null, data = {} } = opts;
  let result = { persisted: false, pushed: false };

  if (!recipientType || !recipientId || !title || !body) {
    console.warn('notify: missing required fields', { recipientType, recipientId, title });
    return result;
  }

  // 1) Resolve fcm_token (unless caller supplied one)
  let fcmToken = opts.fcmToken || null;
  if (!fcmToken) {
    const table = RECIPIENT_TABLE[recipientType];
    if (table) {
      try {
        const [rows] = await pool.query(`SELECT fcm_token FROM ${table} WHERE id = ?`, [recipientId]);
        fcmToken = rows[0]?.fcm_token || null;
      } catch (e) {
        console.error(`notify: fcm_token lookup failed for ${recipientType}#${recipientId}:`, e.message);
      }
    }
  }

  // 2) Send FCM (best-effort)
  if (fcmToken) {
    try {
      const dataPayload = {};
      for (const [k, v] of Object.entries(data || {})) dataPayload[k] = String(v);
      if (reference_type) dataPayload.reference_type = String(reference_type);
      if (reference_id != null) dataPayload.reference_id = String(reference_id);
      if (reference_code != null) dataPayload.reference_code = String(reference_code);
      dataPayload.notif_type = String(type);

      // USER -> notification + data (system tray + handler).
      // VENDOR (everything except 'user') -> data-only (app builds its own popup).
      const dataOnly = recipientType !== 'user';

      const res = await notificationService.sendToDevice(fcmToken, title, body, dataPayload, { dataOnly });
      result.pushed = !!res?.success;
    } catch (e) {
      console.error('notify: FCM send failed:', e.message);
    }
  }

  // 3) Persist row (best-effort; never blocks the main flow)
  try {
    await pool.query(
      `INSERT INTO notifications (recipient_type, recipient_id, title, body, type, reference_type, reference_id, reference_code, sent_via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [recipientType, recipientId, title, body, type, reference_type, reference_id, reference_code, fcmToken ? 'push' : 'sms']
    );
    result.persisted = true;
  } catch (e) {
    console.error('notify: persist failed:', e.message);
  }

  return result;
};

module.exports = { notify };
