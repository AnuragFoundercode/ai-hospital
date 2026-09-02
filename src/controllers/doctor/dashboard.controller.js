const { pool } = require('../../config/database');
const walletModel = require('../../models/doctor/wallet.model');

// ─────────────────────────────────────────────
// DASHBOARD & WALLET CONTROLLER - Doctor Panel
// ─────────────────────────────────────────────

/**
 * GET /api/v1/doctor/dashboard
 * Dashboard stats
 */
const getDashboard = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const istNow = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const today = new Date(istNow).toISOString().split('T')[0];

    // Call status
    const [docRows] = await pool.query('SELECT call_status FROM doctors WHERE id = ?', [doctorId]);

    // Total completed calls
    const [totalCalls] = await pool.query("SELECT COUNT(*) as count FROM doctor_calls WHERE doctor_id = ? AND status = 'completed'", [doctorId]);

    // Today's completed calls + earnings + minutes
    const [todayCalls] = await pool.query("SELECT COUNT(*) as count, COALESCE(SUM(total_minutes),0) as minutes, COALESCE(SUM(doctor_earning),0) as earning FROM doctor_calls WHERE doctor_id = ? AND status = 'completed' AND DATE(started_at) = ?", [doctorId, today]);

    // Total minutes talked
    const [totalMinutes] = await pool.query("SELECT COALESCE(SUM(total_minutes),0) as minutes FROM doctor_calls WHERE doctor_id = ? AND status = 'completed'", [doctorId]);

    // Wallet
    const wallet = await walletModel.getWallet(doctorId);

    return res.status(200).json({
      message: 'Dashboard fetched.',
      data: {
        call_status: docRows[0]?.call_status || 'offline',
        total_calls: totalCalls[0].count,
        today_calls: todayCalls[0].count,
        today_minutes: parseInt(todayCalls[0].minutes),
        today_earning: parseFloat(todayCalls[0].earning),
        total_minutes: parseInt(totalMinutes[0].minutes),
        wallet: {
          balance: wallet.balance,
          total_earned: wallet.total_earned,
          total_withdrawn: wallet.total_withdrawn,
        },
      },
    });
  } catch (error) {
    console.error('getDashboard error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/doctor/wallet
 * Wallet balance
 */
const getWallet = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const wallet = await walletModel.getWallet(doctorId);

    return res.status(200).json({      message: 'Wallet fetched.',
      data: {
        balance: wallet.balance,
        total_earned: wallet.total_earned,
        total_withdrawn: wallet.total_withdrawn,
      },
    });
  } catch (error) {
    console.error('getWallet error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/doctor/wallet/transactions?page=1&limit=20
 * Wallet transaction history
 */
const getTransactions = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { page = 1, limit = 20 } = req.query;

    const result = await walletModel.getTransactions(doctorId, { page: parseInt(page), limit: parseInt(limit) });

    const transactions = result.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      description: t.description,
      reference_type: t.reference_type,
      balance_after: t.balance_after,
      created_at: t.created_at,
    }));

    return res.status(200).json({      message: 'Transactions fetched.',
      data: transactions,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    console.error('getTransactions error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * POST /api/v1/doctor/wallet/withdraw
 * Request withdrawal - deducts from wallet, creates request for admin
 * Body: { amount, remarks }
 */
const requestWithdrawal = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { amount, remarks } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount required.' });
    }

    // Check balance
    const wallet = await walletModel.getWallet(doctorId);
    if (parseFloat(wallet.balance) < parseFloat(amount)) {
      return res.status(400).json({ message: 'Insufficient wallet balance.' });
    }

    // Debit from wallet
    const newBalance = await walletModel.debit(
      doctorId,
      amount,
      `Withdrawal request - ₹${amount}`,
      'withdrawal',
      null
    );

    // Create withdrawal request for admin
    const withdrawal = await walletModel.createWithdrawal(doctorId, amount, remarks);

    return res.status(200).json({      message: 'Withdrawal request submitted. Admin will process it.',
      data: {
        withdrawal_id: withdrawal.id,
        amount,
        wallet_balance: newBalance,
        status: 'pending',
      },
    });
  } catch (error) {
    console.error('requestWithdrawal error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/doctor/wallet/withdrawals?page=1&limit=10
 * Withdrawal history
 */
const getWithdrawals = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { page = 1, limit = 10 } = req.query;

    const result = await walletModel.getWithdrawals(doctorId, { page: parseInt(page), limit: parseInt(limit) });

    const withdrawals = result.withdrawals.map((w) => ({
      id: w.id,
      amount: w.amount,
      status: w.status,
      remarks: w.remarks,
      admin_remarks: w.admin_remarks,
      processed_at: w.processed_at,
      created_at: w.created_at,
    }));

    return res.status(200).json({      message: 'Withdrawals fetched.',
      data: withdrawals,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (error) {
    console.error('getWithdrawals error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getDashboard,
  getWallet,
  getTransactions,
  requestWithdrawal,
  getWithdrawals,
};
