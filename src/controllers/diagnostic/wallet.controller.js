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

/**
 * POST /api/v1/diagnostic/wallet/clear-due
 * Body: { method: "wallet" | "online" }
 * Clears ALL pending admin dues.
 *  - method "wallet": deducts from wallet balance instantly, marks dues paid.
 *  - method "online": initiates Paytm; dues cleared after /clear-due/verify.
 */
const clearAdminDue = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const method = req.body.method || 'online';
    if (!['wallet', 'online'].includes(method)) return res.status(400).json({ message: 'method must be "wallet" or "online".' });

    // Total pending due
    const [dueRows] = await pool.query('SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM diagnostic_admin_dues WHERE diagnostic_center_id = ? AND is_paid = 0', [centerId]);
    const totalDue = parseFloat(dueRows[0].total);
    const duesCount = dueRows[0].cnt;
    if (totalDue <= 0) return res.status(400).json({ message: 'No pending admin due.' });

    const paymentRef = `ADP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ─── Pay from wallet (instant) ───
    if (method === 'wallet') {
      const wallet = await getOrCreateWallet(centerId);
      if (parseFloat(wallet.balance) < totalDue) {
        return res.status(400).json({ message: 'Insufficient wallet balance to clear due.', data: { wallet_balance: wallet.balance, pending_due: totalDue } });
      }
      const newBalance = parseFloat(wallet.balance) - totalDue;
      await pool.query('UPDATE diagnostic_wallets SET balance = ?, total_admin_due_paid = total_admin_due_paid + ? WHERE diagnostic_center_id = ?', [newBalance, totalDue, centerId]);
      await pool.query("INSERT INTO diagnostic_wallet_transactions (diagnostic_center_id, type, amount, description, reference_type, balance_after) VALUES (?, 'debit', ?, ?, 'admin_due_payment', ?)", [centerId, totalDue, `Admin due cleared - ${paymentRef}`, newBalance]);
      await pool.query("UPDATE diagnostic_admin_dues SET is_paid = 1, paid_at = NOW() WHERE diagnostic_center_id = ? AND is_paid = 0", [centerId]);
      await pool.query("INSERT INTO diagnostic_admin_due_payments (payment_ref, diagnostic_center_id, amount, dues_count, method, status, paid_at) VALUES (?, ?, ?, ?, 'wallet', 'success', NOW())", [paymentRef, centerId, totalDue, duesCount]);
      return res.status(200).json({ message: 'Admin due cleared from wallet.', data: { payment_ref: paymentRef, amount: totalDue, dues_count: duesCount, wallet_balance: newBalance } });
    }

    // ─── Pay online via Paytm ───
    const paytmService = require('../../services/paytm.service');
    const paytmConfig = require('../../config/paytm');
    await pool.query("INSERT INTO diagnostic_admin_due_payments (payment_ref, diagnostic_center_id, amount, dues_count, method, status) VALUES (?, ?, ?, ?, 'online', 'pending')", [paymentRef, centerId, totalDue, duesCount]);

    let paytmData = null;
    try {
      const paytmResponse = await paytmService.initiateTransaction(paymentRef, totalDue, centerId);
      if (paytmResponse.body?.txnToken) {
        paytmData = { txn_token: paytmResponse.body.txnToken, order_id: paymentRef, mid: paytmConfig.mid, amount: totalDue.toFixed(2), callback_url: paytmConfig.callbackUrl, website: paytmConfig.website, base_url: paytmConfig.baseUrl };
      } else {
        paytmData = { txn_token: null, order_id: paymentRef, mid: paytmConfig.mid, amount: totalDue.toFixed(2), error: paytmResponse.body?.resultInfo?.resultMsg || 'Token generation failed' };
      }
    } catch (e) { paytmData = { txn_token: null, order_id: paymentRef, error: e.message }; }

    return res.status(201).json({ message: 'Complete payment to clear admin due.', data: { payment_ref: paymentRef, amount: totalDue, dues_count: duesCount, payment: paytmData } });
  } catch (error) { console.error('clearAdminDue error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * POST /api/v1/diagnostic/wallet/clear-due/verify
 * Body: { payment_ref }
 * Verifies Paytm payment for an online admin-due clearance and marks dues paid.
 */
const verifyClearDue = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const { payment_ref } = req.body;
    if (!payment_ref) return res.status(400).json({ message: 'payment_ref required.' });

    const [payRows] = await pool.query('SELECT * FROM diagnostic_admin_due_payments WHERE payment_ref = ? AND diagnostic_center_id = ?', [payment_ref, centerId]);
    if (!payRows.length) return res.status(404).json({ message: 'Payment record not found.' });
    const pay = payRows[0];
    if (pay.status === 'success') return res.status(200).json({ message: 'Already cleared.', data: { payment_ref, amount: pay.amount } });

    const paytmService = require('../../services/paytm.service');
    const paytmResponse = await paytmService.verifyTransaction(payment_ref);
    const resultStatus = paytmResponse.body?.resultInfo?.resultStatus;
    const txnId = paytmResponse.body?.txnId || null;

    if (resultStatus === 'TXN_SUCCESS') {
      await pool.query("UPDATE diagnostic_admin_dues SET is_paid = 1, paid_at = NOW() WHERE diagnostic_center_id = ? AND is_paid = 0", [centerId]);
      await pool.query('UPDATE diagnostic_wallets SET total_admin_due_paid = total_admin_due_paid + ? WHERE diagnostic_center_id = ?', [pay.amount, centerId]);
      await pool.query("UPDATE diagnostic_admin_due_payments SET status = 'success', transaction_id = ?, paid_at = NOW() WHERE id = ?", [txnId, pay.id]);
      return res.status(200).json({ message: 'Admin due cleared.', data: { payment_ref, amount: pay.amount, transaction_id: txnId } });
    }

    return res.status(200).json({ message: 'Payment not completed yet.', data: { status: 'pending' } });
  } catch (error) { console.error('verifyClearDue error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

/**
 * GET /api/v1/diagnostic/wallet/due-payments?page=1&limit=20
 * History of admin-due clearances.
 */
const getAdminDuePayments = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const centerId = req.diagnostic.id;

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM diagnostic_admin_due_payments WHERE diagnostic_center_id = ? AND status = ?', [centerId, 'success']);
    const [rows] = await pool.query(
      "SELECT * FROM diagnostic_admin_due_payments WHERE diagnostic_center_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [centerId, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Admin due payment history fetched.',
      data: rows.map((p) => ({ id: p.id, payment_ref: p.payment_ref, amount: p.amount, dues_count: p.dues_count, method: p.method, transaction_id: p.transaction_id, paid_at: p.paid_at, created_at: p.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) { console.error('getAdminDuePayments error:', error.message); return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = {
  getWallet,
  getTransactions,
  getAdminDues,
  requestWithdrawal,
  getWithdrawals,
  creditAfterComplete,
  clearAdminDue,
  verifyClearDue,
  getAdminDuePayments,
};
