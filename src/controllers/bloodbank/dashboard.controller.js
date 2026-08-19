const { pool } = require('../../config/database');

// ─────────────────────────────────────────────
// BLOOD BANK DASHBOARD
// ─────────────────────────────────────────────

/**
 * GET /api/v1/bloodbank/dashboard
 */
const getDashboard = async (req, res) => {
  try {
    const bankId = req.bloodbank.id;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Total & available units
    const [unitStats] = await pool.query(
      `SELECT 
        SUM(units) as total_units,
        SUM(CASE WHEN status = 'available' THEN units ELSE 0 END) as available_units,
        SUM(CASE WHEN status = 'reserved' THEN units ELSE 0 END) as reserved_units
       FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND status IN ('available', 'reserved')`,
      [bankId]
    );

    // Low stock groups count
    const [lowStock] = await pool.query(
      `SELECT COUNT(*) as count FROM (
        SELECT blood_group, SUM(CASE WHEN status = 'available' THEN units ELSE 0 END) as available
        FROM bloodbank_inventory_items WHERE blood_bank_id = ? AND status IN ('available', 'reserved')
        GROUP BY blood_group HAVING available <= 10
       ) as low`, [bankId]
    );

    // New requests today
    const [newRequests] = await pool.query(
      `SELECT COUNT(*) as count FROM blood_requests WHERE blood_bank_id = ? AND DATE(created_at) = ?`,
      [bankId, today]
    );

    // Today's dispatches
    const [todayDispatches] = await pool.query(
      `SELECT COUNT(*) as count FROM blood_requests WHERE blood_bank_id = ? AND status = 'completed' AND DATE(updated_at) = ?`,
      [bankId, today]
    );

    // Earnings
    const [totalEarnings] = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM blood_requests WHERE blood_bank_id = ? AND status = 'completed' AND payment_status = 'paid'`,
      [bankId]
    );
    const [todayEarnings] = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM blood_requests WHERE blood_bank_id = ? AND status = 'completed' AND payment_status = 'paid' AND DATE(paid_at) = ?`,
      [bankId, today]
    );

    // Blood stock overview (per group)
    const [stockOverview] = await pool.query(
      `SELECT blood_group,
              SUM(CASE WHEN status = 'available' THEN units ELSE 0 END) as available,
              SUM(CASE WHEN status = 'reserved' THEN units ELSE 0 END) as reserved
       FROM bloodbank_inventory_items
       WHERE blood_bank_id = ? AND status IN ('available', 'reserved')
       GROUP BY blood_group ORDER BY blood_group`,
      [bankId]
    );

    // Recent pending requests
    const [recentRequests] = await pool.query(
      `SELECT br.request_id, br.patient_name, br.hospital_name, br.blood_group, br.units_required, br.created_at
       FROM blood_requests br
       WHERE br.blood_bank_id = ? AND br.status = 'pending'
       ORDER BY br.created_at DESC LIMIT 5`,
      [bankId]
    );

    return res.status(200).json({
      message: 'Dashboard fetched.',
      data: {
        stats: {
          total_units: unitStats[0].total_units || 0,
          available_units: unitStats[0].available_units || 0,
          reserved_units: unitStats[0].reserved_units || 0,
          low_stock_groups: lowStock[0].count || 0,
          new_requests_today: newRequests[0].count,
          today_dispatches: todayDispatches[0].count,
          total_earnings: totalEarnings[0].total,
          today_earnings: todayEarnings[0].total,
        },
        stock_overview: stockOverview.map((s) => {
          let status = 'healthy';
          if (s.available <= 5) status = 'critical';
          else if (s.available <= 10) status = 'low_stock';
          return {
            blood_group: s.blood_group,
            available: s.available,
            reserved: s.reserved,
            status,
          };
        }),
        recent_requests: recentRequests.map((r) => ({
          request_id: r.request_id,
          patient_name: r.patient_name,
          hospital_name: r.hospital_name,
          blood_group: r.blood_group,
          units_required: r.units_required,
          created_at: r.created_at,
        })),
      },
    });
  } catch (error) {
    console.error('bloodbank dashboard error:', error.message);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = { getDashboard };
