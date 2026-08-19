const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// BLOOD BANK WALLET & EARNINGS
// ─────────────────────────────────────────────

/**
 * GET /api/v1/bloodbank/wallet
 * Wallet balance + earnings summary
 */
const getWallet = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = `${today.substring(0, 7)}-01`;

    // Get or create wallet
    let [walletRows] = await pool.query('SELECT * FROM bloodbank_wallets WHERE blood_bank_id = ?', [bankId]);
    if (!walletRows.length) {
      await pool.query('INSERT INTO bloodbank_wallets (blood_bank_id) VALUES (?)', [bankId]);
      [walletRows] = await pool.query('SELECT * FROM bloodbank_wallets WHERE blood_bank_id = ?', [bankId]);
    }
    const wallet = walletRows[0];

    // Today's earnings
    const [todayEarnings] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM bloodbank_wallet_transactions WHERE blood_bank_id = ? AND type = 'credit' AND reference_type = 'blood_request_fee' AND DATE(created_at) = ?`,
      [bankId, today]
    );

    // This month earnings
    const [monthEarnings] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM bloodbank_wallet_transactions WHERE blood_bank_id = ? AND type = 'credit' AND reference_type = 'blood_request_fee' AND created_at >= ?`,
      [bankId, firstOfMonth]
    );

    // Pending settlement (pending withdrawals)
    const [pendingWithdrawals] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM bloodbank_withdrawals WHERE blood_bank_id = ? AND status IN ('pending', 'approved')`,
      [bankId]
    );

    return res.status(200).json({
      message: 'Wallet fetched.',
      data: {
        balance: wallet.balance,
        total_earned: wallet.total_earned,
        total_withdrawn: wallet.total_withdrawn,
        today_earnings: todayEarnings[0].total,
        month_earnings: monthEarnings[0].total,
        pending_settlement: pendingWithdrawals[0].total,
      },
    });
  } catch (error) {
    console.error('bloodbank getWallet error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/bloodbank/wallet/transactions?page=1&limit=20&type=credit|debit
 */
const getTransactions = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { page = 1, limit = 20, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['blood_bank_id = ?'];
    let params = [bankId];

    if (type) { where.push('type = ?'); params.push(type); }

    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM bloodbank_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM bloodbank_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Transactions fetched.',
      data: rows.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        description: t.description,
        reference_type: t.reference_type,
        reference_id: t.reference_id,
        admin_commission: t.admin_commission,
        balance_after: t.balance_after,
        created_at: t.created_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('bloodbank getTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/bloodbank/wallet/withdraw
 * Body: { amount, remarks }
 */
const requestWithdrawal = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { amount, remarks } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount required.' });
    }

    // Check balance
    const [walletRows] = await pool.query('SELECT balance FROM bloodbank_wallets WHERE blood_bank_id = ?', [bankId]);
    if (!walletRows.length || walletRows[0].balance < amount) {
      return res.status(400).json({ message: `Insufficient balance. Available: ₹${walletRows.length ? walletRows[0].balance : 0}` });
    }

    // Check bank details exist
    const [bankDetails] = await pool.query('SELECT id FROM bloodbank_bank_details WHERE blood_bank_id = ?', [bankId]);
    if (!bankDetails.length) {
      return res.status(400).json({ message: 'Please add bank details before withdrawing.' });
    }

    // Check no pending withdrawal
    const [pendingReq] = await pool.query(
      "SELECT id FROM bloodbank_withdrawals WHERE blood_bank_id = ? AND status IN ('pending', 'approved')",
      [bankId]
    );
    if (pendingReq.length) {
      return res.status(400).json({ message: 'You already have a pending withdrawal request.' });
    }

    // Create withdrawal request
    await pool.query(
      'INSERT INTO bloodbank_withdrawals (blood_bank_id, amount, remarks) VALUES (?, ?, ?)',
      [bankId, amount, remarks || null]
    );

    // Deduct from wallet balance
    await pool.query('UPDATE bloodbank_wallets SET balance = balance - ? WHERE blood_bank_id = ?', [amount, bankId]);

    // Add debit transaction
    const [updatedWallet] = await pool.query('SELECT balance FROM bloodbank_wallets WHERE blood_bank_id = ?', [bankId]);
    await pool.query(
      `INSERT INTO bloodbank_wallet_transactions (blood_bank_id, type, amount, description, reference_type, balance_after) VALUES (?, 'debit', ?, 'Withdrawal request', 'withdrawal', ?)`,
      [bankId, amount, updatedWallet[0].balance]
    );

    return res.status(201).json({
      message: 'Withdrawal request submitted. Admin will process within 24-48 hours.',
      data: { amount, new_balance: updatedWallet[0].balance },
    });
  } catch (error) {
    console.error('bloodbank requestWithdrawal error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/bloodbank/wallet/withdrawals?status=&page=1&limit=20
 */
const getWithdrawals = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['blood_bank_id = ?'];
    let params = [bankId];

    if (status) { where.push('status = ?'); params.push(status); }

    const whereClause = where.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM bloodbank_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM bloodbank_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    return res.status(200).json({
      message: 'Withdrawals fetched.',
      data: rows.map((w) => ({
        id: w.id,
        amount: w.amount,
        status: w.status,
        remarks: w.remarks,
        admin_remarks: w.admin_remarks,
        processed_at: w.processed_at,
        created_at: w.created_at,
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) },
    });
  } catch (error) {
    console.error('bloodbank getWithdrawals error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getWallet,
  getTransactions,
  requestWithdrawal,
  getWithdrawals,
};
