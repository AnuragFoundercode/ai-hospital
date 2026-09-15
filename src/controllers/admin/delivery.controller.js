const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN PHARMACY DELIVERY PARTNER MANAGEMENT
// ─────────────────────────────────────────────

const resolvePartnerId = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM delivery_partners WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * GET /api/v1/admin/delivery-partners
 * Filters: search, verification_status, is_active, is_online, zone_id, from, to. Pagination.
 * + global summary (unaffected by filters).
 */
const getPartners = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, is_active, is_online, zone_id, from, to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('(dp.full_name LIKE ? OR dp.mobile LIKE ? OR dp.uuid LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('dp.verification_status = ?'); params.push(verification_status); }
    if (is_active !== undefined && is_active !== '') { where.push('dp.is_active = ?'); params.push(is_active === 'true' || is_active === '1' ? 1 : 0); }
    if (is_online !== undefined && is_online !== '') { where.push('dp.is_online = ?'); params.push(is_online === 'true' || is_online === '1' ? 1 : 0); }
    if (zone_id) { where.push('dp.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (from) { where.push('dp.created_at >= ?'); params.push(from); }
    if (to) { where.push('dp.created_at <= ?'); params.push(`${to} 23:59:59`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM delivery_partners dp WHERE ${whereClause}`, params
    );
    const [rows] = await pool.query(
      `SELECT dp.uuid, dp.full_name, dp.mobile, dp.profile_photo, dp.vehicle_type, dp.rc_number,
              dp.verification_status, dp.is_active, dp.is_online, dp.average_rating, dp.total_deliveries,
              dp.created_at, dp.zone_id, z.name AS zone_name,
              COALESCE(w.balance, 0) AS wallet_balance
       FROM delivery_partners dp
       LEFT JOIN zones z ON dp.zone_id = z.id
       LEFT JOIN delivery_wallets w ON w.delivery_partner_id = dp.id
       WHERE ${whereClause} ORDER BY dp.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(is_active = 1) AS active,
              SUM(is_active = 0) AS inactive,
              SUM(verification_status = 'pending') AS pending,
              SUM(is_online = 1) AS online
       FROM delivery_partners`
    );

    return res.status(200).json({
      message: 'Delivery partners fetched.',
      summary: {
        total_partners: summary.total,
        active_partners: Number(summary.active) || 0,
        inactive_partners: Number(summary.inactive) || 0,
        pending_partners: Number(summary.pending) || 0,
        online_partners: Number(summary.online) || 0,
      },
      data: rows.map((r) => ({
        id: r.uuid,
        name: r.full_name,
        mobile: r.mobile,
        profile_photo: r.profile_photo,
        vehicle_type: r.vehicle_type,
        rc_number: r.rc_number,
        zone: r.zone_name,
        verification_status: r.verification_status,
        is_active: !!r.is_active,
        is_online: !!r.is_online,
        rating: r.average_rating,
        total_deliveries: r.total_deliveries,
        wallet_balance: r.wallet_balance,
        registration_date: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPartners error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/delivery-partners/:id
 * Full profile + documents + bank + stats.
 */
const getPartnerDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT dp.*, z.name AS zone_name FROM delivery_partners dp LEFT JOIN zones z ON dp.zone_id = z.id WHERE dp.uuid = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Delivery partner not found.' });
    const p = rows[0];
    const pid = p.id;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM delivery_bank_details WHERE delivery_partner_id = ?', [pid]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM delivery_wallets WHERE delivery_partner_id = ?', [pid]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    const [[deliveries]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(DATE(created_at) = ?) AS today,
              SUM(status = 'delivered') AS completed,
              SUM(status = 'cancelled') AS cancelled,
              SUM(status NOT IN ('delivered','cancelled')) AS ongoing
       FROM delivery_requests WHERE partner_id = ?`, [today, pid]
    );
    const [[payout]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status='processed' THEN amount END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending
       FROM delivery_withdrawals WHERE delivery_partner_id = ?`, [pid]
    );

    return res.status(200).json({
      message: 'Delivery partner detail fetched.',
      data: {
        id: p.uuid,
        verification_status: p.verification_status,
        rejection_reason: p.rejection_reason,
        is_active: !!p.is_active,
        is_online: !!p.is_online,
        profile: {
          name: p.full_name, mobile: p.mobile, email: p.email, profile_photo: p.profile_photo,
          date_of_birth: p.date_of_birth, gender: p.gender,
          vehicle_type: p.vehicle_type,
          rc_number: p.rc_number, dl_number: p.dl_number,
          zone_id: p.zone_id, zone_name: p.zone_name,
          latitude: p.latitude, longitude: p.longitude,
          admin_commission_percent: p.admin_commission_percent,
        },
        documents: {
          aadhaar_front_url: p.aadhaar_front_url,
          aadhaar_back_url: p.aadhaar_back_url,
          pan_card_url: p.pan_card_url,
          driving_licence_url: p.driving_licence_url,
          rider_selfie_url: p.rider_selfie_url,
        },
        bank: bankRows[0] || null,
        stats: {
          total_deliveries: deliveries.total,
          today_deliveries: Number(deliveries.today) || 0,
          completed_deliveries: Number(deliveries.completed) || 0,
          cancelled_deliveries: Number(deliveries.cancelled) || 0,
          ongoing_deliveries: Number(deliveries.ongoing) || 0,
          total_earned: wallet.total_earned,
          wallet_balance: wallet.balance,
          total_withdrawn: wallet.total_withdrawn,
          pending_payout: parseFloat(payout.pending),
          completed_payout: parseFloat(payout.total_paid),
          average_rating: p.average_rating,
          registration_date: p.created_at,
        },
      },
    });
  } catch (error) {
    console.error('admin getPartnerDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/delivery-partners/:id/toggle-status
 */
const togglePartnerStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM delivery_partners WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Delivery partner not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE delivery_partners SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Partner activated.' : 'Partner deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin togglePartnerStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/delivery-partners/:id/transactions?page=&limit=&type=
 */
const getPartnerTransactions = async (req, res) => {
  try {
    const pid = await resolvePartnerId(req.params.id);
    if (!pid) return res.status(404).json({ message: 'Delivery partner not found.' });

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['delivery_partner_id = ?']; const params = [pid];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM delivery_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, admin_commission, balance_after, created_at
       FROM delivery_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPartnerTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/delivery-partners/:id/settlements?page=&limit=&status=
 */
const getPartnerSettlements = async (req, res) => {
  try {
    const pid = await resolvePartnerId(req.params.id);
    if (!pid) return res.status(404).json({ message: 'Delivery partner not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['delivery_partner_id = ?']; const params = [pid];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM delivery_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM delivery_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Settlements fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPartnerSettlements error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/deliveries
 * Global delivery list.
 * Filters: partner_id(uuid), pharmacy_id(uuid), status, zone_id, from, to, search. Pagination.
 */
const getDeliveries = async (req, res) => {
  try {
    const { partner_id, pharmacy_id, status, zone_id, from, to, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (partner_id) { where.push('dp.uuid = ?'); params.push(partner_id); }
    if (pharmacy_id) { where.push('ph.uuid = ?'); params.push(pharmacy_id); }
    if (status) { where.push('dr.status = ?'); params.push(status); }
    if (zone_id) { where.push('ph.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (from) { where.push('dr.created_at >= ?'); params.push(from); }
    if (to) { where.push('dr.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (search) { where.push('(dr.request_id LIKE ? OR po.order_id LIKE ? OR dp.full_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM delivery_requests dr
       LEFT JOIN delivery_partners dp ON dr.partner_id = dp.id
       LEFT JOIN pharmacies ph ON dr.pharmacy_id = ph.id
       LEFT JOIN pharmacy_orders po ON dr.order_id = po.id
       WHERE ${whereClause}`, params
    );
    const [rows] = await pool.query(
      `SELECT dr.request_id, dr.status, dr.distance_km, dr.delivery_fee, dr.delivery_earning, dr.admin_commission,
              dr.assigned_at, dr.picked_up_at, dr.delivered_at, dr.created_at,
              dp.uuid AS dp_uuid, dp.full_name AS dp_name, dp.mobile AS dp_mobile,
              ph.uuid AS ph_uuid, ph.name AS ph_name, z.name AS zone_name,
              po.order_id AS pharmacy_order_id
       FROM delivery_requests dr
       LEFT JOIN delivery_partners dp ON dr.partner_id = dp.id
       LEFT JOIN pharmacies ph ON dr.pharmacy_id = ph.id
       LEFT JOIN zones z ON ph.zone_id = z.id
       LEFT JOIN pharmacy_orders po ON dr.order_id = po.id
       WHERE ${whereClause} ORDER BY dr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'delivered') AS delivered,
              SUM(status = 'cancelled') AS cancelled,
              SUM(status NOT IN ('delivered','cancelled')) AS ongoing
       FROM delivery_requests`
    );

    return res.status(200).json({
      message: 'Deliveries fetched.',
      summary: {
        total_deliveries: summary.total,
        delivered: Number(summary.delivered) || 0,
        cancelled: Number(summary.cancelled) || 0,
        ongoing: Number(summary.ongoing) || 0,
      },
      data: rows.map((r) => ({
        delivery_request_id: r.request_id,
        pharmacy_order_id: r.pharmacy_order_id,
        pharmacy: r.ph_uuid ? { id: r.ph_uuid, name: r.ph_name } : null,
        zone: r.zone_name,
        delivery_partner: r.dp_uuid ? { id: r.dp_uuid, name: r.dp_name, mobile: r.dp_mobile } : null,
        status: r.status,
        distance_km: r.distance_km,
        delivery_fee: r.delivery_fee,
        partner_earning: r.delivery_earning,
        admin_commission: r.admin_commission,
        assigned_at: r.assigned_at,
        picked_up_at: r.picked_up_at,
        delivered_at: r.delivered_at,
        created_at: r.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDeliveries error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/deliveries/:requestId
 * Brief delivery detail: route, partner, pharmacy, earnings, tracking timeline.
 */
const getDeliveryDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT dr.*, 
              dp.uuid AS dp_uuid, dp.full_name AS dp_name, dp.mobile AS dp_mobile, dp.profile_photo AS dp_photo,
              dp.vehicle_type AS dp_vehicle_type, dp.rc_number AS dp_rc_number, dp.average_rating AS dp_rating,
              ph.uuid AS ph_uuid, ph.name AS ph_name, ph.mobile AS ph_mobile,
              ph.address_line1 AS ph_addr1, ph.address_line2 AS ph_addr2, ph.city AS ph_city, ph.state AS ph_state, ph.pincode AS ph_pincode,
              z.name AS zone_name,
              po.order_id AS pharmacy_order_id, po.final_amount AS order_amount, po.payment_status,
              po.delivery_address AS order_delivery_address,
              u.uuid AS user_uuid, u.full_name AS user_name, u.mobile AS user_mobile, u.email AS user_email, u.profile_photo AS user_photo
       FROM delivery_requests dr
       LEFT JOIN delivery_partners dp ON dr.partner_id = dp.id
       LEFT JOIN pharmacies ph ON dr.pharmacy_id = ph.id
       LEFT JOIN zones z ON ph.zone_id = z.id
       LEFT JOIN pharmacy_orders po ON dr.order_id = po.id
       LEFT JOIN users u ON po.user_id = u.id
       WHERE dr.request_id = ?`,
      [req.params.requestId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Delivery not found.' });
    const d = rows[0];

    const timeline = [{ status: 'Created', at: d.created_at }];
    if (d.assigned_at) timeline.push({ status: 'Assigned', at: d.assigned_at });
    if (d.picked_up_at) timeline.push({ status: 'Picked Up', at: d.picked_up_at });
    if (d.reached_at) timeline.push({ status: 'Reached', at: d.reached_at });
    if (d.delivered_at) timeline.push({ status: 'Delivered', at: d.delivered_at });
    if (d.status === 'cancelled') timeline.push({ status: 'Cancelled', at: d.updated_at });

    let orderDeliveryAddress = d.order_delivery_address;
    if (typeof orderDeliveryAddress === 'string') {
      try { orderDeliveryAddress = JSON.parse(orderDeliveryAddress); } catch (e) { /* keep as string */ }
    }

    return res.status(200).json({
      message: 'Delivery detail fetched.',
      data: {
        delivery_request_id: d.request_id,
        status: d.status,
        pharmacy_order_id: d.pharmacy_order_id,
        order_amount: d.order_amount,
        payment_status: d.payment_status,
        zone: d.zone_name,
        customer: d.user_uuid ? {
          id: d.user_uuid, name: d.user_name, mobile: d.user_mobile, email: d.user_email, profile_photo: d.user_photo,
          delivery_address: orderDeliveryAddress,
        } : null,
        pharmacy: d.ph_uuid ? {
          id: d.ph_uuid, name: d.ph_name, mobile: d.ph_mobile,
          address: [d.ph_addr1, d.ph_addr2, d.ph_city, d.ph_state, d.ph_pincode].filter(Boolean).join(', '),
        } : null,
        delivery_partner: d.dp_uuid ? {
          id: d.dp_uuid, name: d.dp_name, mobile: d.dp_mobile, profile_photo: d.dp_photo,
          vehicle_type: d.dp_vehicle_type, rc_number: d.dp_rc_number, rating: d.dp_rating,
        } : null,
        route: {
          pickup_address: d.pickup_address, pickup_latitude: d.pickup_latitude, pickup_longitude: d.pickup_longitude,
          drop_address: d.drop_address, drop_latitude: d.drop_latitude, drop_longitude: d.drop_longitude,
          distance_km: d.distance_km,
        },
        earnings: {
          delivery_fee: d.delivery_fee,
          per_km_charge: d.per_km_charge,
          partner_earning: d.delivery_earning,
          admin_commission: d.admin_commission,
          admin_commission_percent: d.admin_commission_percent,
        },
        timeline,
      },
    });
  } catch (error) {
    console.error('admin getDeliveryDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getPartners,
  getPartnerDetail,
  togglePartnerStatus,
  getPartnerTransactions,
  getPartnerSettlements,
  getDeliveries,
  getDeliveryDetail,
};
