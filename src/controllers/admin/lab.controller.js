const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN PATHOLOGY LAB MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/labs?page=&limit=&search=&verification_status=&is_active=&zone_id=
 * + global summary (total labs / active labs / total bookings) — unaffected by filters.
 */
const getLabs = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, is_active, zone_id } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('(l.name LIKE ? OR l.owner_name LIKE ? OR l.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('l.verification_status = ?'); params.push(verification_status); }
    if (is_active !== undefined) { where.push('l.is_active = ?'); params.push(parseInt(is_active)); }
    if (zone_id) { where.push('l.zone_id = ?'); params.push(parseInt(zone_id)); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM pathology_labs l WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT l.id, l.uuid, l.name, l.owner_name, l.mobile, l.email, l.profile_photo, l.city,
              l.zone_id, z.name AS zone_name, l.verification_status, l.is_active, l.average_rating, l.created_at,
              COALESCE(w.balance, 0) AS wallet_balance,
              (SELECT COUNT(*) FROM bookings b WHERE b.service_type = 'pathology_test' AND b.provider_id = l.id) AS total_bookings
       FROM pathology_labs l
       LEFT JOIN zones z ON l.zone_id = z.id
       LEFT JOIN lab_wallets w ON w.lab_id = l.id
       WHERE ${whereClause} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(is_active = 1) AS active FROM pathology_labs`
    );
    const [[bk]] = await pool.query("SELECT COUNT(*) AS total FROM bookings WHERE service_type = 'pathology_test'");

    return res.status(200).json({
      message: 'Labs fetched.',
      summary: {
        total_labs: summary.total,
        active_labs: Number(summary.active) || 0,
        total_bookings: bk.total,
      },
      data: rows.map((l) => ({
        id: l.uuid,
        db_id: l.id,
        lab_name: l.name,
        owner_name: l.owner_name,
        mobile: l.mobile,
        email: l.email,
        profile_photo: l.profile_photo,
        city: l.city,
        zone: l.zone_name,
        zone_id: l.zone_id,
        total_bookings: l.total_bookings,
        wallet_balance: l.wallet_balance,
        average_rating: l.average_rating,
        status: l.verification_status,
        is_active: !!l.is_active,
        created_at: l.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getLabs error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const resolveLabId = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM pathology_labs WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * GET /api/v1/admin/labs/:id
 * Full lab profile + stats + booking/payout summary.
 */
const getLabDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT l.*, z.name AS zone_name FROM pathology_labs l LEFT JOIN zones z ON l.zone_id = z.id WHERE l.uuid = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Lab not found.' });
    const l = rows[0];
    const lid = l.id;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM lab_bank_details WHERE lab_id = ?', [lid]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM lab_wallets WHERE lab_id = ?', [lid]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    const [[bk]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'completed') AS completed,
              SUM(status IN ('cancelled','failed')) AS cancelled,
              SUM(status NOT IN ('completed','cancelled','failed')) AS pending,
              SUM(DATE(created_at) = ?) AS today
       FROM bookings WHERE service_type = 'pathology_test' AND provider_id = ?`, [today, lid]
    );

    const [[payout]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status = 'processed' THEN amount END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending,
              MAX(CASE WHEN status = 'processed' THEN processed_at END) AS last_settlement
       FROM lab_withdrawals WHERE lab_id = ?`, [lid]
    );

    return res.status(200).json({
      message: 'Lab detail fetched.',
      data: {
        id: l.uuid,
        verification_status: l.verification_status,
        is_active: !!l.is_active,
        profile: { name: l.name, owner_name: l.owner_name, mobile: l.mobile, email: l.email, profile_photo: l.profile_photo, about: l.about_description },
        licenses: { nabl_accreditation_number: l.nabl_accreditation_number, lab_license_number: l.lab_license_number, gst_number: l.gst_number, pan_number: l.pan_number, nabl_certificate_url: l.nabl_certificate_url, lab_license_url: l.lab_license_url, gst_certificate_url: l.gst_certificate_url, pan_card_url: l.pan_card_url },
        address: { address_line1: l.address_line1, address_line2: l.address_line2, landmark: l.landmark, city: l.city, state: l.state, pincode: l.pincode, zone_id: l.zone_id, zone_name: l.zone_name, latitude: l.latitude, longitude: l.longitude },
        settings: { home_collection_available: !!l.home_collection_available, home_collection_radius_km: l.home_collection_radius_km, opening_time: l.opening_time, closing_time: l.closing_time },
        bank: bankRows[0] || null,
        stats: {
          total_bookings: bk.total,
          today_bookings: Number(bk.today) || 0,
          total_lab_earning: wallet.total_earned,
          wallet_balance: wallet.balance,
          pending_payout: parseFloat(payout.pending),
          average_rating: l.average_rating,
          registration_date: l.created_at,
        },
        booking_summary: {
          total: bk.total,
          completed: Number(bk.completed) || 0,
          pending: Number(bk.pending) || 0,
          cancelled: Number(bk.cancelled) || 0,
        },
        payout_summary: {
          total_payout: parseFloat(payout.total_paid),
          pending_payout: parseFloat(payout.pending),
          last_settlement_date: payout.last_settlement,
        },
      },
    });
  } catch (error) {
    console.error('admin getLabDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/labs/:id/toggle-status
 */
const toggleLabStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM pathology_labs WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Lab not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE pathology_labs SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Lab activated.' : 'Lab deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin toggleLabStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/labs/:id/bookings?page=&limit=&status=
 */
const getLabBookings = async (req, res) => {
  try {
    const lid = await resolveLabId(req.params.id);
    if (!lid) return res.status(404).json({ message: 'Lab not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ["b.service_type = 'pathology_test'", 'b.provider_id = ?']; const params = [lid];
    if (status) { where.push('b.status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM bookings b WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT b.booking_id, b.status, b.payment_status, b.final_amount, b.booking_date, b.slot_start_time, b.metadata, b.created_at,
              u.uuid AS user_uuid, u.full_name AS user_name, u.profile_photo AS user_photo, u.mobile AS user_mobile
       FROM bookings b JOIN users u ON b.user_id = u.id
       WHERE ${whereClause} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Bookings fetched.',
      data: rows.map((r) => {
        const md = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});
        return {
          booking_id: r.booking_id, status: r.status, payment_status: r.payment_status, amount: r.final_amount,
          date: r.booking_date, slot_time: r.slot_start_time,
          collection_type: md.collection_type, tests: md.tests || [],
          user: { id: r.user_uuid, name: r.user_name, profile_photo: r.user_photo, mobile: r.user_mobile },
          created_at: r.created_at,
        };
      }),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getLabBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/labs/:id/transactions?page=&limit=&type=
 */
const getLabTransactions = async (req, res) => {
  try {
    const lid = await resolveLabId(req.params.id);
    if (!lid) return res.status(404).json({ message: 'Lab not found.' });

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['lab_id = ?']; const params = [lid];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM lab_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, balance_after, created_at
       FROM lab_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getLabTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/labs/:id/settlements?page=&limit=&status=
 * Withdrawal / settlement history.
 */
const getLabSettlements = async (req, res) => {
  try {
    const lid = await resolveLabId(req.params.id);
    if (!lid) return res.status(404).json({ message: 'Lab not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['lab_id = ?']; const params = [lid];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM lab_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM lab_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Settlements fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getLabSettlements error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/lab-bookings
 * Global pathology booking list.
 * Filters: zone_id, lab_id (uuid), status, payment_status, from, to, search. Pagination.
 */
const getAllBookings = async (req, res) => {
  try {
    const { zone_id, lab_id, status, payment_status, from, to, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ["b.service_type = 'pathology_test'"]; const params = [];
    if (zone_id) { where.push('l.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (lab_id) { where.push('l.uuid = ?'); params.push(lab_id); }
    if (status) { where.push('b.status = ?'); params.push(status); }
    if (payment_status) { where.push('b.payment_status = ?'); params.push(payment_status); }
    if (from) { where.push('b.created_at >= ?'); params.push(from); }
    if (to) { where.push('b.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (search) { where.push('(b.booking_id LIKE ? OR u.full_name LIKE ? OR u.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM bookings b JOIN users u ON b.user_id = u.id LEFT JOIN pathology_labs l ON b.provider_id = l.id WHERE ${whereClause}`, params
    );
    const [rows] = await pool.query(
      `SELECT b.booking_id, b.status, b.payment_status, b.final_amount, b.booking_date, b.slot_start_time, b.metadata, b.created_at,
              u.uuid AS user_uuid, u.full_name AS patient_name, u.mobile AS patient_mobile,
              l.uuid AS lab_uuid, l.name AS lab_name, l.mobile AS lab_mobile, l.zone_id, z.name AS zone_name,
              sc.uuid AS collector_uuid, sc.full_name AS collector_name, sc.mobile AS collector_mobile,
              scr.status AS collection_status
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       LEFT JOIN pathology_labs l ON b.provider_id = l.id
       LEFT JOIN zones z ON l.zone_id = z.id
       LEFT JOIN sample_collection_requests scr ON scr.booking_id = b.id
       LEFT JOIN sample_collectors sc ON scr.collector_id = sc.id
       WHERE ${whereClause} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Bookings fetched.',
      data: rows.map((b) => {
        const md = typeof b.metadata === 'string' ? JSON.parse(b.metadata || '{}') : (b.metadata || {});
        return {
          booking_id: b.booking_id,
          patient: { id: b.user_uuid, name: b.patient_name, mobile: b.patient_mobile },
          mobile: b.patient_mobile,
          zone: b.zone_name,
          lab: b.lab_uuid ? { id: b.lab_uuid, name: b.lab_name, mobile: b.lab_mobile } : null,
          collection_partner: b.collector_uuid ? { id: b.collector_uuid, name: b.collector_name, mobile: b.collector_mobile, collection_status: b.collection_status } : null,
          tests: md.tests || [],
          collection_type: md.collection_type || null,
          status: b.status,
          payment_status: b.payment_status,
          amount: b.final_amount,
          booking_date: b.created_at,
        };
      }),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getAllBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getLabs,
  getLabDetail,
  toggleLabStatus,
  getLabBookings,
  getLabTransactions,
  getLabSettlements,
  getAllBookings,
};
