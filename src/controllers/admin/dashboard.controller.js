const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// ADMIN DASHBOARD
// ─────────────────────────────────────────────

/**
 * GET /api/v1/admin/dashboard
 * Aggregated platform-wide counts for the admin home screen.
 */
const getDashboard = async (req, res) => {
  try {
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];

    // Run independent count queries in parallel.
    const [
      [[patients]],
      [[doctors]],
      [[calls]],
      [[pharmacies]],
      [[orders]],
      [[labs]],
      [[labBookings]],
      [[diagnostics]],
      [[scans]],
      [[bloodBanks]],
      [[bloodRequests]],
      [[ambulances]],
      [[revenue]],
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, SUM(DATE(created_at) = ?) AS today FROM users`, [today]),
      pool.query(`SELECT COUNT(*) AS total,
                         SUM(verification_status = 'approved') AS verified,
                         SUM(verification_status = 'pending') AS pending,
                         SUM(is_active = 1) AS online
                  FROM doctors`),
      pool.query(`SELECT COUNT(*) AS total, SUM(DATE(created_at) = ?) AS today FROM doctor_calls`, [today]),
      pool.query(`SELECT COUNT(*) AS total FROM pharmacies`),
      pool.query(`SELECT COUNT(*) AS total,
                         SUM(status IN ('out_for_delivery','reached','ready','packing')) AS pending_deliveries
                  FROM pharmacy_orders`),
      pool.query(`SELECT COUNT(*) AS total FROM pathology_labs`),
      pool.query(`SELECT COUNT(*) AS total,
                         SUM(status NOT IN ('completed','report_uploaded','cancelled','failed')) AS pending_reports
                  FROM bookings WHERE service_type = 'pathology_test'`),
      pool.query(`SELECT COUNT(*) AS total FROM diagnostic_centers`),
      pool.query(`SELECT COUNT(*) AS total FROM bookings WHERE service_type = 'diagnostic_scan'`),
      pool.query(`SELECT COUNT(*) AS total FROM blood_banks`),
      pool.query(`SELECT COUNT(*) AS total FROM blood_requests`),
      pool.query(`SELECT COUNT(*) AS total FROM ambulance_services`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) AS total FROM admin_commissions`),
    ]);

    return res.status(200).json({
      message: 'Dashboard fetched.',
      data: {
        total_patients: patients.total,
        todays_patients: Number(patients.today) || 0,

        total_doctors: doctors.total,
        verified_doctors: Number(doctors.verified) || 0,
        pending_verification: Number(doctors.pending) || 0,
        online_doctors: Number(doctors.online) || 0,

        total_calls: calls.total,
        todays_calls: Number(calls.today) || 0,

        total_pharmacies: pharmacies.total,
        medicine_orders: orders.total,
        pending_deliveries: Number(orders.pending_deliveries) || 0,

        total_labs: labs.total,
        total_bookings: labBookings.total,
        pending_reports: Number(labBookings.pending_reports) || 0,

        total_diagnostic_centers: diagnostics.total,
        scan_bookings: scans.total,

        total_blood_banks: bloodBanks.total,
        blood_requests: bloodRequests.total,

        total_ambulances: ambulances.total,

        admin_total_revenue: parseFloat(revenue.total) || 0,
      },
    });
  } catch (error) {
    console.error('admin getDashboard error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { getDashboard };
