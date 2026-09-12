const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN PHARMACY MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/pharmacies?page=&limit=&search=&verification_status=&is_active=&zone_id=
 * + global summary (total / active / inactive / pending) unaffected by filters.
 */
const getPharmacies = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, is_active, zone_id } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('(p.name LIKE ? OR p.owner_name LIKE ? OR p.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('p.verification_status = ?'); params.push(verification_status); }
    if (is_active !== undefined) { where.push('p.is_active = ?'); params.push(parseInt(is_active)); }
    if (zone_id) { where.push('p.zone_id = ?'); params.push(parseInt(zone_id)); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM pharmacies p WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT p.id, p.uuid, p.name, p.owner_name, p.mobile, p.email, p.profile_photo, p.city, p.zone_id, z.name AS zone_name,
              p.average_rating, p.verification_status, p.is_active, p.created_at
       FROM pharmacies p LEFT JOIN zones z ON p.zone_id = z.id
       WHERE ${whereClause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(is_active = 1) AS active,
              SUM(is_active = 0) AS inactive,
              SUM(verification_status = 'pending') AS pending
       FROM pharmacies`
    );

    return res.status(200).json({
      message: 'Pharmacies fetched.',
      summary: {
        total_pharmacies: summary.total,
        active_pharmacies: Number(summary.active) || 0,
        inactive_pharmacies: Number(summary.inactive) || 0,
        pending_pharmacies: Number(summary.pending) || 0,
      },
      data: rows.map((p) => ({
        id: p.uuid, db_id: p.id, name: p.name, owner_name: p.owner_name, mobile: p.mobile, email: p.email,
        profile_photo: p.profile_photo, city: p.city, zone_id: p.zone_id, zone_name: p.zone_name,
        average_rating: p.average_rating, verification_status: p.verification_status, is_active: !!p.is_active,
        created_at: p.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPharmacies error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/pharmacies/:id/toggle-status
 */
const togglePharmacyStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM pharmacies WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Pharmacy not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE pharmacies SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Pharmacy activated.' : 'Pharmacy deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin togglePharmacyStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/pharmacies/:id
 * Full profile + stats + order/stock/payout summary + recent orders.
 */
const getPharmacyDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT p.*, z.name AS zone_name FROM pharmacies p LEFT JOIN zones z ON p.zone_id = z.id WHERE p.uuid = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Pharmacy not found.' });
    const p = rows[0];
    const pid = p.id;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM pharmacy_bank_details WHERE pharmacy_id = ?', [pid]);
    const [walletRows] = await pool.query('SELECT balance, total_earned, total_withdrawn FROM pharmacy_wallets WHERE pharmacy_id = ?', [pid]);
    const wallet = walletRows[0] || { balance: 0, total_earned: 0, total_withdrawn: 0 };

    // Orders summary
    const [[ord]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'delivered') AS completed,
              SUM(status IN ('cancelled','rejected')) AS cancelled,
              SUM(status NOT IN ('delivered','cancelled','rejected')) AS pending,
              SUM(DATE(created_at) = ?) AS today
       FROM pharmacy_orders WHERE pharmacy_id = ?`, [today, pid]
    );

    // Stock summary
    const [[stock]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(quantity > low_stock_alert) AS in_stock,
              SUM(quantity > 0 AND quantity <= low_stock_alert) AS low_stock,
              SUM(quantity = 0) AS out_of_stock
       FROM pharmacy_medicines WHERE pharmacy_id = ? AND is_active = 1`, [pid]
    );

    // Payout summary (withdrawals)
    const [[payout]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status = 'processed' THEN amount END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending,
              MAX(CASE WHEN status = 'processed' THEN processed_at END) AS last_settlement
       FROM pharmacy_withdrawals WHERE pharmacy_id = ?`, [pid]
    );

    // Recent orders (max 10)
    const [recent] = await pool.query(
      `SELECT po.order_id, po.status, po.payment_status, po.final_amount, po.total_items, po.created_at,
              u.full_name AS customer_name
       FROM pharmacy_orders po JOIN users u ON po.user_id = u.id
       WHERE po.pharmacy_id = ? ORDER BY po.created_at DESC LIMIT 10`, [pid]
    );

    return res.status(200).json({
      message: 'Pharmacy detail fetched.',
      data: {
        id: p.uuid,
        verification_status: p.verification_status,
        is_active: !!p.is_active,
        profile: {
          name: p.name, owner_name: p.owner_name, mobile: p.mobile, email: p.email, profile_photo: p.profile_photo,
          about: p.about_description, store_photo_url: p.store_photo_url,
        },
        licenses: {
          license_number: p.license_number, drug_license_number: p.drug_license_number, gst_number: p.gst_number,
          pan_number: p.pan_number, business_registration_number: p.business_registration_number,
          drug_license_url: p.drug_license_url, gst_certificate_url: p.gst_certificate_url, pan_card_url: p.pan_card_url,
        },
        address: {
          address_line1: p.address_line1, address_line2: p.address_line2, landmark: p.landmark,
          city: p.city, state: p.state, pincode: p.pincode, zone_id: p.zone_id, zone_name: p.zone_name,
          latitude: p.latitude, longitude: p.longitude,
        },
        settings: {
          opening_time: p.opening_time, closing_time: p.closing_time, is_24hours: !!p.is_24hours,
          delivery_available: !!p.delivery_available, delivery_radius_km: p.delivery_radius_km,
          delivery_charge: p.delivery_charge, free_delivery_above: p.free_delivery_above,
          admin_commission_percent: p.admin_commission_percent,
        },
        bank: bankRows[0] || null,
        stats: {
          total_orders: ord.total,
          todays_orders: Number(ord.today) || 0,
          total_pharmacy_earning: wallet.total_earned,
          wallet_balance: wallet.balance,
          pending_payout: parseFloat(payout.pending),
          total_products: stock.total,
          average_rating: p.average_rating,
          registration_date: p.created_at,
        },
        order_summary: {
          total: ord.total,
          completed: Number(ord.completed) || 0,
          pending: Number(ord.pending) || 0,
          cancelled: Number(ord.cancelled) || 0,
        },
        stock_summary: {
          total_products: stock.total,
          in_stock: Number(stock.in_stock) || 0,
          low_stock: Number(stock.low_stock) || 0,
          out_of_stock: Number(stock.out_of_stock) || 0,
        },
        payout_summary: {
          total_payout: parseFloat(payout.total_paid),
          pending_payout: parseFloat(payout.pending),
          last_settlement_date: payout.last_settlement,
        },
        recent_orders: recent.map((r) => ({
          order_id: r.order_id, status: r.status, payment_status: r.payment_status,
          amount: r.final_amount, total_items: r.total_items, customer_name: r.customer_name, created_at: r.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('admin getPharmacyDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/pharmacies/:id/transactions?page=&limit=&type=
 */
const getPharmacyTransactions = async (req, res) => {
  try {
    const [pRows] = await pool.query('SELECT id FROM pharmacies WHERE uuid = ?', [req.params.id]);
    if (!pRows.length) return res.status(404).json({ message: 'Pharmacy not found.' });
    const pid = pRows[0].id;

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['pharmacy_id = ?']; const params = [pid];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM pharmacy_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, admin_commission, balance_after, created_at
       FROM pharmacy_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPharmacyTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const resolvePid = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM pharmacies WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * GET /api/v1/admin/pharmacies/:id/withdrawals?page=&limit=&status=
 */
const getPharmacyWithdrawals = async (req, res) => {
  try {
    const pid = await resolvePid(req.params.id);
    if (!pid) return res.status(404).json({ message: 'Pharmacy not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['pharmacy_id = ?']; const params = [pid];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM pharmacy_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM pharmacy_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Withdrawals fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPharmacyWithdrawals error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/pharmacies/:id/orders?page=&limit=&status=&payment_status=
 * Order history with full details + customer.
 */
const getPharmacyOrders = async (req, res) => {
  try {
    const pid = await resolvePid(req.params.id);
    if (!pid) return res.status(404).json({ message: 'Pharmacy not found.' });

    const { status, payment_status, page = 1, limit = 20 } = req.query;
    const where = ['po.pharmacy_id = ?']; const params = [pid];
    if (status) { where.push('po.status = ?'); params.push(status); }
    if (payment_status) { where.push('po.payment_status = ?'); params.push(payment_status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM pharmacy_orders po WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT po.order_id, po.status, po.payment_status, po.payment_method, po.total_items,
              po.base_amount, po.discount_amount, po.delivery_charge, po.final_amount,
              po.items, po.delivery_address, po.prescription_url, po.delivery_partner_earning, po.delivery_admin_commission,
              po.created_at, po.delivered_at,
              u.uuid AS user_uuid, u.full_name AS customer_name, u.mobile AS customer_mobile,
              dp.uuid AS dp_uuid, dp.full_name AS dp_name, dp.mobile AS dp_mobile, dp.profile_photo AS dp_photo, dp.vehicle_type AS dp_vehicle, dp.average_rating AS dp_rating
       FROM pharmacy_orders po
       JOIN users u ON po.user_id = u.id
       LEFT JOIN delivery_partners dp ON po.delivery_partner_id = dp.id
       WHERE ${whereClause} ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Orders fetched.',
      data: rows.map((o) => ({
        order_id: o.order_id, status: o.status, payment_status: o.payment_status, payment_method: o.payment_method,
        total_items: o.total_items,
        pricing: { base_amount: o.base_amount, discount_amount: o.discount_amount, delivery_charge: o.delivery_charge, final_amount: o.final_amount },
        items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
        delivery_address: typeof o.delivery_address === 'string' ? JSON.parse(o.delivery_address) : o.delivery_address,
        prescription_url: o.prescription_url,
        customer: { id: o.user_uuid, name: o.customer_name, mobile: o.customer_mobile },
        delivery_partner: o.dp_uuid ? {
          id: o.dp_uuid, name: o.dp_name, mobile: o.dp_mobile, profile_photo: o.dp_photo,
          vehicle_type: o.dp_vehicle, rating: o.dp_rating,
          earning: o.delivery_partner_earning, admin_commission: o.delivery_admin_commission,
        } : null,
        created_at: o.created_at, delivered_at: o.delivered_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPharmacyOrders error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/pharmacies/:id/products?page=&limit=&search=&stock=in_stock|low_stock|out_of_stock
 * Product list with live stock status.
 */
const getPharmacyProducts = async (req, res) => {
  try {
    const pid = await resolvePid(req.params.id);
    if (!pid) return res.status(404).json({ message: 'Pharmacy not found.' });

    const { search, stock, page = 1, limit = 20 } = req.query;
    const where = ['pm.pharmacy_id = ?', 'pm.is_active = 1']; const params = [pid];
    if (search) { where.push('(pm.name LIKE ? OR pm.generic_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (stock === 'in_stock') where.push('pm.quantity > pm.low_stock_alert');
    else if (stock === 'low_stock') where.push('pm.quantity > 0 AND pm.quantity <= pm.low_stock_alert');
    else if (stock === 'out_of_stock') where.push('pm.quantity = 0');
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM pharmacy_medicines pm WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT pm.id, pm.name, pm.generic_name, pm.manufacturer, mc.name AS category_name,
              pm.mrp, pm.selling_price, pm.quantity, pm.low_stock_alert, pm.expiry_date,
              pm.prescription_required, pm.medicine_image_url
       FROM pharmacy_medicines pm LEFT JOIN medicine_categories mc ON pm.category_id = mc.id
       WHERE ${whereClause} ORDER BY pm.name ASC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const stockStatus = (q, low) => (q === 0 ? 'out_of_stock' : (q <= low ? 'low_stock' : 'in_stock'));

    return res.status(200).json({
      message: 'Products fetched.',
      data: rows.map((m) => ({
        id: m.id, name: m.name, generic_name: m.generic_name, manufacturer: m.manufacturer, category: m.category_name,
        mrp: m.mrp, selling_price: m.selling_price, quantity: m.quantity, low_stock_alert: m.low_stock_alert,
        stock_status: stockStatus(m.quantity, m.low_stock_alert),
        expiry_date: m.expiry_date, prescription_required: !!m.prescription_required, image_url: m.medicine_image_url,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getPharmacyProducts error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getPharmacies,
  togglePharmacyStatus,
  getPharmacyDetail,
  getPharmacyTransactions,
  getPharmacyWithdrawals,
  getPharmacyOrders,
  getPharmacyProducts,
};
