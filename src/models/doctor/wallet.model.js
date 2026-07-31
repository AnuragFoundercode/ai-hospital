const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DOCTOR WALLET MODEL
// ─────────────────────────────────────────────

// Get or create wallet
const getWallet = async (doctorId) => {
  const [rows] = await pool.query('SELECT * FROM doctor_wallets WHERE doctor_id = ?', [doctorId]);
  if (rows.length) return rows[0];

  // Create wallet if not exists
  await pool.query('INSERT INTO doctor_wallets (doctor_id) VALUES (?)', [doctorId]);
  const [newRows] = await pool.query('SELECT * FROM doctor_wallets WHERE doctor_id = ?', [doctorId]);
  return newRows[0];
};

// Credit amount (consultation complete)
const credit = async (doctorId, amount, description, referenceType, referenceId) => {
  const wallet = await getWallet(doctorId);
  const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

  await pool.query(
    'UPDATE doctor_wallets SET balance = ?, total_earned = total_earned + ? WHERE doctor_id = ?',
    [newBalance, amount, doctorId]
  );

  await pool.query(
    'INSERT INTO doctor_wallet_transactions (doctor_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [doctorId, 'credit', amount, description, referenceType, referenceId, newBalance]
  );

  return newBalance;
};

// Debit amount (withdrawal)
const debit = async (doctorId, amount, description, referenceType, referenceId) => {
  const wallet = await getWallet(doctorId);

  if (parseFloat(wallet.balance) < parseFloat(amount)) {
    return null; // Insufficient balance
  }

  const newBalance = parseFloat(wallet.balance) - parseFloat(amount);

  await pool.query(
    'UPDATE doctor_wallets SET balance = ?, total_withdrawn = total_withdrawn + ? WHERE doctor_id = ?',
    [newBalance, amount, doctorId]
  );

  await pool.query(
    'INSERT INTO doctor_wallet_transactions (doctor_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [doctorId, 'debit', amount, description, referenceType, referenceId, newBalance]
  );

  return newBalance;
};

// Get transactions
const getTransactions = async (doctorId, { page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;

  const [countResult] = await pool.query(
    'SELECT COUNT(*) as total FROM doctor_wallet_transactions WHERE doctor_id = ?',
    [doctorId]
  );

  const [rows] = await pool.query(
    'SELECT * FROM doctor_wallet_transactions WHERE doctor_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [doctorId, limit, offset]
  );

  return { transactions: rows, total: countResult[0].total, page, limit };
};

// Create withdrawal request
const createWithdrawal = async (doctorId, amount, remarks) => {
  const [result] = await pool.query(
    'INSERT INTO doctor_withdrawals (doctor_id, amount, remarks) VALUES (?, ?, ?)',
    [doctorId, amount, remarks || null]
  );
  return { id: result.insertId };
};

// Get withdrawal requests
const getWithdrawals = async (doctorId, { page = 1, limit = 10 }) => {
  const offset = (page - 1) * limit;

  const [countResult] = await pool.query(
    'SELECT COUNT(*) as total FROM doctor_withdrawals WHERE doctor_id = ?',
    [doctorId]
  );

  const [rows] = await pool.query(
    'SELECT * FROM doctor_withdrawals WHERE doctor_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [doctorId, limit, offset]
  );

  return { withdrawals: rows, total: countResult[0].total, page, limit };
};

module.exports = {
  getWallet,
  credit,
  debit,
  getTransactions,
  createWithdrawal,
  getWithdrawals,
};
