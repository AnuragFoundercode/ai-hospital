const { pool } = require('../../config/database');

const getWallet = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = `${today.substring(0, 7)}-01`;

    let [walletRows] = await pool.query('SELECT * FROM pharmacy_wallets WHERE pharmacy_id = ?', [pharmacyId]);
    if (!walletRows.length) { await pool.query('INSERT INTO pharmacy_wallets (pharmacy_id) VALUES (?)', [pharmacyId]); [walletRows] = await pool.query('SELECT * FROM pharmacy_wallets WHERE pharmacy_id = ?', [pharmacyId]); }
    const wallet = walletRows[0];

    const [todayEarnings] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM pharmacy_wallet_transactions WHERE pharmacy_id = ? AND type = 'credit' AND reference_type = 'order_fee' AND DATE(created_at) = ?", [pharmacyId, today]);
    const [monthEarnings] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM pharmacy_wallet_transactions WHERE pharmacy_id = ? AND type = 'credit' AND reference_type = 'order_fee' AND created_at >= ?", [pharmacyId, firstOfMonth]);
    const [pendingWithdrawals] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM pharmacy_withdrawals WHERE pharmacy_id = ? AND status IN ('pending', 'approved')", [pharmacyId]);

    return res.status(200).json({ message: 'Wallet fetched.', data: { balance: wallet.balance, total_earned: wallet.total_earned, total_withdrawn: wallet.total_withdrawn, today_earnings: todayEarnings[0].total, month_earnings: monthEarnings[0].total, pending_settlement: pendingWithdrawals[0].total } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['pharmacy_id = ?']; let params = [req.pharmacy.id];
    if (type) { where.push('type = ?'); params.push(type); }
    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM pharmacy_wallet_transactions WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT * FROM pharmacy_wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({ message: 'Transactions fetched.', data: rows.map(t => ({ id: t.id, type: t.type, amount: t.amount, description: t.description, reference_type: t.reference_type, admin_commission: t.admin_commission, balance_after: t.balance_after, created_at: t.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const requestWithdrawal = async (req, res) => {
  try {
    const pharmacyId = req.pharmacy.id;
    const { amount, remarks } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Valid amount required.' });
    const [walletRows] = await pool.query('SELECT balance FROM pharmacy_wallets WHERE pharmacy_id = ?', [pharmacyId]);
    if (!walletRows.length || walletRows[0].balance < amount) return res.status(400).json({ message: `Insufficient balance. Available: ₹${walletRows.length ? walletRows[0].balance : 0}` });
    const [bankDetails] = await pool.query('SELECT id FROM pharmacy_bank_details WHERE pharmacy_id = ?', [pharmacyId]);
    if (!bankDetails.length) return res.status(400).json({ message: 'Please add bank details first.' });
    const [pendingReq] = await pool.query("SELECT id FROM pharmacy_withdrawals WHERE pharmacy_id = ? AND status IN ('pending', 'approved')", [pharmacyId]);
    if (pendingReq.length) return res.status(400).json({ message: 'You already have a pending withdrawal.' });

    await pool.query('INSERT INTO pharmacy_withdrawals (pharmacy_id, amount, remarks) VALUES (?, ?, ?)', [pharmacyId, amount, remarks || null]);
    await pool.query('UPDATE pharmacy_wallets SET balance = balance - ? WHERE pharmacy_id = ?', [amount, pharmacyId]);
    const [updated] = await pool.query('SELECT balance FROM pharmacy_wallets WHERE pharmacy_id = ?', [pharmacyId]);
    await pool.query("INSERT INTO pharmacy_wallet_transactions (pharmacy_id, type, amount, description, reference_type, balance_after) VALUES (?, 'debit', ?, 'Withdrawal request', 'withdrawal', ?)", [pharmacyId, amount, updated[0].balance]);

    return res.status(201).json({ message: 'Withdrawal request submitted.', data: { amount, new_balance: updated[0].balance } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

const getWithdrawals = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = ['pharmacy_id = ?']; let params = [req.pharmacy.id];
    if (status) { where.push('status = ?'); params.push(status); }
    const whereClause = where.join(' AND ');
    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM pharmacy_withdrawals WHERE ${whereClause}`, params);
    const [rows] = await pool.query(`SELECT * FROM pharmacy_withdrawals WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
    return res.status(200).json({ message: 'Withdrawals fetched.', data: rows.map(w => ({ id: w.id, amount: w.amount, status: w.status, remarks: w.remarks, admin_remarks: w.admin_remarks, processed_at: w.processed_at, created_at: w.created_at })), pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, total_pages: Math.ceil(countResult[0].total / parseInt(limit)) } });
  } catch (error) { return res.status(500).json({ message: 'Something went wrong.' }); }
};

module.exports = { getWallet, getTransactions, requestWithdrawal, getWithdrawals };
