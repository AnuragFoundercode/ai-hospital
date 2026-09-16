const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN AMBULANCE (SERVICES) MANAGEMENT
// ─────────────────────────────────────────────

const resolveServiceId = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM ambulance_services WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * GET /api/v1/admin/ambulance-services
 * Filters: search, verification_status, is_active, is_online, zone_id, from, to. Pagination.
 * + global summary (unaffected by filters).
 */
const getServices = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, is_active, is_online, zone_id, from, to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('(s.name LIKE ? OR s.owner_name LIKE ? OR s.mobile LIKE ? OR s.uuid LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('s.verification_status = ?'); params.push(verification_status); }
    if (is_active !== undefined && is_active !== '') { where.push('s.is_active = ?'); params.push(is_active === 'true' || is_active === '1' ? 1 : 0); }
    if (is_online !== undefined && is_online !== '') { where.push('s.is_online = ?'); params.push(is_online === 'true' || is_online === '1' ? 1 : 0); }
    if (zone_id) { where.push('s.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (from) { where.push('s.created_at >= ?'); params.push(from); }
    if (to) { where.push('s.created_at <= ?'); params.push(`${to} 23:59:59`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM ambulance_services s WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT s.uuid, s.name, s.owner_name, s.mobile, s.profile_photo, s.fleet_size,
              s.verification_status, s.is_active, s.is_online, s.average_rating, s.created_at,
              s.zone_id, z.name AS zone_name,
              COALESCE(w.balance, 0) AS wallet_balance
       FROM ambulance_services s
       LEFT JOIN zones z ON s.zone_id = z.id
       LEFT JOIN ambulance_wallets w ON w.ambulance_service_id = s.id
       WHERE ${whereClause} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(is_active = 1) AS active,
              SUM(is_active = 0) AS inactive,
              SUM(verification_status = 'pending') AS pending,
              SUM(is_online = 1) AS online
       FROM ambulance_services`
    );

    return res.status(200).json({
      message: 'Ambulance services fetched.',
      summary: {
        total_services: summary.total,
        active_services: Number(summary.active) || 0,
        inactive_services: Number(summary.inactive) || 0,
        pending_services: Number(summary.pending) || 0,
        online_services: Number(summary.online) || 0,
      },
      data: rows.map((r) => ({
        id: r.uuid,
        name: r.name,
        owner_name: r.owner_name,
        mobile: r.mobile,
        profile_photo: r.profile_photo,
        fleet_size: r.fleet_size,
        zone: r.zone_name,
        verification_status: r.verification_status,
        is_active: !!r.is_active,
        is_online: !!r.is_online,
        rating: r.average_rating,
        wallet_balance: r.wallet_balance,
        registration_date: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getServices error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/ambulance-services/:id
 * Full profile + documents + bank + wallet/payout stats + vehicles count.
 */
const getServiceDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT s.*, z.name AS zone_name FROM ambulance_services s LEFT JOIN zones z ON s.zone_id = z.id WHERE s.uuid = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Ambulance service not found.' });
    const s = rows[0];
    const sid = s.id;

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM ambulance_bank_details WHERE ambulance_service_id = ?', [sid]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM ambulance_wallets WHERE ambulance_service_id = ?', [sid]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    const [[veh]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(is_active = 1) AS active FROM ambulance_vehicles WHERE ambulance_service_id = ?`, [sid]
    );
    const [[payout]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status='processed' THEN amount END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending
       FROM ambulance_withdrawals WHERE ambulance_service_id = ?`, [sid]
    );

    return res.status(200).json({
      message: 'Ambulance service detail fetched.',
      data: {
        id: s.uuid,
        verification_status: s.verification_status,
        rejection_reason: s.rejection_reason,
        is_active: !!s.is_active,
        is_online: !!s.is_online,
        profile: {
          name: s.name, owner_name: s.owner_name, full_name: s.full_name,
          mobile: s.mobile, email: s.email, profile_photo: s.profile_photo,
          dob: s.dob, gender: s.gender,
          driving_license_number: s.driving_license_number, license_expiry_date: s.license_expiry_date,
          registration_number: s.registration_number, gst_number: s.gst_number, pan_number: s.pan_number,
          fleet_size: s.fleet_size, coverage_radius_km: s.coverage_radius_km,
          city: s.city, state: s.state, zone_id: s.zone_id, zone_name: s.zone_name,
          base_latitude: s.base_latitude, base_longitude: s.base_longitude,
          base_fare: s.base_fare, per_km_charge: s.per_km_charge,
        },
        documents: {
          registration_certificate_url: s.registration_certificate_url,
          gst_certificate_url: s.gst_certificate_url,
          pan_card_url: s.pan_card_url,
          aadhaar_url: s.aadhaar_url,
          driving_licence_url: s.driving_licence_url,
          rc_book_url: s.rc_book_url,
          emergency_training_certificate_url: s.emergency_training_certificate_url,
        },
        bank: bankRows[0] || null,
        stats: {
          fleet_size: s.fleet_size,
          total_vehicles: veh.total,
          active_vehicles: Number(veh.active) || 0,
          total_earned: wallet.total_earned,
          wallet_balance: wallet.balance,
          total_withdrawn: wallet.total_withdrawn,
          pending_payout: parseFloat(payout.pending),
          completed_payout: parseFloat(payout.total_paid),
          average_rating: s.average_rating,
          registration_date: s.created_at,
        },
      },
    });
  } catch (error) {
    console.error('admin getServiceDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/ambulance-services/:id/toggle-status
 */
const toggleServiceStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM ambulance_services WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Ambulance service not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE ambulance_services SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Service activated.' : 'Service deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin toggleServiceStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/ambulance-services/:id/transactions?page=&limit=&type=
 */
const getServiceTransactions = async (req, res) => {
  try {
    const sid = await resolveServiceId(req.params.id);
    if (!sid) return res.status(404).json({ message: 'Ambulance service not found.' });

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['ambulance_service_id = ?']; const params = [sid];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM ambulance_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, balance_after, created_at
       FROM ambulance_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getServiceTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/ambulance-services/:id/settlements?page=&limit=&status=
 */
const getServiceSettlements = async (req, res) => {
  try {
    const sid = await resolveServiceId(req.params.id);
    if (!sid) return res.status(404).json({ message: 'Ambulance service not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['ambulance_service_id = ?']; const params = [sid];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM ambulance_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM ambulance_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Settlements fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getServiceSettlements error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/ambulance-bookings
 * Global ambulance booking history.
 * Filters: status, payment_status, payment_method, category_id, from, to, search. Pagination.
 * + global summary (unaffected by filters).
 */
const getBookings = async (req, res) => {
  try {
    const { status, payment_status, payment_method, category_id, from, to, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (status) { where.push('b.status = ?'); params.push(status); }
    if (payment_status) { where.push('b.payment_status = ?'); params.push(payment_status); }
    if (payment_method) { where.push('b.payment_method = ?'); params.push(payment_method); }
    if (category_id) { where.push('b.category_id = ?'); params.push(parseInt(category_id)); }
    if (from) { where.push('b.created_at >= ?'); params.push(from); }
    if (to) { where.push('b.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (search) { where.push('(b.booking_id LIKE ? OR b.patient_name LIKE ? OR u.full_name LIKE ? OR u.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM ambulance_bookings b
       LEFT JOIN users u ON b.user_id = u.id WHERE ${whereClause}`, params
    );
    const [rows] = await pool.query(
      `SELECT b.booking_id, b.patient_name, b.status, b.total_fare, b.distance_km,
              b.payment_status, b.payment_method, b.created_at,
              u.uuid AS user_uuid, u.full_name AS user_name, u.mobile AS user_mobile,
              s.uuid AS service_uuid, s.name AS service_name, s.mobile AS service_mobile,
              c.name AS category_name
       FROM ambulance_bookings b
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN ambulance_services s ON b.partner_id = s.id
       LEFT JOIN ambulance_types c ON b.category_id = c.id
       WHERE ${whereClause} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];
    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(DATE(created_at) = ?) AS today,
              SUM(status IN ('searching','pending','accepted','arrived','in_transit')) AS ongoing,
              SUM(status = 'completed') AS completed,
              SUM(status IN ('cancelled','no_partner_found')) AS cancelled
       FROM ambulance_bookings`, [today]
    );

    return res.status(200).json({
      message: 'Ambulance bookings fetched.',
      summary: {
        total_bookings: summary.total,
        todays_bookings: Number(summary.today) || 0,
        ongoing_bookings: Number(summary.ongoing) || 0,
        completed_bookings: Number(summary.completed) || 0,
        cancelled_bookings: Number(summary.cancelled) || 0,
      },
      data: rows.map((r) => ({
        booking_id: r.booking_id,
        patient_name: r.patient_name,
        user: r.user_uuid ? { id: r.user_uuid, name: r.user_name, mobile: r.user_mobile } : null,
        service: r.service_uuid ? { id: r.service_uuid, name: r.service_name, mobile: r.service_mobile } : null,
        category: r.category_name,
        distance_km: r.distance_km,
        amount: r.total_fare,
        status: r.status,
        payment_status: r.payment_status,
        payment_method: r.payment_method,
        booking_date: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/ambulance-bookings/:bookingId
 * Full ambulance booking detail: booking info, patient, user, partner, route, fare, timeline.
 */
const getBookingDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*,
              u.uuid AS user_uuid, u.full_name AS user_name, u.mobile AS user_mobile, u.email AS user_email, u.profile_photo AS user_photo,
              s.uuid AS service_uuid, s.name AS service_name, s.mobile AS service_mobile, s.profile_photo AS service_photo,
              s.average_rating AS service_rating,
              c.name AS category_name
       FROM ambulance_bookings b
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN ambulance_services s ON b.partner_id = s.id
       LEFT JOIN ambulance_types c ON b.category_id = c.id
       WHERE b.booking_id = ?`,
      [req.params.bookingId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    const b = rows[0];

    const timeline = [{ status: 'Booking Placed', at: b.created_at }];
    if (b.accepted_at) timeline.push({ status: 'Accepted', at: b.accepted_at });
    if (b.arrived_at) timeline.push({ status: 'Arrived at Pickup', at: b.arrived_at });
    if (b.started_at) timeline.push({ status: 'Trip Started', at: b.started_at });
    if (b.completed_at) timeline.push({ status: 'Completed', at: b.completed_at });
    if (b.cancelled_at) timeline.push({ status: 'Cancelled', at: b.cancelled_at });

    return res.status(200).json({
      message: 'Ambulance booking detail fetched.',
      data: {
        booking_info: {
          booking_id: b.booking_id,
          status: b.status,
          category: b.category_name,
          distance_km: b.distance_km,
          estimated_time_minutes: b.estimated_time_minutes,
          cancellation_reason: b.cancellation_reason,
          cancelled_by: b.cancelled_by,
          booking_date: b.created_at,
        },
        patient: {
          name: b.patient_name,
          condition: b.patient_condition,
          emergency_contact: b.emergency_contact,
        },
        user: b.user_uuid ? { id: b.user_uuid, name: b.user_name, mobile: b.user_mobile, email: b.user_email, profile_photo: b.user_photo } : null,
        service: b.service_uuid ? {
          id: b.service_uuid, name: b.service_name, mobile: b.service_mobile, profile_photo: b.service_photo,
          rating: b.service_rating,
        } : null,
        route: {
          pickup_address: b.pickup_address, pickup_latitude: b.pickup_latitude, pickup_longitude: b.pickup_longitude,
          drop_address: b.drop_address, drop_latitude: b.drop_latitude, drop_longitude: b.drop_longitude,
          distance_km: b.distance_km,
        },
        fare_summary: {
          base_charge: b.base_charge,
          per_km_charge: b.per_km_charge,
          distance_km: b.distance_km,
          total_fare: b.total_fare,
          payment_method: b.payment_method,
          payment_status: b.payment_status,
          transaction_id: b.transaction_id,
          paid_at: b.paid_at,
        },
        timeline,
        rating: b.user_rating ? { rating: b.user_rating, review: b.user_review, rated_at: b.rated_at } : null,
      },
    });
  } catch (error) {
    console.error('admin getBookingDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getServices,
  getServiceDetail,
  toggleServiceStatus,
  getServiceTransactions,
  getServiceSettlements,
  getBookings,
  getBookingDetail,
};
