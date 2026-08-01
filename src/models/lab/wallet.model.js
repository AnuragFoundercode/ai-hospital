const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// LAB WALLET MODEL
// ─────────────────────────────────────────────

const getWallet = async (labId) => {
  const [rows] = await pool.query('SELECT * FROM lab_wallets WHERE lab_id = ?', [labId]);
  if (rows.length) return rows[0];

  await pool.query('INSERT INTO lab_wallets (lab_id) VALUES (?)', [labId]);
  const [newRows] = await pool.query('SELECT * FROM lab_wallets WHERE lab_id = ?', [labId]);
  return newRows[0];
};

const credit = async (labId, amount, description, referenceType, referenceId) => {
  const wallet = await getWallet(labId);
  const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

  await pool.query(
    'UPDATE lab_wallets SET balance = ?, total_earned = total_earned + ? WHERE lab_id = ?',
    [newBalance, amount, labId]
  );

  await pool.query(
    'INSERT INTO lab_wallet_transactions (lab_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [labId, 'credit', amount, description, referenceType, referenceId, newBalance]
  );

  return newBalance;
};

const debit = async (labId, amount, description, referenceType, referenceId) => {
  const wallet = await getWallet(labId);
  if (parseFloat(wallet.balance) < parseFloat(amount)) return null;

  const newBalance = parseFloat(wallet.balance) - parseFloat(amount);

  await pool.query(
    'UPDATE lab_wallets SET balance = ?, total_withdrawn = total_withdrawn + ? WHERE lab_id = ?',
    [newBalance, amount, labId]
  );

  await pool.query(
    'INSERT INTO lab_wallet_transactions (lab_id, type, amount, description, reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [labId, 'debit', amount, description, referenceType, referenceId, newBalance]
  );

  return newBalance;
};

const getTransactions = async (labId, { page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;
  const [countResult] = await pool.query('SELECT COUNT(*) as total FROM lab_wallet_transactions WHERE lab_id = ?', [labId]);
  const [rows] = await pool.query('SELECT * FROM lab_wallet_transactions WHERE lab_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [labId, limit, offset]);
  return { transactions: rows, total: countResult[0].total, page, limit };
};

const createWithdrawal = async (labId, amount, remarks) => {
  const [result] = await pool.query('INSERT INTO lab_withdrawals (lab_id, amount, remarks) VALUES (?, ?, ?)', [labId, amount, remarks || null]);
  return { id: result.insertId };
};

const getWithdrawals = async (labId, { page = 1, limit = 10 }) => {
  const offset = (page - 1) * limit;
  const [countResult] = await pool.query('SELECT COUNT(*) as total FROM lab_withdrawals WHERE lab_id = ?', [labId]);
  const [rows] = await pool.query('SELECT * FROM lab_withdrawals WHERE lab_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [labId, limit, offset]);
  return { withdrawals: rows, total: countResult[0].total, page, limit };
};

// Bank details
const getBankDetails = async (labId) => {
  const [rows] = await pool.query('SELECT * FROM lab_bank_details WHERE lab_id = ?', [labId]);
  return rows[0] || null;
};

const upsertBankDetails = async (labId, data) => {
  const [existing] = await pool.query('SELECT id FROM lab_bank_details WHERE lab_id = ?', [labId]);
  if (existing.length) {
    await pool.query('UPDATE lab_bank_details SET account_holder_name = ?, bank_name = ?, account_number = ?, ifsc_code = ? WHERE lab_id = ?',
      [data.account_holder_name, data.bank_name, data.account_number, data.ifsc_code, labId]);
  } else {
    await pool.query('INSERT INTO lab_bank_details (lab_id, account_holder_name, bank_name, account_number, ifsc_code) VALUES (?, ?, ?, ?, ?)',
      [labId, data.account_holder_name, data.bank_name, data.account_number, data.ifsc_code]);
  }
};

module.exports = {
  getWallet,
  credit,
  debit,
  getTransactions,
  createWithdrawal,
  getWithdrawals,
  getBankDetails,
  upsertBankDetails,
};
