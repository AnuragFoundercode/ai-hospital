const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// USER WALLET MODEL
// Uses existing tables: wallets + wallet_transactions
// ─────────────────────────────────────────────

// Get or create wallet for a user
const getWallet = async (userId) => {
  const [rows] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  if (rows.length) return rows[0];
  await pool.query('INSERT INTO wallets (user_id) VALUES (?)', [userId]);
  const [newRows] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  return newRows[0];
};

/**
 * Credit (add money / refund / cashback / admin credit)
 * @param {number} userId
 * @param {number} amount
 * @param {string} description
 * @param {string} referenceType - 'recharge' | 'refund' | 'cashback' | 'admin_credit'
 * @param {number|null} referenceId
 * @param {string} createdByType - 'user' | 'admin' | 'system'
 */
const credit = async (userId, amount, description, referenceType = 'recharge', referenceId = null, createdByType = 'system') => {
  const wallet = await getWallet(userId);
  const newBalance = parseFloat(wallet.balance) + parseFloat(amount);
  await pool.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [newBalance, userId]);
  await pool.query(
    "INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, description, reference_type, reference_id, balance_after, created_by_type) VALUES (?, ?, 'credit', ?, ?, ?, ?, ?, ?)",
    [wallet.id, userId, amount, description, referenceType, referenceId, newBalance, createdByType]
  );
  return newBalance;
};

/**
 * Debit (deduct for booking / call payment)
 * Returns null if insufficient balance.
 */
const debit = async (userId, amount, description, referenceType = 'booking_payment', referenceId = null, createdByType = 'system') => {
  const wallet = await getWallet(userId);
  if (parseFloat(wallet.balance) < parseFloat(amount)) return null;
  const newBalance = parseFloat(wallet.balance) - parseFloat(amount);
  await pool.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [newBalance, userId]);
  await pool.query(
    "INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, description, reference_type, reference_id, balance_after, created_by_type) VALUES (?, ?, 'debit', ?, ?, ?, ?, ?, ?)",
    [wallet.id, userId, amount, description, referenceType, referenceId, newBalance, createdByType]
  );
  return newBalance;
};

const getTransactions = async (userId, { page = 1, limit = 20, type }) => {
  const offset = (page - 1) * limit;
  let where = ['user_id = ?'];
  let params = [userId];
  if (type) { where.push('type = ?'); params.push(type); }
  const whereClause = where.join(' AND ');
  const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM wallet_transactions WHERE ${whereClause}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM wallet_transactions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { transactions: rows, total: countRows[0].total, page, limit };
};

module.exports = { getWallet, credit, debit, getTransactions };
