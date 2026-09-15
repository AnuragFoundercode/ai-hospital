const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN DIAGNOSTIC CENTER MANAGEMENT
// ─────────────────────────────────────────────

const resolveCenterId = async (uuid) => {
  const [rows] = await pool.query('SELECT id FROM diagnostic_centers WHERE uuid = ?', [uuid]);
  return rows.length ? rows[0].id : null;
};

/**
 * GET /api/v1/admin/diagnostics?page=&limit=&search=&verification_status=&is_active=&zone_id=&from=&to=
 * + global summary (total / active centers / total bookings) — unaffected by filters.
 */
const getDiagnostics = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, verification_status, is_active, zone_id, from, to } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1']; const params = [];
    if (search) { where.push('(d.name LIKE ? OR d.owner_name LIKE ? OR d.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (verification_status) { where.push('d.verification_status = ?'); params.push(verification_status); }
    if (is_active !== undefined) { where.push('d.is_active = ?'); params.push(parseInt(is_active)); }
    if (zone_id) { where.push('d.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (from) { where.push('d.created_at >= ?'); params.push(from); }
    if (to) { where.push('d.created_at <= ?'); params.push(`${to} 23:59:59`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM diagnostic_centers d WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT d.id, d.uuid, d.name, d.owner_name, d.mobile, d.email, d.profile_photo, d.city,
              d.zone_id, z.name AS zone_name, d.verification_status, d.is_active, d.average_rating, d.created_at,
              COALESCE(w.balance, 0) AS wallet_balance
       FROM diagnostic_centers d
       LEFT JOIN zones z ON d.zone_id = z.id
       LEFT JOIN diagnostic_wallets w ON w.diagnostic_center_id = d.id
       WHERE ${whereClause} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [[summary]] = await pool.query('SELECT COUNT(*) AS total, SUM(is_active = 1) AS active FROM diagnostic_centers');
    const [[bk]] = await pool.query("SELECT COUNT(*) AS total FROM bookings WHERE service_type = 'diagnostic_scan'");

    return res.status(200).json({
      message: 'Diagnostic centers fetched.',
      summary: { total_centers: summary.total, active_centers: Number(summary.active) || 0, total_bookings: bk.total },
      data: rows.map((d) => ({
        id: d.uuid, db_id: d.id, center_name: d.name, owner_name: d.owner_name, mobile: d.mobile, email: d.email,
        profile_photo: d.profile_photo, city: d.city, zone: d.zone_name, zone_id: d.zone_id,
        wallet_balance: d.wallet_balance, average_rating: d.average_rating,
        status: d.verification_status, is_active: !!d.is_active, registration_date: d.created_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDiagnostics error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/diagnostics/:id/toggle-status
 */
const toggleDiagnosticStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, is_active FROM diagnostic_centers WHERE uuid = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Diagnostic center not found.' });
    const next = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE diagnostic_centers SET is_active = ? WHERE id = ?', [next, rows[0].id]);
    return res.status(200).json({ message: next ? 'Center activated.' : 'Center deactivated.', data: { id: req.params.id, is_active: !!next } });
  } catch (error) {
    console.error('admin toggleDiagnosticStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/diagnostics/:id
 * Full profile + stats + scan/payout summary.
 */
const getDiagnosticDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT d.*, z.name AS zone_name FROM diagnostic_centers d LEFT JOIN zones z ON d.zone_id = z.id WHERE d.uuid = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Diagnostic center not found.' });
    const d = rows[0];
    const cid = d.id;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];

    const [bankRows] = await pool.query('SELECT account_holder_name, bank_name, account_number, ifsc_code FROM diagnostic_bank_details WHERE diagnostic_center_id = ?', [cid]);
    const [wRows] = await pool.query('SELECT * FROM diagnostic_wallets WHERE diagnostic_center_id = ?', [cid]);
    const w = wRows[0] || { balance: 0, total_online_collection: 0, total_offline_collection: 0, total_withdrawn: 0, total_admin_due: 0, total_admin_due_paid: 0 };

    const [[bk]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'completed') AS completed,
              SUM(status IN ('cancelled','failed')) AS cancelled,
              SUM(status NOT IN ('completed','cancelled','failed')) AS pending,
              SUM(DATE(created_at) = ?) AS today
       FROM bookings WHERE service_type = 'diagnostic_scan' AND provider_id = ?`, [today, cid]
    );

    const [[payout]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status = 'processed' THEN amount END),0) AS total_paid,
              COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount END),0) AS pending,
              MAX(CASE WHEN status = 'processed' THEN processed_at END) AS last_settlement
       FROM diagnostic_withdrawals WHERE diagnostic_center_id = ?`, [cid]
    );

    const totalEarning = parseFloat(w.total_online_collection) + parseFloat(w.total_offline_collection);
    const pendingAdminDue = parseFloat(w.total_admin_due) - parseFloat(w.total_admin_due_paid);

    return res.status(200).json({
      message: 'Diagnostic detail fetched.',
      data: {
        id: d.uuid,
        verification_status: d.verification_status,
        is_active: !!d.is_active,
        profile: { name: d.name, owner_name: d.owner_name, mobile: d.mobile, email: d.email, profile_photo: d.profile_photo },
        licenses: { nabh_accreditation_number: d.nabh_accreditation_number, registration_number: d.registration_number, gst_number: d.gst_number, pan_number: d.pan_number, nabh_certificate_url: d.nabh_certificate_url, registration_certificate_url: d.registration_certificate_url, gst_certificate_url: d.gst_certificate_url, pan_card_url: d.pan_card_url },
        address: { address_line1: d.address_line1, address_line2: d.address_line2, landmark: d.landmark, city: d.city, state: d.state, pincode: d.pincode, zone_id: d.zone_id, zone_name: d.zone_name, latitude: d.latitude, longitude: d.longitude },
        settings: { opening_time: d.opening_time, closing_time: d.closing_time, admin_commission_percent: d.admin_commission_percent },
        bank: bankRows[0] || null,
        stats: {
          total_bookings: bk.total,
          todays_bookings: Number(bk.today) || 0,
          total_center_earnings: parseFloat(totalEarning.toFixed(2)),
          wallet_balance: w.balance,
          pending_payout: parseFloat(payout.pending),
          completed_payout: parseFloat(payout.total_paid),
          admin_due_pending: parseFloat(pendingAdminDue.toFixed(2)),
          total_offline_collection: w.total_offline_collection,
          total_online_collection: w.total_online_collection,
          average_rating: d.average_rating,
          registration_date: d.created_at,
        },
        scan_summary: {
          total: bk.total,
          completed: Number(bk.completed) || 0,
          pending: Number(bk.pending) || 0,
          cancelled: Number(bk.cancelled) || 0,
        },
        payout_summary: {
          total_payout: parseFloat(payout.total_paid),
          pending_payout: parseFloat(payout.pending),
          completed_payout: parseFloat(payout.total_paid),
          last_settlement_date: payout.last_settlement,
        },
      },
    });
  } catch (error) {
    console.error('admin getDiagnosticDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/diagnostics/:id/transactions?page=&limit=&type=
 */
const getDiagnosticTransactions = async (req, res) => {
  try {
    const cid = await resolveCenterId(req.params.id);
    if (!cid) return res.status(404).json({ message: 'Diagnostic center not found.' });

    const { type, page = 1, limit = 20 } = req.query;
    const where = ['diagnostic_center_id = ?']; const params = [cid];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM diagnostic_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, type, amount, description, reference_type, reference_id, balance_after, created_at
       FROM diagnostic_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Transactions fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDiagnosticTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/diagnostics/:id/settlements?page=&limit=&status=
 * Withdrawal / settlement history.
 */
const getDiagnosticSettlements = async (req, res) => {
  try {
    const cid = await resolveCenterId(req.params.id);
    if (!cid) return res.status(404).json({ message: 'Diagnostic center not found.' });

    const { status, page = 1, limit = 20 } = req.query;
    const where = ['diagnostic_center_id = ?']; const params = [cid];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM diagnostic_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT id, amount, status, remarks, admin_remarks, processed_at, created_at
       FROM diagnostic_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );
    return res.status(200).json({
      message: 'Settlements fetched.', data: rows,
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin getDiagnosticSettlements error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/diagnostic-bookings
 * Global diagnostic booking list.
 * Filters: zone_id, center_id(uuid), booking_type, status, payment_status, payment_method, from, to, search. Pagination.
 * + global summary (unaffected by filters).
 */
const getAllBookings = async (req, res) => {
  try {
    const { zone_id, center_id, booking_type, status, payment_status, payment_method, from, to, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ["b.service_type = 'diagnostic_scan'"]; const params = [];
    if (zone_id) { where.push('d.zone_id = ?'); params.push(parseInt(zone_id)); }
    if (center_id) { where.push('d.uuid = ?'); params.push(center_id); }
    if (booking_type) { where.push("JSON_EXTRACT(b.metadata, '$.booking_type') = ?"); params.push(booking_type); }
    if (status) { where.push('b.status = ?'); params.push(status); }
    if (payment_status) { where.push('b.payment_status = ?'); params.push(payment_status); }
    if (payment_method) { where.push('b.payment_method = ?'); params.push(payment_method); }
    if (from) { where.push('b.created_at >= ?'); params.push(from); }
    if (to) { where.push('b.created_at <= ?'); params.push(`${to} 23:59:59`); }
    if (search) { where.push('(b.booking_id LIKE ? OR u.full_name LIKE ? OR u.mobile LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const whereClause = where.join(' AND ');

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM bookings b JOIN users u ON b.user_id = u.id LEFT JOIN diagnostic_centers d ON b.provider_id = d.id WHERE ${whereClause}`, params
    );
    const [rows] = await pool.query(
      `SELECT b.booking_id, b.status, b.payment_status, b.payment_method, b.final_amount, b.booking_date, b.slot_start_time, b.slot_end_time, b.metadata, b.created_at,
              u.uuid AS user_uuid, u.full_name AS patient_name, u.mobile AS patient_mobile,
              d.uuid AS center_uuid, d.name AS center_name, d.zone_id, z.name AS zone_name
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       LEFT JOIN diagnostic_centers d ON b.provider_id = d.id
       LEFT JOIN zones z ON d.zone_id = z.id
       WHERE ${whereClause} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];
    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(DATE(created_at) = ?) AS today,
              SUM(status = 'completed') AS completed,
              SUM(status = 'report_uploaded') AS report_ready,
              SUM(status IN ('cancelled','failed')) AS cancelled,
              SUM(status NOT IN ('completed','report_uploaded','cancelled','failed')) AS pending
       FROM bookings WHERE service_type = 'diagnostic_scan'`, [today]
    );

    return res.status(200).json({
      message: 'Bookings fetched.',
      summary: {
        total_bookings: summary.total,
        todays_bookings: Number(summary.today) || 0,
        pending_scans: Number(summary.pending) || 0,
        completed_scans: Number(summary.completed) || 0,
        report_ready: Number(summary.report_ready) || 0,
        cancelled: Number(summary.cancelled) || 0,
      },
      data: rows.map((b) => {
        const md = typeof b.metadata === 'string' ? JSON.parse(b.metadata || '{}') : (b.metadata || {});
        return {
          booking_id: b.booking_id,
          patient_name: md.patient?.name || b.patient_name,
          mobile: b.patient_mobile,
          zone: b.zone_name,
          diagnostic_center: b.center_uuid ? { id: b.center_uuid, name: b.center_name } : null,
          booking_type: md.booking_type || null,
          service_name: md.service_name || null,
          scheduled_date: b.booking_date,
          slot_time: b.slot_start_time,
          amount: b.final_amount,
          status: b.status,
          payment_status: b.payment_status,
          payment_method: b.payment_method,
          booking_date: b.created_at,
        };
      }),
      pagination: { page: pageNum, limit: limitNum, total: cnt.total, total_pages: Math.ceil(cnt.total / limitNum) },
    });
  } catch (error) {
    console.error('admin diagnostic getAllBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/diagnostic-bookings/:booking_id
 * Complete diagnostic booking view.
 */
const getBookingDetail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, u.uuid AS user_uuid, u.full_name AS patient_name, u.mobile AS patient_mobile, u.email AS patient_email, u.gender AS user_gender, u.date_of_birth AS user_dob,
              d.uuid AS center_uuid, d.name AS center_name, d.owner_name AS center_owner, d.mobile AS center_mobile,
              d.address_line1 AS c_addr1, d.address_line2 AS c_addr2, d.landmark AS c_landmark, d.city AS c_city, d.state AS c_state, d.pincode AS c_pincode,
              d.latitude AS c_lat, d.longitude AS c_lng, d.admin_commission_percent, d.zone_id, z.name AS zone_name
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       LEFT JOIN diagnostic_centers d ON b.provider_id = d.id
       LEFT JOIN zones z ON d.zone_id = z.id
       WHERE b.booking_id = ? AND b.service_type = 'diagnostic_scan'`,
      [req.params.booking_id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Booking not found.' });
    const b = rows[0];
    const md = typeof b.metadata === 'string' ? JSON.parse(b.metadata || '{}') : (b.metadata || {});

    // Service details from pricing table
    let service = null;
    if (md.service_pricing_id) {
      const [svc] = await pool.query(
        `SELECT dsp.price, dsp.discount_percent, dsp.duration_minutes, dsp.booking_type, ds.name AS service_name, ds.description, ds.report_delivery_hours, ds.is_fasting_required, dc.name AS category_name
         FROM diagnostic_service_pricing dsp
         JOIN diagnostic_services ds ON dsp.service_id = ds.id
         LEFT JOIN diagnostic_categories dc ON ds.category_id = dc.id
         WHERE dsp.id = ?`, [md.service_pricing_id]
      );
      service = svc[0] || null;
    }

    // Timeline
    const [hist] = await pool.query(
      'SELECT to_status, remarks, created_at FROM booking_status_history WHERE booking_id = ? ORDER BY created_at ASC',
      [b.id]
    );

    const finalAmount = parseFloat(b.final_amount) || 0;
    const commissionPct = parseFloat(b.admin_commission_percent) || 0;
    const adminProfit = parseFloat((finalAmount * (commissionPct / 100)).toFixed(2));

    return res.status(200).json({
      message: 'Booking detail fetched.',
      data: {
        booking_information: {
          booking_id: b.booking_id,
          booking_date: b.created_at,
          scheduled_date: b.booking_date,
          slot_start_time: b.slot_start_time,
          slot_end_time: b.slot_end_time,
          booking_type: service?.booking_type || md.booking_type || null,
          status: b.status,
          payment_status: b.payment_status,
          payment_method: b.payment_method,
          transaction_id: b.transaction_id,
          zone: b.zone_name,
        },
        patient_information: {
          name: md.patient?.name || b.patient_name,
          mobile: md.patient?.mobile || b.patient_mobile,
          email: md.patient?.email || b.patient_email,
          age: md.patient?.age || null,
          gender: md.patient?.gender || b.user_gender,
        },
        diagnostic_center: {
          id: b.center_uuid,
          name: b.center_name,
          contact_person: b.center_owner,
          mobile: b.center_mobile,
          address: [b.c_addr1, b.c_addr2, b.c_landmark, b.c_city, b.c_state, b.c_pincode].filter(Boolean).join(', '),
          latitude: b.c_lat,
          longitude: b.c_lng,
        },
        service: {
          name: service?.service_name || md.service_name || null,
          category: service?.category_name || null,
          description: service?.description || null,
          duration_minutes: service?.duration_minutes || null,
          is_fasting_required: service ? !!service.is_fasting_required : null,
          report_delivery_hours: service?.report_delivery_hours || null,
        },
        payment_summary: {
          service_amount: parseFloat(b.base_amount) || finalAmount,
          discount: parseFloat(b.discount_amount) || 0,
          tax_amount: parseFloat(b.tax_amount) || 0,
          total_amount: finalAmount,
          admin_commission_percent: commissionPct,
          admin_profit: adminProfit,
        },
        reports: md.reports && md.reports.length ? md.reports : [],
        report_notes: md.report_notes || null,
        prescription: md.prescription || null,
        order_timeline: hist.map((h) => ({ status: h.to_status, remarks: h.remarks, time: h.created_at })),
        booking_notes: b.user_notes || md.notes || null,
        rating: b.user_rating ? { rating: b.user_rating, review: b.user_review, rated_at: b.rated_at } : null,
      },
    });
  } catch (error) {
    console.error('admin diagnostic getBookingDetail error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getDiagnostics,
  toggleDiagnosticStatus,
  getDiagnosticDetail,
  getDiagnosticTransactions,
  getDiagnosticSettlements,
  getAllBookings,
  getBookingDetail,
};
