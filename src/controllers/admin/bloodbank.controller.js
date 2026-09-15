const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN BLOOD BANK MANAGEMENT
// ─────────────────────────────────────────────

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * GET /api/v1/admin/blood-banks?page=&limit=&search=&verification_status=&is_active=&zone_id=&from=&to=
 * + global summary + blood stock overview (all banks) — unaffected by filters.
 */
const getBloodBanks = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, is_active, zone_id, from, to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('(bb.name LIKE ? OR bb.contact_person LIKE ? OR bb.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('bb.verification_status = ?'); params.push(verification_status); }
    if (is_active !== undefined) { where.push('bb.is_active = ?'); params.push(parseInt(is_active)); }
    if (zone_id) { where.push('bb.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (from) { where.push('bb.created_at >= ?'); params.push(from); }
    if (to) { where.push('bb.created_at <= ?'); params.push(`${to} 23:59:59`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM blood_banks bb WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT bb.id, bb.uuid, bb.name, bb.contact_person, bb.mobile, bb.email, bb.profile_photo, bb.city,
              bb.zone_id, z.name AS zone_name, bb.verification_status, bb.is_active, bb.created_at,
              COALESCE(w.balance, 0) AS wallet_balance
       FROM blood_banks bb
       LEFT JOIN zones z ON bb.zone_id = z.id
       LEFT JOIN bloodbank_wallets w ON w.blood_bank_id = bb.id
       WHERE ${whereClause} ORDER BY bb.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    // Summary + total available units (all banks)
    const [[summary]] = await pool.query('SELECT COUNT(*) AS total, SUM(is_active = 1) AS active FROM blood_banks');
    const [[units]] = await pool.query("SELECT COUNT(*) AS total FROM bloodbank_inventory_items WHERE status = 'available' AND expiry_date >= CURDATE()");

    // Blood stock overview by group (available, non-expired)
    const [stockRows] = await pool.query(
      "SELECT blood_group, COUNT(*) AS units FROM bloodbank_inventory_items WHERE status = 'available' AND expiry_date >= CURDATE() GROUP BY blood_group"
    );
    const stockMap = {};
    stockRows.forEach((r) => { stockMap[r.blood_group] = r.units; });
    const blood_stock_overview = BLOOD_GROUPS.map((g) => ({ blood_group: g, units: stockMap[g] || 0 }));

    return res.status(200).json({
      message: 'Blood banks fetched.',
      summary: {
        total_blood_banks: summary.total,
        active_blood_banks: Number(summary.active) || 0,
        total_units_available: units.total,
        total_donors: 0,
      },
      blood_stock_overview,
      data: rows.map((b) => ({
        id: b.uuid, db_id: b.id, blood_bank_name: b.name, owner_name: b.contact_person, contact: b.mobile, email: b.email,
        profile_photo: b.profile_photo, city: b.city, zone: b.zone_name, zone_id: b.zone_id,
        wallet_balance: b.wallet_balance, status: b.verification_status, is_active: !!b.is_active, register_date: b.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getBloodBanks error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const resolveBankId = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM blood_banks WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * PUT /api/v1/admin/blood-banks/:id/toggle-status
 */
const toggleBloodBankStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM blood_banks WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Blood bank not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE blood_banks SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Blood bank activated.' : 'Blood bank deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin toggleBloodBankStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/blood-banks/:id
 * Full profile + stats + stock by group + recent requests + recent donors.
 */
const getBloodBankDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT bb.*, z.name AS zone_name FROM blood_banks bb LEFT JOIN zones z ON bb.zone_id = z.id WHERE bb.uuid = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Blood bank not found.' });
    const b = rows[0];
    const bid = b.id;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM bloodbank_bank_details WHERE blood_bank_id = ?', [bid]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM bloodbank_wallets WHERE blood_bank_id = ?', [bid]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    const [[units]] = await pool.query("SELECT COUNT(*) AS total FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND status = 'available' AND expiry_date >= CURDATE()", [bid]);
    const [[req0]] = await pool.query('SELECT COUNT(*) AS total, SUM(DATE(created_at) = ?) AS today FROM blood_requests WHERE blood_bank_id = ?', [today, bid]);
    const [[payout]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status='processed' THEN amount END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending
       FROM bloodbank_withdrawals WHERE blood_bank_id = ?`, [bid]
    );

    // Stock by group
    const [stockRows] = await pool.query(
      "SELECT blood_group, COUNT(*) AS units FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND status = 'available' AND expiry_date >= CURDATE() GROUP BY blood_group", [bid]
    );
    const stockMap = {}; stockRows.forEach((r) => { stockMap[r.blood_group] = r.units; });
    const blood_stock_by_group = BLOOD_GROUPS.map((g) => ({ blood_group: g, units: stockMap[g] || 0 }));

    // Recent requests (max 10)
    const [recentReq] = await pool.query(
      `SELECT br.request_id, br.blood_group, br.units_required, br.status, br.payment_status, br.total_amount, br.created_at,
              u.full_name AS user_name, u.mobile AS user_mobile
       FROM blood_requests br JOIN users u ON br.user_id = u.id
       WHERE br.blood_bank_id = ? ORDER BY br.created_at DESC LIMIT 10`, [bid]
    );

    return res.status(200).json({
      message: 'Blood bank detail fetched.',
      data: {
        id: b.uuid,
        verification_status: b.verification_status,
        is_active: !!b.is_active,
        profile: { name: b.name, owner_name: b.contact_person, mobile: b.mobile, email: b.email, profile_photo: b.profile_photo, about: b.about_description, category: b.blood_bank_category },
        licenses: { license_number: b.license_number, gst_number: b.gst_number, pan_number: b.pan_number, license_url: b.license_url, gst_certificate_url: b.gst_certificate_url, pan_card_url: b.pan_card_url },
        address: { address_line1: b.address_line1, address_line2: b.address_line2, landmark: b.landmark, city: b.city, state: b.state, pincode: b.pincode, zone_id: b.zone_id, zone_name: b.zone_name, latitude: b.latitude, longitude: b.longitude },
        settings: { is_24hours: !!b.is_24hours, opening_time: b.opening_time, closing_time: b.closing_time, admin_commission_percent: b.admin_commission_percent },
        bank: bankRows[0] || null,
        stats: {
          total_units_available: units.total,
          total_donors: 0,
          total_requests: req0.total,
          today_requests: Number(req0.today) || 0,
          wallet_balance: wallet.balance,
          pending_payout: parseFloat(payout.pending),
          completed_payout: parseFloat(payout.total_paid),
          average_rating: b.average_rating,
          registration_date: b.created_at,
        },
        blood_stock_by_group,
        recent_requests: recentReq.map((r) => ({
          request_id: r.request_id, blood_group: r.blood_group, units_required: r.units_required,
          status: r.status, payment_status: r.payment_status, amount: r.total_amount,
          user: { name: r.user_name, mobile: r.user_mobile }, created_at: r.created_at,
        })),
        recent_donors: [],
      },
    });
  } catch (error) {
    console.error('admin getBloodBankDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/blood-banks/:id/transactions?page=&limit=&type=
 */
const getBloodBankTransactions = async (req, res) => {
  try {
    const bid = await resolveBankId(req.params.id);
    if (!bid) return res.status(404).json({ message: 'Blood bank not found.' });

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['blood_bank_id = ?']; const params = [bid];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM bloodbank_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, admin_commission, balance_after, created_at
       FROM bloodbank_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getBloodBankTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/blood-banks/:id/settlements?page=&limit=&status=
 */
const getBloodBankSettlements = async (req, res) => {
  try {
    const bid = await resolveBankId(req.params.id);
    if (!bid) return res.status(404).json({ message: 'Blood bank not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['blood_bank_id = ?']; const params = [bid];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM bloodbank_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM bloodbank_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Settlements fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getBloodBankSettlements error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/blood-requests
 * Global blood request list.
 * Filters: zone_id, blood_bank_id(uuid), blood_group, status, payment_status, payment_method, from, to, search. Pagination.
 * + global summary (unaffected by filters).
 */
const getAllRequests = async (req, res) => {
  try {
    const { zone_id, blood_bank_id, blood_group, status, payment_status, payment_method, from, to, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (zone_id) { where.push('bb.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (blood_bank_id) { where.push('bb.uuid = ?'); params.push(blood_bank_id); }
    if (blood_group) { where.push('br.blood_group = ?'); params.push(blood_group); }
    if (status) { where.push('br.status = ?'); params.push(status); }
    if (payment_status) { where.push('br.payment_status = ?'); params.push(payment_status); }
    if (payment_method) { where.push('br.payment_method = ?'); params.push(payment_method); }
    if (from) { where.push('br.created_at >= ?'); params.push(from); }
    if (to) { where.push('br.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (search) { where.push('(br.request_id LIKE ? OR u.full_name LIKE ? OR u.mobile LIKE ? OR br.patient_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM blood_requests br JOIN users u ON br.user_id = u.id LEFT JOIN blood_banks bb ON br.blood_bank_id = bb.id WHERE ${whereClause}`, params
    );
    const [rows] = await pool.query(
      `SELECT br.request_id, br.patient_name, br.blood_group, br.units_required, br.required_date, br.status, br.payment_status, br.payment_method, br.total_amount, br.delivery_fee, br.created_at,
              u.uuid AS user_uuid, u.full_name AS user_name, u.mobile AS user_mobile,
              bb.uuid AS bank_uuid, bb.name AS bank_name, bb.zone_id, z.name AS zone_name,
              dp.uuid AS dp_uuid, dp.full_name AS dp_name, dp.mobile AS dp_mobile, bdr.status AS delivery_status
       FROM blood_requests br
       JOIN users u ON br.user_id = u.id
       LEFT JOIN blood_banks bb ON br.blood_bank_id = bb.id
       LEFT JOIN zones z ON bb.zone_id = z.id
       LEFT JOIN blood_delivery_requests bdr ON bdr.blood_request_id = br.id
       LEFT JOIN blood_delivery_partners dp ON bdr.partner_id = dp.id
       WHERE ${whereClause} ORDER BY br.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];
    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(DATE(created_at) = ?) AS today,
              SUM(status = 'completed') AS completed,
              SUM(status IN ('cancelled','rejected')) AS cancelled,
              SUM(status NOT IN ('completed','cancelled','rejected')) AS pending
       FROM blood_requests`, [today]
    );

    return res.status(200).json({
      message: 'Blood requests fetched.',
      summary: {
        total_requests: summary.total,
        todays_requests: Number(summary.today) || 0,
        pending_requests: Number(summary.pending) || 0,
        completed_requests: Number(summary.completed) || 0,
        cancelled_requests: Number(summary.cancelled) || 0,
      },
      data: rows.map((r) => ({
        request_id: r.request_id,
        patient_name: r.patient_name,
        requested_by: { id: r.user_uuid, name: r.user_name, mobile: r.user_mobile },
        mobile: r.user_mobile,
        zone: r.zone_name,
        blood_bank: r.bank_uuid ? { id: r.bank_uuid, name: r.bank_name } : null,
        blood_group: r.blood_group,
        units_required: r.units_required,
        required_date: r.required_date,
        delivery_partner: r.dp_uuid ? { id: r.dp_uuid, name: r.dp_name, mobile: r.dp_mobile, delivery_status: r.delivery_status } : null,
        amount: r.total_amount,
        status: r.status,
        payment_status: r.payment_status,
        payment_method: r.payment_method,
        request_date: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin blood getAllRequests error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/blood-requests/:requestId
 * Full blood request detail: request info, patient, documents, blood bank,
 * delivery partner + tracking, payment summary, timeline.
 */
const getRequestDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT br.*,
              u.uuid AS user_uuid, u.full_name AS user_name, u.mobile AS user_mobile, u.email AS user_email, u.profile_photo AS user_photo,
              bb.uuid AS bank_uuid, bb.name AS bank_name, bb.contact_person AS bank_contact_person, bb.mobile AS bank_mobile,
              bb.address_line1 AS bank_addr1, bb.address_line2 AS bank_addr2, bb.city AS bank_city, bb.state AS bank_state, bb.pincode AS bank_pincode,
              bb.zone_id, z.name AS zone_name
       FROM blood_requests br
       JOIN users u ON br.user_id = u.id
       LEFT JOIN blood_banks bb ON br.blood_bank_id = bb.id
       LEFT JOIN zones z ON bb.zone_id = z.id
       WHERE br.request_id = ?`,
      [req.params.requestId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Blood request not found.' });
    const r = rows[0];

    // Delivery request + partner
    const [delRows] = await pool.query(
      `SELECT bdr.request_id AS delivery_request_id, bdr.pickup_address, bdr.pickup_latitude, bdr.pickup_longitude,
              bdr.drop_address, bdr.drop_latitude, bdr.drop_longitude, bdr.distance_km, bdr.per_km_charge,
              bdr.delivery_fee, bdr.admin_commission, bdr.delivery_earning, bdr.status AS delivery_status,
              bdr.assigned_at, bdr.picked_up_at, bdr.reached_at, bdr.delivered_at,
              dp.uuid AS dp_uuid, dp.full_name AS dp_name, dp.mobile AS dp_mobile, dp.profile_photo AS dp_photo,
              dp.vehicle_type AS dp_vehicle_type, dp.vehicle_number AS dp_vehicle_number, dp.average_rating AS dp_rating
       FROM blood_delivery_requests bdr
       LEFT JOIN blood_delivery_partners dp ON bdr.partner_id = dp.id
       WHERE bdr.blood_request_id = ?
       ORDER BY bdr.created_at DESC LIMIT 1`,
      [r.id]
    );
    const del = delRows[0] || null;

    // Timeline
    const timeline = [{ status: 'Request Placed', at: r.created_at }];
    if (r.paid_at) timeline.push({ status: 'Payment Completed', at: r.paid_at });
    if (del) {
      if (del.assigned_at) timeline.push({ status: 'Delivery Partner Assigned', at: del.assigned_at });
      if (del.picked_up_at) timeline.push({ status: 'Picked Up', at: del.picked_up_at });
      if (del.reached_at) timeline.push({ status: 'Out for Delivery', at: del.reached_at });
      if (del.delivered_at) timeline.push({ status: 'Delivered', at: del.delivered_at });
    }
    if (['cancelled', 'rejected'].includes(r.status)) timeline.push({ status: r.status === 'rejected' ? 'Rejected' : 'Cancelled', at: r.updated_at });

    const bloodAmount = parseFloat(r.total_amount || 0) - parseFloat(r.delivery_fee || 0);

    return res.status(200).json({
      message: 'Blood request detail fetched.',
      data: {
        request_info: {
          request_id: r.request_id,
          status: r.status,
          rejection_reason: r.rejection_reason,
          blood_group: r.blood_group,
          units_required: r.units_required,
          required_date: r.required_date,
          reason: r.reason,
          zone: r.zone_name,
          request_date: r.created_at,
        },
        patient: {
          name: r.patient_name,
          age: r.patient_age,
          gender: r.patient_gender,
          hospital_name: r.hospital_name,
          drop_address: r.drop_address,
          drop_latitude: r.drop_latitude,
          drop_longitude: r.drop_longitude,
          attendant_name: r.attendant_name,
          attendant_mobile: r.attendant_mobile,
        },
        requested_by: { id: r.user_uuid, name: r.user_name, mobile: r.user_mobile, email: r.user_email, profile_photo: r.user_photo },
        documents: {
          doctor_prescription_url: r.doctor_prescription_url,
          blood_requirement_letter_url: r.blood_requirement_letter_url,
          patient_id_proof_url: r.patient_id_proof_url,
        },
        blood_bank: r.bank_uuid ? {
          id: r.bank_uuid, name: r.bank_name, contact_person: r.bank_contact_person, mobile: r.bank_mobile,
          address: [r.bank_addr1, r.bank_addr2, r.bank_city, r.bank_state, r.bank_pincode].filter(Boolean).join(', '),
        } : null,
        delivery_partner: del && del.dp_uuid ? {
          id: del.dp_uuid, name: del.dp_name, mobile: del.dp_mobile, profile_photo: del.dp_photo,
          vehicle_type: del.dp_vehicle_type, vehicle_number: del.dp_vehicle_number, rating: del.dp_rating,
        } : null,
        delivery_tracking: del ? {
          delivery_request_id: del.delivery_request_id,
          delivery_status: del.delivery_status,
          pickup_address: del.pickup_address, pickup_latitude: del.pickup_latitude, pickup_longitude: del.pickup_longitude,
          drop_address: del.drop_address, drop_latitude: del.drop_latitude, drop_longitude: del.drop_longitude,
          distance_km: del.distance_km,
          assigned_at: del.assigned_at, picked_up_at: del.picked_up_at, reached_at: del.reached_at, delivered_at: del.delivered_at,
        } : null,
        payment_summary: {
          price_per_unit: r.price_per_unit,
          units_required: r.units_required,
          blood_amount: bloodAmount,
          delivery_fee: r.delivery_fee,
          total_amount: r.total_amount,
          payment_method: r.payment_method,
          payment_status: r.payment_status,
          transaction_id: r.transaction_id,
          paid_at: r.paid_at,
        },
        timeline,
        rating: r.user_rating ? { rating: r.user_rating, review: r.user_review, rated_at: r.rated_at } : null,
      },
    });
  } catch (error) {
    console.error('admin getRequestDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getBloodBanks,
  toggleBloodBankStatus,
  getBloodBankDetail,
  getBloodBankTransactions,
  getBloodBankSettlements,
  getAllRequests,
  getRequestDetail,
};
