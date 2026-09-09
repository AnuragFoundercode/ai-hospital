const { pool } = require('../config/database');

// ─────────────────────────────────────────────
// NOTIFICATIONS - list + mark read (shared by all roles)
// Each role's route passes its recipientType; the recipientId is
// taken from whichever auth object the middleware set.
// ─────────────────────────────────────────────

// Map recipientType -> the req property the auth middleware populates
const AUTH_PROP = {
  user: 'user',
  doctor: 'doctor',
  pharmacy: 'pharmacy',
  pathology_lab: 'lab',
  diagnostic_center: 'diagnostic',
  blood_bank: 'bloodbank',
  ambulance_service: 'ambulance',
  delivery_partner: 'delivery',
  blood_delivery_partner: 'bloodDelivery',
  sample_collector: 'collector',
};

const resolveRecipient = (req, recipientType) => {
  const prop = AUTH_PROP[recipientType];
  const actor = prop ? req[prop] : null;
  return actor ? actor.id : null;
};

/**
 * GET /notifications?page=&limit=&unread=true
 * Returns this recipient's notifications (newest first) + unread count.
 */
const list = (recipientType) => async (req, res) => {
  try {
    const recipientId = resolveRecipient(req, recipientType);
    if (!recipientId) return res.status(401).json({ message: 'Unauthorized.' });

    const { page = 1, limit = 20, unread } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = ['recipient_type = ?', 'recipient_id = ?'];
    const params = [recipientType, recipientId];
    if (unread === 'true') where.push('is_read = 0');
    const whereClause = where.join(' AND ');

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM notifications WHERE ${whereClause}`, params);
    const [unreadRows] = await pool.query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0',
      [recipientType, recipientId]
    );
    const [rows] = await pool.query(
      `SELECT id, title, body, type, reference_type, reference_id, is_read, sent_at
       FROM notifications WHERE ${whereClause} ORDER BY sent_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Notifications fetched.',
      data: rows,
      unread_count: unreadRows[0].unread,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countRows[0].total, total_pages: Math.ceil(countRows[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('notifications list error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /notifications/:id/read  — mark one as read
 */
const markRead = (recipientType) => async (req, res) => {
  try {
    const recipientId = resolveRecipient(req, recipientType);
    if (!recipientId) return res.status(401).json({ message: 'Unauthorized.' });

    const [result] = await pool.query(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND recipient_type = ? AND recipient_id = ?',
      [req.params.id, recipientType, recipientId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Notification not found.' });
    return res.status(200).json({ message: 'Marked as read.' });
  } catch (error) {
    console.error('notifications markRead error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /notifications/read-all — mark all as read
 */
const markAllRead = (recipientType) => async (req, res) => {
  try {
    const recipientId = resolveRecipient(req, recipientType);
    if (!recipientId) return res.status(401).json({ message: 'Unauthorized.' });

    await pool.query(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0',
      [recipientType, recipientId]
    );
    return res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('notifications markAllRead error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { list, markRead, markAllRead };
