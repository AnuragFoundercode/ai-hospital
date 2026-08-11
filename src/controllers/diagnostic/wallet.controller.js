const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DIAGNOSTIC WALLET CONTROLLER
// ─────────────────────────────────────────────

// Helper: get or create wallet
const getOrCreateWallet = async (centerId) => {
  const [rows] = await pool.query('SELECT * FROM diagnostic_wallets WHERE diagnostic_center_id = ?', [centerId]);
  if (rows.length) return rows[0];
  await pool.query('INSERT INTO diagnostic_wallets (diagnostic_center_id) VALUES (?)', [centerId]);
  const [newRows] = await pool.query('SELECT * FROM diagnostic_wallets WHERE diagnostic_center_id = ?', [centerId]);
  return newRows[0];
};

/**
 * GET /api/v1/diagnostic/wallet
 */
const getWallet = async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.diagnostic.id);

    // Get pending admin due
    const [duePending] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM diagnostic_admin_dues WHERE diagnostic_center_id = ? AND is_paid = 0',
      [req.diagnostic.id]
    );

    return res.status(200).json({
      message: 'Wallet fetched.',
      data: {
        balance: wallet.balance,
        total_online_collection: wallet.total_online_collection,
        total_offline_collection: wallet.total_offline_collection,
        total_withdrawn: wallet.total_withdrawn,
        total_admin_due: wallet.total_admin_due,
        total_admin_due_paid: wallet.total_admin_due_paid,
        pending_admin_due: duePending[0].total,
      },
    });
  } catch (error) {
    console.error('diagnostic getWallet error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/diagnostic/wallet/transactions?page=1&limit=20
 */
const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const centerId = req.diagnostic.id;

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM diagnostic_wallet_transactions WHERE diagnostic_center_id = ?', [centerId]);
    const [rows] = await pool.query(
      'SELECT * FROM diagnostic_wallet_transactions WHERE diagnostic_center_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [centerId, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Transactions fetched.',
      data: rows.map((t) => ({
        id: t.id, type: t.type, amount: t.amount, description: t.description,
        reference_type: t.reference_type, balance_after: t.balance_after, created_at: t.created_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('diagnostic getTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/diagnostic/wallet/admin-dues?is_paid=0|1&page=1&limit=20
 */
const getAdminDues = async (req, res) => {
  try {
    const { is_paid, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const centerId = req.diagnostic.id;

    let where = ['diagnostic_center_id = ?'];
    let params = [centerId];
    if (is_paid !== undefined) { where.push('is_paid = ?'); params.push(parseInt(is_paid)); }

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM diagnostic_admin_dues WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM diagnostic_admin_dues WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Admin dues fetched.',
      data: rows.map((d) => ({
        id: d.id, booking_id: d.booking_id, amount: d.amount, commission_percent: d.commission_percent,
        booking_amount: d.booking_amount, payment_type: d.payment_type, is_paid: d.is_paid, paid_at: d.paid_at, created_at: d.created_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('diagnostic getAdminDues error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/diagnostic/wallet/withdraw
 * Body: { amount, remarks }
 */
const requestWithdrawal = async (req, res) => {
  try {
    const { amount, remarks } = req.body;
    const centerId = req.diagnostic.id;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Valid amount required.' });

    const wallet = await getOrCreateWallet(centerId);
    if (parseFloat(wallet.balance) < parseFloat(amount)) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    // Debit
    const newBalance = parseFloat(wallet.balance) - parseFloat(amount);
    await pool.query('UPDATE diagnostic_wallets SET balance = ?, total_withdrawn = total_withdrawn + ? WHERE diagnostic_center_id = ?', [newBalance, amount, centerId]);
    await pool.query('INSERT INTO diagnostic_wallet_transactions (diagnostic_center_id, type, amount, description, reference_type, balance_after) VALUES (?, ?, ?, ?, ?, ?)',
      [centerId, 'debit', amount, `Withdrawal - ₹${amount}`, 'withdrawal', newBalance]);

    // Create withdrawal request
    await pool.query('INSERT INTO diagnostic_withdrawals (diagnostic_center_id, amount, remarks) VALUES (?, ?, ?)', [centerId, amount, remarks || null]);

    return res.status(200).json({ message: 'Withdrawal request submitted.', data: { amount, balance: newBalance, status: 'pending' } });
  } catch (error) {
    console.error('diagnostic withdrawal error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/diagnostic/wallet/withdrawals
 */
const getWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const centerId = req.diagnostic.id;

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM diagnostic_withdrawals WHERE diagnostic_center_id = ?', [centerId]);
    const [rows] = await pool.query('SELECT * FROM diagnostic_withdrawals WHERE diagnostic_center_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [centerId, parseInt(limit), offset]);

    return res.status(200).json({
      message: 'Withdrawals fetched.',
      data: rows.map((w) => ({ id: w.id, amount: w.amount, status: w.status, remarks: w.remarks, admin_remarks: w.admin_remarks, processed_at: w.processed_at, created_at: w.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('diagnostic getWithdrawals error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * HELPER: Credit wallet after booking complete
 * Called from booking status update when completed
 * Online: amount - commission → wallet, commission → admin_due
 * Offline: full amount → NOT in wallet (center collected cash), commission → admin_due
 */
const creditAfterComplete = async (centerId, bookingId, amount, paymentType) => {
  try {
    // Get commission percent
    const [centerRows] = await pool.query('SELECT admin_commission_percent FROM diagnostic_centers WHERE id = ?', [centerId]);
    const commissionPercent = centerRows[0]?.admin_commission_percent || 10;
    const commission = parseFloat(amount) * (commissionPercent / 100);

    const wallet = await getOrCreateWallet(centerId);

    if (paymentType === 'online') {
      // Online: credit (amount - commission) to wallet
      const creditAmount = parseFloat(amount) - commission;
      const newBalance = parseFloat(wallet.balance) + creditAmount;
      await pool.query('UPDATE diagnostic_wallets SET balance = ?, total_online_collection = total_online_collection + ?, total_admin_due = total_admin_due + ? WHERE diagnostic_center_id = ?',
        [newBalance, parseFloat(amount), commission, centerId]);
      await pool.query('INSERT INTO diagnostic_wallet_transactions (diagnostic_center_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [centerId, 'credit', creditAmount, `Online booking (₹${amount} - ${commissionPercent}% commission)`, 'online_booking', bookingId, newBalance]);
    } else {
      // Offline: center already has cash, just track in total_offline_collection + admin_due
      await pool.query('UPDATE diagnostic_wallets SET total_offline_collection = total_offline_collection + ?, total_admin_due = total_admin_due + ? WHERE diagnostic_center_id = ?',
        [parseFloat(amount), commission, centerId]);
    }

    // Record admin due
    await pool.query('INSERT INTO diagnostic_admin_dues (diagnostic_center_id, booking_id, amount, commission_percent, booking_amount, payment_type) VALUES (?, ?, ?, ?, ?, ?)',
      [centerId, bookingId, commission, commissionPercent, amount, paymentType]);

  } catch (error) {
    console.error('creditAfterComplete error:', error.message);
  }
};

module.exports = {
  getWallet,
  getTransactions,
  getAdminDues,
  requestWithdrawal,
  getWithdrawals,
  creditAfterComplete,
};
