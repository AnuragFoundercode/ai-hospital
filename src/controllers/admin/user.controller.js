const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN USER MANAGEMENT
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/users
 * Query:
 *   page, limit
 *   search       - matches full_name / mobile / email
 *   is_active    - 0 | 1
 *   is_verified  - 0 | 1
 *   gender       - male | female | other
 *   blood_group  - e.g. O+
 *   sort         - newest (default) | oldest | name
 */
const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, is_active, is_verified, gender, blood_group, sort = 'newest' } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const where = ['1=1'];
    const params = [];

    if (search) {
      where.push('(u.full_name LIKE ? OR u.mobile LIKE ? OR u.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (is_active !== undefined) { where.push('u.is_active = ?'); params.push(parseInt(is_active)); }
    if (is_verified !== undefined) { where.push('u.is_verified = ?'); params.push(parseInt(is_verified)); }
    if (gender) { where.push('u.gender = ?'); params.push(gender); }
    if (blood_group) { where.push('u.blood_group = ?'); params.push(blood_group); }

    const whereClause = where.join(' AND ');

    let orderBy = 'u.created_at DESC';
    if (sort === 'oldest') orderBy = 'u.created_at ASC';
    else if (sort === 'name') orderBy = 'u.full_name ASC';

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${whereClause}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT u.id, u.uuid, u.full_name, u.mobile, u.email, u.gender, u.date_of_birth, u.blood_group, u.is_verified, u.is_active, u.profile_photo, u.aadhaar_number, u.abha_number, u.credit_limit, u.created_at, u.updated_at,
              COALESCE(w.balance, 0.00) AS wallet_balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE ${whereClause}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.status(200).json({
      message: 'Users fetched.',
      data: rows.map((u) => ({
        id: u.uuid,
        db_id: u.id,
        full_name: u.full_name,
        mobile: u.mobile,
        email: u.email,
        gender: u.gender,
        date_of_birth: u.date_of_birth,
        blood_group: u.blood_group,
        is_verified: !!u.is_verified,
        is_active: !!u.is_active,
        profile_photo: u.profile_photo,
        aadhaar_number: u.aadhaar_number,
        abha_number: u.abha_number,
        credit_limit: u.credit_limit,
        wallet_balance: u.wallet_balance,
        created_at: u.created_at,
        updated_at: u.updated_at,
      })),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('admin getUsers error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/users/:id/toggle-status
 * Flips is_active for the user (activate <-> deactivate). :id = user uuid.
 */
const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT id, is_active FROM users WHERE uuid = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });

    const newStatus = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, rows[0].id]);

    return res.status(200).json({
      message: newStatus ? 'User activated.' : 'User deactivated.',
      data: { id, is_active: !!newStatus },
    });
  } catch (error) {
    console.error('admin toggleUserStatus error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/admin/users/:id/credit-limit
 * Body: { action: 'set' | 'increase' | 'decrease', amount }
 *   set      -> credit_limit = amount
 *   increase -> credit_limit = credit_limit + amount
 *   decrease -> credit_limit = credit_limit - amount (cannot go below outstanding or 0)
 * :id = user uuid.
 */
const updateCreditLimit = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, amount } = req.body;

    const numAmount = parseFloat(amount);
    if (!['set', 'increase', 'decrease'].includes(action)) {
      return res.status(400).json({ message: "action must be 'set', 'increase', or 'decrease'." });
    }
    if (isNaN(numAmount) || numAmount < 0) {
      return res.status(400).json({ message: 'Valid non-negative amount required.' });
    }

    const [rows] = await pool.query('SELECT id, credit_limit FROM users WHERE uuid = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });
    const userDbId = rows[0].id;
    const current = parseFloat(rows[0].credit_limit) || 0;

    let newLimit;
    if (action === 'set') newLimit = numAmount;
    else if (action === 'increase') newLimit = current + numAmount;
    else newLimit = current - numAmount;

    newLimit = parseFloat(newLimit.toFixed(2));
    if (newLimit < 0) return res.status(400).json({ message: 'Credit limit cannot be negative.', data: { current_limit: current } });

    // Don't drop the limit below what the user has already drawn (approved credit)
    const [outRows] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS outstanding FROM credit_applications WHERE user_id = ? AND status = 'approved'",
      [userDbId]
    );
    const outstanding = parseFloat(outRows[0].outstanding) || 0;
    if (newLimit < outstanding) {
      return res.status(400).json({
        message: `Credit limit cannot be less than the amount already drawn (₹${outstanding}).`,
        data: { current_limit: current, outstanding, attempted_limit: newLimit },
      });
    }

    await pool.query('UPDATE users SET credit_limit = ? WHERE id = ?', [newLimit, userDbId]);

    return res.status(200).json({
      message: 'Credit limit updated.',
      data: { id, previous_limit: current, credit_limit: newLimit, outstanding, available_limit: parseFloat((newLimit - outstanding).toFixed(2)) },
    });
  } catch (error) {
    console.error('admin updateCreditLimit error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/users/:id/overview
 * :id = user uuid. Full admin overview of one user:
 *  - profile
 *  - quick summary (total bookings, total recharge, wallet balance, total spent)
 *  - transaction summary (total / successful / pending / failed)
 *  - recent activity (latest actions across all modules)
 */
const getUserOverview = async (req, res) => {
  try {
    const { id } = req.params;

    const [uRows] = await pool.query(
      `SELECT id, uuid, full_name, mobile, email, gender, date_of_birth, blood_group, profile_photo,
              is_verified, is_active, credit_limit, created_at
       FROM users WHERE uuid = ?`,
      [id]
    );
    if (!uRows.length) return res.status(404).json({ message: 'User not found.' });
    const u = uRows[0];
    const uid = u.id;

    // ── Wallet balance ──
    const [wRows] = await pool.query('SELECT COALESCE(balance, 0) AS balance FROM wallets WHERE user_id = ?', [uid]);
    const walletBalance = parseFloat(wRows[0]?.balance || 0);

    // ── Total wallet recharge (sum of successful recharge credits) ──
    const [rechRows] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions WHERE user_id = ? AND type = 'credit' AND reference_type = 'recharge'",
      [uid]
    );
    const totalRecharge = parseFloat(rechRows[0].total);

    // ── Total spent (all debits: booking payments, call charges, etc.) ──
    const [spentRows] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions WHERE user_id = ? AND type = 'debit'",
      [uid]
    );
    const totalSpent = parseFloat(spentRows[0].total);

    // ── Total bookings across all modules ──
    const [[b1]] = await pool.query('SELECT COUNT(*) AS c FROM bookings WHERE user_id = ?', [uid]);
    const [[b2]] = await pool.query('SELECT COUNT(*) AS c FROM pharmacy_orders WHERE user_id = ?', [uid]);
    const [[b3]] = await pool.query('SELECT COUNT(*) AS c FROM ambulance_bookings WHERE user_id = ?', [uid]);
    const [[b4]] = await pool.query('SELECT COUNT(*) AS c FROM blood_requests WHERE user_id = ?', [uid]);
    const totalBookings = b1.c + b2.c + b3.c + b4.c;

    // ── Transaction summary (payment status across all paid modules) ──
    // successful = paid, pending = unpaid/pending/partial, failed = failed
    const paymentAgg = async (table) => {
      const [[r]] = await pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS successful,
           SUM(CASE WHEN payment_status IN ('failed') THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN payment_status NOT IN ('paid','failed') THEN 1 ELSE 0 END) AS pending
         FROM ${table} WHERE user_id = ?`,
        [uid]
      );
      return { total: r.total || 0, successful: Number(r.successful) || 0, failed: Number(r.failed) || 0, pending: Number(r.pending) || 0 };
    };
    const t1 = await paymentAgg('bookings');
    const t2 = await paymentAgg('pharmacy_orders');
    const t3 = await paymentAgg('ambulance_bookings');
    const t4 = await paymentAgg('blood_requests');
    const txnSummary = {
      total: t1.total + t2.total + t3.total + t4.total,
      successful: t1.successful + t2.successful + t3.successful + t4.successful,
      pending: t1.pending + t2.pending + t3.pending + t4.pending,
      failed: t1.failed + t2.failed + t3.failed + t4.failed,
    };

    // ── Recent activity (latest across modules) ──
    const activities = [];
    const [pRows] = await pool.query("SELECT order_id AS ref, status, created_at FROM pharmacy_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [uid]);
    pRows.forEach((r) => activities.push({ type: 'medicine_order', title: 'Medicine order placed', reference: r.ref, status: r.status, time: r.created_at }));

    const [bkRows] = await pool.query("SELECT booking_id AS ref, service_type, status, created_at FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [uid]);
    const svcLabel = { doctor_consultation: 'Doctor appointment booked', pathology_test: 'Lab test booked', diagnostic_scan: 'Diagnostic scan booked', blood_request: 'Blood request placed', medicine_order: 'Medicine order placed', ambulance: 'Ambulance booked' };
    bkRows.forEach((r) => activities.push({ type: r.service_type, title: svcLabel[r.service_type] || 'Booking placed', reference: r.ref, status: r.status, time: r.created_at }));

    const [abRows] = await pool.query("SELECT booking_id AS ref, status, created_at FROM ambulance_bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [uid]);
    abRows.forEach((r) => activities.push({ type: 'ambulance', title: 'Ambulance booked', reference: r.ref, status: r.status, time: r.created_at }));

    const [brRows] = await pool.query("SELECT request_id AS ref, status, created_at FROM blood_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [uid]);
    brRows.forEach((r) => activities.push({ type: 'blood_request', title: 'Blood request placed', reference: r.ref, status: r.status, time: r.created_at }));

    const [wtRows] = await pool.query("SELECT type, amount, reference_type, created_at FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [uid]);
    wtRows.forEach((r) => activities.push({
      type: 'wallet',
      title: r.reference_type === 'recharge' ? 'Wallet recharged' : (r.type === 'debit' ? 'Wallet payment' : 'Wallet credited'),
      reference: null, status: null, amount: parseFloat(r.amount), time: r.created_at,
    }));

    // Sort by time desc, take latest 10
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recentActivity = activities.slice(0, 10);

    return res.status(200).json({
      message: 'User overview fetched.',
      data: {
        user: {
          id: u.uuid,
          full_name: u.full_name,
          profile_photo: u.profile_photo,
          mobile: u.mobile,
          email: u.email,
          gender: u.gender,
          date_of_birth: u.date_of_birth,
          blood_group: u.blood_group,
          registered_on: u.created_at,
          is_verified: !!u.is_verified,
          status: u.is_active ? 'active' : 'inactive',
        },
        quick_summary: {
          total_bookings: totalBookings,
          total_wallet_recharge: totalRecharge,
          wallet_balance: walletBalance,
          total_spent: totalSpent,
        },
        transaction_summary: txnSummary,
        recent_activity: recentActivity,
      },
    });
  } catch (error) {
    console.error('admin getUserOverview error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/admin/users/:id/bookings
 * :id = user uuid. All bookings/orders across modules for one user.
 * Query:
 *   type    - doctor | lab | diagnostic | pharmacy | ambulance | blood (omit = all)
 *   status  - filter by status
 *   payment_status - unpaid | paid | ...
 *   page, limit
 */
const getUserBookings = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, status, payment_status, page = 1, limit = 20 } = req.query;

    const [uRows] = await pool.query('SELECT id FROM users WHERE uuid = ?', [id]);
    if (!uRows.length) return res.status(404).json({ message: 'User not found.' });
    const uid = uRows[0].id;

    const items = [];

    // 1) bookings table (doctor / lab / diagnostic)
    if (!type || ['doctor', 'lab', 'diagnostic'].includes(type)) {
      const w = ['b.user_id = ?']; const p = [uid];
      if (type === 'doctor') w.push("b.service_type = 'doctor_consultation'");
      else if (type === 'lab') w.push("b.service_type = 'pathology_test'");
      else if (type === 'diagnostic') w.push("b.service_type = 'diagnostic_scan'");
      else w.push("b.service_type IN ('doctor_consultation','pathology_test','diagnostic_scan')");
      if (status) { w.push('b.status = ?'); p.push(status); }
      if (payment_status) { w.push('b.payment_status = ?'); p.push(payment_status); }
      const [rows] = await pool.query(
        `SELECT b.booking_id, b.service_type, b.status, b.payment_status, b.final_amount, b.booking_date, b.slot_start_time, b.created_at
         FROM bookings b WHERE ${w.join(' AND ')}`, p
      );
      const svcType = { doctor_consultation: 'doctor', pathology_test: 'lab', diagnostic_scan: 'diagnostic' };
      rows.forEach((r) => items.push({
        reference_id: r.booking_id, module: svcType[r.service_type] || r.service_type,
        status: r.status, payment_status: r.payment_status, amount: r.final_amount,
        date: r.booking_date, slot_time: r.slot_start_time, created_at: r.created_at,
      }));
    }

    // 2) pharmacy orders
    if (!type || type === 'pharmacy') {
      const w = ['po.user_id = ?']; const p = [uid];
      if (status) { w.push('po.status = ?'); p.push(status); }
      if (payment_status) { w.push('po.payment_status = ?'); p.push(payment_status); }
      const [rows] = await pool.query(
        `SELECT po.order_id, po.status, po.payment_status, po.final_amount, po.total_items, po.created_at,
                ph.name AS pharmacy_name
         FROM pharmacy_orders po JOIN pharmacies ph ON po.pharmacy_id = ph.id WHERE ${w.join(' AND ')}`, p
      );
      rows.forEach((r) => items.push({
        reference_id: r.order_id, module: 'pharmacy',
        status: r.status, payment_status: r.payment_status, amount: r.final_amount,
        total_items: r.total_items, provider_name: r.pharmacy_name, created_at: r.created_at,
      }));
    }

    // 3) ambulance
    if (!type || type === 'ambulance') {
      const w = ['ab.user_id = ?']; const p = [uid];
      if (status) { w.push('ab.status = ?'); p.push(status); }
      if (payment_status) { w.push('ab.payment_status = ?'); p.push(payment_status); }
      const [rows] = await pool.query(
        `SELECT ab.booking_id, ab.status, ab.payment_status, ab.total_fare, ab.patient_name, ab.created_at
         FROM ambulance_bookings ab WHERE ${w.join(' AND ')}`, p
      );
      rows.forEach((r) => items.push({
        reference_id: r.booking_id, module: 'ambulance',
        status: r.status, payment_status: r.payment_status, amount: r.total_fare,
        patient_name: r.patient_name, created_at: r.created_at,
      }));
    }

    // 4) blood requests
    if (!type || type === 'blood') {
      const w = ['br.user_id = ?']; const p = [uid];
      if (status) { w.push('br.status = ?'); p.push(status); }
      if (payment_status) { w.push('br.payment_status = ?'); p.push(payment_status); }
      const [rows] = await pool.query(
        `SELECT br.request_id, br.status, br.payment_status, br.total_amount, br.blood_group, br.units_required, br.created_at,
                bb.name AS bank_name
         FROM blood_requests br JOIN blood_banks bb ON br.blood_bank_id = bb.id WHERE ${w.join(' AND ')}`, p
      );
      rows.forEach((r) => items.push({
        reference_id: r.request_id, module: 'blood',
        status: r.status, payment_status: r.payment_status, amount: r.total_amount,
        blood_group: r.blood_group, units_required: r.units_required, provider_name: r.bank_name, created_at: r.created_at,
      }));
    }

    // sort newest first + paginate
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = items.length;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const start = (pageNum - 1) * limitNum;
    const paged = items.slice(start, start + limitNum);

    return res.status(200).json({
      message: 'User bookings fetched.',
      data: paged,
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('admin getUserBookings error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getUsers,
  getUserOverview,
  getUserBookings,
  toggleUserStatus,
  updateCreditLimit,
};
