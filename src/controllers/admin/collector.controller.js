const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN SAMPLE COLLECTION (COLLECTOR) MANAGEMENT
// ─────────────────────────────────────────────

const resolveCollectorId = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM sample_collectors WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * GET /api/v1/admin/collectors
 * Filters: search, verification_status, is_active, is_online, zone_id, from, to. Pagination.
 * + global summary (unaffected by filters).
 */
const getCollectors = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, is_active, is_online, zone_id, from, to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('(c.full_name LIKE ? OR c.mobile LIKE ? OR c.uuid LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('c.verification_status = ?'); params.push(verification_status); }
    if (is_active !== undefined && is_active !== '') { where.push('c.is_active = ?'); params.push(is_active === 'true' || is_active === '1' ? 1 : 0); }
    if (is_online !== undefined && is_online !== '') { where.push('c.is_online = ?'); params.push(is_online === 'true' || is_online === '1' ? 1 : 0); }
    if (zone_id) { where.push('c.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (from) { where.push('c.created_at >= ?'); params.push(from); }
    if (to) { where.push('c.created_at <= ?'); params.push(`${to} 23:59:59`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM sample_collectors c WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT c.uuid, c.full_name, c.mobile, c.profile_photo_url, c.verification_status,
              c.is_active, c.is_online, c.average_rating, c.total_collections, c.created_at,
              c.zone_id, z.name AS zone_name,
              COALESCE(w.balance, 0) AS wallet_balance
       FROM sample_collectors c
       LEFT JOIN zones z ON c.zone_id = z.id
       LEFT JOIN sample_collector_wallets w ON w.collector_id = c.id
       WHERE ${whereClause} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(is_active = 1) AS active,
              SUM(is_active = 0) AS inactive,
              SUM(verification_status = 'pending') AS pending,
              SUM(is_online = 1) AS online
       FROM sample_collectors`
    );

    return res.status(200).json({
      message: 'Collectors fetched.',
      summary: {
        total_collectors: summary.total,
        active_collectors: Number(summary.active) || 0,
        inactive_collectors: Number(summary.inactive) || 0,
        pending_collectors: Number(summary.pending) || 0,
        online_collectors: Number(summary.online) || 0,
      },
      data: rows.map((r) => ({
        id: r.uuid,
        name: r.full_name,
        mobile: r.mobile,
        profile_photo: r.profile_photo_url,
        zone: r.zone_name,
        verification_status: r.verification_status,
        is_active: !!r.is_active,
        is_online: !!r.is_online,
        rating: r.average_rating,
        total_collections: r.total_collections,
        wallet_balance: r.wallet_balance,
        registration_date: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getCollectors error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/collectors/:id
 * Full profile + documents + bank + collection/payout stats.
 */
const getCollectorDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT c.*, z.name AS zone_name FROM sample_collectors c LEFT JOIN zones z ON c.zone_id = z.id WHERE c.uuid = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Collector not found.' });
    const c = rows[0];
    const cid = c.id;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM sample_collector_bank_details WHERE collector_id = ?', [cid]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM sample_collector_wallets WHERE collector_id = ?', [cid]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    const [[coll]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(DATE(created_at) = ?) AS today,
              SUM(status = 'delivered_to_lab') AS completed,
              SUM(status = 'cancelled') AS cancelled,
              SUM(status NOT IN ('delivered_to_lab','cancelled')) AS ongoing
       FROM sample_collection_requests WHERE collector_id = ?`, [today, cid]
    );
    const [[payout]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status='processed' THEN amount END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending
       FROM sample_collector_withdrawals WHERE collector_id = ?`, [cid]
    );

    return res.status(200).json({
      message: 'Collector detail fetched.',
      data: {
        id: c.uuid,
        verification_status: c.verification_status,
        rejection_reason: c.rejection_reason,
        is_active: !!c.is_active,
        is_online: !!c.is_online,
        profile: {
          name: c.full_name, mobile: c.mobile, email: c.email, profile_photo: c.profile_photo_url,
          date_of_birth: c.date_of_birth, gender: c.gender, experience_years: c.experience_years,
          qualifications: c.qualifications,
          zone_id: c.zone_id, zone_name: c.zone_name,
          latitude: c.latitude, longitude: c.longitude,
        },
        documents: {
          aadhaar_url: c.aadhaar_url,
          pan_url: c.pan_url,
          dl_url: c.dl_url,
          profile_photo_url: c.profile_photo_url,
        },
        bank: bankRows[0] || null,
        stats: {
          total_collections: coll.total,
          today_collections: Number(coll.today) || 0,
          completed_collections: Number(coll.completed) || 0,
          cancelled_collections: Number(coll.cancelled) || 0,
          ongoing_collections: Number(coll.ongoing) || 0,
          total_earned: wallet.total_earned,
          wallet_balance: wallet.balance,
          total_withdrawn: wallet.total_withdrawn,
          pending_payout: parseFloat(payout.pending),
          completed_payout: parseFloat(payout.total_paid),
          average_rating: c.average_rating,
          registration_date: c.created_at,
        },
      },
    });
  } catch (error) {
    console.error('admin getCollectorDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/collectors/:id/toggle-status
 */
const toggleCollectorStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM sample_collectors WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Collector not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE sample_collectors SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Collector activated.' : 'Collector deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin toggleCollectorStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/collectors/:id/transactions?page=&limit=&type=
 */
const getCollectorTransactions = async (req, res) => {
  try {
    const cid = await resolveCollectorId(req.params.id);
    if (!cid) return res.status(404).json({ message: 'Collector not found.' });

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['collector_id = ?']; const params = [cid];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM sample_collector_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, balance_after, created_at
       FROM sample_collector_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getCollectorTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/collectors/:id/settlements?page=&limit=&status=
 */
const getCollectorSettlements = async (req, res) => {
  try {
    const cid = await resolveCollectorId(req.params.id);
    if (!cid) return res.status(404).json({ message: 'Collector not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['collector_id = ?']; const params = [cid];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM sample_collector_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM sample_collector_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Settlements fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getCollectorSettlements error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/collections
 * Global sample collection list.
 * Filters: collector_id(uuid), lab_id(uuid), status, from, to, search. Pagination.
 */
const getCollections = async (req, res) => {
  try {
    const { collector_id, lab_id, status, from, to, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (collector_id) { where.push('c.uuid = ?'); params.push(collector_id); }
    if (lab_id) { where.push('l.uuid = ?'); params.push(lab_id); }
    if (status) { where.push('scr.status = ?'); params.push(status); }
    if (from) { where.push('scr.created_at >= ?'); params.push(from); }
    if (to) { where.push('scr.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (search) { where.push('(scr.request_id LIKE ? OR c.full_name LIKE ? OR l.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM sample_collection_requests scr
       LEFT JOIN sample_collectors c ON scr.collector_id = c.id
       LEFT JOIN pathology_labs l ON scr.lab_id = l.id
       WHERE ${whereClause}`, params
    );
    const [rows] = await pool.query(
      `SELECT scr.request_id, scr.booking_id, scr.status, scr.distance_km, scr.collection_earning,
              scr.assigned_at, scr.collected_at, scr.delivered_at, scr.created_at,
              c.uuid AS c_uuid, c.full_name AS c_name, c.mobile AS c_mobile,
              l.uuid AS l_uuid, l.name AS l_name
       FROM sample_collection_requests scr
       LEFT JOIN sample_collectors c ON scr.collector_id = c.id
       LEFT JOIN pathology_labs l ON scr.lab_id = l.id
       WHERE ${whereClause} ORDER BY scr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'delivered_to_lab') AS completed,
              SUM(status = 'cancelled') AS cancelled,
              SUM(status NOT IN ('delivered_to_lab','cancelled')) AS ongoing
       FROM sample_collection_requests`
    );

    return res.status(200).json({
      message: 'Collections fetched.',
      summary: {
        total_collections: summary.total,
        completed: Number(summary.completed) || 0,
        cancelled: Number(summary.cancelled) || 0,
        ongoing: Number(summary.ongoing) || 0,
      },
      data: rows.map((r) => ({
        collection_request_id: r.request_id,
        lab_booking_id: r.booking_id,
        collector: r.c_uuid ? { id: r.c_uuid, name: r.c_name, mobile: r.c_mobile } : null,
        lab: r.l_uuid ? { id: r.l_uuid, name: r.l_name } : null,
        status: r.status,
        distance_km: r.distance_km,
        collection_earning: r.collection_earning,
        assigned_at: r.assigned_at,
        collected_at: r.collected_at,
        delivered_at: r.delivered_at,
        created_at: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getCollections error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/collections/:requestId
 * Brief collection detail: collector, lab, route, earning, timeline.
 */
const getCollectionDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT scr.*,
              c.uuid AS c_uuid, c.full_name AS c_name, c.mobile AS c_mobile, c.profile_photo_url AS c_photo, c.average_rating AS c_rating,
              l.uuid AS l_uuid, l.name AS l_name, l.mobile AS l_mobile,
              b.booking_id AS lab_booking_code, b.status AS booking_status, b.booking_date AS scheduled_date,
              b.slot_start_time, b.base_amount, b.final_amount, b.payment_status, b.payment_method, b.metadata,
              u.uuid AS user_uuid, u.full_name AS user_name, u.mobile AS user_mobile, u.email AS user_email, u.profile_photo AS user_photo
       FROM sample_collection_requests scr
       LEFT JOIN sample_collectors c ON scr.collector_id = c.id
       LEFT JOIN pathology_labs l ON scr.lab_id = l.id
       LEFT JOIN bookings b ON scr.booking_id = b.id
       LEFT JOIN users u ON b.user_id = u.id
       WHERE scr.request_id = ?`,
      [req.params.requestId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Collection not found.' });
    const d = rows[0];

    let md = {};
    if (d.metadata) { try { md = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : d.metadata; } catch (e) { md = {}; } }
    const tests = md.tests || [];
    const testsTotal = tests.reduce((s, t) => s + (parseFloat(t.price) || 0), 0);

    const timeline = [{ status: 'Created', at: d.created_at }];
    if (d.assigned_at) timeline.push({ status: 'Assigned', at: d.assigned_at });
    if (d.reached_at) timeline.push({ status: 'Reached Patient', at: d.reached_at });
    if (d.collected_at) timeline.push({ status: 'Sample Collected', at: d.collected_at });
    if (d.delivered_at) timeline.push({ status: 'Delivered to Lab', at: d.delivered_at });
    if (d.status === 'cancelled') timeline.push({ status: 'Cancelled', at: d.updated_at });

    return res.status(200).json({
      message: 'Collection detail fetched.',
      data: {
        collection_request_id: d.request_id,
        lab_booking_id: d.lab_booking_code || d.booking_id,
        status: d.status,
        booking: d.lab_booking_code ? {
          booking_id: d.lab_booking_code,
          booking_status: d.booking_status,
          scheduled_date: d.scheduled_date,
          slot_time: d.slot_start_time,
          payment_status: d.payment_status,
          payment_method: d.payment_method,
          amount: d.final_amount,
        } : null,
        user: d.user_uuid ? { id: d.user_uuid, name: d.user_name, mobile: d.user_mobile, email: d.user_email, profile_photo: d.user_photo } : null,
        patient: {
          name: md.patient?.name || d.user_name || null,
          mobile: md.patient?.mobile || d.user_mobile || null,
          age: md.patient?.age || null,
          gender: md.patient?.gender || null,
          address: md.address || md.collection_address || d.pickup_address || null,
        },
        tests: {
          items: tests.map((t) => ({ name: t.name, price: t.price })),
          total_tests: tests.length,
          total_test_amount: testsTotal,
        },
        collector: d.c_uuid ? {
          id: d.c_uuid, name: d.c_name, mobile: d.c_mobile, profile_photo: d.c_photo, rating: d.c_rating,
        } : null,
        lab: d.l_uuid ? { id: d.l_uuid, name: d.l_name, mobile: d.l_mobile } : null,
        route: {
          pickup_address: d.pickup_address, pickup_latitude: d.pickup_latitude, pickup_longitude: d.pickup_longitude,
          lab_address: d.lab_address, lab_latitude: d.lab_latitude, lab_longitude: d.lab_longitude,
          distance_km: d.distance_km,
        },
        earning: {
          per_km_charge: d.per_km_charge,
          collection_earning: d.collection_earning,
        },
        timeline,
      },
    });
  } catch (error) {
    console.error('admin getCollectionDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getCollectors,
  getCollectorDetail,
  toggleCollectorStatus,
  getCollectorTransactions,
  getCollectorSettlements,
  getCollections,
  getCollectionDetail,
};
