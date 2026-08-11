const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// DIAGNOSTIC DASHBOARD CONTROLLER
// ─────────────────────────────────────────────

/**
 * GET /api/v1/diagnostic/dashboard
 */
const getDashboard = async (req, res) => {
  try {
    const centerId = req.diagnostic.id;
    const today = new Date().toISOString().split('T')[0];

    // Total Bookings
    const [totalBookings] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan'", [centerId]
    );

    // Today's Bookings
    const [todayBookings] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND DATE(created_at) = ?", [centerId, today]
    );

    // Total Completed Scans
    const [totalCompleted] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND status = 'completed'", [centerId]
    );

    // Total Pending Reports
    const [pendingReports] = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND status = 'in_progress'", [centerId]
    );

    // Today's Revenue (all paid today)
    const [todayRevenue] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND payment_status = 'paid' AND DATE(paid_at) = ?", [centerId, today]
    );

    // Total Revenue
    const [totalRevenue] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND payment_status = 'paid'", [centerId]
    );

    // Today Offline Revenue
    const [todayOffline] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND payment_method = 'cod' AND status = 'completed' AND DATE(completed_at) = ?", [centerId, today]
    );

    // Total Offline Revenue
    const [totalOffline] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND payment_method = 'cod' AND status = 'completed'", [centerId]
    );

    // Today Online Revenue
    const [todayOnline] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND payment_method != 'cod' AND payment_status = 'paid' AND DATE(paid_at) = ?", [centerId, today]
    );

    // Total Online Revenue
    const [totalOnline] = await pool.query(
      "SELECT COALESCE(SUM(final_amount), 0) as total FROM bookings WHERE provider_id = ? AND service_type = 'diagnostic_scan' AND payment_method != 'cod' AND payment_status = 'paid'", [centerId]
    );

    return res.status(200).json({
      message: 'Dashboard fetched.',
      data: {
        total_bookings: totalBookings[0].count,
        today_bookings: todayBookings[0].count,
        total_completed_scans: totalCompleted[0].count,
        total_pending_reports: pendingReports[0].count,
        today_revenue: todayRevenue[0].total,
        total_revenue: totalRevenue[0].total,
        today_offline_revenue: todayOffline[0].total,
        total_offline_revenue: totalOffline[0].total,
        today_online_revenue: todayOnline[0].total,
        total_online_revenue: totalOnline[0].total,
      },
    });
  } catch (error) {
    console.error('diagnostic getDashboard error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  getDashboard,
};
