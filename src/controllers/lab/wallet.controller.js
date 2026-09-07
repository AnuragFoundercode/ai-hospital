const walletModel = require('../../models/lab/wallet.model');

// ─────────────────────────────────────────────
// LAB WALLET CONTROLLER
// ─────────────────────────────────────────────

/**
 * GET /api/v1/lab/wallet
 */
const getWallet = async (req, res) => {
  try {
    const wallet = await walletModel.getWallet(req.lab.id);
    return res.status(200).json({      message: 'Wallet fetched.',
      data: { balance: wallet.balance, total_earned: wallet.total_earned, total_withdrawn: wallet.total_withdrawn },
    });
  } catch (error) {
    console.error('lab getWallet error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/wallet/transactions?page=1&limit=20
 */
const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await walletModel.getTransactions(req.lab.id, { page: parseInt(page), limit: parseInt(limit) });

    return res.status(200).json({      message: 'Transactions fetched.',
      data: result.transactions.map((t) => ({
        id: t.id,
        transaction_id: t.id,
        type: t.type,
        amount: t.amount,
        description: t.description,
        reference_type: t.reference_type,
        booking_id: t.booking_code || null,
        balance_after: t.balance_after,
        created_at: t.created_at,
      })),
      pagination: { page: result.page, limit: result.limit, total: result.total, total_pages: Math.ceil(result.total / result.limit) },
    });
  } catch (error) {
    console.error('lab getTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/lab/wallet/withdraw
 * Body: { amount, remarks }
 */
const requestWithdrawal = async (req, res) => {
  try {
    const { amount, remarks } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount required.' });
    }

    const wallet = await walletModel.getWallet(req.lab.id);
    if (parseFloat(wallet.balance) < parseFloat(amount)) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    const newBalance = await walletModel.debit(req.lab.id, amount, `Withdrawal request - ₹${amount}`, 'withdrawal', null);
    const withdrawal = await walletModel.createWithdrawal(req.lab.id, amount, remarks);

    return res.status(200).json({      message: 'Withdrawal request submitted.',
      data: { withdrawal_id: withdrawal.id, amount, wallet_balance: newBalance, status: 'pending' },
    });
  } catch (error) {
    console.error('lab withdrawal error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/wallet/withdrawals
 */
const getWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = await walletModel.getWithdrawals(req.lab.id, { page: parseInt(page), limit: parseInt(limit) });

    return res.status(200).json({      message: 'Withdrawals fetched.',
      data: result.withdrawals.map((w) => ({
        id: w.id, amount: w.amount, status: w.status, remarks: w.remarks,
        admin_remarks: w.admin_remarks, processed_at: w.processed_at, created_at: w.created_at,
      })),
      pagination: { page: result.page, limit: result.limit, total: result.total, total_pages: Math.ceil(result.total / result.limit) },
    });
  } catch (error) {
    console.error('lab getWithdrawals error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/bank-details
 */
const getBankDetails = async (req, res) => {
  try {
    const bank = await walletModel.getBankDetails(req.lab.id);
    return res.status(200).json({      message: 'Bank details fetched.',
      data: bank || null,
    });
  } catch (error) {
    console.error('lab getBankDetails error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * PUT /api/v1/lab/bank-details
 * Body: { account_holder_name, bank_name, account_number, ifsc_code }
 */
const updateBankDetails = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code } = req.body;

    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return res.status(400).json({ message: 'All bank fields required.' });
    }

    await walletModel.upsertBankDetails(req.lab.id, { account_holder_name, bank_name, account_number, ifsc_code });

    return res.status(200).json({      message: 'Bank details saved.',
    });
  } catch (error) {
    console.error('lab updateBankDetails error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getWallet,
  getTransactions,
  requestWithdrawal,
  getWithdrawals,
  getBankDetails,
  updateBankDetails,
};
