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
    const today = new Date().toISOString().split('T')[0];

    // Today's appointments
    const [todayAppts] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'doctor_consultation' AND booking_date = ? AND status IN ('confirmed', 'in_progress')",
      [doctorId, today]
    );

    // Today's patients (completed today)
    const [todayPatients] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'doctor_consultation' AND booking_date = ? AND status = 'completed'",
      [doctorId, today]
    );

    // Total completed
    const [totalCompleted] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'doctor_consultation' AND status = 'completed'",
      [doctorId]
    );

    // Upcoming appointments
    const [upcoming] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'doctor_consultation' AND status IN ('confirmed', 'pending') AND booking_date >= ?",
      [doctorId, today]
    );

    // Wallet balance
    const wallet = await walletModel.getWallet(doctorId);

    return res.status(200).json({
      success: true,
      message: 'Dashboard fetched.',
      data: {
        today_appointments: todayAppts[0].count,
        today_patients: todayPatients[0].count,
        total_completed: totalCompleted[0].count,
        upcoming_appointments: upcoming[0].count,
        wallet: {
          balance: wallet.balance,
          total_earned: wallet.total_earned,
          total_withdrawn: wallet.total_withdrawn,
        },
      },
    });
  } catch (error) {
    console.error('getDashboard error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
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

    return res.status(200).json({
      success: true,
      message: 'Wallet fetched.',
      data: {
        balance: wallet.balance,
        total_earned: wallet.total_earned,
        total_withdrawn: wallet.total_withdrawn,
      },
    });
  } catch (error) {
    console.error('getWallet error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
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

    return res.status(200).json({
      success: true,
      message: 'Transactions fetched.',
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
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
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
      return res.status(400).json({ success: false, message: 'Valid amount required.' });
    }

    // Check balance
    const wallet = await walletModel.getWallet(doctorId);
    if (parseFloat(wallet.balance) < parseFloat(amount)) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance.' });
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

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted. Admin will process it.',
      data: {
        withdrawal_id: withdrawal.id,
        amount,
        wallet_balance: newBalance,
        status: 'pending',
      },
    });
  } catch (error) {
    console.error('requestWithdrawal error:', error.message);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
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

    return res.status(200).json({
      success: true,
      message: 'Withdrawals fetched.',
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
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

module.exports = {
  getDashboard,
  getWallet,
  getTransactions,
  requestWithdrawal,
  getWithdrawals,
};
