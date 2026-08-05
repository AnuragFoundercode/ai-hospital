const { pool } = require('../../config/database');
const walletModel = require('../../models/lab/wallet.model');

// ─────────────────────────────────────────────
// LAB DASHBOARD CONTROLLER
// ─────────────────────────────────────────────

/**
 * GET /api/v1/lab/dashboard
 */
const getDashboard = async (req, res) => {
  try {
    const labId = req.lab.id;
    const today = new Date().toISOString().split('T')[0];

    // Total Revenue
    const [totalRevenue] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND payment_status = 'paid'",
      [labId]
    );

    // Today's Revenue
    const [todayRevenue] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND payment_status = 'paid' AND DATE(confirmed_at) = ?",
      [labId, today]
    );

    // Wallet Balance
    const wallet = await walletModel.getWallet(labId);

    // Total Bookings
    const [totalBookings] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test'",
      [labId]
    );

    // Today's Bookings
    const [todayBookings] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND DATE(created_at) = ?",
      [labId, today]
    );

    // Today's Samples (assigned today - sample collection pending/done)
    const [todaySamples] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND booking_date = ? AND status IN ('assigned', 'in_progress')",
      [labId, today]
    );

    // Samples In Lab (in_progress status)
    const [samplesInLab] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND status = 'in_progress'",
      [labId]
    );

    // Reports Pending (in_progress - report not uploaded yet)
    const [reportsPending] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND status = 'in_progress' AND (metadata NOT LIKE '%reports%' OR metadata IS NULL)",
      [labId]
    );

    // Reports Uploaded Today
    const [reportsToday] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND status = 'completed' AND DATE(completed_at) = ?",
      [labId, today]
    );

    // Pending Withdrawals
    const [pendingWithdrawals] = await pool.query(
      "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount FROM lab_withdrawals WHERE lab_id = ? AND status = 'pending'",
      [labId]
    );

    return res.status(200).json({
      message: 'Dashboard fetched.',
      data: {
        total_revenue: totalRevenue[0].total,
        today_revenue: todayRevenue[0].total,
        wallet_balance: wallet.balance,
        total_bookings: totalBookings[0].count,
        today_bookings: todayBookings[0].count,
        today_samples: todaySamples[0].count,
        samples_in_lab: samplesInLab[0].count,
        reports_pending: reportsPending[0].count,
        reports_uploaded_today: reportsToday[0].count,
        pending_withdrawals: {
          count: pendingWithdrawals[0].count,
          amount: pendingWithdrawals[0].total_amount,
        },
      },
    });
  } catch (error) {
    console.error('lab getDashboard error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/analytics/revenue?period=today|yesterday|weekly|monthly
 * Revenue trend for graph
 */
const getRevenueTrend = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { period = 'weekly' } = req.query;

    let query = '';
    let params = [labId];

    if (period === 'today') {
      // Hourly breakdown for today
      query = `SELECT HOUR(confirmed_at) as label, COALESCE(SUM(final_amount), 0) as revenue
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND payment_status = 'paid' AND DATE(confirmed_at) = CURDATE()
               GROUP BY HOUR(confirmed_at) ORDER BY label`;
    } else if (period === 'yesterday') {
      query = `SELECT HOUR(confirmed_at) as label, COALESCE(SUM(final_amount), 0) as revenue
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND payment_status = 'paid' AND DATE(confirmed_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
               GROUP BY HOUR(confirmed_at) ORDER BY label`;
    } else if (period === 'weekly') {
      // Daily breakdown for last 7 days
      query = `SELECT DATE(confirmed_at) as label, COALESCE(SUM(final_amount), 0) as revenue
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND payment_status = 'paid' AND confirmed_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
               GROUP BY DATE(confirmed_at) ORDER BY label`;
    } else if (period === 'monthly') {
      // Daily breakdown for last 30 days
      query = `SELECT DATE(confirmed_at) as label, COALESCE(SUM(final_amount), 0) as revenue
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND payment_status = 'paid' AND confirmed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
               GROUP BY DATE(confirmed_at) ORDER BY label`;
    } else {
      return res.status(400).json({ message: 'Invalid period. Use: today, yesterday, weekly, monthly' });
    }

    const [rows] = await pool.query(query, params);

    // Total for the period
    const total = rows.reduce((sum, r) => sum + parseFloat(r.revenue), 0);

    return res.status(200).json({
      message: 'Revenue trend fetched.',
      data: {
        period,
        total,
        trend: rows.map((r) => ({ label: r.label, revenue: parseFloat(r.revenue) })),
      },
    });
  } catch (error) {
    console.error('lab getRevenueTrend error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

/**
 * GET /api/v1/lab/analytics/bookings?period=today|yesterday|weekly|monthly
 * Booking trend for graph
 */
const getBookingTrend = async (req, res) => {
  try {
    const labId = req.lab.id;
    const { period = 'weekly' } = req.query;

    let query = '';
    let params = [labId];

    if (period === 'today') {
      query = `SELECT HOUR(created_at) as label, COUNT(*) as count
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND DATE(created_at) = CURDATE()
               GROUP BY HOUR(created_at) ORDER BY label`;
    } else if (period === 'yesterday') {
      query = `SELECT HOUR(created_at) as label, COUNT(*) as count
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
               GROUP BY HOUR(created_at) ORDER BY label`;
    } else if (period === 'weekly') {
      query = `SELECT DATE(created_at) as label, COUNT(*) as count
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
               GROUP BY DATE(created_at) ORDER BY label`;
    } else if (period === 'monthly') {
      query = `SELECT DATE(created_at) as label, COUNT(*) as count
               FROM bookings WHERE provider_id = ? AND service_type = 'pathology_test' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
               GROUP BY DATE(created_at) ORDER BY label`;
    } else {
      return res.status(400).json({ message: 'Invalid period. Use: today, yesterday, weekly, monthly' });
    }

    const [rows] = await pool.query(query, params);

    const total = rows.reduce((sum, r) => sum + r.count, 0);

    return res.status(200).json({
      message: 'Booking trend fetched.',
      data: {
        period,
        total,
        trend: rows.map((r) => ({ label: r.label, count: r.count })),
      },
    });
  } catch (error) {
    console.error('lab getBookingTrend error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getDashboard,
  getRevenueTrend,
  getBookingTrend,
};
