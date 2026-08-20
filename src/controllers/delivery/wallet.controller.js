const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DELIVERY PARTNER WALLET & EARNINGS
// ─────────────────────────────────────────────

/**
 * GET /api/v1/delivery/wallet
 */
const getWallet = async (req, res) => {
  try {
    const partnerId = req.delivery.id;
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = `${today.substring(0, 7)}-01`;

    let [walletRows] = await pool.query('SELECT * FROM delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    if (!walletRows.length) {
      await pool.query('INSERT INTO delivery_wallets (delivery_partner_id) VALUES (?)', [partnerId]);
      [walletRows] = await pool.query('SELECT * FROM delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    }
    const wallet = walletRows[0];

    const [todayEarnings] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM delivery_wallet_transactions WHERE delivery_partner_id = ? AND type = 'credit' AND reference_type = 'delivery_earning' AND DATE(created_at) = ?", [partnerId, today]);
    const [monthEarnings] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM delivery_wallet_transactions WHERE delivery_partner_id = ? AND type = 'credit' AND reference_type = 'delivery_earning' AND created_at >= ?", [partnerId, firstOfMonth]);
    const [pendingWithdrawals] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM delivery_withdrawals WHERE delivery_partner_id = ? AND status IN ('pending', 'approved')", [partnerId]);

    return res.status(200).json({
      message: 'Wallet fetched.',
      data: {
        balance: wallet.balance,
        total_earned: wallet.total_earned,
        total_withdrawn: wallet.total_withdrawn,
        today_earnings: todayEarnings[0].total,
        month_earnings: monthEarnings[0].total,
        pending_withdrawal: pendingWithdrawals[0].total,
      },
    });
  } catch (error) {
    console.error('delivery getWallet error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/delivery/wallet/transactions?type=credit|debit&page=&limit=
 */
const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['delivery_partner_id = ?']; let params = [req.delivery.id];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM delivery_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT * FROM delivery_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    return res.status(200).json({
      message: 'Transactions fetched.',
      data: rows.map(t => ({ id: t.id, type: t.type, amount: t.amount, description: t.description, reference_type: t.reference_type, reference_id: t.reference_id, balance_after: t.balance_after, created_at: t.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('delivery getTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/delivery/wallet/withdraw
 * Body: { amount, remarks }
 */
const requestWithdrawal = async (req, res) => {
  try {
    const partnerId = req.delivery.id;
    const { amount, remarks } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ message: 'Valid amount required.' });

    const [walletRows] = await pool.query('SELECT balance FROM delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    if (!walletRows.length || walletRows[0].balance < amount) return res.status(400).json({ message: `Insufficient balance. Available: ₹${walletRows.length ? walletRows[0].balance : 0}` });

    const [bankDetails] = await pool.query('SELECT id FROM delivery_bank_details WHERE delivery_partner_id = ?', [partnerId]);
    if (!bankDetails.length) return res.status(400).json({ message: 'Please add bank details first (Step 4).' });

    const [pendingReq] = await pool.query("SELECT id FROM delivery_withdrawals WHERE delivery_partner_id = ? AND status IN ('pending', 'approved')", [partnerId]);
    if (pendingReq.length) return res.status(400).json({ message: 'You already have a pending withdrawal.' });

    await pool.query('INSERT INTO delivery_withdrawals (delivery_partner_id, amount, remarks) VALUES (?, ?, ?)', [partnerId, amount, remarks || null]);
    await pool.query('UPDATE delivery_wallets SET balance = balance - ? WHERE delivery_partner_id = ?', [amount, partnerId]);

    const [updated] = await pool.query('SELECT balance FROM delivery_wallets WHERE delivery_partner_id = ?', [partnerId]);
    await pool.query("INSERT INTO delivery_wallet_transactions (delivery_partner_id, type, amount, description, reference_type, balance_after) VALUES (?, 'debit', ?, 'Withdrawal request', 'withdrawal', ?)", [partnerId, amount, updated[0].balance]);

    return res.status(201).json({ message: 'Withdrawal request submitted.', data: { amount, new_balance: updated[0].balance } });
  } catch (error) {
    console.error('delivery requestWithdrawal error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/delivery/wallet/withdrawals?status=&page=&limit=
 */
const getWithdrawals = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['delivery_partner_id = ?']; let params = [req.delivery.id];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM delivery_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT * FROM delivery_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    return res.status(200).json({
      message: 'Withdrawals fetched.',
      data: rows.map(w => ({ id: w.id, amount: w.amount, status: w.status, remarks: w.remarks, admin_remarks: w.admin_remarks, processed_at: w.processed_at, created_at: w.created_at })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('delivery getWithdrawals error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { getWallet, getTransactions, requestWithdrawal, getWithdrawals };
